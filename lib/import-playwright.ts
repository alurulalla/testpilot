/**
 * Import Playwright project from a ZIP archive.
 *
 * Validates that the archive is a Playwright project, extracts all spec file
 * contents (with imports rewritten for the TestPilot workspace), and parses
 * test use-cases for coverage-gap analysis.
 */
import AdmZip from 'adm-zip';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportedUseCase {
  file: string;
  suite: string;
  tests: string[];
}

export interface SpecFileContent {
  fileName: string;
  content: string;
}

export interface ImportResult {
  valid: true;
  useCases: ImportedUseCase[];
  specFiles: SpecFileContent[];
  specFilesCount: number;
  hasPlaywrightConfig: boolean;
  detectedBaseUrl?: string;
}

export interface ImportError {
  valid: false;
  reason: string;
}

// ── Detection ──────────────────────────────────────────────────────────────────

const CONFIG_RE = /playwright\.config\.[cm]?[jt]s$/;
const SPEC_RE   = /\.(spec|test)\.[cm]?[jt]sx?$/;

function extractBaseUrl(configContent: string): string | undefined {
  const m = configContent.match(/baseURL\s*:\s*['"`]([^'"`\n]+)['"`]/);
  return m?.[1]?.trim() || undefined;
}

function isPlaywrightPackageJson(content: string): boolean {
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>;
    const deps = {
      ...(pkg.dependencies as Record<string, unknown> | undefined ?? {}),
      ...(pkg.devDependencies as Record<string, unknown> | undefined ?? {}),
    };
    return '@playwright/test' in deps;
  } catch {
    return false;
  }
}

// ── Import rewriting ───────────────────────────────────────────────────────────

/**
 * Rewrite spec file imports so they work inside the TestPilot workspace.
 *
 * The canonical TestPilot import is:
 *   import { test, expect } from './fixtures.js';
 *   import { TARGET_URL } from './fixtures.js';
 *
 * We strip any @playwright/test imports and prepend the canonical ones.
 * Relative helper imports (../utils, ./helpers) are removed with a comment
 * because the helpers don't exist in the workspace — the user can re-add them.
 */
export function rewriteImports(content: string): string {
  // Remove @playwright/test imports
  let fixed = content
    .replace(/^import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '')
    .replace(/^import\s*\{[^}]*\bexpect\b[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '')
    .replace(/^import[^'"]*from\s*['"]@playwright\/test['"]\s*;?[ \t]*\n?/gm, '');

  // Comment out relative helper imports (they won't exist in the workspace)
  fixed = fixed.replace(
    /^(import[^'"]*from\s*['"])(\.\.?\/.+)(['"];?[ \t]*)$/gm,
    '// [imported] $1$2$3 — helper not available in TestPilot workspace',
  );

  // Check what's already in the file
  const hasTestImport    = /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]\.\/fixtures\.js['"]/.test(fixed);
  const hasTargetImport  = /import\s*\{[^}]*TARGET_URL[^}]*\}\s*from\s*['"]\.\/fixtures\.js['"]/.test(fixed);
  const needsTestImport  = /\btest\s*\(/.test(fixed) || /\btest\.describe\s*\(/.test(fixed);

  if (!needsTestImport) return fixed;

  const prefix = [
    !hasTestImport   ? `import { test, expect } from './fixtures.js';` : '',
    !hasTargetImport ? `import { TARGET_URL } from './fixtures.js';`    : '',
  ].filter(Boolean).join('\n');

  return prefix ? prefix + '\n' + fixed : fixed;
}

// ── Test name extraction ───────────────────────────────────────────────────────

function extractUseCasesFromSpec(source: string, fileName: string): ImportedUseCase[] {
  const results: ImportedUseCase[] = [];

  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, '');

  const DESCRIBE_RE = /\btest\.describe\s*\(\s*(["'`])([\s\S]*?)\1/g;
  const TEST_RE     = /\btest(?:\.only|\.skip|\.fixme)?\s*\(\s*(["'`])([\s\S]*?)\1/g;

  interface DescribeBlock { label: string; startIdx: number; endIdx: number }
  const describes: DescribeBlock[] = [];

  {
    let m: RegExpExecArray | null;
    while ((m = DESCRIBE_RE.exec(stripped)) !== null) {
      const label = m[2].replace(/\\(['"`])/g, '$1').trim();
      let braceStart = stripped.indexOf('{', m.index + m[0].length);
      if (braceStart === -1) continue;
      let depth = 1;
      let i = braceStart + 1;
      while (i < stripped.length && depth > 0) {
        if (stripped[i] === '{') depth++;
        else if (stripped[i] === '}') depth--;
        i++;
      }
      describes.push({ label, startIdx: braceStart, endIdx: i });
    }
  }

  const suiteMap = new Map<string, string[]>();
  const TOP_KEY = `__top__:${fileName}`;

  {
    let m: RegExpExecArray | null;
    TEST_RE.lastIndex = 0;
    while ((m = TEST_RE.exec(stripped)) !== null) {
      const testName = m[2].replace(/\\(['"`])/g, '$1').trim();
      if (!testName) continue;
      const testIdx = m.index;
      const parent  = describes.find(d => testIdx > d.startIdx && testIdx < d.endIdx);
      const key     = parent ? parent.label : TOP_KEY;
      const list    = suiteMap.get(key) ?? [];
      list.push(testName);
      suiteMap.set(key, list);
    }
  }

  const fileStem = fileName.replace(SPEC_RE, '');
  for (const [key, tests] of suiteMap) {
    results.push({ file: fileName, suite: key === TOP_KEY ? fileStem : key, tests });
  }
  if (results.length === 0) {
    results.push({ file: fileName, suite: fileStem, tests: [] });
  }
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function importPlaywrightProject(zipBuffer: Buffer): ImportResult | ImportError {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    return { valid: false, reason: 'The file is not a valid ZIP archive.' };
  }

  const entries = zip.getEntries().filter(e => {
    const n = e.entryName;
    return !n.includes('__MACOSX') && !n.includes('/.') && !e.isDirectory;
  });

  if (entries.length === 0) {
    return { valid: false, reason: 'The ZIP archive is empty.' };
  }

  const hasConfig  = entries.some(e => CONFIG_RE.test(e.entryName));
  const specEntries = entries.filter(e => SPEC_RE.test(e.entryName));

  if (!hasConfig && specEntries.length === 0) {
    const pkgEntry = entries.find(e => /(?:^|\/|\\)package\.json$/.test(e.entryName));
    if (!pkgEntry || !isPlaywrightPackageJson(pkgEntry.getData().toString('utf8'))) {
      return {
        valid: false,
        reason:
          'No Playwright configuration (playwright.config.ts), spec files (.spec.ts/.test.ts), ' +
          'or @playwright/test dependency were found. Please upload a valid Playwright project.',
      };
    }
  }

  // Extract baseURL from playwright config if present
  const configEntry = entries.find(e => CONFIG_RE.test(e.entryName));
  let detectedBaseUrl: string | undefined;
  if (configEntry) {
    try {
      detectedBaseUrl = extractBaseUrl(configEntry.getData().toString('utf8'));
    } catch { /* ignore */ }
  }

  const specFiles: SpecFileContent[] = [];
  const allUseCases: ImportedUseCase[] = [];

  for (const entry of specEntries) {
    const fileName = entry.entryName.split('/').pop() ?? entry.entryName;
    try {
      const raw     = entry.getData().toString('utf8');
      const content = rewriteImports(raw);
      specFiles.push({ fileName, content });
      allUseCases.push(...extractUseCasesFromSpec(raw, fileName));
    } catch {
      /* skip unreadable files */
    }
  }

  return {
    valid: true,
    useCases: allUseCases,
    specFiles,
    specFilesCount: specEntries.length,
    hasPlaywrightConfig: hasConfig,
    detectedBaseUrl,
  };
}
