/**
 * Anthropic (Claude) chat model — uses @anthropic-ai/sdk directly.
 *
 * Cost optimisations built in:
 *
 * 1. PROMPT CACHING — system messages and long first-user-message blocks are
 *    automatically marked with cache_control: {type: "ephemeral"}.  Anthropic
 *    stores them for 5 minutes; cache reads cost 10% of normal input price.
 *    Minimum cacheable size is 1 024 tokens (~4 000 chars) — blocks shorter
 *    than that are sent un-cached so we never pay the write surcharge for tiny
 *    prompts that wouldn't save anything.
 *
 * 2. PER-CALL max_tokens — callers can pass { maxTokens } to cap output size
 *    for phases that produce short responses (review, triage, fix).  Defaults
 *    to 16 384 (same as before) when not specified.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatModel } from './types';

export interface CreateAnthropicModelOptions {
  apiKey: string;
  model?: string;
}

/** Minimum character count before we apply cache_control (~1 024 tokens). */
const CACHE_MIN_CHARS = 4_000;

export async function createAnthropicModel(
  options: CreateAnthropicModelOptions,
): Promise<ChatModel> {
  const modelName = options.model ?? 'claude-sonnet-4-20250514';
  const client = new Anthropic({ apiKey: options.apiKey });

  return {
    modelName,
    provider: 'anthropic',

    async invoke(
      messages: ChatMessage[],
      invokeOptions?: { maxTokens?: number },
    ): Promise<string> {
      const maxTokens = invokeOptions?.maxTokens ?? 16_384;

      const systemMessages    = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      // ── System blocks (with automatic caching for long prompts) ─────────────
      const systemBlocks: Anthropic.TextBlockParam[] = systemMessages.map((m, i) => {
        const isLast  = i === systemMessages.length - 1;
        const isLong  = m.content.length >= CACHE_MIN_CHARS;
        return {
          type: 'text',
          text: m.content,
          ...(isLast && isLong ? { cache_control: { type: 'ephemeral' } } : {}),
        };
      });

      // ── User / assistant messages ─────────────────────────────────────────
      // Cache the first user message when it's large (typically the context
      // block that contains the interactives table or product documentation —
      // the same content is reused across many calls in a session).
      const builtMessages: Anthropic.MessageParam[] = nonSystemMessages.map((m, i) => {
        const cacheThisBlock =
          i === 0 &&
          m.role === 'user' &&
          m.content.length >= CACHE_MIN_CHARS;

        return {
          role: m.role as 'user' | 'assistant',
          content: cacheThisBlock
            ? [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
            : m.content,
        };
      });

      const response = await client.messages.create({
        model: modelName,
        max_tokens: maxTokens,
        ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
        messages: builtMessages,
      });

      const block = response.content[0];
      if (block.type !== 'text') {
        throw new Error(`Unexpected Anthropic response block type: ${block.type}`);
      }
      return block.text;
    },
  };
}
