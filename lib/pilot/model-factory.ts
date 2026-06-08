/**
 * Model factory — creates the correct ChatModel based on the stored LLM config.
 *
 * API keys come exclusively from the org-level key store (OrgApiKey table),
 * surfaced via config.apiKey by getOrgLlmConfig(). Keys are NEVER read from
 * environment variables or .env.local — every organisation supplies its own
 * keys through the settings UI.
 */
import type { ChatModel } from './types';
import { createAnthropicModel } from './anthropic-model';
import { createGeminiModel }    from './gemini-model';
import { createOpenAICompatModel } from './openai-model';
import { getProvider, DEFAULT_PROVIDER_ID, DEFAULT_MODEL } from './providers';

export interface LlmConfig {
  provider: string;
  model: string;
  /** API key from the org key store (OrgApiKey). Empty → model call will fail. */
  apiKey?: string;
  /** Custom base URL (used by Ollama, LM Studio, Azure, etc.) */
  baseUrl?: string;
}

/** Resolve the API key. Only the org-supplied key is used — no env fallback. */
export function resolveApiKey(config: LlmConfig): string | undefined {
  return config.apiKey || undefined;
}

export async function createModelFromConfig(config: LlmConfig): Promise<ChatModel> {
  const providerDef = getProvider(config.provider);
  const sdk = providerDef?.sdk ?? 'openai-compat';

  switch (sdk) {
    case 'anthropic': {
      const key = resolveApiKey(config);
      if (!key) throw new Error(`Anthropic API key not set. Add it in your organisation's Settings → AI → API Keys.`);
      return createAnthropicModel({ apiKey: key, model: config.model });
    }

    case 'gemini': {
      const key = resolveApiKey(config);
      if (!key) throw new Error(`Google API key not set. Add it in your organisation's Settings → AI → API Keys.`);
      return createGeminiModel({ apiKey: key, model: config.model });
    }

    case 'openai-compat': {
      const key = resolveApiKey(config);
      const isLocal = providerDef?.local ?? false;
      if (!key && !isLocal) {
        throw new Error(
          `API key not set for ${providerDef?.name ?? config.provider}. ` +
          `Add it in your organisation's Settings → AI → API Keys.`,
        );
      }
      const baseUrl = config.baseUrl || providerDef?.defaultBaseUrl;
      return createOpenAICompatModel({
        apiKey:       key ?? 'no-key',
        model:        config.model,
        baseUrl,
        providerName: config.provider,
      });
    }

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: DEFAULT_PROVIDER_ID,
  model:    DEFAULT_MODEL,
};
