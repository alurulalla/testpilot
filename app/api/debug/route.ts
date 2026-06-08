import { NextResponse } from 'next/server';

/**
 * Lightweight diagnostics. API keys are managed per-organisation in the
 * OrgApiKey table and are intentionally NOT surfaced here.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV,
  });
}
