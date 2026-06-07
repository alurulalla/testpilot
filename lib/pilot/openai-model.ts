/**
 * OpenAI-compatible model — works for OpenAI, Groq, Mistral, xAI, OpenRouter,
 * Ollama, LM Studio, or any other provider that implements the OpenAI Chat
 * Completions API.
 */
import OpenAI from 'openai';
import type { ChatMessage, ChatModel, InvokeOptions, MessageContent } from './types';

export interface CreateOpenAICompatModelOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  providerName?: string;
}

/**
 * Convert our provider-agnostic MessageContent to the OpenAI content format.
 * For vision: images become image_url blocks with a data-URI.
 * Plain strings stay as strings (backward-compatible).
 */
function toOpenAIContent(
  content: MessageContent,
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'auto' } }> {
  if (typeof content === 'string') return content;
  return content.map(block => {
    if (block.type === 'image') {
      return {
        type: 'image_url' as const,
        image_url: {
          url:    `data:${block.mediaType};base64,${block.data}`,
          detail: 'auto' as const,
        },
      };
    }
    return { type: 'text' as const, text: block.text };
  });
}

export async function createOpenAICompatModel(
  options: CreateOpenAICompatModelOptions,
): Promise<ChatModel> {
  const modelName = options.model ?? 'gpt-4o';
  // Local models (Ollama, LM Studio) can be slow — give them 5 minutes.
  // Cloud providers use the default 10-minute OpenAI SDK timeout.
  const isLocal = options.baseUrl?.includes('localhost') || options.baseUrl?.includes('127.0.0.1');
  const client = new OpenAI({
    apiKey: options.apiKey || 'no-key',   // local providers don't need a real key
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    timeout: isLocal ? 300_000 : 120_000, // 5 min for local, 2 min for cloud
  });

  return {
    modelName,
    provider: options.providerName ?? 'openai',

    async invoke(messages: ChatMessage[], invokeOptions?: InvokeOptions): Promise<string> {
      // Some local models (older Ollama builds) don't handle the 'system' role
      // in the messages array. Merge the system prompt into the first user message.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let apiMessages: { role: 'system' | 'user' | 'assistant'; content: any }[];
      if (isLocal) {
        // Local models (Ollama, LM Studio) don't handle system role or image blocks — text only.
        const textOnly = (c: MessageContent) =>
          typeof c === 'string' ? c : c.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('\n');

        const systemParts = messages.filter(m => m.role === 'system').map(m => textOnly(m.content));
        const nonSystem   = messages.filter(m => m.role !== 'system');
        if (systemParts.length > 0 && nonSystem.length > 0) {
          apiMessages = [
            { role: 'user', content: `${systemParts.join('\n\n')}\n\n${textOnly(nonSystem[0].content)}` },
            ...nonSystem.slice(1).map(m => ({
              role: m.role as 'user' | 'assistant',
              content: textOnly(m.content),
            })),
          ];
        } else {
          apiMessages = nonSystem.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: textOnly(m.content),
          }));
        }
      } else {
        apiMessages = messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: toOpenAIContent(m.content),
        }));
      }

      const response = await client.chat.completions.create({
        model: modelName,
        temperature: 0.2,
        messages: apiMessages,
        ...(invokeOptions?.maxTokens ? { max_tokens: invokeOptions.maxTokens } : {}),
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error(`${modelName} returned an empty response`);
      return content;
    },
  };
}
