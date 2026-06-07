import { NextRequest, NextResponse } from 'next/server';
import { scanLoginPage, groupsToContextFields } from '@/lib/detect-form-fields';

// Single-page scan can still take 10-15 s on slow sites.
export const maxDuration = 30;

/** POST /api/contexts/detect-page  { url }
 *  Scans a SINGLE page for login/signup fields — no link following.
 *  Used when the user manually provides their login URL.
 *
 *  Returns: { groups: DetectedFormGroup[], fields: ContextField[] }
 *  Returns 404 when no form fields found (so UI can fall back to manual entry). */
export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string };
  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  try {
    const groups = await scanLoginPage(body.url);
    const fields = groupsToContextFields(groups);

    if (groups.length === 0) {
      return NextResponse.json(
        { error: 'No login form fields found on this page.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ groups, fields });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Page scan failed: ${msg}` }, { status: 500 });
  }
}
