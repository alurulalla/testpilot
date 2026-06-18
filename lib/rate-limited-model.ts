import type { ChatModel, InvokeOptions } from '@/lib/pilot';
import { StopError } from '@/lib/token-counter';

/** Local providers (Ollama, LM Studio) don't need rate-limit delays. */
const LOCAL_PROVIDERS = new Set(['ollama', 'lmstudio']);

function isRateLimitError(msg: string) {
  return msg.includes('429') || msg.includes('rate_limit_error');
}

function isTransientError(msg: string) {
  return (
    msg.includes('Connection error') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('socket hang up') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('overloaded_error') ||
    msg.includes('Premature close') ||       // undici: server closed stream before completion
    msg.includes('Invalid response body') || // fetch wrapper around premature-close
    msg.includes('ERR_STREAM_PREMATURE_CLOSE')
  );
}

/** Sleep that wakes up early if shouldStop() returns true. */
async function interruptibleSleep(ms: number, shouldStop?: () => boolean): Promise<void> {
  const interval = 500;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop?.()) throw new StopError();
    await new Promise(r => setTimeout(r, Math.min(interval, end - Date.now())));
  }
}

/**
 * Wraps a ChatModel to retry on rate-limit (429) and transient network errors.
 * For cloud providers a small proactive delay is added between calls so bursts
 * of sequential invocations stay within free-tier token limits.
 * Local providers (Ollama, LM Studio) skip the delay entirely.
 *
 * Pass shouldStop to make retry waits interruptible by the Stop button.
 */
export function withRateLimit(model: ChatModel, delayMs = 3000, shouldStop?: () => boolean): ChatModel {
  const isLocal = LOCAL_PROVIDERS.has(model.provider);
  const effectiveDelay = isLocal ? 0 : delayMs;

  return {
    ...model,
    async invoke(messages, options?: InvokeOptions) {
      if (effectiveDelay > 0) {
        await interruptibleSleep(effectiveDelay, shouldStop);
      }

      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          return await model.invoke(messages, options);
        } catch (err) {
          if (err instanceof StopError) throw err; // propagate stop immediately
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt === 5) throw err;

          if (isRateLimitError(msg)) {
            const wait = 20_000 * (attempt + 1); // 20s, 40s, 60s …
            console.log(`Rate limit hit — retrying in ${wait / 1000}s (attempt ${attempt + 1}/5)…`);
            await interruptibleSleep(wait, shouldStop);
          } else if (isTransientError(msg)) {
            const wait = 5_000 * (attempt + 1); // 5s, 10s, 15s …
            console.log(`Connection error — retrying in ${wait / 1000}s (attempt ${attempt + 1}/5)…`);
            await interruptibleSleep(wait, shouldStop);
          } else {
            throw err; // non-retryable error
          }
        }
      }
      throw new Error('Max retries exceeded');
    },
  };
}
