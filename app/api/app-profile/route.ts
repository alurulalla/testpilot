/**
 * App Profile API — read and edit the per-app feature-context "brief".
 *
 *   GET   /api/app-profile?host=<hostname>           → AppProfileRecord | null
 *   PATCH /api/app-profile  { host, profile?, feature?, deleteFeatureId? }
 *           profile         → update narrative fields (purpose/personas/glossary/env)
 *           feature         → create/update one feature
 *           deleteFeatureId → remove a feature
 *
 * Org-scoped via the authenticated session (same pattern as /api/trends).
 * Building/synthesizing happens during the crawl loop, not here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import {
  getAppProfile, updateAppProfile, upsertFeature, deleteFeature, setFeatureQuarantine,
  buildAppProfile, tagTestsToFeatures, hostOf,
  type ProfilePatch, type FeaturePatch,
} from '@/lib/app-profile';
import { prisma } from '@/lib/prisma';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = req.nextUrl.searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    return NextResponse.json(await getAppProfile(org.id, host));
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

interface PatchBody {
  host?: string;
  profile?: ProfilePatch;
  feature?: FeaturePatch;
  deleteFeatureId?: string;
  quarantine?: { featureId: string; quarantined: boolean };
}

export async function PATCH(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    if (!body.host) return NextResponse.json({ error: 'host is required' }, { status: 400 });

    let result = await getAppProfile(org.id, body.host);
    if (body.profile) result = await updateAppProfile(org.id, body.host, body.profile);
    if (body.feature) result = await upsertFeature(org.id, body.host, body.feature);
    if (body.deleteFeatureId) result = await deleteFeature(org.id, body.host, body.deleteFeatureId);
    if (body.quarantine) result = await setFeatureQuarantine(org.id, body.host, body.quarantine.featureId, body.quarantine.quarantined);

    return NextResponse.json(result);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/app-profile  { host }  — force a rebuild from the latest crawl +
 * current doc + figma (preserving user-edited features). Used by the "Rebuild"
 * button when the doc/design changed but no run is queued.
 */
export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string };
    if (!body.host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    const host = body.host;

    // Find the most recent session for this app that has a crawl to build from.
    const sessions = await prisma.session.findMany({
      where: { orgId: org.id },
      orderBy: { updatedAt: 'desc' },
      select: { url: true, siteMap: true, contextDoc: true, figmaFrameMap: true },
    });
    const src = sessions.find(s => hostOf(s.url) === host && s.siteMap);
    if (!src) return NextResponse.json({ error: 'No crawl available for this app yet — run a session first.' }, { status: 409 });

    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const frameMap = (src.figmaFrameMap ?? null) as Record<string, string> | null;
    const figmaContext = frameMap && Object.keys(frameMap).length ? `Figma screens: ${Object.keys(frameMap).join(', ')}` : null;

    const profile = await buildAppProfile({
      orgId: org.id, host, siteMap: src.siteMap,
      docContent: src.contextDoc ?? null, figmaContext, model,
    });
    await tagTestsToFeatures(org.id, host).catch(() => 0);
    return NextResponse.json(profile);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
