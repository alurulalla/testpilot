import { NextResponse } from 'next/server';

/**
 * GET /api/config
 * Returns server-side feature flags so the client can adapt its UI.
 *
 * AUTO_SELF_HEAL (default: false)
 *   false → self-healing must be triggered manually by the user
 *   true  → self-healing runs automatically after every failing test run
 */
export async function GET() {
  return NextResponse.json({
    autoSelfHeal: process.env.AUTO_SELF_HEAL === 'true',
  });
}
