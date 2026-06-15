/**
 * Feature-context resolver (Phase 2).
 *
 * Turns the stored AppProfile (purpose, personas, glossary, env, features) into a
 * single COMPACT text block to inject into prompts — so generation writes
 * real-journey tests, triage knows the intended behavior, and self-heal fixes
 * toward intent rather than just silencing errors.
 *
 * Kept deliberately small (a few hundred tokens): it biases the model, it doesn't
 * dump the whole profile. Returns '' when no profile exists, so every caller can
 * inject it unconditionally and it's simply a no-op until a profile is built.
 */
import { getAppProfile, type AppProfileRecord } from '@/lib/app-profile';

export function renderFeatureContext(profile: AppProfileRecord, opts?: { maxFeatures?: number }): string {
  const maxF = opts?.maxFeatures ?? 14;
  const lines: string[] = ['## APP CONTEXT (what this app is and what each feature should do)'];
  if (profile.purpose) lines.push(`Purpose: ${profile.purpose}`);
  if (profile.personas.length) lines.push(`Users: ${profile.personas.map(p => p.name).join(', ')}`);
  if (profile.glossary.length) {
    lines.push(`Glossary: ${profile.glossary.slice(0, 8).map(g => `${g.term} = ${g.definition}`).join('; ')}`);
  }
  const env = profile.envSignals;
  const envBits = [
    env.authModel && `auth: ${env.authModel}`,
    env.spa != null && (env.spa ? 'SPA' : 'multi-page'),
    env.consentVendor && `consent banner: ${env.consentVendor}`,
    env.locales?.length && `locales: ${env.locales.join('/')}`,
  ].filter(Boolean);
  if (envBits.length) lines.push(`Environment: ${envBits.join(', ')}`);
  if (profile.features.length) {
    lines.push('Key features (criticality, journey → expected outcome):');
    for (const f of profile.features.slice(0, maxF)) {
      const j = f.journeys.slice(0, 2).join('; ');
      const o = f.expectedOutcomes.slice(0, 2).join('; ');
      const inv = f.invariants.slice(0, 2).join('; ');
      lines.push(`- [${f.criticality}] ${f.name}${f.area ? ` (${f.area})` : ''}${j ? `: ${j}` : ''}${o ? ` → expected: ${o}` : ''}${inv ? ` · invariants: ${inv}` : ''}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/** Load + render the app-context block for org+host. '' when no profile yet. */
export async function getFeatureContext(orgId: string, host: string, opts?: { maxFeatures?: number }): Promise<string> {
  const profile = await getAppProfile(orgId, host).catch(() => null);
  if (!profile) return '';
  return renderFeatureContext(profile, opts);
}
