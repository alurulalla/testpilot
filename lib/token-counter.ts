/**
 * Token-counter wrapper for ChatModel.
 *
 * Wraps any ChatModel and intercepts every invoke() call to accumulate token
 * usage (input, output, cache hits) transparently — no changes needed at call
 * sites.  Use getUsage() to read the running total and reset() to clear it
 * between phases or iterations.
 */
import type { ChatModel, InvokeOptions, ChatMessage, TokenUsage } from '@/lib/pilot/types';

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
