/**
 * Anthropic (Claude) chat model — uses @anthropic-ai/sdk directly
 * for TestPilot — uses @anthropic-ai/sdk directly.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatModel } from './types';

export interface CreateAnthropicModelOptions {
  apiKey: string;
  model?: string;
}

export async function createAnthropicModel(
  options: CreateAnthropicModelOptions,
): Promise<ChatModel> {
  const modelName = options.model ?? 'claude-sonnet-4-20250514';
  const client = new Anthropic({ apiKey: options.apiKey });

  return {
    modelName,
    provider: 'anthropic',

    async invoke(messages: ChatMessage[]): Promise<string> {
      const systemMessages = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');

      const response = await client.messages.create({
        model: modelName,
        max_tokens: 16384,
        ...(systemMessages.length > 0
          ? { system: systemMessages.map(m => m.content).join('\n\n') }
          : {}),
        messages: nonSystemMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      const block = response.content[0];
      if (block.type !== 'text') {
        throw new Error(`Unexpected Anthropic response block type: ${block.type}`);
      }
      return block.text;
    },
  };
}
