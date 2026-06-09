/**
 * GET /api/llm-config/status
 *
 * Lightweight read of the current org's active provider/model + whether a key
 * is configured. Powers the global "connected model" badge shown on every page.
 */
import { NextResponse } from 'next/server';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { getProvider } from '@/lib/pilot/providers';
import { requireAuth, authErrorResponse } from '@/lib/auth';

export async function GET() {
  try {
    const { org } = await requireAuth();
    const llm = await getOrgLlmConfig(org.id);
    return NextResponse.json({
      providerLabel: getProvider(llm.provider)?.name ?? llm.provider,
      model:         llm.model,
      keyConfigured: Boolean(llm.apiKey),
    });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
