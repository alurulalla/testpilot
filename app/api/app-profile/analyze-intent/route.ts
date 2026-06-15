/**
 * POST /api/app-profile/analyze-intent  { host }  — intent-coverage scoring (#1).
 *
 * Audits whether each feature's tests actually ASSERT its expected outcomes (not
 * just "a test exists"), and persists a per-feature intent-coverage %. One
 * batched LLM call. Org-scoped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { analyzeIntentCoverage } from '@/lib/app-profile';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string };
    if (!body.host) return NextResponse.json({ error: 'host is required' }, { status: 400 });

    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const profile = await analyzeIntentCoverage(org.id, body.host, model);
    return NextResponse.json(profile);
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return authErr;
    // Surface the real cause so 500s aren't opaque (LLM-config missing, etc.).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[analyze-intent] failed:', err);
    return NextResponse.json({ error: message || 'Internal error' }, { status: 500 });
  }
}
