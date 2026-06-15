/**
 * POST /api/app-profile/ask  { host, question }  — natural-language coverage Q&A (#11).
 *
 * Answers questions ("is checkout covered? what's critical and untested?") using
 * ONLY the app's feature map + health rollup — no crawling, one short LLM call.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, authErrorResponse } from '@/lib/auth';
import { getFeatureContext } from '@/lib/feature-context';
import { getFeatureHealth } from '@/lib/feature-health';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { withRateLimit } from '@/lib/rate-limited-model';

export async function POST(req: NextRequest) {
  try {
    const { org } = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { host?: string; question?: string };
    if (!body.host || !body.question?.trim()) {
      return NextResponse.json({ error: 'host and question are required' }, { status: 400 });
    }

    const ctx = await getFeatureContext(org.id, body.host);
    if (!ctx) return NextResponse.json({ answer: 'No profile has been built for this app yet — run a session first.' });

    const health = await getFeatureHealth(org.id, body.host);
    const healthLines = health.features.map(f => {
      const status = f.quarantined ? 'quarantined'
        : f.untested ? 'UNTESTED'
        : f.passRate != null ? `${f.passRate}% pass` : 'not run yet';
      return `- ${f.name} [${f.criticality}]: ${status}${f.flaky ? ', flaky' : ''} (${f.testCount} test(s))`;
    }).join('\n');

    const model = withRateLimit(await createModelFromConfig(await getOrgLlmConfig(org.id)));
    const answer = await model.invoke(
      [
        { role: 'system', content: 'You answer questions about a web app\'s test coverage using ONLY the feature map and health provided. Be concise and specific (name features). If the data does not say, say you don\'t have that information.' },
        { role: 'user', content: `${ctx}\n\n## Feature health\n${healthLines}\n\n## Question\n${body.question.trim()}` },
      ],
      { maxTokens: 600 },
    ).catch(() => null);

    return NextResponse.json({ answer: answer ?? 'Sorry — could not answer right now.' });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
