/**
 * Stateless ZIP validation — no session required.
 * Returns import metadata including the detected baseURL from playwright.config.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { importPlaywrightProject } from '@/lib/import-playwright';

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ valid: false, reason: 'No file uploaded.' }, { status: 400 });
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer());
  const result = importPlaywrightProject(buffer);

  if (!result.valid) {
    return NextResponse.json({ valid: false, reason: result.reason });
  }

  return NextResponse.json({
    valid: true,
    specFilesCount: result.specFilesCount,
    detectedBaseUrl: result.detectedBaseUrl ?? null,
    useCases: result.useCases,
  });
}
