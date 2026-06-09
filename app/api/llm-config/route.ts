import { NextRequest, NextResponse } from 'next/server';
import { getOrgLlmSettings, saveOrgLlmSettings } from '@/lib/llm-config-store';
import { getProvider } from '@/lib/pilot/providers';
import { requireAuth, requireOrgAdmin, authErrorResponse } from '@/lib/auth';

/** GET /api/llm-config — the current org's provider/model selection. */
export async function GET() {
  try {
    const { org } = await requireAuth();
    const settings = await getOrgLlmSettings(org.id);
    return NextResponse.json(settings);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/** POST /api/llm-config — save the org's provider/model selection (admin only). */
export async function POST(req: NextRequest) {
  let orgCtx: Awaited<ReturnType<typeof requireOrgAdmin>>;
  try {
    orgCtx = await requireOrgAdmin();
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  let body: { provider?: string; model?: string; baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { provider, model, baseUrl } = body;
  if (!provider || typeof provider !== 'string') {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }
  if (!model || typeof model !== 'string') {
    return NextResponse.json({ error: 'model is required' }, { status: 400 });
  }
  if (!getProvider(provider)) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  await saveOrgLlmSettings(orgCtx.org.id, {
    provider,
    model,
    baseUrl: (baseUrl && baseUrl.trim()) ? baseUrl.trim() : undefined,
  });

  return NextResponse.json({ ok: true });
}
