import { NextResponse } from 'next/server';
import { getAnthropicKey } from '@/lib/config';

export async function GET() {
  const key = getAnthropicKey();
  return NextResponse.json({
    hasKey: !!key,
    keyPrefix: key?.slice(0, 15) ?? 'NOT SET',
    cwd: process.cwd(),
  });
}
