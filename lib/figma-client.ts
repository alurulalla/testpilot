import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { FigmaComparison, FigmaResult } from '@/types/session';

// ── Figma API helpers ────────────────────────────────────────────────────────

/** Extract the file key from a Figma URL */
export function parseFigmaFileKey(figmaUrl: string): string {
  const match = figmaUrl.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error(`Cannot parse Figma file key from: ${figmaUrl}`);
  return match[1];
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
}

/** Fetch the file structure and return all top-level FRAME nodes from the first canvas page.
 *  depth=3 is required: document(1) → pages(2) → top-level nodes on each page(3).
 *  Also unwraps SECTION nodes which are a newer Figma container type that wraps frames. */
async function fetchTopLevelFrames(
  token: string,
  fileKey: string,
): Promise<FigmaNode[]> {
  // depth=3: document → pages → frames (depth=2 only reaches pages, not the frames inside them)
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=3`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }
  const data = await res.json() as { document: FigmaNode };
  const pages = data.document.children ?? [];
  if (pages.length === 0) return [];

  // Search across ALL pages, not just the first, to maximise frame discovery
  const frames: FigmaNode[] = [];
  for (const page of pages) {
    for (const node of page.children ?? []) {
      if (node.type === 'FRAME' || node.type === 'COMPONENT') {
        frames.push(node);
      } else if (node.type === 'SECTION') {
        // SECTION is a newer Figma grouping layer — unwrap it one level
        for (const child of node.children ?? []) {
          if (child.type === 'FRAME' || child.type === 'COMPONENT') {
            frames.push(child);
          }
        }
      }
    }
  }

  return frames;
}

/** Request image exports for the given node IDs */
async function fetchImageUrls(
  token: string,
  fileKey: string,
  nodeIds: string[],
): Promise<Record<string, string>> {
  const ids = nodeIds.join(',');
  const res = await fetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=1`,
    { headers: { 'X-Figma-Token': token } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Figma images API error ${res.status}: ${body}`);
  }
  const data = await res.json() as { images: Record<string, string | null>; err?: string };
  if (data.err) throw new Error(`Figma images error: ${data.err}`);
  const result: Record<string, string> = {};
  for (const [id, url] of Object.entries(data.images)) {
    if (url) result[id] = url;
  }
  return result;
}

// ── URL guessing ─────────────────────────────────────────────────────────────

/**
 * Strip common design-file naming noise from a frame name so we can match
 * the semantic page name it represents.
 *
 * Examples:
 *   "1920w light"      → ""       → homepage
 *   "Login - Desktop"  → "login"
 *   "Dashboard 375w Dark" → "dashboard"
 */
function cleanFrameName(name: string): string {
  return name
    // Remove resolution / breakpoint suffixes (1920w, 375px, etc.)
    .replace(/\b\d{3,4}w\b/gi, '')
    .replace(/\b\d{3,4}px\b/gi, '')
    // Remove theme / device variant words
    .replace(/\b(light|dark|desktop|mobile|tablet|responsive|sm|md|lg|xl|2xl)\b/gi, '')
    // Collapse separators into spaces
    .replace(/[-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Best-guess the live URL for a Figma frame based on its name.
 *  knownUrls (from the site map) are searched first for the best match. */
function guessUrl(frameName: string, baseUrl: string, knownUrls: string[] = []): string {
  const base = baseUrl.replace(/\/$/, '');
  const cleaned = cleanFrameName(frameName);

  // Empty after cleaning (e.g. "1920w light" → "") → homepage
  if (!cleaned) return base + '/';

  // ── Try to find in the actual site map URLs ──────────────────────────────
  if (knownUrls.length > 0) {
    const slug = cleaned.replace(/\s+/g, '-');
    // Exact segment match first
    const exactMatch = knownUrls.find(u => {
      const path = new URL(u).pathname.replace(/\/$/, '');
      return path.endsWith('/' + slug) || path === '/' + slug;
    });
    if (exactMatch) return exactMatch;
    // Partial match (frame name appears anywhere in the path)
    const partialMatch = knownUrls.find(u =>
      u.toLowerCase().includes(cleaned.replace(/\s+/g, '-')) ||
      u.toLowerCase().includes(cleaned.replace(/\s+/g, '/')),
    );
    if (partialMatch) return partialMatch;
  }

  // ── Semantic keyword matching ────────────────────────────────────────────
  if (['home', 'homepage', 'landing', 'index', 'main', 'page'].includes(cleaned)) return base + '/';
  if (['login', 'log in', 'sign in', 'signin'].includes(cleaned)) return `${base}/login`;
  if (['register', 'signup', 'sign up', 'create account'].includes(cleaned)) return `${base}/register`;
  if (['dashboard', 'overview'].includes(cleaned)) return `${base}/dashboard`;
  if (['profile', 'account', 'my account'].includes(cleaned)) return `${base}/profile`;
  if (['settings', 'preferences'].includes(cleaned)) return `${base}/settings`;
  if (['about', 'about us'].includes(cleaned)) return `${base}/about`;
  if (['contact', 'contact us'].includes(cleaned)) return `${base}/contact`;

  // Build a slug from the cleaned name
  const slug = cleaned.replace(/\s+/g, '-');

  // If the slug looks like a design artefact (just numbers, single letter, etc.) → homepage
  if (/^[\d-]+$/.test(slug) || slug.length <= 1) return base + '/';

  return `${base}/${slug}`;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch Figma frames, download PNGs, capture live screenshots, and generate
 * a figma-visual.spec.ts test file in the workspace.
 */
export async function runFigmaComparison(
  token: string,
  figmaFileUrl: string,
  baseUrl: string,
  workspaceDir: string,
  knownUrls: string[],
  onProgress?: (msg: string) => void,
): Promise<FigmaResult> {
  const log = (msg: string) => onProgress?.(msg);

  const fileKey = parseFigmaFileKey(figmaFileUrl);
  log(`Fetching Figma file ${fileKey}…`);

  const frames = await fetchTopLevelFrames(token, fileKey);
  if (frames.length === 0) {
    throw new Error(
      'No top-level frames found in the Figma file. ' +
      'Make sure the file has FRAME nodes at the top level of a page (not inside groups). ' +
      `File key used: ${fileKey}`,
    );
  }
  log(`Found ${frames.length} frame(s): ${frames.map(f => f.name).join(', ')}`);

  log(`Matched known site URLs: ${knownUrls.length > 0 ? knownUrls.slice(0, 5).join(', ') + (knownUrls.length > 5 ? '…' : '') : 'none (site map not yet built)'}`);
  log('Exporting Figma frames as PNG…');
  // scale=1 keeps file sizes manageable for large frames (e.g. 1920px wide)
  const imageUrls = await fetchImageUrls(token, fileKey, frames.map(f => f.id));

  const figmaDir = path.join(workspaceDir, 'figma-snapshots');
  const screenshotsDir = path.join(workspaceDir, 'figma-live-screenshots');
  mkdirSync(figmaDir, { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });

  // Download Figma PNGs
  const downloaded: { frame: FigmaNode; figmaFile: string }[] = [];
  for (const frame of frames) {
    const url = imageUrls[frame.id];
    if (!url) { log(`⚠ No export URL for "${frame.name}" — skipping`); continue; }

    const safeName = frame.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');
    const figmaFile = `${safeName}.png`;
    const figmaPath = path.join(figmaDir, figmaFile);

    log(`Downloading Figma export: ${frame.name}`);
    const imgRes = await fetch(url);
    if (!imgRes.ok) { log(`⚠ Failed to download "${frame.name}"`); continue; }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    writeFileSync(figmaPath, buf);
    downloaded.push({ frame, figmaFile });
  }

  if (downloaded.length === 0) throw new Error('Could not download any Figma frame images');

  // Take live screenshots with Playwright
  log('Launching browser for live screenshots…');
  const browser = await chromium.launch({ headless: true });
  const comparisons: FigmaComparison[] = [];

  try {
    for (const { frame, figmaFile } of downloaded) {
      const targetUrl = guessUrl(frame.name, baseUrl, knownUrls);
      const safeName = figmaFile.replace('.png', '');
      const screenshotFile = `${safeName}-live.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotFile);

      const cleanedLabel = cleanFrameName(frame.name) || '(homepage)';
      log(`Capturing live screenshot: "${frame.name}" (cleaned: "${cleanedLabel}") → ${targetUrl}`);
      try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15_000 });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        await context.close();

        comparisons.push({
          frameName: frame.name,
          url: targetUrl,
          figmaImagePath: path.relative(workspaceDir, path.join(figmaDir, figmaFile)),
          screenshotPath: path.relative(workspaceDir, screenshotPath),
        });
      } catch (err) {
        log(`⚠ Screenshot failed for "${frame.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Generate the visual test file
  const testFile = generateVisualTestFile(workspaceDir, comparisons, baseUrl);
  log(`Generated visual test file: ${testFile}`);

  return { comparisons, testFile };
}

// ── Test file generator ──────────────────────────────────────────────────────

function generateVisualTestFile(
  workspaceDir: string,
  comparisons: FigmaComparison[],
  _baseUrl: string,
): string {
  const testsDir = path.join(workspaceDir, 'tests');
  mkdirSync(testsDir, { recursive: true });

  const relFigmaDir = path.relative(testsDir, path.join(workspaceDir, 'figma-snapshots'));
  const relScreenshotsDir = path.relative(testsDir, path.join(workspaceDir, 'figma-live-screenshots'));

  const testCases = comparisons.map(c => {
    const safeName = c.frameName.replace(/'/g, "\\'");
    const figmaFile = c.figmaImagePath.split('/').pop()!;
    const screenshotFile = c.screenshotPath.split('/').pop()!;
    return `  test('${safeName} — visual alignment check', async ({ page }, testInfo) => {
    await page.goto('${c.url}');
    await page.waitForLoadState('networkidle');

    // Take live screenshot
    const liveScreenshot = await page.screenshot({ fullPage: false });

    // Attach both to the Playwright HTML report for visual inspection
    await testInfo.attach('figma-design', {
      body: readFileSync(path.join(__dirname, '${relFigmaDir}', '${figmaFile}')),
      contentType: 'image/png',
    });
    await testInfo.attach('live-screenshot', {
      body: liveScreenshot,
      contentType: 'image/png',
    });

    // Basic structural checks
    await expect(page.locator('body')).toBeVisible();
    expect(liveScreenshot.length).toBeGreaterThan(0);
    console.log('Visual comparison attached to report — open HTML report to inspect side-by-side.');
  });`;
  }).join('\n\n');

  const content = `// Auto-generated by TestPilot Figma integration
// Run: npx playwright test figma-visual.spec.ts --reporter=html
// Then open playwright-report/index.html to view side-by-side Figma vs live comparisons.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';

test.describe('Figma Visual Alignment', () => {
  // Attach live screenshot next to Figma export in the HTML report.
  // Open playwright-report/index.html after running to inspect each comparison.
  // Note: ${relScreenshotsDir} contains pre-captured live screenshots from test generation time.

${testCases}
});
`;

  const testFilePath = path.join(testsDir, 'figma-visual.spec.ts');
  writeFileSync(testFilePath, content, 'utf8');
  return path.relative(workspaceDir, testFilePath);
}

/** Checks if a Figma file URL + token are configured */
export function isFigmaConfigured(
  token: string | undefined,
  figmaFileUrl: string | null | undefined,
): figmaFileUrl is string {
  return !!token && !!figmaFileUrl;
}
