/**
 * LLM config store — resolves the provider/model/key the AI pipeline should use.
 *
 * Provider & model are per-organisation (Organization.llmProvider/llmModel/…).
 * API keys live in the per-organisation OrgApiKey table and are NEVER read from
 * environment variables. Nothing here is global or env-sourced.
 */
import type { LlmConfig } from './pilot/model-factory';
import { DEFAULT_LLM_CONFIG } from './pilot/model-factory';
import { getOrgKeys } from './org-keys';
import { prisma } from './prisma';

// ── Org-aware helpers ─────────────────────────────────────────────────────────

/** Provider → its well-known env-var name (mirrors model-factory.ts). */
const PROVIDER_ENV_VAR: Record<string, string> = {
  anthropic:  'ANTHROPIC_API_KEY',
  openai:     'OPENAI_API_KEY',
  gemini:     'GOOGLE_API_KEY',
  groq:       'GROQ_API_KEY',
  mistral:    'MISTRAL_API_KEY',
  xai:        'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** Provider/model/baseUrl chosen by an organisation (no API key). */
export interface OrgLlmSettings {
  provider: string;
  model: string;
  baseUrl?: string;
}

/**
 * Read an organisation's provider/model selection from the Organization row,
 * falling back to the app default when the org hasn't chosen one yet.
 */
export async function getOrgLlmSettings(orgId: string): Promise<OrgLlmSettings> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { llmProvider: true, llmModel: true, llmBaseUrl: true },
  });
  return {
    provider: org?.llmProvider ?? DEFAULT_LLM_CONFIG.provider,
    model:    org?.llmModel    ?? DEFAULT_LLM_CONFIG.model,
    baseUrl:  org?.llmBaseUrl  ?? undefined,
  };
}

/** Persist an organisation's provider/model selection. */
export async function saveOrgLlmSettings(orgId: string, s: OrgLlmSettings): Promise<void> {
  await prisma.organization.update({
    where: { id: orgId },
    data: {
      llmProvider: s.provider,
      llmModel:    s.model,
      llmBaseUrl:  s.baseUrl ?? null,
    },
  });
}

/**
 * The org's provider/model selection merged with the org's API key.
 *
 * The API key comes EXCLUSIVELY from the org-level OrgApiKey table — never from
 * a config file and never from environment variables. If the org hasn't saved
 * a key for the active provider, apiKey is undefined and the model call fails
 * with a message pointing the user at Settings → AI → API Keys.
 *
 * Call this in AI pipeline routes.
 */
export async function getOrgLlmConfig(orgId: string): Promise<LlmConfig> {
  const settings = await getOrgLlmSettings(orgId);
  const orgKeys = await getOrgKeys(orgId);
  const envVar = PROVIDER_ENV_VAR[settings.provider];
  const orgKey = envVar ? orgKeys[envVar] : undefined;
  return { ...settings, apiKey: orgKey };
}

/**
 * The org's Figma token from the OrgApiKey table. Never falls back to env.
 *
 * Call this instead of getFigmaToken() in AI pipeline routes.
 */
export async function getOrgFigmaToken(orgId: string): Promise<string | undefined> {
  const orgKeys = await getOrgKeys(orgId);
  return orgKeys['FIGMA_TOKEN'] || undefined;
}

