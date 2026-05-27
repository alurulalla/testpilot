/**
 * Model factory — creates the correct ChatModel based on the stored LLM config.
 *
 * API-key resolution order:
 *  1. config.apiKey (set via the UI settings panel)
 *  2. Environment variable for the provider (e.g. ANTHROPIC_API_KEY)
 *
 * This means existing users whose key is already in .env.local get zero-friction
 * migration — they don't need to re-enter anything.
 */
import type { ChatModel } from './types';
import { createAnthropicModel } from './anthropic-model';
import { createGeminiModel }    from './gemini-model';
import { createOpenAICompatModel } from './openai-model';
import { getProvider, DEFAULT_PROVIDER_ID, DEFAULT_MODEL } from './providers';

export interface LlmConfig {
  provider: string;
  model: string;
  /** Stored API key (may be empty — factory falls back to env vars) */
  apiKey?: string;
  /** Custom base URL (used by Ollama, LM Studio, Azure, etc.) */
  baseUrl?: string;
}

/** Resolve the API key: prefer stored key, fall back to well-known env vars. */
export function resolveApiKey(config: LlmConfig): string | undefined {
  if (config.apiKey) return config.apiKey;

  const envVarMap: Record<string, string> = {
    anthropic:   'ANTHROPIC_API_KEY',
    openai:      'OPENAI_API_KEY',
    gemini:      'GOOGLE_API_KEY',
    groq:        'GROQ_API_KEY',
    mistral:     'MISTRAL_API_KEY',
    xai:         'XAI_API_KEY',
    openrouter:  'OPENROUTER_API_KEY',
  };
  const envVar = envVarMap[config.provider];
  return envVar ? (process.env[envVar] || undefined) : undefined;
}

export async function createModelFromConfig(config: LlmConfig): Promise<ChatModel> {
  const providerDef = getProvider(config.provider);
  const sdk = providerDef?.sdk ?? 'openai-compat';

  switch (sdk) {
    case 'anthropic': {
      const key = resolveApiKey(config);
      if (!key) throw new Error(`Anthropic API key not set. Add it in the LLM settings panel or set ANTHROPIC_API_KEY.`);
      return createAnthropicModel({ apiKey: key, model: config.model });
    }

    case 'gemini': {
      const key = resolveApiKey(config);
      if (!key) throw new Error(`Google API key not set. Add it in the LLM settings panel or set GOOGLE_API_KEY.`);
      return createGeminiModel({ apiKey: key, model: config.model });
    }

    case 'openai-compat': {
      const key = resolveApiKey(config);
      const isLocal = providerDef?.local ?? false;
      if (!key && !isLocal) {
        const envVar = providerDef?.apiKeyEnvVar ?? 'API_KEY';
        throw new Error(
          `API key not set for ${providerDef?.name ?? config.provider}. ` +
          `Add it in the LLM settings panel or set ${envVar}.`,
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
