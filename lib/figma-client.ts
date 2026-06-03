import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { launchBrowser } from '@/lib/browser';
import { FigmaComparison, FigmaDiscrepancy, FigmaResult } from '@/types/session';
import type { ChatModel } from '@/lib/pilot';

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
  characters?: string;        // TEXT nodes: actual text content
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
  };
}

/** Fetch the file structure and return all top-level FRAME nodes from all canvas pages. */
async function fetchTopLevelFrames(token: string, fileKey: string): Promise<FigmaNode[]> {
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=3`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }
  const data = await res.json() as { document: FigmaNode };
  const pages = data.document.children ?? [];
  const frames: FigmaNode[] = [];
  for (const page of pages) {
    for (const node of page.children ?? []) {
      if (node.type === 'FRAME' || node.type === 'COMPONENT') {
        frames.push(node);
      } else if (node.type === 'SECTION') {
        for (const child of node.children ?? []) {
          if (child.type === 'FRAME' || child.type === 'COMPONENT') frames.push(child);
        }
      }
    }
  }
  return frames;
}

/** Fetch the deep node tree for a specific frame (for text/component extraction). */
async function fetchFrameNodes(
  token: string,
  fileKey: string,
  nodeId: string,
): Promise<FigmaNode | null> {
  const res = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
    { headers: { 'X-Figma-Token': token } },
  );
  if (!res.ok) return null;
  const data = await res.json() as {
    nodes: Record<string, { document: FigmaNode } | null>;
  };
  return data.nodes[nodeId]?.document ?? null;
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

// ── Design content extraction ────────────────────────────────────────────────

interface DesignContent {
  texts: string[];
  componentNames: string[];
  buttonLabels: string[];
  inputLabels: string[];
  headings: string[];
}

function extractDesignContent(node: FigmaNode, depth = 0): DesignContent {
  const result: DesignContent = {
    texts: [], componentNames: [], buttonLabels: [], inputLabels: [], headings: [],
  };

  function walk(n: FigmaNode, d: number) {
    // Collect text nodes
    if (n.type === 'TEXT' && n.characters) {
      const text = n.characters.trim();
      if (!text) return;
      const fontSize = n.style?.fontSize ?? 14;

      // Classify by font size / name heuristics
      if (fontSize >= 20 || /^h[1-6]$/i.test(n.name) || /heading|title|headline/i.test(n.name)) {
        result.headings.push(text);
      } else if (/button|cta|action/i.test(n.name) || (fontSize >= 14 && text.length < 40)) {
        // Could be a button label — also check parent context
        result.texts.push(text);
      } else {
        result.texts.push(text);
      }
    }

    // Collect named components (buttons, inputs, etc.)
    if (
      (n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'FRAME') &&
      n.name && d > 0
    ) {
      const name = n.name.toLowerCase();
      if (/button|btn|cta/i.test(n.name)) {
        // Extract button label from child TEXT nodes
        const childText = (n.children ?? [])
          .filter(c => c.type === 'TEXT' && c.characters)
          .map(c => c.characters!.trim())
          .join(' ');
        if (childText) result.buttonLabels.push(childText);
        else result.componentNames.push(n.name);
      } else if (/input|field|text.?field|email|password|search/i.test(n.name)) {
        result.inputLabels.push(n.name);
      } else if (n.name.length < 60 && !/^\d/.test(n.name)) {
        result.componentNames.push(n.name);
      }
      void name; // suppress lint
    }

    for (const child of n.children ?? []) {
      walk(child, d + 1);
    }
  }

  walk(node, depth);

  // Deduplicate
  result.texts          = [...new Set(result.texts)].slice(0, 50);
  result.componentNames = [...new Set(result.componentNames)].slice(0, 30);
  result.buttonLabels   = [...new Set(result.buttonLabels)].slice(0, 20);
  result.inputLabels    = [...new Set(result.inputLabels)].slice(0, 20);
  result.headings       = [...new Set(result.headings)].slice(0, 20);

  return result;
}

// ── Live page DOM extraction ─────────────────────────────────────────────────

interface LivePageContent {
  title: string;
  headings: string[];
  buttonTexts: string[];
  linkTexts: string[];
  inputPlaceholders: string[];
  labelTexts: string[];
  visibleText: string[];
}

async function extractLivePageContent(page: Page): Promise<LivePageContent> {
  return page.evaluate((): LivePageContent => {
    const txt = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ');
    const visible = (el: Element) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(visible).map(txt).filter(Boolean).slice(0, 20);

    const buttonTexts = Array.from(
      document.querySelectorAll('button,[role="button"],[type="submit"],[type="button"]'),
    ).filter(visible).map(txt).filter(Boolean).slice(0, 30);

    const linkTexts = Array.from(document.querySelectorAll('a[href]'))
      .filter(visible)
      .map(txt)
      .filter(t => t.length > 1 && t.length < 80)
      .filter(Boolean).slice(0, 30);

    const inputPlaceholders = Array.from(
      document.querySelectorAll<HTMLInputElement>('input,textarea'),
    ).filter(visible)
      .map(el => el.placeholder || el.name || el.getAttribute('aria-label') || '')
      .filter(Boolean).slice(0, 20);

    const labelTexts = Array.from(document.querySelectorAll('label'))
      .filter(visible).map(txt).filter(Boolean).slice(0, 20);

    // Collect prominent paragraph/span text (not inside interactive elements)
    const visibleText = Array.from(document.querySelectorAll('p,span,li'))
      .filter(visible)
      .filter(el => !el.closest('button,a,nav,script,style'))
      .map(txt)
      .filter(t => t.length > 5 && t.length < 150)
      .slice(0, 40);

    return {
      title: document.title,
      headings,
      buttonTexts,
      linkTexts,
      inputPlaceholders,
      labelTexts,
      visibleText,
    };
  });
}

// ── LLM DOM comparison ───────────────────────────────────────────────────────

async function compareWithLlm(
  frameName: string,
  design: DesignContent,
  live: LivePageContent,
  url: string,
  model: ChatModel,
): Promise<FigmaDiscrepancy[]> {
  const formatList = (items: string[]) =>
    items.length ? items.map(i => `• ${i}`).join('\n') : '(none)';

  const systemPrompt =
    'You are a QA engineer performing a DOM-level comparison between a Figma design spec and a live web page. ' +
    'Identify specific discrepancies: missing elements, wrong text, missing form fields, missing buttons, etc. ' +
    'Output ONLY a valid JSON array — no prose, no markdown fences. ' +
    'Each item: { "severity": "high"|"medium"|"low", "element": string, "issue": string, "figmaValue"?: string, "liveValue"?: string }. ' +
    'Output [] if everything matches. Limit to the 10 most important findings.';

  const userPrompt =
    `FIGMA DESIGN — Frame: "${frameName}"\n` +
    `Headings/Titles:\n${formatList(design.headings)}\n` +
    `Button labels:\n${formatList(design.buttonLabels)}\n` +
    `Input fields:\n${formatList(design.inputLabels)}\n` +
    `Other text elements:\n${formatList(design.texts.slice(0, 20))}\n` +
    `Component names:\n${formatList(design.componentNames.slice(0, 15))}\n\n` +
    `LIVE PAGE — URL: ${url}\n` +
    `Page title: ${live.title}\n` +
    `Headings:\n${formatList(live.headings)}\n` +
    `Buttons:\n${formatList(live.buttonTexts)}\n` +
    `Links:\n${formatList(live.linkTexts.slice(0, 15))}\n` +
    `Input placeholders/labels:\n${formatList([...live.inputPlaceholders, ...live.labelTexts])}\n` +
    `Visible text:\n${formatList(live.visibleText.slice(0, 20))}\n\n` +
    `Compare the Figma design against the live page. ` +
    `Flag elements present in the design but missing/wrong in the live page, and vice versa. ` +
    `Focus on functional elements (headings, buttons, forms, navigation) over decorative ones. ` +
    `Output JSON array only.`;

  let raw: string;
  try {
    raw = await model.invoke(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      { maxTokens: 2_048 },
    );
  } catch {
    return [];
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const items = JSON.parse(match[0]) as FigmaDiscrepancy[];
    return items.filter(i => i.severity && i.element && i.issue).slice(0, 10);
  } catch {
    return [];
  }
}

// ── Pixel diff ───────────────────────────────────────────────────────────────

/**
 * Generate a pixel-diff image:
 *  - Resize both images to the same dimensions (live screenshot drives the size)
 *  - Blend the two images 50/50 (overlay)
 *  - Apply a red tint on pixels that differ significantly
 *
 * Returns the path of the generated diff PNG, or null on failure.
 */
async function generatePixelDiff(
  figmaPath: string,
  livePath: string,
  diffPath: string,
): Promise<string | null> {
  try {
    // Get live screenshot dimensions (our reference size)
    const liveMeta = await sharp(livePath).metadata();
    const w = liveMeta.width  ?? 1280;
    const h = liveMeta.height ?? 800;

    // Resize Figma frame to match live screenshot dimensions
    const [figmaBuf, liveBuf] = await Promise.all([
      sharp(figmaPath).resize(w, h, { fit: 'cover', position: 'top' }).raw().toBuffer(),
      sharp(livePath).resize(w, h, { fit: 'cover', position: 'top' }).raw().toBuffer(),
    ]);

    // Channels: sharp raw() gives RGB (3 bytes/pixel) or RGBA (4 bytes/pixel)
    // Normalise to RGB
    const figmaChannels = (figmaBuf.length / (w * h)) | 0;
    const liveChannels  = (liveBuf.length  / (w * h)) | 0;
    const pixels        = w * h;
    const diffRgba      = Buffer.alloc(pixels * 4);

    for (let i = 0; i < pixels; i++) {
      const fi = i * figmaChannels;
      const li = i * liveChannels;
      const fr = figmaBuf[fi] ?? 0;
      const fg = figmaBuf[fi + 1] ?? 0;
      const fb = figmaBuf[fi + 2] ?? 0;
      const lr = liveBuf[li] ?? 0;
      const lg = liveBuf[li + 1] ?? 0;
      const lb = liveBuf[li + 2] ?? 0;

      // Euclidean distance in RGB space (0–441)
      const dist = Math.sqrt((fr - lr) ** 2 + (fg - lg) ** 2 + (fb - lb) ** 2);
      const di   = i * 4;

      if (dist > 30) {
        // Differing pixel: bright red overlay
        diffRgba[di]     = 220;  // R
        diffRgba[di + 1] = 30;   // G
        diffRgba[di + 2] = 30;   // B
        diffRgba[di + 3] = Math.min(255, Math.round((dist / 441) * 255 * 1.5)); // A
      } else {
        // Matching pixel: show dimmed live screenshot as background
        diffRgba[di]     = lr >> 1;
        diffRgba[di + 1] = lg >> 1;
        diffRgba[di + 2] = lb >> 1;
        diffRgba[di + 3] = 255;
      }
    }

    await sharp(diffRgba, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toFile(diffPath);

    return diffPath;
  } catch {
    return null;
  }
}

// ── URL guessing ─────────────────────────────────────────────────────────────

function cleanFrameName(name: string): string {
  return name
    .replace(/\b\d{3,4}w\b/gi, '')
    .replace(/\b\d{3,4}px\b/gi, '')
    .replace(/\b(light|dark|desktop|mobile|tablet|responsive|sm|md|lg|xl|2xl)\b/gi, '')
    .replace(/[-–—_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function guessUrl(frameName: string, baseUrl: string, knownUrls: string[] = []): string {
  const base = baseUrl.replace(/\/$/, '');
  const cleaned = cleanFrameName(frameName);
  if (!cleaned) return base + '/';

  if (knownUrls.length > 0) {
    const slug = cleaned.replace(/\s+/g, '-');
    const exactMatch = knownUrls.find(u => {
      const p = new URL(u).pathname.replace(/\/$/, '');
      return p.endsWith('/' + slug) || p === '/' + slug;
    });
    if (exactMatch) return exactMatch;
    const partialMatch = knownUrls.find(u =>
      u.toLowerCase().includes(cleaned.replace(/\s+/g, '-')) ||
      u.toLowerCase().includes(cleaned.replace(/\s+/g, '/')),
    );
    if (partialMatch) return partialMatch;
  }

  if (['home', 'homepage', 'landing', 'index', 'main', 'page'].includes(cleaned)) return base + '/';
  if (['login', 'log in', 'sign in', 'signin'].includes(cleaned)) return `${base}/login`;
  if (['register', 'signup', 'sign up', 'create account'].includes(cleaned)) return `${base}/register`;
  if (['dashboard', 'overview'].includes(cleaned)) return `${base}/dashboard`;
  if (['profile', 'account', 'my account'].includes(cleaned)) return `${base}/profile`;
  if (['settings', 'preferences'].includes(cleaned)) return `${base}/settings`;
  if (['about', 'about us'].includes(cleaned)) return `${base}/about`;
  if (['contact', 'contact us'].includes(cleaned)) return `${base}/contact`;

  const slug = cleaned.replace(/\s+/g, '-');
  if (/^[\d-]+$/.test(slug) || slug.length <= 1) return base + '/';
  return `${base}/${slug}`;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * For each Figma frame:
 *  1. Download the Figma PNG (for visual reference in the UI)
 *  2. Navigate to the matched live URL and take a screenshot
 *  3. Fetch the full Figma node tree and extract design content
 *  4. Extract live page DOM content via Playwright
 *  5. Ask the LLM to compare and return structured discrepancies
 *  6. Compute a match score (100 − weighted penalty per severity)
 */
export async function runFigmaComparison(
  token: string,
  figmaFileUrl: string,
  baseUrl: string,
  workspaceDir: string,
  knownUrls: string[],
  onProgress?: (msg: string) => void,
  model?: ChatModel,
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

  log('Exporting Figma frames as PNG…');
  const imageUrls = await fetchImageUrls(token, fileKey, frames.map(f => f.id));

  const figmaDir      = path.join(workspaceDir, 'figma-snapshots');
  const screenshotsDir = path.join(workspaceDir, 'figma-live-screenshots');
  mkdirSync(figmaDir,       { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });

  // Download Figma PNGs
  const downloaded: { frame: FigmaNode; figmaFile: string }[] = [];
  for (const frame of frames) {
    const url = imageUrls[frame.id];
    if (!url) { log(`⚠ No export URL for "${frame.name}" — skipping`); continue; }
    const safeName  = frame.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');
    const figmaFile = `${safeName}.png`;
    log(`Downloading Figma export: ${frame.name}`);
    const imgRes = await fetch(url);
    if (!imgRes.ok) { log(`⚠ Failed to download "${frame.name}"`); continue; }
    writeFileSync(path.join(figmaDir, figmaFile), Buffer.from(await imgRes.arrayBuffer()));
    downloaded.push({ frame, figmaFile });
  }

  if (downloaded.length === 0) throw new Error('Could not download any Figma frame images');

  // Launch browser — used for both screenshots and DOM extraction
  log('Launching browser for live page analysis…');
  const browser: Browser = await launchBrowser();
  const comparisons: FigmaComparison[] = [];

  try {
    for (const { frame, figmaFile } of downloaded) {
      const targetUrl = guessUrl(frame.name, baseUrl, knownUrls);
      const safeName  = figmaFile.replace('.png', '');
      const screenshotFile = `${safeName}-live.png`;
      const screenshotPath = path.join(screenshotsDir, screenshotFile);
      const cleanedLabel   = cleanFrameName(frame.name) || '(homepage)';

      log(`Analysing "${frame.name}" (→ ${targetUrl})…`);

      let discrepancies: FigmaDiscrepancy[] = [];
      let matchScore: number | undefined;
      let liveScreenshot = false;
      let diffImagePath: string | undefined;

      const figmaFullPath = path.join(figmaDir, figmaFile);
      const diffFile      = `${safeName}-diff.png`;
      const diffFullPath  = path.join(screenshotsDir, diffFile);

      try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page    = await context.newPage();
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20_000 });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        liveScreenshot = true;

        // ── Pixel diff ────────────────────────────────────────────────────────
        log(`  Generating pixel diff for "${frame.name}"…`);
        const diffResult = await generatePixelDiff(figmaFullPath, screenshotPath, diffFullPath);
        if (diffResult) {
          diffImagePath = path.relative(workspaceDir, diffFullPath);
          log(`  ✓ Pixel diff saved`);
        }

        // ── Fetch Figma design content ──────────────────────────────────────
        let designContent: DesignContent = {
          texts: [], componentNames: [], buttonLabels: [], inputLabels: [], headings: [],
        };
        if (model) {
          log(`  Fetching design content for "${frame.name}"…`);
          const tree = await fetchFrameNodes(token, fileKey, frame.id);
          if (tree) {
            designContent = extractDesignContent(tree);
            log(`  Design: ${designContent.headings.length} heading(s), ${designContent.buttonLabels.length} button(s), ${designContent.texts.length} text(s)`);
          }

          // ── Extract live page DOM ─────────────────────────────────────────
          log(`  Extracting live DOM from ${targetUrl}…`);
          const liveContent = await extractLivePageContent(page);
          log(`  Live: ${liveContent.headings.length} heading(s), ${liveContent.buttonTexts.length} button(s)`);

          // ── LLM comparison ────────────────────────────────────────────────
          log(`  Comparing design vs live with LLM…`);
          discrepancies = await compareWithLlm(frame.name, designContent, liveContent, targetUrl, model);
          log(`  Found ${discrepancies.length} discrepancy(ies) for "${frame.name}"`);

          // Score: start at 100, deduct per severity
          const highCount   = discrepancies.filter(d => d.severity === 'high').length;
          const mediumCount = discrepancies.filter(d => d.severity === 'medium').length;
          const lowCount    = discrepancies.filter(d => d.severity === 'low').length;
          matchScore = Math.max(0, 100 - highCount * 15 - mediumCount * 8 - lowCount * 3);
        }

        await context.close();
      } catch (err) {
        log(`⚠ Analysis failed for "${frame.name}": ${err instanceof Error ? err.message : String(err)}`);
      }

      void cleanedLabel;
      comparisons.push({
        frameName:      frame.name,
        url:            targetUrl,
        figmaImagePath: path.relative(workspaceDir, figmaFullPath),
        screenshotPath: liveScreenshot
          ? path.relative(workspaceDir, screenshotPath)
          : path.relative(workspaceDir, figmaFullPath),
        diffImagePath,
        discrepancies,
        matchScore,
      });
    }
  } finally {
    await browser.close();
  }

  const testFile = generateVerificationTestFile(workspaceDir, comparisons, baseUrl);
  log(`Generated verification test file: ${testFile}`);

  return { comparisons, testFile };
}

// ── Test file generator ──────────────────────────────────────────────────────

/**
 * Generate a Playwright spec that:
 *  - Navigates to each matched URL
 *  - Checks that key design elements (headings, buttons) are present on the live page
 *  - Uses the discrepancy findings as the source of truth for what to assert
 */
function generateVerificationTestFile(
  workspaceDir: string,
  comparisons: FigmaComparison[],
  _baseUrl: string,
): string {
  const testsDir = path.join(workspaceDir, 'tests');
  mkdirSync(testsDir, { recursive: true });

  const testCases = comparisons.map(c => {
    const safeName = c.frameName.replace(/'/g, "\\'");

    // Build assertions from high/medium severity discrepancies
    const assertions = (c.discrepancies ?? [])
      .filter(d => d.severity !== 'low')
      .slice(0, 5)
      .map(d => {
        // Turn each finding into a comment + a basic structural check
        const comment = `// ${d.severity.toUpperCase()}: ${d.element} — ${d.issue}`;
        if (d.figmaValue && d.figmaValue.length < 60) {
          // If we know the expected value, assert it's visible
          const escaped = d.figmaValue.replace(/'/g, "\\'");
          return `    ${comment}\n    await expect(page.getByText('${escaped}', { exact: false })).toBeVisible();`;
        }
        return `    ${comment}\n    // TODO: add assertion for this element`;
      })
      .join('\n\n');

    return `  test('${safeName} — design verification', async ({ page }) => {
    await page.goto('${c.url}');
    await page.waitForLoadState('networkidle');

    // Basic structural check
    await expect(page.locator('body')).toBeVisible();
${assertions || '    // No high/medium discrepancies found — page matches design'}
  });`;
  }).join('\n\n');

  const discrepancySummary = comparisons
    .map(c => {
      const count = (c.discrepancies ?? []).length;
      const score = c.matchScore != null ? ` (score: ${c.matchScore}/100)` : '';
      return ` * - ${c.frameName}: ${count} discrepancy(ies)${score}`;
    })
    .join('\n');

  const content = `// Auto-generated by TestPilot Figma DOM verification
// Each test checks that key design elements are present on the live page.
//
// Summary:
${discrepancySummary}

import { test, expect } from '@playwright/test';

test.describe('Figma Design Verification', () => {

${testCases}
});
`;

  const testFilePath = path.join(testsDir, 'figma-verification.spec.ts');
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
