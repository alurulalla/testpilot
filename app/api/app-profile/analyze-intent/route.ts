/**
 * POST /api/app-profile/analyze-intent  { host }
 * GET  /api/app-profile/analyze-intent?host=...
 *
 * POST fires the intent-coverage audit as a background job and returns 202
 * immediately — the client does NOT need to stay connected. The LLM work
 * continues on the server and writes results to the DB when done.
 *
 * GET returns the current job status: 'idle' | 'analyzing' | 'done' | 'error'.
 * When status is 'done', the response also includes the updated profile so the
 * client can refresh without a second request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { analyzeIntentCoverage, getAppProfile } from '@/lib/app-profile';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';

type JobStatus = 'analyzing' | 'done' | 'error';

// Module-level status map — survives across requests within the same server
// process. Acceptable for this use case: if the server restarts mid-analysis
// the job is lost, but the profile page will simply show no spinner on reload.
const jobs = new Map<string, JobStatus>();

function jobKey(orgId: string, host: string) { return `${orgId}:${host}`; }

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string };
    if (!body.host) return NextResponse.json({ error: 'host is required' }, { status: 400 });

    const key = jobKey(org.id, body.host);

    // De-duplicate: if already running, just report the current status.
    if (jobs.get(key) === 'analyzing') {
      return NextResponse.json({ status: 'analyzing' }, { status: 202 });
    }

    // Build the model now (async) before firing the background job so we don't
    // have dangling async init inside a floating promise.
    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));

    jobs.set(key, 'analyzing');

    // Fire and forget — intentionally not awaited.
    analyzeIntentCoverage(org.id, body.host, model)
      .then(() => { jobs.set(key, 'done'); })
      .catch((err) => {
        console.error('[analyze-intent] background job failed:', err);
        jobs.set(key, 'error');
      });

    return NextResponse.json({ status: 'analyzing' }, { status: 202 });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return authErr;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[analyze-intent] setup failed:', err);
    return NextResponse.json({ error: message || 'Internal error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const host = new URL(req.url).searchParams.get('host');
    if (!host) return NextResponse.json({ error: 'host is required' }, { status: 400 });

    const key = jobKey(org.id, host);
    const status = jobs.get(key) ?? 'idle';

    if (status === 'done') {
      jobs.delete(key);
      const profile = await getAppProfile(org.id, host).catch(() => null);
      return NextResponse.json({ status: 'done', profile });
    }

    return NextResponse.json({ status });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return authErr;
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
