/**
 * GET /api/admin/me
 * Lightweight super-admin check used by the admin layout.
 */
import { NextResponse } from 'next/server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth';

export async function GET() {
  try {
    const { email } = await requireSuperAdmin();
    return NextResponse.json({ email });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
