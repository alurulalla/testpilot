import { NextRequest, NextResponse } from 'next/server';
import { detectAllFormFields, groupsToContextFields } from '@/lib/detect-form-fields';

/** POST /api/contexts/detect  { url }
 *  Scans the URL and all form-related linked pages.
 *  Returns: { groups: DetectedFormGroup[], fields: ContextField[] }
 *   - groups  → for grouped UI display (one section per page)
 *   - fields  → flat deduplicated list ready to save as context */
export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string };
  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  try {
    const groups = await detectAllFormFields(body.url);
    const fields = groupsToContextFields(groups);

    if (groups.length === 0) {
      return NextResponse.json({ error: 'No form fields detected on this page or its linked pages.' }, { status: 404 });
    }

    return NextResponse.json({ groups, fields });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Detection failed: ${msg}` }, { status: 500 });
  }
}
