/**
 * POST /api/sessions/[id]/flows/extract
 *
 * Uses the LLM to extract user flows from the session's uploaded product
 * documentation. Returns suggested flows for the user to approve.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import { getSession } from '@/lib/session-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.contextDoc) {
    return NextResponse.json({ error: 'No documentation uploaded yet' }, { status: 400 });
  }

  try {
    const llmConfig = await getOrgLlmConfig(session.orgId);
    const baseModel = await createModelFromConfig(llmConfig);
    const model = withRateLimit(baseModel);

    const response = await model.invoke([
      {
        role: 'system',
        content:
          'You are a QA analyst. Extract testable user flows from product documentation.\n' +
          'Reply with a JSON array only — no prose, no markdown fences:\n' +
          '[\n' +
          '  {\n' +
          '    "title": "Short action title (5-8 words)",\n' +
          '    "description": "One sentence describing what the user does and what they expect.",\n' +
          '    "steps": ["Step 1", "Step 2", "Step 3"]\n' +
          '  }\n' +
          ']\n' +
          'Extract 3-10 flows. Focus on end-user actions, not implementation details.',
      },
      {
        role: 'user',
        content:
          `Extract user flows from this product documentation:\n\n${session.contextDoc.slice(0, 8000)}`,
      },
    ]);

    // Parse the JSON array from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse flows from LLM response' }, { status: 500 });
    }

    const flows = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      description: string;
      steps?: string[];
    }>;

    const cleaned = flows
      .filter(f => f.title && f.description)
      .map(f => ({
        title: String(f.title).trim(),
        description: String(f.description).trim(),
        steps: (f.steps ?? []).map((s: unknown) => String(s).trim()).filter(Boolean),
      }));

    return NextResponse.json({ flows: cleaned });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuth = msg.includes('401') || msg.includes('authentication_error');
    return NextResponse.json({
      error: isAuth
        ? 'API key rejected — update it in ⚙ Settings'
        : `Extraction failed: ${msg}`,
    }, { status: 500 });
  }
}
