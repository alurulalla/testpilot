/**
 * Google Gemini model via @google/genai SDK.
 */
import { GoogleGenAI } from '@google/genai';
import type { ChatMessage, ChatModel, InvokeOptions, MessageContent } from './types';

export interface CreateGeminiModelOptions {
  apiKey: string;
  model?: string;
}

/**
 * Convert our provider-agnostic MessageContent to Gemini Part array.
 * Text → { text } · Image → { inlineData: { mimeType, data } }
 */
function toGeminiParts(content: MessageContent): { text?: string; inlineData?: { mimeType: string; data: string } }[] {
  if (typeof content === 'string') return [{ text: content }];
  return content.map(block => {
    if (block.type === 'image') return { inlineData: { mimeType: block.mediaType, data: block.data } };
    return { text: block.text };
  });
}

export async function createGeminiModel(
  options: CreateGeminiModelOptions,
): Promise<ChatModel> {
  const modelName = options.model ?? 'gemini-2.0-flash';
  const client = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    modelName,
    provider: 'gemini',

    async invoke(messages: ChatMessage[], invokeOptions?: InvokeOptions): Promise<string> {
      const systemMessages    = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      const contents = nonSystemMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toGeminiParts(m.content),
      }));

      const response = await client.models.generateContent({
        model: modelName,
        contents,
        config: {
          ...(systemMessages.length > 0
            ? { systemInstruction: systemMessages.map(m => m.content).join('\n\n') }
            : {}),
          temperature: invokeOptions?.temperature ?? 0.2,
          ...(invokeOptions?.maxTokens ? { maxOutputTokens: invokeOptions.maxTokens } : {}),
        },
      });

      const text = response.text;
      if (!text) throw new Error('Gemini returned an empty response');
      return text;
    },
  };
}
