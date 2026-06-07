import { NextRequest, NextResponse } from 'next/server';
import { detectAllFormFields, groupsToContextFields } from '@/lib/detect-form-fields';

// Allow up to 60 s for multi-page form scanning (Vercel Pro / hobby max).
// The scan visits up to ~10 pages; each takes 1-3 s on fast sites.
export const maxDuration = 60;

/** POST /api/contexts/detect  { url }
 *  Scans the URL and all form-related linked pages.
 *  Returns: { groups: DetectedFormGroup[], fields: ContextField[] }
 *   - groups  → for grouped UI display (one section per page)
 *   - fields  → flat deduplicated list ready to save as context
 *
 *  When no forms are found (404), also returns signInInfo so the UI can offer
 *  the user a chance to provide their login URL for single-page scanning. */
export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string };
  if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

  try {
    const { groups, signInInfo } = await detectAllFormFields(body.url);
    const fields = groupsToContextFields(groups);

    if (groups.length === 0) {
      return NextResponse.json(
        {
          error: 'No form fields detected on this page or its linked pages.',
          signInInfo,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ groups, fields, signInInfo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Detection failed: ${msg}` }, { status: 500 });
  }
}
