/**
 * LLM config store — persists the user's chosen provider, model, and API key.
 *
 * Storage: <cwd>/.testpilot/llm-config.json (gitignored, never committed).
 *
 * The config is read fresh on every request so changes take effect
 * immediately without a server restart.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { LlmConfig } from './pilot/model-factory';
import { DEFAULT_LLM_CONFIG } from './pilot/model-factory';

const CONFIG_DIR  = path.join(process.cwd(), '.testpilot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'llm-config.json');

/** Read the stored LLM config, falling back to the default if none exists. */
export function getLlmConfig(): LlmConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_LLM_CONFIG };
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      provider: parsed.provider ?? DEFAULT_LLM_CONFIG.provider,
      model:    parsed.model    ?? DEFAULT_LLM_CONFIG.model,
      apiKey:   parsed.apiKey   ?? undefined,
      baseUrl:  parsed.baseUrl  ?? undefined,
    };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

/** Persist an LLM config. */
export function saveLlmConfig(config: LlmConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Return the stored config but with the apiKey masked for safe API responses.
 * The last 4 chars are shown so the user can identify which key is stored.
 */
export function getMaskedLlmConfig(): LlmConfig & { apiKeyMasked?: string } {
  const cfg = getLlmConfig();
  const { apiKey, ...rest } = cfg;
  if (!apiKey) return rest;
  const masked = apiKey.length > 4
    ? `${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-4)}`
    : '****';
  return { ...rest, apiKey: undefined, apiKeyMasked: masked };
}
