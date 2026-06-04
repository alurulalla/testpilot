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

/**
 * Strip API keys from error messages before sending to the client.
 * SDK errors (Anthropic, OpenAI, Google, etc.) sometimes echo the key back in
 * the message string. We redact both the known key and common key-shaped tokens.
 */
function sanitizeErrorMessage(msg: string, apiKey?: string): string {
  let s = msg;
  // Redact the exact key if we know it (and it's long enough to be meaningful)
  if (apiKey && apiKey.length > 8) {
    s = s.replaceAll(apiKey, '[REDACTED]');
  }
  // Redact common provider key patterns regardless
  s = s.replace(/sk-ant-[a-zA-Z0-9\-_]{10,}/g, '[REDACTED]');   // Anthropic
  s = s.replace(/sk-[a-zA-Z0-9\-_]{10,}/g,     '[REDACTED]');   // OpenAI / generic
  s = s.replace(/AIza[a-zA-Z0-9\-_]{10,}/g,    '[REDACTED]');   // Google
  s = s.replace(/ya29\.[a-zA-Z0-9\-_]{10,}/g,  '[REDACTED]');   // Google OAuth
  s = s.replace(/gsk_[a-zA-Z0-9\-_]{10,}/g,    '[REDACTED]');   // Groq
  return s;
}

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
    const raw = err instanceof Error ? err.message : String(err);

    // Sanitize before returning — SDK error strings often echo back the API key.
    const sanitized = sanitizeErrorMessage(raw, config.apiKey);

    // Classify the error so the UI can show a targeted hint
    const isAuthError = raw.includes('401') || raw.includes('authentication') ||
      raw.includes('invalid') && raw.toLowerCase().includes('key') ||
      raw.includes('Unauthorized') || raw.includes('API key');
    const isModelError = raw.includes('model') && (raw.includes('not found') || raw.includes('does not exist'));
    const isNetworkError = raw.includes('ECONNREFUSED') || raw.includes('ETIMEDOUT') || raw.includes('fetch failed');

    let hint = '';
    if (isAuthError)   hint = 'Check that your API key is correct and has not been revoked.';
    else if (isModelError) hint = `The model "${config.model}" was not found. Try a different model name.`;
    else if (isNetworkError) hint = 'Could not reach the provider. Check the Base URL and that the service is running.';

    return NextResponse.json({ ok: false, error: sanitized, hint }, { status: 200 });
    // Note: always 200 so the client can read the body
  }
}
