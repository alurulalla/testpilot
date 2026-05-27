/**
 * Provider catalogue — all supported LLM providers and their models.
 */

export interface ProviderDef {
  id: string;
  name: string;
  /** Default model to select when this provider is first chosen */
  defaultModel: string;
  /** Preset model list shown in the dropdown */
  models: string[];
  /** Whether the user must supply an API key */
  apiKeyRequired: boolean;
  /** Env-var that holds a fallback key (checked if no key in config) */
  apiKeyEnvVar?: string;
  /** Placeholder text for the API-key input */
  apiKeyPlaceholder?: string;
  /** Hardcoded base URL (Groq, Mistral, etc.) — omit for providers with native SDKs */
  defaultBaseUrl?: string;
  /** Whether the user can override the base URL (custom deployments, local) */
  customBaseUrl: boolean;
  /** Whether the user can type a model name that isn't in the preset list */
  customModel: boolean;
  /** True for local providers (Ollama, LM Studio) */
  local: boolean;
  /** Which underlying SDK implementation to use */
  sdk: 'anthropic' | 'openai-compat' | 'gemini';
}

export const PROVIDERS: ProviderDef[] = [
  // ── Cloud — native SDKs ───────────────────────────────────────────────────
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      'claude-opus-4-5',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    apiKeyPlaceholder: 'sk-ant-api03-...',
    customBaseUrl: false,
    customModel: false,
    local: false,
    sdk: 'anthropic',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: [
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'GOOGLE_API_KEY',
    apiKeyPlaceholder: 'AIzaSy...',
    customBaseUrl: false,
    customModel: false,
    local: false,
    sdk: 'gemini',
  },

  // ── Cloud — OpenAI-compatible ────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1-preview',
      'o3-mini',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    apiKeyPlaceholder: 'sk-...',
    customBaseUrl: false,
    customModel: true,
    local: false,
    sdk: 'openai-compat',
  },
  {
    id: 'groq',
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'GROQ_API_KEY',
    apiKeyPlaceholder: 'gsk_...',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    customBaseUrl: false,
    customModel: false,
    local: false,
    sdk: 'openai-compat',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    defaultModel: 'mistral-large-latest',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'MISTRAL_API_KEY',
    apiKeyPlaceholder: '...',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    customBaseUrl: false,
    customModel: false,
    local: false,
    sdk: 'openai-compat',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    defaultModel: 'grok-2-latest',
    models: [
      'grok-2-latest',
      'grok-3-latest',
      'grok-beta',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'XAI_API_KEY',
    apiKeyPlaceholder: 'xai-...',
    defaultBaseUrl: 'https://api.x.ai/v1',
    customBaseUrl: false,
    customModel: false,
    local: false,
    sdk: 'openai-compat',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel: 'openai/gpt-4o',
    models: [
      'openai/gpt-4o',
      'anthropic/claude-sonnet-4-5',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-001',
      'deepseek/deepseek-r1',
      'mistralai/mistral-large',
    ],
    apiKeyRequired: true,
    apiKeyEnvVar: 'OPENROUTER_API_KEY',
    apiKeyPlaceholder: 'sk-or-v1-...',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    customBaseUrl: false,
    customModel: true,
    local: false,
    sdk: 'openai-compat',
  },

  // ── Local ────────────────────────────────────────────────────────────────
  {
    id: 'ollama',
    name: 'Ollama',
    defaultModel: 'llama3.2',
    models: [
      'llama3.2',
      'llama3.1',
      'mistral',
      'gemma2',
      'codellama',
      'qwen2.5',
      'deepseek-r1',
      'phi3',
    ],
    apiKeyRequired: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    customBaseUrl: true,
    customModel: true,
    local: true,
    sdk: 'openai-compat',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    defaultModel: 'local-model',
    models: [],
    apiKeyRequired: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
    customBaseUrl: true,
    customModel: true,
    local: true,
    sdk: 'openai-compat',
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export const DEFAULT_PROVIDER_ID = 'anthropic';
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
