import { NextRequest, NextResponse } from 'next/server';
import { getLlmConfig, saveLlmConfig, getMaskedLlmConfig } from '@/lib/llm-config-store';
import type { LlmConfig } from '@/lib/pilot/model-factory';
import { getProvider } from '@/lib/pilot/providers';

/** GET /api/llm-config — return current config (API key masked). */
export async function GET() {
  const cfg = getMaskedLlmConfig();
  return NextResponse.json(cfg);
}

/** POST /api/llm-config — save a new config. */
export async function POST(req: NextRequest) {
  let body: Partial<LlmConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { provider, model, apiKey, baseUrl } = body;

  if (!provider || typeof provider !== 'string') {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }
  if (!model || typeof model !== 'string') {
    return NextResponse.json({ error: 'model is required' }, { status: 400 });
  }

  const providerDef = getProvider(provider);
  if (!providerDef) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  // Preserve the existing stored key if the client didn't send a new one
  // (the UI sends an empty string when no key was typed)
  const existing = getLlmConfig();
  const resolvedKey = (apiKey && apiKey.trim())
    ? apiKey.trim()
    : existing.apiKey;

  const newConfig: LlmConfig = {
    provider,
    model,
    apiKey:  resolvedKey,
    baseUrl: (baseUrl && baseUrl.trim()) ? baseUrl.trim() : undefined,
  };

  saveLlmConfig(newConfig);
  return NextResponse.json({ ok: true });
}
