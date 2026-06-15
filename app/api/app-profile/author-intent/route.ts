/**
 * POST /api/app-profile/author-intent  { text }  — NL intent authoring (#8).
 *
 * Convert plain English ("a shopper must see a confirmation number after
 * paying") into structured intent (journeys + expected/negative outcomes), so
 * the user can paste a paragraph and get a properly-shaped feature definition.
 * One LLM call. Returns the structured fields; the client decides whether to
 * create or update a feature with them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { authorIntentFromText } from '@/lib/app-profile';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    if (!body.text?.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 });

    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const intent = await authorIntentFromText(body.text, model);
    if (!intent) return NextResponse.json({ error: 'Could not parse intent — try a more concrete description.' }, { status: 422 });
    return NextResponse.json(intent);
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return authErr;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[author-intent] failed:', err);
    return NextResponse.json({ error: message || 'Internal error' }, { status: 500 });
  }
}
