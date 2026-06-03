import { NextRequest, NextResponse } from 'next/server';
import { getMaskedAppSettings, saveAppSettings } from '@/lib/app-settings-store';
import { getMaxPages, getDeepCrawlMaxPages, getFigmaToken, getAutoSelfHeal } from '@/lib/config';

/** GET /api/app-settings — return current settings (figmaToken masked). */
export async function GET() {
  const masked = getMaskedAppSettings();
  // Merge with effective defaults so the UI shows current live values
  return NextResponse.json({
    maxPages:          masked.maxPages          ?? getMaxPages(),
    deepCrawlMaxPages: masked.deepCrawlMaxPages ?? getDeepCrawlMaxPages(),
    figmaTokenSet:     masked.figmaTokenSet,
    figmaTokenMasked:  masked.figmaTokenMasked,
    autoSelfHeal:      masked.autoSelfHeal      ?? getAutoSelfHeal(),
    // Also expose whether FIGMA_TOKEN comes from env
    figmaTokenFromEnv: Boolean(!masked.figmaTokenMasked && getFigmaToken()),
  });
}

/** POST /api/app-settings — save updated settings. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Parameters<typeof saveAppSettings>[0] = {};

  if ('maxPages' in body) {
    const v = Number(body.maxPages);
    if (!Number.isFinite(v) || v < 1) {
      return NextResponse.json({ error: 'maxPages must be a positive integer' }, { status: 400 });
    }
    update.maxPages = Math.floor(v);
  }

  if ('deepCrawlMaxPages' in body) {
    const v = Number(body.deepCrawlMaxPages);
    if (!Number.isFinite(v) || v < 1) {
      return NextResponse.json({ error: 'deepCrawlMaxPages must be a positive integer' }, { status: 400 });
    }
    update.deepCrawlMaxPages = Math.floor(v);
  }

  if ('figmaToken' in body) {
    // Empty string means "clear the stored token"
    update.figmaToken = typeof body.figmaToken === 'string' ? body.figmaToken.trim() || undefined : undefined;
  }

  if ('autoSelfHeal' in body) {
    update.autoSelfHeal = Boolean(body.autoSelfHeal);
  }

  saveAppSettings(update);
  return NextResponse.json({ ok: true });
}
