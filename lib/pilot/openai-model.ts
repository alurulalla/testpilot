/**
 * OpenAI-compatible model — works for OpenAI, Groq, Mistral, xAI, OpenRouter,
 * Ollama, LM Studio, or any other provider that implements the OpenAI Chat
 * Completions API.
 */
import OpenAI from 'openai';
import type { ChatMessage, ChatModel, InvokeOptions } from './types';

export interface CreateOpenAICompatModelOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  providerName?: string;
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
      let apiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      if (isLocal) {
        const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
        const nonSystem   = messages.filter(m => m.role !== 'system');
        if (systemParts.length > 0 && nonSystem.length > 0) {
          apiMessages = [
            { role: 'user', content: `${systemParts.join('\n\n')}\n\n${nonSystem[0].content}` },
            ...nonSystem.slice(1).map(m => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })),
          ];
        } else {
          apiMessages = nonSystem.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
        }
      } else {
        apiMessages = messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
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
