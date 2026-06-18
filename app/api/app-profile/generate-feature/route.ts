/**
 * POST /api/app-profile/generate-feature  { host, featureId, negative? }
 * GET  /api/app-profile/generate-feature?host=...&featureId=...
 *
 * POST fires test generation as a background job and returns 202 immediately —
 * the client does NOT need to stay connected. Poll GET until status !== 'generating'.
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
import { getFeatureHealth } from '@/lib/feature-health';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';
import { ensureWorkspaceReady, snapshotTestFiles } from '@/lib/session-files';
import { updateSession } from '@/lib/session-store';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';
import { generateScenarioTest } from '@/lib/pilot/generate-scenario';

type JobStatus = 'generating' | 'done' | 'error';
type JobResult = { ok: boolean; sessionId?: string; testFile?: string; testNames?: string[]; error?: string };

const jobs = new Map<string, { status: JobStatus; result?: JobResult }>();

function jobKey(orgId: string, host: string, featureId: string) {
  return `${orgId}:${host}:${featureId}`;
}

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const { searchParams } = new URL(req.url);
    const host = searchParams.get('host');
    const featureId = searchParams.get('featureId');
    if (!host || !featureId) return NextResponse.json({ error: 'host and featureId are required' }, { status: 400 });

    const key = jobKey(org.id, host, featureId);
    const job = jobs.get(key);
    if (!job) return NextResponse.json({ status: 'idle' });

    if (job.status !== 'generating') jobs.delete(key);
    return NextResponse.json({ status: job.status, ...job.result });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string; featureId?: string; negative?: boolean };
    if (!body.host || !body.featureId) {
      return NextResponse.json({ error: 'host and featureId are required' }, { status: 400 });
    }
    const host = body.host;
    const featureId = body.featureId;
    const key = jobKey(org.id, host, featureId);

    // De-duplicate: already generating this feature.
    if (jobs.get(key)?.status === 'generating') {
      return NextResponse.json({ status: 'generating' }, { status: 202 });
    }

    const profile = await getAppProfile(org.id, host);
    const feature = profile?.features.find(f => f.id === featureId);
    if (!feature) return NextResponse.json({ error: 'Feature not found' }, { status: 404 });

    // Find the app's latest session that has a crawl to ground locators in.
    const sessions = await prisma.session.findMany({
      where: { orgId: org.id }, orderBy: { updatedAt: 'desc' },
      select: { id: true, url: true, siteMap: true },
    });
    const src = sessions.find(s => hostOf(s.url) === host && s.siteMap);
    if (!src) return NextResponse.json({ error: 'No crawl available for this app yet — run a session first.' }, { status: 409 });

    // Build all inputs eagerly so the background task has no dangling async init.
    const workspace = new Workspace({ url: src.url, rootDir: getSessionDir(src.id, org.id) });
    await ensureWorkspaceReady(src.id, workspace);

    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const siteMapPages = (src.siteMap as { pages?: { url: string; title: string; elements: Record<string, unknown> }[] } | null)
      ?.pages?.map(p => ({ url: p.url, title: p.title, elements: p.elements })) ?? [];
    const appContext = await getFeatureContext(org.id, host).catch(() => '');

    // Seed the description from the feature's journeys + expected outcomes so the
    // generated test follows the real flow AND asserts the intended result.
    // #4 persona-aware: ground the flow in the app's real user persona(s).
    const personas = (profile?.personas ?? []).map(p => p.name).filter(Boolean);
    const personaHint = personas.length ? ` Exercise it as the app's user persona(s): ${personas.slice(0, 3).join(', ')}.` : '';

    // #12 visual-intent assertion: if this feature has a Figma baseline, the
    // generated test should also assert visual parity (toHaveScreenshot).
    const health = await getFeatureHealth(org.id, host).catch(() => null);
    const fh = health?.features.find(x => x.id === feature.id);
    const hasVisualBaseline = (fh?.visualBaselineCount ?? 0) > 0;
    const visualHint = hasVisualBaseline
      ? ' Also assert visual parity: at the end, call `await expect(page).toHaveScreenshot({ maxDiffPixelRatio: 0.05 });` to catch design regressions against the saved baseline.'
      : '';

    let description: string;
    if (body.negative) {
      if (feature.negativeOutcomes.length === 0) {
        return NextResponse.json({ error: 'This feature has no negative outcomes defined.' }, { status: 409 });
      }
      description = `Negative test for "${feature.name}". Verify the app PREVENTS/REJECTS each of these — assert the failure/blocked state, not success: ${feature.negativeOutcomes.join('; ')}.${personaHint}${visualHint}`;
    } else {
      const journeys = feature.journeys.length ? feature.journeys.join(' ; ') : feature.name;
      const outcomes = feature.expectedOutcomes.length ? ` Verify these outcomes: ${feature.expectedOutcomes.join('; ')}.` : '';
      const invariants = feature.invariants.length ? ` Also assert these invariants hold across the flow: ${feature.invariants.join('; ')}.` : '';
      description = `${feature.name} — ${journeys}.${outcomes}${invariants}${personaHint}${visualHint}`;
    }

    jobs.set(key, { status: 'generating' });

    // Fire and forget — intentionally not awaited.
    generateScenarioTest({ description, workspace, model, siteMapPages, appContext })
      .then(async (gen) => {
        updateSession(src.id, { testFiles: workspace.testFiles() });
        await snapshotTestFiles(src.id, workspace);
        jobs.set(key, {
          status: 'done',
          result: { ok: true, sessionId: src.id, testFile: gen.testFile.split('/').pop(), testNames: gen.matchedTests },
        });
      })
      .catch((err) => {
        console.error('[generate-feature] background job failed:', err);
        jobs.set(key, { status: 'error', result: { ok: false, error: err instanceof Error ? err.message : String(err) } });
      });

    return NextResponse.json({ status: 'generating' }, { status: 202 });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
