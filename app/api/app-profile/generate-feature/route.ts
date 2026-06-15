/**
 * POST /api/app-profile/generate-feature  { host, featureId }
 *
 * Coverage-driven generation (#1): generate an e2e spec for ONE feature, seeded
 * from its journeys (steps) + expected outcomes (assertions) — so the test
 * verifies the real outcome, not just "page rendered" (#3). Saves the spec to the
 * app's latest session suite; the user runs it from there.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAppProfile, hostOf } from '@/lib/app-profile';
import { getFeatureContext } from '@/lib/feature-context';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';
import { ensureWorkspaceReady, snapshotTestFiles } from '@/lib/session-files';
import { updateSession } from '@/lib/session-store';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { generateScenarioTest } from '@/lib/pilot/generate-scenario';

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string; featureId?: string };
    if (!body.host || !body.featureId) {
      return NextResponse.json({ error: 'host and featureId are required' }, { status: 400 });
    }
    const host = body.host;

    const profile = await getAppProfile(org.id, host);
    const feature = profile?.features.find(f => f.id === body.featureId);
    if (!feature) return NextResponse.json({ error: 'Feature not found' }, { status: 404 });

    // Find the app's latest session that has a crawl to ground locators in.
    const sessions = await prisma.session.findMany({
      where: { orgId: org.id }, orderBy: { updatedAt: 'desc' },
      select: { id: true, url: true, siteMap: true },
    });
    const src = sessions.find(s => hostOf(s.url) === host && s.siteMap);
    if (!src) return NextResponse.json({ error: 'No crawl available for this app yet — run a session first.' }, { status: 409 });

    const workspace = new Workspace({ url: src.url, rootDir: getSessionDir(src.id, org.id) });
    await ensureWorkspaceReady(src.id, workspace);

    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const siteMapPages = (src.siteMap as { pages?: { url: string; title: string; elements: Record<string, unknown> }[] } | null)
      ?.pages?.map(p => ({ url: p.url, title: p.title, elements: p.elements })) ?? [];
    const appContext = await getFeatureContext(org.id, host).catch(() => '');

    // Seed the description from the feature's journeys + expected outcomes so the
    // generated test follows the real flow AND asserts the intended result.
    const journeys = feature.journeys.length ? feature.journeys.join(' ; ') : feature.name;
    const outcomes = feature.expectedOutcomes.length ? ` Verify these outcomes: ${feature.expectedOutcomes.join('; ')}.` : '';
    // #4 persona-aware: ground the flow in the app's real user persona(s).
    const personas = (profile?.personas ?? []).map(p => p.name).filter(Boolean);
    const personaHint = personas.length ? ` Exercise it as the app's user persona(s): ${personas.slice(0, 3).join(', ')}.` : '';
    const description = `${feature.name} — ${journeys}.${outcomes}${personaHint}`;

    const gen = await generateScenarioTest({ description, workspace, model, siteMapPages, appContext });

    updateSession(src.id, { testFiles: workspace.testFiles() });
    await snapshotTestFiles(src.id, workspace);

    return NextResponse.json({
      ok: true,
      sessionId: src.id,
      testFile: gen.testFile.split('/').pop(),
      testNames: gen.matchedTests,
    });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
