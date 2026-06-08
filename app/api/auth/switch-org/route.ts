/**
 * POST /api/auth/switch-org  — set the user's active organisation.
 *
 * Body: { orgId: string }
 * Writes the tp_org cookie (validated against the user's memberships) so that
 * subsequent requireAuth() calls resolve to the chosen org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireAuth, authErrorResponse, ACTIVE_ORG_COOKIE } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { memberships } = await requireAuth();
    const { orgId } = await req.json() as { orgId?: string };

    if (!orgId || !memberships.some(m => m.orgId === orgId)) {
      return NextResponse.json(
        { error: 'You are not a member of that organisation.' },
        { status: 403 },
      );
    }

    (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
