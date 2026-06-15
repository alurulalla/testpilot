import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireOrgAdmin, authErrorResponse } from '@/lib/auth';
import { getOrgSettings, saveOrgSettings, type OrgSettingsPatch } from '@/lib/org-settings';

/** GET /api/app-settings — the current org's settings (DB-backed). */
export async function GET() {
  try {
    const { org } = await requireAuth();
    const settings = await getOrgSettings(org.id);
    return NextResponse.json(settings);
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/** POST /api/app-settings — save settings for the org (admin only). */
export async function POST(req: NextRequest) {
  let orgId: string;
  try {
    ({ org: { id: orgId } } = await requireOrgAdmin());
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: OrgSettingsPatch = {};

  if ('maxPages' in body) {
    const v = Number(body.maxPages);
    if (!Number.isFinite(v) || v < 1) {
      return NextResponse.json({ error: 'maxPages must be a positive integer' }, { status: 400 });
    }
    patch.maxPages = Math.floor(v);
  }

  if ('deepCrawlMaxPages' in body) {
    const v = Number(body.deepCrawlMaxPages);
    if (!Number.isFinite(v) || v < 1) {
      return NextResponse.json({ error: 'deepCrawlMaxPages must be a positive integer' }, { status: 400 });
    }
    patch.deepCrawlMaxPages = Math.floor(v);
  }

  if ('autoSelfHeal' in body) {
    patch.autoSelfHeal = Boolean(body.autoSelfHeal);
  }

  if ('healMode' in body) {
    patch.healMode = body.healMode === 'agent' ? 'agent' : 'single-shot';
  }

  await saveOrgSettings(orgId, patch);
  return NextResponse.json({ ok: true });
}
