import { NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getOrgSettings } from '@/lib/org-settings';

/**
 * GET /api/config
 * Returns org-level feature flags so the client can adapt its UI.
 *
 * autoSelfHeal (default: false)
 *   false → self-healing must be triggered manually by the user
 *   true  → self-healing runs automatically after every failing test run
 */
export async function GET() {
  try {
    const { org } = await requireAuth();
    const { autoSelfHeal } = await getOrgSettings(org.id);
    return NextResponse.json({ autoSelfHeal });
  } catch (err) {
    const r = authErrorResponse(err);
    return r ?? NextResponse.json({ autoSelfHeal: false });
  }
}
