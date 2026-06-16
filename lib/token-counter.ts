/**
 * Token-counter + stop-check wrappers for ChatModel.
 *
 * withTokenCounter — accumulates token usage across every invoke() call.
 * withStopCheck    — throws StopError before any invoke() when shouldStop() is true.
 *
 * Stack them: withTokenCounter(withStopCheck(withRateLimit(base), shouldStop))
 * so every LLM call in every pipeline phase respects the user's Stop button
 * without needing changes at each call site.
 */
import type { ChatModel, InvokeOptions, ChatMessage, TokenUsage } from '@/lib/pilot/types';

/** Thrown when the user clicks Stop mid-pipeline. Caught by the loop route's top-level handler. */
export class StopError extends Error {
  constructor() {
    super('Session stopped by user');
    this.name = 'StopError';
  }
}

export interface TokenCounterModel extends ChatModel {
  /** Running accumulated usage since construction (or last reset). */
  getUsage(): TokenUsage;
  /** Zero the counter (e.g. between loop iterations). */
  reset(): void;
}

export function withTokenCounter(model: ChatModel): TokenCounterModel {
  let acc: TokenUsage = { input: 0, output: 0, cacheRead: 0 };

  return {
    get modelName() { return model.modelName; },
    get provider()  { return model.provider; },

    async invoke(messages: ChatMessage[], options?: InvokeOptions): Promise<string> {
      return model.invoke(messages, {
        ...options,
        onUsage(u) {
          acc = { input: acc.input + u.input, output: acc.output + u.output, cacheRead: acc.cacheRead + u.cacheRead };
          options?.onUsage?.(u);
        },
      });
    },

    getUsage: () => ({ ...acc }),
    reset:    () => { acc = { input: 0, output: 0, cacheRead: 0 }; },
  };
}

/**
 * Wraps a ChatModel to throw StopError before any invoke() call when
 * shouldStop() returns true.  Stack this beneath withTokenCounter so the
 * counter still accumulates on successful calls while stops propagate cleanly.
 */
export function withStopCheck(model: ChatModel, shouldStop: () => boolean): ChatModel {
  return {
    get modelName() { return model.modelName; },
    get provider()  { return model.provider; },
    async invoke(messages: ChatMessage[], options?: InvokeOptions): Promise<string> {
      if (shouldStop()) throw new StopError();
      return model.invoke(messages, options);
    },
  };
}
