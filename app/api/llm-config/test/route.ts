/**
 * POST /api/llm-config/test
 *
 * Sends a minimal "ping" request to the configured LLM provider so the user
 * can verify their API key and model name are correct before running tests.
 *
 * Returns: { ok: true, model: string } on success
 *          { ok: false, error: string } on failure (auth error, bad model, etc.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig, resolveApiKey } from '@/lib/pilot/model-factory';
import type { LlmConfig } from '@/lib/pilot/model-factory';

export async function POST(req: NextRequest) {
  // Caller may send an in-progress config (not yet saved) to test before saving
  let config: LlmConfig;
  try {
    const body = await req.json().catch(() => null);
    if (body && body.provider) {
      // Merge with stored config so we preserve the saved key when none is typed
      const stored = getLlmConfig();
      config = {
        provider: body.provider ?? stored.provider,
        model:    body.model    ?? stored.model,
        apiKey:   (body.apiKey && body.apiKey.trim()) ? body.apiKey.trim() : stored.apiKey,
        baseUrl:  (body.baseUrl && body.baseUrl.trim()) ? body.baseUrl.trim() : stored.baseUrl,
      };
    } else {
      config = getLlmConfig();
    }
  } catch {
    config = getLlmConfig();
  }

  try {
    const model = await createModelFromConfig(config);
    // Minimal prompt — just enough to get a response confirming the key/model work
    const response = await model.invoke([
      { role: 'user', content: 'Reply with exactly one word: ready' },
    ]);

    return NextResponse.json({
      ok: true,
      model: config.model,
      provider: config.provider,
      response: response.trim().slice(0, 50),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Classify the error so the UI can show a targeted hint
    const isAuthError = msg.includes('401') || msg.includes('authentication') ||
      msg.includes('invalid') && msg.toLowerCase().includes('key') ||
      msg.includes('Unauthorized') || msg.includes('API key');
    const isModelError = msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist'));
    const isNetworkError = msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('fetch failed');

    let hint = '';
    if (isAuthError)   hint = 'Check that your API key is correct and has not been revoked.';
    else if (isModelError) hint = `The model "${config.model}" was not found. Try a different model name.`;
    else if (isNetworkError) hint = 'Could not reach the provider. Check the Base URL and that the service is running.';

    return NextResponse.json({ ok: false, error: msg, hint }, { status: 200 });
    // Note: always 200 so the client can read the body
  }
}
