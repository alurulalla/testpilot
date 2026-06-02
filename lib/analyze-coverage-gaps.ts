/**
 * Compare an imported Playwright project's existing test coverage against the
 * crawled site map and identify features/pages that lack test coverage.
 *
 * The LLM receives the crawled page elements + existing test names and returns
 * a structured list of gaps with suggested test names for each.
 */
import { randomUUID } from 'crypto';
import type { SiteMap } from '@/types/session';
import type { CoverageGap } from '@/types/session';
import type { ImportedUseCase } from '@/types/session';
import type { ChatModel } from '@/lib/pilot';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Interactive { role: string; name: string; href?: string }

function summarisePage(page: SiteMap['pages'][number]): string {
  const ints = ((page.elements as Record<string, unknown>).interactives as Interactive[] | undefined) ?? [];
  const inputs = ((page.elements as Record<string, unknown>).inputs as { label?: string; type?: string }[] | undefined) ?? [];
  const headings = ((page.elements as Record<string, unknown>).headings as string[] | undefined) ?? [];

  const lines: string[] = [`URL: ${page.url}`, `Title: ${page.title}`];

  if (headings.length > 0) {
    lines.push(`Headings: ${headings.slice(0, 5).join(', ')}`);
  }
  if (ints.length > 0) {
    const items = ints.slice(0, 20).map(el => {
      const base = `${el.role} "${el.name}"`;
      return el.href ? `${base} [href=${el.href}]` : base;
    });
    lines.push(`Interactive: ${items.join('; ')}`);
  }
  if (inputs.length > 0) {
    const items = inputs.slice(0, 10).map(inp => inp.label ?? inp.type ?? 'input');
    lines.push(`Inputs: ${items.join(', ')}`);
  }
  return lines.join('\n');
}

// ── LLM gap analysis ──────────────────────────────────────────────────────────

interface GapLlmItem {
  pageUrl: string;
  pageTitle: string;
  feature: string;
  suggestedTestNames: string[];
}

/**
 * Ask the LLM to find which pages/features are NOT covered by the existing
 * test cases and suggest test names for each gap.
 *
 * Returns an empty array when all features appear to be covered.
 */
export async function analyzeCoverageGaps(
  siteMap: SiteMap,
  importedUseCases: ImportedUseCase[],
  model: ChatModel,
  onProgress?: (line: string) => void,
): Promise<CoverageGap[]> {
  const existingTests = importedUseCases
    .flatMap(u => u.tests.map(t => `[${u.suite}] ${t}`))
    .join('\n');

  const pagesSummary = siteMap.pages
    .slice(0, 20)
    .map(p => summarisePage(p))
    .join('\n\n---\n\n');

  onProgress?.('Analysing coverage gaps against crawled pages…');

  const systemPrompt =
    'You are a senior QA engineer performing a coverage gap analysis. ' +
    'You will be given: (1) a list of existing Playwright test names from an imported project, ' +
    'and (2) a summary of every page crawled from the live application, including its ' +
    'interactive elements, inputs, and headings. ' +
    'Your task: identify features and interactions that exist in the application but are ' +
    'NOT covered by the existing tests. ' +
    'For each gap, suggest 1-4 concise Playwright test names that would provide coverage. ' +
    'Output ONLY a valid JSON array — no prose, no markdown fences. ' +
    'Each element: { "pageUrl": string, "pageTitle": string, "feature": string, "suggestedTestNames": string[] }. ' +
    'If all features appear covered, output an empty array: [].';

  const userPrompt =
    `EXISTING TEST CASES (from imported project):\n${existingTests || '(none)'}\n\n` +
    `CRAWLED APPLICATION PAGES:\n${pagesSummary}\n\n` +
    `List every feature/page interaction NOT covered by the existing tests. ` +
    `Be specific — if a page has a form, a search box, or navigation that isn't tested, flag it. ` +
    `Output JSON array only.`;

  let raw: string;
  try {
    raw = await model.invoke(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      { maxTokens: 4_096 },
    );
  } catch (e) {
    onProgress?.(`Coverage analysis failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  // Extract JSON from response (strip prose/fences if present)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let items: GapLlmItem[];
  try {
    items = JSON.parse(jsonMatch[0]) as GapLlmItem[];
  } catch {
    return [];
  }

  return items
    .filter(item => item.pageUrl && item.feature && Array.isArray(item.suggestedTestNames))
    .map(item => ({
      id:                 randomUUID(),
      pageUrl:            item.pageUrl,
      pageTitle:          item.pageTitle ?? item.pageUrl,
      feature:            item.feature,
      suggestedTestNames: item.suggestedTestNames.slice(0, 4),
    }));
}
