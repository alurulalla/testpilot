/**
 * App Profile API — read and edit the per-app feature-context "brief".
 *
 *   GET   /api/app-profile?host=<hostname>           → { ...AppProfileRecord, rebuilding?: boolean }
 *   PATCH /api/app-profile  { host, profile?, feature?, deleteFeatureId? }
 *           profile         → update narrative fields (purpose/personas/glossary/env)
 *           feature         → create/update one feature
 *           deleteFeatureId → remove a feature
 *   POST  /api/app-profile  { host }  — fire-and-forget rebuild; returns 202 { status: 'building' }
 *                                       immediately so callers can navigate away safely.
 *                                       Poll GET until rebuilding === false.
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

type JobStatus = 'building' | 'done' | 'error';
const jobs = new Map<string, JobStatus>();
function jobKey(orgId: string, host: string) { return `${orgId}:${host}`; }

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = req.nextUrl.searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    const profile = await getAppProfile(org.id, host);
    const key = jobKey(org.id, host);
    const jobStatus = jobs.get(key);
    const rebuilding = jobStatus === 'building';
    if (jobStatus === 'done' || jobStatus === 'error') jobs.delete(key);
    return NextResponse.json(profile ? { ...profile, rebuilding } : null);
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
 * POST /api/app-profile  { host }  — fire-and-forget rebuild from the latest
 * crawl + doc + figma (preserving user-edited features). Returns 202 immediately
 * so the client can navigate away. Poll GET until rebuilding === false.
 */
export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string };
    if (!body.host) return NextResponse.json({ error: 'host is required' }, { status: 400 });
    const host = body.host;
    const key = jobKey(org.id, host);

    // De-duplicate: if already building, report current status.
    if (jobs.get(key) === 'building') {
      return NextResponse.json({ status: 'building' }, { status: 202 });
    }

    // Find the most recent session for this app that has a crawl to build from.
    const sessions = await prisma.session.findMany({
      where: { orgId: org.id },
      orderBy: { updatedAt: 'desc' },
      select: { url: true, siteMap: true, contextDoc: true, figmaFrameMap: true },
    });
    const src = sessions.find(s => hostOf(s.url) === host && s.siteMap);
    if (!src) return NextResponse.json({ error: 'No crawl available for this app yet — run a session first.' }, { status: 409 });

    // Build model eagerly before the background task so there's no dangling async init.
    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const frameMap = (src.figmaFrameMap ?? null) as Record<string, string> | null;
    const figmaContext = frameMap && Object.keys(frameMap).length ? `Figma screens: ${Object.keys(frameMap).join(', ')}` : null;
    const siteMap = src.siteMap;

    jobs.set(key, 'building');

    // Fire and forget — intentionally not awaited.
    buildAppProfile({ orgId: org.id, host, siteMap, docContent: src.contextDoc ?? null, figmaContext, model })
      .then(() => tagTestsToFeatures(org.id, host).catch(() => 0))
      .then(() => { jobs.set(key, 'done'); })
      .catch((err) => {
        console.error('[app-profile rebuild] background job failed:', err);
        jobs.set(key, 'error');
      });

    return NextResponse.json({ status: 'building' }, { status: 202 });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
