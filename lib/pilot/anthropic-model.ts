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
import type { ChatMessage, ChatModel, MessageContent } from './types';

export interface CreateAnthropicModelOptions {
  apiKey: string;
  model?: string;
}

/** Minimum character count before we apply cache_control (~1 024 tokens). */
const CACHE_MIN_CHARS = 4_000;

/**
 * Convert our provider-agnostic MessageContent to Anthropic content block array.
 * Handles plain strings, text blocks, and base64 image blocks.
 */
function toAnthropicContent(
  content: MessageContent,
  applyCache = false,
): Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [{ type: 'text', text: content, ...(applyCache ? { cache_control: { type: 'ephemeral' as const } } : {}) } as any];
  }
  return content.map((block, i): Anthropic.ContentBlockParam => {
    if (block.type === 'image') {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: block.mediaType as Anthropic.Base64ImageSource['media_type'],
          data: block.data,
        },
      };
    }
    // Text block — cache only the first one when requested
    const shouldCache = applyCache && i === 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { type: 'text', text: block.text, ...(shouldCache ? { cache_control: { type: 'ephemeral' as const } } : {}) } as any;
  });
}

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
      invokeOptions?: { maxTokens?: number; temperature?: number },
    ): Promise<string> {
      const maxTokens = invokeOptions?.maxTokens ?? 16_384;
      const temperature = invokeOptions?.temperature;

      const systemMessages    = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      // ── System blocks (with automatic caching for long prompts) ─────────────
      // System messages are always plain strings — safe to cast
      const systemBlocks: Anthropic.TextBlockParam[] = systemMessages.map((m, i) => {
        const text    = m.content as string;
        const isLast  = i === systemMessages.length - 1;
        const isLong  = text.length >= CACHE_MIN_CHARS;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { type: 'text', text, ...(isLast && isLong ? { cache_control: { type: 'ephemeral' } } : {}) } as any;
      });

      // ── User / assistant messages ─────────────────────────────────────────
      // Cache the first user message when it's large (typically the context
      // block that contains the interactives table or product documentation —
      // the same content is reused across many calls in a session).
      const builtMessages: Anthropic.MessageParam[] = nonSystemMessages.map((m, i) => {
        // For caching, measure character length of text portions only
        const textLen = typeof m.content === 'string'
          ? m.content.length
          : m.content.filter(b => b.type === 'text').reduce((n, b) => n + (b as {type:'text';text:string}).text.length, 0);

        const cacheThisBlock = i === 0 && m.role === 'user' && textLen >= CACHE_MIN_CHARS;

        return {
          role: m.role as 'user' | 'assistant',
          content: toAnthropicContent(m.content, cacheThisBlock),
        };
      });

      const response = await client.messages.create({
        model: modelName,
        max_tokens: maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
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
