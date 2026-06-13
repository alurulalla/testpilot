/**
 * Generate Playwright tests for the coverage gaps the user has selected,
 * then immediately trigger the full run → triage → fix loop.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import path from 'path';
import { writeFileSync } from 'fs';
import { snapshotTestFiles } from '@/lib/session-files';
import {
  getSession, setStatus, addLog, updateSession,
} from '@/lib/session-store';
import { Workspace, createModelFromConfig } from '@/lib/pilot';
import { getOrgLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { getSessionDir } from '@/lib/config';


function buildGapTestPrompt(
  baseUrl: string,
  gap: { pageUrl: string; pageTitle: string; feature: string; suggestedTestNames: string[] },
  siteMapPages: Array<{ url: string; title: string; elements: Record<string, unknown> }>,
): string {
  const page = siteMapPages.find(p => p.url === gap.pageUrl) ?? siteMapPages[0];
  const ints = (page?.elements.interactives as { role: string; name: string; href?: string }[] | undefined) ?? [];
  const inputs = (page?.elements.inputs as { label?: string; type?: string }[] | undefined) ?? [];

  const interactiveSummary = ints.slice(0, 30).map(el => {
    const base = `  ${el.role} "${el.name}"`;
    return el.href ? `${base}  href="${el.href}"` : base;
  }).join('\n');

  const inputSummary = inputs.slice(0, 10).map(inp =>
    `  input  label="${inp.label ?? ''}"  type="${inp.type ?? 'text'}"`,
  ).join('\n');

  const testList = gap.suggestedTestNames.map(n => `- ${n}`).join('\n');

  return (
    `Generate a Playwright test file for the following uncovered feature.\n` +
    `Base URL: ${baseUrl}\n` +
    `Page URL: ${gap.pageUrl}\n` +
    `Page title: ${gap.pageTitle}\n` +
    `Feature: ${gap.feature}\n\n` +
    `INTERACTIVE ELEMENTS (use ONLY these for locators — do NOT guess selectors):\n` +
    (interactiveSummary || '  (none detected)') + '\n' +
    (inputSummary ? `\nINPUT FIELDS:\n${inputSummary}\n` : '') +
    `\nSUGGESTED TEST NAMES (cover all of them):\n${testList}\n\n` +
    `Rules:\n` +
    `- import { test, expect } from './fixtures.js'\n` +
    `- import { TARGET_URL } from './fixtures.js'\n` +
    `- Each test is independent — call page.goto in each test\n` +
    `- Use getByRole, getByLabel, locator('a[href="..."]') from the elements table above\n` +
    `- NEVER invent selectors not in the elements table\n` +
    `- Return ONLY valid TypeScript — no markdown fences, no explanation\n`
  );
}

function featureSlug(feature: string): string {
  return feature.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'gap';
}

function extractTypeScript(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const importIdx = trimmed.indexOf('\nimport ');
  if (importIdx >= 0) return trimmed.slice(importIdx + 1).trim();
  if (trimmed.startsWith('import ')) return trimmed;
  return trimmed;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (!session.coverageAnalysis) {
    return NextResponse.json({ error: 'Run coverage analysis first.' }, { status: 400 });
  }
  if (['exploring', 'analyzing', 'generating', 'running', 'fixing'].includes(session.status)) {
    return NextResponse.json({ error: 'Session is busy' }, { status: 409 });
  }

  const { selectedGapIds } = session.coverageAnalysis;
  const selectedGaps = session.coverageAnalysis.gaps.filter(g => selectedGapIds.includes(g.id));

  if (selectedGaps.length === 0) {
    return NextResponse.json({ error: 'No gaps selected.' }, { status: 400 });
  }

  // Fire-and-forget
  (async () => {
    try {
      const llmConfig  = await getOrgLlmConfig(session.orgId);
      const baseModel  = await createModelFromConfig(llmConfig);
      const chatModel  = withRateLimit(baseModel);
      const rootDir    = getSessionDir(id, session.orgId);
      const workspace  = new Workspace({ url: session.url, rootDir });

      // Read the site map pages for locator context
      const siteMapData = workspace.readSiteMap() as {
        pages?: Array<{ url: string; title: string; elements: Record<string, unknown> }>;
      } | null;
      const pages = siteMapData?.pages ?? [];

      setStatus(id, 'generating');
      addLog(id, `Generating tests for ${selectedGaps.length} selected gap(s)…`, 'info');

      const systemPrompt =
        'You are an expert Playwright test engineer (TypeScript). ' +
        'Generate tests ONLY using the interactive elements provided — never guess selectors. ' +
        'Return ONLY valid TypeScript with no markdown fences or explanation.';

      const slugsSeen = new Set<string>();

      for (const gap of selectedGaps) {
        let slug = featureSlug(gap.feature);
        if (slugsSeen.has(slug)) slug = `${slug}-${slugsSeen.size}`;
        slugsSeen.add(slug);

        const filePath = path.join(workspace.testsDir, `${slug}.spec.ts`);
        addLog(id, `  Generating ${slug}.spec.ts for "${gap.feature}"…`, 'info');

        try {
          const userPrompt = buildGapTestPrompt(session.url, gap, pages);
          const raw = await chatModel.invoke(
            [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            { maxTokens: 4_096 },
          );
          const code = extractTypeScript(raw);
          if (code.includes('test(') || code.includes('test.describe(')) {
            writeFileSync(filePath, code, 'utf8');
            addLog(id, `  ✓ ${slug}.spec.ts written`, 'success');
          } else {
            addLog(id, `  ⚠ ${slug}.spec.ts — no test code returned, skipping`, 'info');
          }
        } catch (e) {
          addLog(id, `  ✗ Failed to generate ${slug}: ${e instanceof Error ? e.message : String(e)}`, 'error');
        }
      }

      updateSession(id, { testFiles: workspace.testFiles() });
      await snapshotTestFiles(id, workspace);
      addLog(id, 'Gap tests generated. Starting full test run…', 'success');

      // Trigger the run loop (reuse the existing loop endpoint). Use the
      // incoming request's own origin (works locally AND on Railway) and
      // forward the caller's cookies so the loop route's auth check passes.
      await fetch(`${req.nextUrl.origin}/api/sessions/${id}/loop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({ maxIterations: 3 }),
      }).catch(() => {
        setStatus(id, 'idle');
      });
    } catch (err) {
      addLog(id, `Generate-selected error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setStatus(id, 'idle');
    }
  })();

  return NextResponse.json({ ok: true });
}
