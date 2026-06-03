/**
 * POST /api/sessions/[id]/accuracy
 *
 * Runs an LLM-powered coverage analysis that measures how well the generated
 * test suite covers:
 *   1. Every documented feature from CONTEXT.md / product documentation
 *   2. Every page discovered during site exploration (site_map.json)
 *   3. Every Figma frame (when figmaResult is present)
 *
 * Returns a structured AccuracyReport.
 */
import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { getSession } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { createModelFromConfig } from '@/lib/pilot/model-factory';
import { getLlmConfig } from '@/lib/llm-config-store';
import { withRateLimit } from '@/lib/rate-limited-model';
import { getSessionDir } from '@/lib/config';
import { getSessionOrRestore } from '@/lib/get-session-or-restore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeatureCoverage {
  name: string;
  items: string[];
  covered: boolean;
  tests: string[];       // test names that cover this feature
  testFile: string | null;
}

export interface SitePageCoverage {
  url: string;
  title: string;
  covered: boolean;
  testFile: string | null;
}

export interface TestAlignmentItem {
  file: string;
  name: string;
  alignedTo: string | null; // null = tests something undocumented
}

export interface FigmaFrameCoverage {
  frameName: string;
  covered: boolean;
  compareUrl: string;
}

export interface AccuracyReport {
  sessionId: string;
  sessionUrl: string;
  overallScore: number;
  llmError?: string | null;

  doc: {
    score: number;
    features: FeatureCoverage[];
    total: number;
    covered: number;
    hasDoc: boolean;
  };

  site: {
    score: number;
    pages: SitePageCoverage[];
    total: number;
    covered: number;
    hasMap: boolean;
  };

  tests: {
    alignmentScore: number;
    total: number;
    aligned: number;
    items: TestAlignmentItem[];
  };

  figma?: {
    score: number;
    frames: FigmaFrameCoverage[];
    total: number;
    covered: number;
  };

  generatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DocSection { name: string; items: string[] }

function parseFeaturesFromContextMd(md: string): DocSection[] {
  const sections: DocSection[] = [];
  let cur: DocSection | null = null;
  const SKIP = /^(Overview|Homepage Sections?|Sections?|Features?|Summary|Table of Contents|Introduction)/i;
  const STOP = /^#{1,4}\s+(Typical\s+User\s+Journey|Best Practices?|Summary)/i;

  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.match(STOP)) { if (cur && cur.items.length) sections.push(cur); cur = null; continue; }
    const hm = line.match(/^#{2,4}\s+(?:\d+[.)]\s+)?(.+)/);
    if (hm) {
      const name = hm[1].trim();
      if (!name.match(SKIP)) {
        if (cur && cur.items.length) sections.push(cur);
        cur = { name, items: [] };
      }
      continue;
    }
    const bm = line.match(/^[-*•]\s+(.+)/);
    if (bm && cur) cur.items.push(bm[1].trim());
  }
  if (cur && cur.items.length) sections.push(cur);
  return sections;
}

function extractTestNames(specContent: string): string[] {
  const names: string[] = [];
  // Capture test() / it() names
  const re = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(specContent)) !== null) names.push(m[1]);
  return [...new Set(names)];
}

/**
 * Find the best LLM-reported coverage entry for a feature name.
 * 1. Exact case-insensitive match.
 * 2. One contains the other (e.g. "Key Features" ↔ "Key Features section").
 */
function findLlmMatch(
  llmCoverage: { feature: string; covered: boolean; tests: string[] }[],
  featureName: string,
): { feature: string; covered: boolean; tests: string[] } | undefined {
  const lower = featureName.toLowerCase().trim();
  const exact = llmCoverage.find(f => f.feature.toLowerCase().trim() === lower);
  if (exact) return exact;
  return llmCoverage.find(f => {
    const fl = f.feature.toLowerCase().trim();
    return fl.includes(lower) || lower.includes(fl);
  });
}

/**
 * Keyword heuristic: returns test names whose text shares significant words
 * with the feature name. Used as fallback when the LLM analysis is unavailable.
 */
function heuristicMatchTests(
  featureName: string,
  allTestNames: { file: string; name: string }[],
): string[] {
  // Skip common stop-words; require words longer than 3 chars
  const STOP = new Set(['with', 'that', 'this', 'from', 'have', 'been', 'will', 'test', 'page', 'should', 'when', 'then', 'into', 'show', 'visible', 'displayed']);
  const words = featureName
    .toLowerCase()
    .split(/[\s\-_/]+/)
    .filter(w => w.length > 3 && !STOP.has(w));
  if (words.length === 0) return [];
  return allTestNames
    .filter(t => words.some(w => t.name.toLowerCase().includes(w)))
    .map(t => t.name);
}

/** Convert page URL to the spec filename stem (mirrors generate-suite.ts logic). */
function urlToFileStem(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    const base   = new URL(baseUrl);
    let pathname = parsed.pathname.replace(base.pathname, '');
    if (!pathname || pathname === '/') return 'homepage';
    pathname = pathname.replace(/^\//, '').replace(/\/$/, '');
    return pathname.replace(/\//g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'page';
  } catch { return 'page'; }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSessionOrRestore(id, req);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id),
  });

  // ── 1. Read spec files ─────────────────────────────────────────────────────
  const testsDir = workspace.testsDir;
  const specFiles: { file: string; names: string[] }[] = [];

  if (existsSync(testsDir)) {
    for (const f of readdirSync(testsDir).filter(f => f.endsWith('.spec.ts'))) {
      const content = readFileSync(path.join(testsDir, f), 'utf8');
      specFiles.push({ file: f, names: extractTestNames(content) });
    }
  }

  const allTestNames = specFiles.flatMap(sf => sf.names.map(n => ({ file: sf.file, name: n })));

  // ── 2. Read CONTEXT.md for documented features ─────────────────────────────
  const contextPath = path.join(workspace.dir, 'CONTEXT.md');
  const contextMd   = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : null;
  const docFeatures = contextMd ? parseFeaturesFromContextMd(contextMd) : [];

  // ── 3. Read site_map.json for discovered pages ─────────────────────────────
  interface SiteMapPage { url: string; title?: string }
  let sitePages: SiteMapPage[] = [];
  if (existsSync(workspace.siteMapFile)) {
    try {
      const sm = JSON.parse(readFileSync(workspace.siteMapFile, 'utf8')) as { pages?: SiteMapPage[] };
      sitePages = sm.pages ?? [];
    } catch { /* ignore */ }
  }

  // ── 4. LLM analysis (doc features ↔ tests) ────────────────────────────────
  let llmFeatureCoverage: { feature: string; covered: boolean; tests: string[] }[] = [];
  let llmTestAlignment: { test: string; alignedTo: string | null }[] = [];
  let llmError: string | null = null;

  if (docFeatures.length > 0 && allTestNames.length > 0) {
    try {
      const llmConfig = getLlmConfig();
      const baseModel = await createModelFromConfig(llmConfig);
      const model     = withRateLimit(baseModel);

      const featuresText = docFeatures
        .map(f => `- ${f.name}: ${f.items.join(', ')}`)
        .join('\n');

      const testsText = specFiles
        .map(sf => `[${sf.file}] ${sf.names.join(' | ')}`)
        .join('\n');

      const response = await model.invoke([
        {
          role: 'system',
          content:
            'You are a QA coverage analyst. Analyse which generated tests cover which ' +
            'documented features. Reply with a JSON object only — no prose, no markdown fences.\n' +
            'IMPORTANT: Use the EXACT feature names as listed below in your response.\n' +
            'Format:\n' +
            '{\n' +
            '  "featureCoverage": [\n' +
            '    { "feature": "<exact feature name>", "covered": true|false, "tests": ["test name 1", ...] }\n' +
            '  ],\n' +
            '  "testAlignment": [\n' +
            '    { "test": "<test name>", "alignedTo": "<exact feature name> or null" }\n' +
            '  ]\n' +
            '}',
        },
        {
          role: 'user',
          content:
            `DOCUMENTED FEATURES (use these exact names in your response):\n${featuresText}\n\n` +
            `GENERATED TESTS:\n${testsText}\n\n` +
            'Map features → tests and tests → features. ' +
            'A test "covers" a feature if it verifies at least one item listed under that feature. ' +
            'A test alignment is null if it tests something NOT in the documented features.',
        },
      ]);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          featureCoverage?: { feature: string; covered: boolean; tests: string[] }[];
          testAlignment?: { test: string; alignedTo: string | null }[];
        };
        llmFeatureCoverage = parsed.featureCoverage ?? [];
        llmTestAlignment   = parsed.testAlignment ?? [];
      } else {
        llmError = 'LLM returned non-JSON response — using keyword matching instead.';
      }
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── 5. Build report ────────────────────────────────────────────────────────

  // Doc coverage — prefer LLM match, fall back to keyword heuristic
  const docReport: FeatureCoverage[] = docFeatures.map(f => {
    const llmMatch = findLlmMatch(llmFeatureCoverage, f.name);

    let covered = llmMatch?.covered ?? false;
    let tests   = llmMatch?.tests ?? [];

    // If LLM didn't find coverage (either failed or returned covered:false with no match),
    // use the keyword heuristic so we don't silently under-report.
    if (!covered) {
      const heuristic = heuristicMatchTests(f.name, allTestNames);
      if (heuristic.length > 0) {
        covered = true;
        tests   = heuristic;
      }
    }

    const testFile = tests.length > 0
      ? (specFiles.find(sf => sf.names.some(n => tests.includes(n)))?.file ?? null)
      : null;
    return {
      name: f.name,
      items: f.items,
      covered,
      tests,
      testFile,
    };
  });

  const docCovered = docReport.filter(f => f.covered).length;
  const docScore   = docReport.length ? Math.round((docCovered / docReport.length) * 100) : 0;

  // Site coverage — check whether a spec file exists for each discovered page.
  // Also consider doc-features.spec.ts as covering all pages (it tests the base URL).
  const specFileNames = new Set(specFiles.map(sf => sf.file));
  const hasDocFeatureSpec = specFileNames.has('doc-features.spec.ts');
  const siteReport: SitePageCoverage[] = sitePages.map(p => {
    const stem     = urlToFileStem(p.url, session.url);
    // Homepage is covered either by homepage.spec.ts OR the doc-features spec
    const isHomepage = stem === 'homepage';
    const testFile =
      specFileNames.has(`${stem}.spec.ts`) ? `${stem}.spec.ts`
      : (isHomepage && hasDocFeatureSpec)   ? 'doc-features.spec.ts'
      : null;
    return { url: p.url, title: p.title ?? p.url, covered: testFile !== null, testFile };
  });

  const siteCovered = siteReport.filter(p => p.covered).length;
  const siteScore   = siteReport.length ? Math.round((siteCovered / siteReport.length) * 100) : 0;

  // Test alignment — LLM match, case-insensitive fallback
  const testItems: TestAlignmentItem[] = allTestNames.map(t => {
    // Try exact match first
    const exact = llmTestAlignment.find(la => la.test === t.name);
    if (exact) return { file: t.file, name: t.name, alignedTo: exact.alignedTo };

    // Case-insensitive fallback
    const ci = llmTestAlignment.find(la => la.test.toLowerCase() === t.name.toLowerCase());
    if (ci) return { file: t.file, name: t.name, alignedTo: ci.alignedTo };

    // If the test name contains a documented feature name as a prefix (doc-features.spec.ts style)
    // e.g. test name "Hero Section: Get Started button" → alignedTo "Hero Section"
    const colonIdx = t.name.indexOf(':');
    if (colonIdx > 0) {
      const prefix = t.name.slice(0, colonIdx).trim();
      const matched = docFeatures.find(f => f.name.toLowerCase() === prefix.toLowerCase());
      if (matched) return { file: t.file, name: t.name, alignedTo: matched.name };
    }

    // Keyword heuristic: find which feature's words appear in the test name
    const matchedFeature = docFeatures.find(f => {
      const words = f.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.length > 0 && words.some(w => t.name.toLowerCase().includes(w));
    });
    return { file: t.file, name: t.name, alignedTo: matchedFeature?.name ?? null };
  });

  const aligned       = testItems.filter(t => t.alignedTo !== null).length;
  const alignedScore  = testItems.length ? Math.round((aligned / testItems.length) * 100) : 0;

  // Figma coverage
  let figmaReport: AccuracyReport['figma'];
  if (session.figmaResult?.comparisons?.length) {
    const frames: FigmaFrameCoverage[] = session.figmaResult.comparisons.map(c => ({
      frameName: c.frameName,
      covered: true, // if it's in figmaResult it was included in a test
      compareUrl: c.url,
    }));
    figmaReport = {
      score: 100,
      frames,
      total: frames.length,
      covered: frames.length,
    };
  }

  // Overall score: weighted average
  let overallScore = 0;
  let weights = 0;
  if (docReport.length)    { overallScore += docScore * 0.5;   weights += 0.5; }
  if (siteReport.length)   { overallScore += siteScore * 0.3;  weights += 0.3; }
  if (testItems.length)    { overallScore += alignedScore * 0.2; weights += 0.2; }
  if (weights > 0) overallScore = Math.round(overallScore / weights);

  const report: AccuracyReport = {
    sessionId: id,
    sessionUrl: session.url,
    overallScore,
    ...(llmError ? { llmError } : {}),

    doc: {
      score: docScore,
      features: docReport,
      total: docReport.length,
      covered: docCovered,
      hasDoc: !!contextMd,
    },

    site: {
      score: siteScore,
      pages: siteReport,
      total: siteReport.length,
      covered: siteCovered,
      hasMap: sitePages.length > 0,
    },

    tests: {
      alignmentScore: alignedScore,
      total: testItems.length,
      aligned,
      items: testItems,
    },

    ...(figmaReport ? { figma: figmaReport } : {}),

    generatedAt: Date.now(),
  };

  return NextResponse.json(report);
}
