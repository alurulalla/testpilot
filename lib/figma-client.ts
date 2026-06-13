import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import { launchBrowser } from '@/lib/browser';
import { FigmaComparison, FigmaDiscrepancy, FigmaResult } from '@/types/session';
import type { ChatModel, ContentBlock } from '@/lib/pilot';

// ── Figma API helpers ────────────────────────────────────────────────────────

/** Extract the file key from a Figma URL */
export function parseFigmaFileKey(figmaUrl: string): string {
  const match = figmaUrl.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error(`Cannot parse Figma file key from: ${figmaUrl}`);
  return match[1];
}

// ── Figma node types ─────────────────────────────────────────────────────────

interface FigmaFill {
  type: string; // 'SOLID' | 'IMAGE' | 'GRADIENT_LINEAR' | ...
  color?:    { r: number; g: number; b: number; a: number };
  imageRef?: string;
  scaleMode?: string; // 'FILL' | 'FIT' | 'CROP' | 'TILE'
  visible?:  boolean;
  opacity?:  number;
}

interface FigmaNode {
  id:       string;
  name:     string;
  type:     string;
  visible?: boolean;
  children?: FigmaNode[];

  // TEXT node content & style
  characters?: string;
  style?: {
    fontFamily?:          string;
    fontSize?:            number;
    fontWeight?:          number;
    lineHeightPx?:        number;
    letterSpacing?:       number;
    textAlignHorizontal?: string;
    italic?:              boolean;
  };

  // Visual layout — present on most node types
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?:               FigmaFill[];
  cornerRadius?:        number;
  paddingLeft?:         number;
  paddingRight?:        number;
  paddingTop?:          number;
  paddingBottom?:       number;
  opacity?:             number;
}

// ── Viewport matching ─────────────────────────────────────────────────────────

/**
 * Choose the live-browser viewport width to match a Figma frame, the way a
 * tester would resize their browser to the design's breakpoint. Clamped to a
 * sane range so an oversized artboard or a tiny component frame doesn't produce
 * a broken viewport.
 */
function frameViewportWidth(frame: FigmaNode): number {
  const w = frame.absoluteBoundingBox?.width;
  if (!w || !Number.isFinite(w)) return 1280; // sensible default
  return Math.round(Math.min(1920, Math.max(360, w)));
}

// ── Colour helpers ───────────────────────────────────────────────────────────

/** Convert Figma colour (0–1 floats) to CSS hex string. */
function rgbToHex(r: number, g: number, b: number): string {
  const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Extract the first solid fill colour from a fills array, returns hex or undefined. */
function solidFillHex(fills?: FigmaFill[]): string | undefined {
  const f = fills?.find(f => f.type === 'SOLID' && f.color && f.visible !== false);
  return f?.color ? rgbToHex(f.color.r, f.color.g, f.color.b) : undefined;
}

// ── Node classification ──────────────────────────────────────────────────────

/** True for VECTOR nodes or small named icons/logos → must be visually verified. */
function isUIImage(node: FigmaNode): boolean {
  if (node.type === 'VECTOR') return true;
  const bbox = node.absoluteBoundingBox;
  const small = bbox ? bbox.width <= 96 && bbox.height <= 96 : false;
  return small && /\b(icon|logo|badge|avatar|symbol|mark|glyph)\b/i.test(node.name);
}

/** True for rectangle/image fills that represent placeholder content images. */
function isContentImage(node: FigmaNode): boolean {
  if (isUIImage(node)) return false;
  return Boolean(node.fills?.some(f => f.type === 'IMAGE'));
}

// ── Figma API calls ──────────────────────────────────────────────────────────

/**
 * Fetch a Figma API URL with automatic retry on 429 (rate-limit) responses.
 *
 * Respects the Retry-After response header when present (Figma sets this on
 * 429s).  Falls back to exponential backoff: 15 s → 30 s → 60 s.
 */
/** Maximum wait we'll ever honour from a Retry-After header (2 minutes). */
const MAX_RETRY_WAIT_MS = 2 * 60 * 1_000;

async function figmaFetch(
  url: string,
  token: string,
  maxRetries = 3,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<Response> {
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
    if (res.status !== 429) return res;   // success or non-rate-limit error
    lastRes = res;

    if (attempt < maxRetries) {
      const retryAfterSec = Number(res.headers.get('Retry-After') ?? 0);

      // If Figma says wait longer than our maximum, abort immediately —
      // the token has been temporarily blocked (e.g. too many failed requests).
      if (retryAfterSec > MAX_RETRY_WAIT_MS / 1_000) {
        const hours = Math.round(retryAfterSec / 3600);
        throw new Error(
          `Figma has rate-limited this token for ~${hours}h due to too many requests. ` +
          `Please wait before retrying, or generate a new Personal Access Token at ` +
          `figma.com → Settings → Personal access tokens.`,
        );
      }

      const delayMs = retryAfterSec > 0
        ? retryAfterSec * 1_000
        : 15_000 * Math.pow(2, attempt); // fallback: 15 s, 30 s, 60 s
      onRetry?.(attempt + 1, delayMs);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return lastRes!;
}

/**
 * Verify that a Figma PAT is valid and has file-read access.
 * Returns an error string, or null if the token is fine.
 *
 * Common failure modes:
 *   - Token created without "File content" (files:read) scope
 *   - Token expired or revoked
 *   - Wrong token pasted (starts with "figd-" for new tokens, "fig-" for legacy)
 */
export async function validateFigmaToken(token: string): Promise<string | null> {
  // Skip the /me round-trip if we validated this token recently (10 min) —
  // avoids burning rate-limit quota re-checking the same token every run.
  const lastOk = _tokenValidatedAt.get(token);
  if (lastOk && Date.now() - lastOk < 10 * 60 * 1_000) return null;
  try {
    const res = await fetch('https://api.figma.com/v1/me', {
      headers: { 'X-Figma-Token': token },
    });
    if (res.ok) { _tokenValidatedAt.set(token, Date.now()); return null; } // token valid
    if (res.status === 403 || res.status === 401) {
      return 'Invalid token — make sure it has the "File content" (files:read) scope enabled.';
    }
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      return retryAfter
        ? `Figma rate limit — please wait ${retryAfter}s before retrying.`
        : 'Figma rate limit exceeded. Please wait a few minutes and try again.';
    }
    return `Figma API returned ${res.status} — check your token and try again.`;
  } catch (err) {
    return `Could not reach Figma API: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Brief pause between sequential Figma API calls to stay within rate limits. */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── In-session caches ─────────────────────────────────────────────────────────
// Avoid re-hitting the Figma API for the same data within one process.
// Keyed by "{fileKey}:{token_first8}" so different tokens don't share entries.
const _frameCache = new Map<string, { frames: FigmaNode[]; ts: number }>();
const _nodeCache  = new Map<string, { node: FigmaNode | null; ts: number }>();
// Tokens we've already validated (value = timestamp) so we don't spam /me.
const _tokenValidatedAt = new Map<string, number>();
const FRAME_CACHE_TTL_MS = 30 * 60 * 1_000; // 30 minutes

/** Fetch all top-level FRAME nodes from every canvas page in the file. */
async function fetchTopLevelFrames(
  token: string,
  fileKey: string,
  onLog?: (msg: string) => void,
): Promise<FigmaNode[]> {
  // Return cached result if still fresh — avoids burning rate-limit quota on repeat runs
  const cacheKey = `${fileKey}:${token.slice(0, 8)}`;
  const cached = _frameCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FRAME_CACHE_TTL_MS) {
    onLog?.(`  (using cached frame list — ${cached.frames.length} frame(s))`);
    return cached.frames;
  }

  const res = await figmaFetch(
    `https://api.figma.com/v1/files/${fileKey}?depth=3`,
    token,
    3,
    (attempt, waitMs) =>
      onLog?.(
        `  Figma rate limit hit — waiting ${waitMs / 1_000}s before retry ${attempt}/3…`,
      ),
  );
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
  // Cache for 30 minutes so re-runs in the same session skip this call
  _frameCache.set(cacheKey, { frames, ts: Date.now() });
  return frames;
}

/** Fetch the full deep node tree for a specific frame ID (cached per process). */
async function fetchFrameNodes(
  token: string, fileKey: string, nodeId: string,
  onLog?: (msg: string) => void,
): Promise<FigmaNode | null> {
  const cacheKey = `${fileKey}:${nodeId}:${token.slice(0, 8)}`;
  const cached = _nodeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < FRAME_CACHE_TTL_MS) return cached.node;

  const res = await figmaFetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
    token, 3,
    (attempt, waitMs) =>
      onLog?.(`  Figma rate limit — waiting ${waitMs / 1_000}s (retry ${attempt}/3)…`),
  );
  if (!res.ok) return null;
  const data = await res.json() as { nodes: Record<string, { document: FigmaNode } | null> };
  const node = data.nodes[nodeId]?.document ?? null;
  _nodeCache.set(cacheKey, { node, ts: Date.now() });
  return node;
}

/** Request PNG export URLs for a list of node IDs. */
async function fetchImageUrls(
  token: string, fileKey: string, nodeIds: string[],
): Promise<Record<string, string>> {
  const ids = nodeIds.join(',');
  const res = await figmaFetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=1`,
    token, 3,
    (attempt, waitMs) =>
      console.log(`  Figma images rate limit — waiting ${waitMs / 1_000}s (retry ${attempt}/3)…`),
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

// ── Figma visual spec extraction ─────────────────────────────────────────────

/**
 * Walk the Figma node tree and return a compact, human-readable design spec
 * that the LLM can compare against live DOM properties.
 *
 * Each significant node is formatted as:
 *   [NodeName] (TYPE) WxH at (x,y)  bg=#HEX  border-radius:Npx
 *     font-size:Npx  font-weight:N  color:#HEX  → "text content"
 */
function buildFigmaVisualSpec(root: FigmaNode, maxDepth = 5): string {
  const lines: string[] = [];

  function walk(node: FigmaNode, depth: number) {
    if (depth > maxDepth) return;
    if (node.visible === false) return;

    const indent = '  '.repeat(depth);
    const bbox   = node.absoluteBoundingBox;
    const sizeStr = bbox
      ? ` ${Math.round(bbox.width)}×${Math.round(bbox.height)} at (${Math.round(bbox.x)},${Math.round(bbox.y)})`
      : '';

    if (node.type === 'TEXT' && node.characters) {
      const s     = node.style ?? {};
      const color = solidFillHex(node.fills);
      const parts: string[] = [];
      if (s.fontSize)   parts.push(`font-size:${s.fontSize}px`);
      if (s.fontWeight) parts.push(`font-weight:${s.fontWeight}`);
      if (s.fontFamily) parts.push(`font-family:${s.fontFamily}`);
      if (color)        parts.push(`color:${color}`);
      if (s.lineHeightPx)  parts.push(`line-height:${Math.round(s.lineHeightPx)}px`);
      if (s.letterSpacing) parts.push(`letter-spacing:${s.letterSpacing}`);
      lines.push(
        `${indent}[${node.name}] (TEXT)${sizeStr}  "${node.characters.slice(0, 60)}"`,
      );
      if (parts.length) lines.push(`${indent}  ${parts.join(' | ')}`);

    } else if (isUIImage(node)) {
      const color = solidFillHex(node.fills);
      lines.push(
        `${indent}[${node.name}] (UI-IMAGE/${node.type})${sizeStr}` +
        (color ? `  color:${color}` : '') +
        `  ← verify visually`,
      );

    } else if (isContentImage(node)) {
      const fillScale = node.fills?.find(f => f.type === 'IMAGE')?.scaleMode ?? 'FILL';
      lines.push(
        `${indent}[${node.name}] (CONTENT-IMAGE)${sizeStr}  object-fit:${fillScale.toLowerCase()}` +
        (node.cornerRadius ? `  border-radius:${node.cornerRadius}px` : '') +
        `  ← check size/position/fit only`,
      );
      return; // don't recurse into content images

    } else if (
      ['FRAME','COMPONENT','INSTANCE','RECTANGLE','GROUP'].includes(node.type) &&
      node.name && depth > 0
    ) {
      const bg = solidFillHex(node.fills);
      const parts: string[] = [];
      if (bg) parts.push(`bg:${bg}`);
      if (node.cornerRadius) parts.push(`border-radius:${node.cornerRadius}px`);
      if (node.paddingTop || node.paddingLeft) {
        const p = [node.paddingTop ?? 0, node.paddingRight ?? 0,
                   node.paddingBottom ?? 0, node.paddingLeft ?? 0];
        parts.push(`padding:${p.join(' ')}px`);
      }
      if (node.opacity != null && node.opacity < 1) parts.push(`opacity:${node.opacity}`);
      lines.push(
        `${indent}[${node.name}] (${node.type})${sizeStr}` +
        (parts.length ? `  ${parts.join('  ')}` : ''),
      );
    }

    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return lines.join('\n');
}

// ── DOM style extraction ─────────────────────────────────────────────────────

interface DomStyleEntry {
  selector:   string;
  tag:        string;
  role?:      string;
  /** Landmark region this element sits in: header | nav | main | footer | body */
  region:     string;
  text:       string;
  x: number;  y: number; w: number; h: number;
  fontSize:   string;
  fontWeight: string;
  fontFamily: string;
  color:      string;
  bg:         string;
  borderRadius: string;
  padding:    string;
  lineHeight: string;
  objectFit?: string;
  isImg:      boolean;
  imgBroken?: boolean;
  imgAlt?:    string;
}

/**
 * Extract computed CSS styles from a live Playwright page for all key elements:
 * headings, buttons, inputs, images, nav, header, footer.
 * Returns a compact formatted spec string for the LLM.
 */
async function extractDomVisualSpec(page: Page): Promise<string> {
  const entries: DomStyleEntry[] = await page.evaluate((): DomStyleEntry[] => {
    const results: DomStyleEntry[] = [];

    function bestSelector(el: Element): string {
      const testId = el.getAttribute('data-test') || el.getAttribute('data-testid');
      if (testId) return `[data-test="${testId}"]`;
      if (el.id) return `#${el.id}`;
      const cls = Array.from(el.classList).slice(0, 2).join('.');
      return cls ? `.${cls}` : el.tagName.toLowerCase();
    }

    function isVisible(el: Element): boolean {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }

    function regionOf(el: Element): string {
      if (el.closest('header,[role="banner"]')) return 'header';
      if (el.closest('nav,[role="navigation"]')) return 'nav';
      if (el.closest('footer,[role="contentinfo"]')) return 'footer';
      if (el.closest('main,[role="main"]')) return 'main';
      return 'body';
    }

    function capture(el: Element, overrideTag?: string) {
      if (!isVisible(el)) return;
      const cs   = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const isImg = el.tagName === 'IMG';
      const entry: DomStyleEntry = {
        selector:     bestSelector(el),
        tag:          overrideTag ?? el.tagName.toLowerCase(),
        role:         el.getAttribute('role') ?? undefined,
        region:       regionOf(el),
        text:         (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        fontSize:     cs.fontSize,
        fontWeight:   cs.fontWeight,
        fontFamily:   cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        color:        cs.color,
        bg:           cs.backgroundColor,
        borderRadius: cs.borderRadius,
        padding:      `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        lineHeight:   cs.lineHeight,
        isImg,
      };
      if (isImg) {
        const img = el as HTMLImageElement;
        entry.imgBroken = img.naturalWidth === 0;
        entry.imgAlt    = img.alt || undefined;
        entry.objectFit = cs.objectFit;
      }
      results.push(entry);
    }

    // Headings
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el => capture(el));
    // Buttons
    document.querySelectorAll('button,[role="button"],[type="submit"],[type="button"]')
      .forEach(el => capture(el));
    // Inputs
    document.querySelectorAll('input:not([type="hidden"]),select,textarea')
      .forEach(el => capture(el));
    // Images
    document.querySelectorAll('img').forEach(el => capture(el));
    // Labels
    document.querySelectorAll('label').forEach(el => capture(el));
    // Nav / header / footer
    ['header','nav','footer','main'].forEach(tag => {
      document.querySelectorAll(tag).forEach(el => capture(el, tag));
    });
    // Prominent spans/paragraphs (price labels, badges, etc.)
    document.querySelectorAll('.price,[class*="price"],[class*="badge"],[class*="tag"],[class*="count"]')
      .forEach(el => capture(el));

    return results.slice(0, 80); // cap to keep prompt manageable
  });

  if (entries.length === 0) return '  (no elements extracted)';

  const fmtEntry = (e: DomStyleEntry) => {
    const pos  = `${e.w}×${e.h} at (${e.x},${e.y})`;
    const font = `font-size:${e.fontSize} font-weight:${e.fontWeight} font-family:${e.fontFamily}`;
    const cols = `color:${e.color} bg:${e.bg}`;
    const radius = e.borderRadius !== '0px' ? ` border-radius:${e.borderRadius}` : '';
    let line = `  [${e.selector}] (${e.tag}) ${pos}  ${font}  ${cols}${radius}`;
    if (e.text) line += `  → "${e.text.slice(0, 60)}"`;
    if (e.isImg) {
      line += e.imgBroken ? '  ❌ BROKEN IMAGE' : '  ✅ image loaded';
      if (e.objectFit) line += `  object-fit:${e.objectFit}`;
      if (!e.imgAlt)   line += '  ⚠ no alt text';
    }
    return line;
  };

  // Group top-to-bottom by region so the comparison reads like a tester's scan.
  const ORDER = ['header', 'nav', 'main', 'body', 'footer'];
  const byRegion = new Map<string, DomStyleEntry[]>();
  for (const e of entries) {
    if (!byRegion.has(e.region)) byRegion.set(e.region, []);
    byRegion.get(e.region)!.push(e);
  }
  const sections = ORDER.filter(r => byRegion.has(r)).map(r =>
    `▼ REGION: ${r.toUpperCase()}\n${byRegion.get(r)!.map(fmtEntry).join('\n')}`,
  );
  return sections.join('\n\n');
}

// ── Image resizing helper ────────────────────────────────────────────────────

/**
 * Read a PNG from disk, resize it to at most maxWidth (keeping aspect ratio),
 * and return a base64-encoded string ready for the LLM vision API.
 * Returns undefined if the file is missing or resize fails.
 */
async function pngToBase64(filePath: string, maxWidth = 900): Promise<string | undefined> {
  try {
    const buf      = readFileSync(filePath);
    const meta     = await sharp(buf).metadata();
    const srcWidth = meta.width ?? 0;
    const resized  = srcWidth > maxWidth
      ? await sharp(buf).resize(maxWidth).png({ compressionLevel: 7 }).toBuffer()
      : await sharp(buf).png({ compressionLevel: 7 }).toBuffer();
    return resized.toString('base64');
  } catch { return undefined; }
}

// ── Text design content (for LLM text comparison) ────────────────────────────

interface DesignContent {
  texts:          string[];
  componentNames: string[];
  buttonLabels:   string[];
  inputLabels:    string[];
  headings:       string[];
}

function extractDesignContent(node: FigmaNode): DesignContent {
  const result: DesignContent = {
    texts: [], componentNames: [], buttonLabels: [], inputLabels: [], headings: [],
  };

  function walk(n: FigmaNode, d: number) {
    if (n.type === 'TEXT' && n.characters) {
      const text     = n.characters.trim();
      if (!text) return;
      const fontSize = n.style?.fontSize ?? 14;
      if (fontSize >= 20 || /heading|title|headline/i.test(n.name)) {
        result.headings.push(text);
      } else {
        result.texts.push(text);
      }
    }
    if ((n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'FRAME') && n.name && d > 0) {
      if (/button|btn|cta/i.test(n.name)) {
        const childText = (n.children ?? [])
          .filter(c => c.type === 'TEXT' && c.characters)
          .map(c => c.characters!.trim()).join(' ');
        if (childText) result.buttonLabels.push(childText);
        else result.componentNames.push(n.name);
      } else if (/input|field|text.?field|email|password|search/i.test(n.name)) {
        result.inputLabels.push(n.name);
      } else if (n.name.length < 60 && !/^\d/.test(n.name)) {
        result.componentNames.push(n.name);
      }
    }
    for (const child of n.children ?? []) walk(child, d + 1);
  }

  walk(node, 0);
  result.texts          = [...new Set(result.texts)].slice(0, 50);
  result.componentNames = [...new Set(result.componentNames)].slice(0, 30);
  result.buttonLabels   = [...new Set(result.buttonLabels)].slice(0, 20);
  result.inputLabels    = [...new Set(result.inputLabels)].slice(0, 20);
  result.headings       = [...new Set(result.headings)].slice(0, 20);
  return result;
}

// ── Live page text extraction ────────────────────────────────────────────────

interface LivePageContent {
  title:              string;
  headings:           string[];
  buttonTexts:        string[];
  linkTexts:          string[];
  inputPlaceholders:  string[];
  labelTexts:         string[];
  visibleText:        string[];
}

async function extractLivePageContent(page: Page): Promise<LivePageContent> {
  return page.evaluate((): LivePageContent => {
    const txt     = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ');
    const visible = (el: Element) => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .filter(visible).map(txt).filter(Boolean).slice(0, 20);
    const buttonTexts = Array.from(
      document.querySelectorAll('button,[role="button"],[type="submit"],[type="button"]'),
    ).filter(visible).map(txt).filter(Boolean).slice(0, 30);
    const linkTexts = Array.from(document.querySelectorAll('a[href]'))
      .filter(visible).map(txt).filter(t => t.length > 1 && t.length < 80).filter(Boolean).slice(0, 30);
    const inputPlaceholders = Array.from(
      document.querySelectorAll<HTMLInputElement>('input,textarea'),
    ).filter(visible)
      .map(el => el.placeholder || el.name || el.getAttribute('aria-label') || '')
      .filter(Boolean).slice(0, 20);
    const labelTexts = Array.from(document.querySelectorAll('label'))
      .filter(visible).map(txt).filter(Boolean).slice(0, 20);
    const visibleText = Array.from(document.querySelectorAll('p,span,li'))
      .filter(visible)
      .filter(el => !el.closest('button,a,nav,script,style'))
      .map(txt).filter(t => t.length > 5 && t.length < 150).slice(0, 40);
    return { title: document.title, headings, buttonTexts, linkTexts,
             inputPlaceholders, labelTexts, visibleText };
  });
}

// ── LLM comparison ───────────────────────────────────────────────────────────

const TESTER_SYSTEM_PROMPT =
  'You are a senior QA tester doing a formal design-review of a web application against its Figma design.\n' +
  'You receive:\n' +
  '  1. Screenshots — Figma design (first image) and live app (second image), captured at the SAME width\n' +
  '  2. Figma design spec — exact component properties extracted from the Figma node tree\n' +
  '  3. Live DOM spec — computed CSS styles, grouped by REGION (header, nav, main, body, footer)\n\n' +
  'Work like a real tester: scan TOP-TO-BOTTOM, REGION BY REGION (header → nav → main → footer). ' +
  'For each region compare the design against the live page and check every measurable property:\n' +
  '  • Typography: font-size, font-weight, font-family, line-height, color\n' +
  '  • Colors: background, border, text, icon colours\n' +
  '  • Spacing: padding, margin, border-radius\n' +
  '  • Layout: element size (width × height) and position\n' +
  '  • Content: missing labels, wrong button text, missing sections\n' +
  '  • Images:\n' +
  '      – UI images (logos, icons, illustrations): verify visual match — they must look identical\n' +
  '      – Content images (product photos): check presence, size, object-fit — NOT actual content\n' +
  '      – Broken images: flag as high severity\n\n' +
  'PLACEHOLDER RULE: Figma designs use placeholder text (lorem ipsum, "Body text", dummy labels) and ' +
  'stock/dummy images. NEVER report a finding just because the live COPY or IMAGE CONTENT differs from a ' +
  'placeholder — only flag placeholders for wrong STYLE (font, color, size) or missing/structural issues.\n\n' +
  'Severity guide:\n' +
  '  high   — missing element/section, completely wrong colour, wrong font-weight on a CTA, broken image\n' +
  '  medium — font-size off by >2 px, wrong border-radius, missing border, clearly wrong padding\n' +
  '  low    — position/size off by ≤4 px, very close colour shade, minor spacing\n\n' +
  'Return ONLY a valid JSON array — no prose, no markdown fences.\n' +
  'Schema: [{ "region": "header"|"nav"|"main"|"footer"|"body", "severity": "high"|"medium"|"low", ' +
  '"element": string, "issue": string, "figmaValue"?: string, "liveValue"?: string }]\n' +
  'Return [] if everything matches. Report real, user-noticeable issues only — limit to the 15 most important.';

async function compareWithLlm(
  frameName: string,
  design: DesignContent,
  live: LivePageContent,
  url: string,
  model: ChatModel,
  options?: {
    figmaBase64?:    string;  // base64 PNG of Figma frame
    liveBase64?:     string;  // base64 PNG of live screenshot
    figmaVisualSpec?: string; // extracted Figma node properties as text
    domVisualSpec?:  string;  // extracted DOM computed styles as text
  },
): Promise<FigmaDiscrepancy[]> {

  // Mark obvious placeholder copy so the model checks style, not literal text.
  const isPlaceholder = (s: string) =>
    /lorem ipsum|dolor sit amet|body (copy|text)|placeholder|dummy|sample text|lipsum|consectetur/i.test(s);
  const fmt = (items: string[]) =>
    items.length
      ? items.map(i => `• ${i}${isPlaceholder(i) ? '  (placeholder — check style only)' : ''}`).join('\n')
      : '(none)';

  // ── Build text content ──────────────────────────────────────────────────
  const textSection =
    `FIGMA DESIGN — Frame: "${frameName}"\n` +
    `Headings/Titles:\n${fmt(design.headings)}\n` +
    `Button labels:\n${fmt(design.buttonLabels)}\n` +
    `Input fields:\n${fmt(design.inputLabels)}\n` +
    `Other text elements:\n${fmt(design.texts.slice(0, 20))}\n` +
    `Component names:\n${fmt(design.componentNames.slice(0, 15))}\n\n` +
    `LIVE PAGE — URL: ${url}\n` +
    `Page title: ${live.title}\n` +
    `Headings:\n${fmt(live.headings)}\n` +
    `Buttons:\n${fmt(live.buttonTexts)}\n` +
    `Links:\n${fmt(live.linkTexts.slice(0, 15))}\n` +
    `Input placeholders/labels:\n${fmt([...live.inputPlaceholders, ...live.labelTexts])}\n` +
    `Visible text:\n${fmt(live.visibleText.slice(0, 20))}`;

  const specSection = (options?.figmaVisualSpec || options?.domVisualSpec)
    ? `\n\n${'─'.repeat(60)}\n` +
      `FIGMA VISUAL SPEC (exact properties from Figma node tree):\n${options.figmaVisualSpec ?? '(not available)'}\n\n` +
      `LIVE DOM VISUAL SPEC (computed CSS from live page):\n${options.domVisualSpec ?? '(not available)'}`
    : '';

  const userText = textSection + specSection +
    `\n\n${'─'.repeat(60)}\nCompare the Figma design against the live page. ` +
    `Flag every discrepancy. Focus on functional elements and visual properties.`;

  // ── Build message content — with images if available ────────────────────
  const contentBlocks: ContentBlock[] = [];

  if (options?.figmaBase64 && options?.liveBase64) {
    // Vision: both screenshots + instruction text
    contentBlocks.push({
      type: 'text',
      text: `Compare these two images:\n• Image 1 = Figma design for "${frameName}"\n• Image 2 = Live app screenshot (${url})\n\n` +
            `Then use the detailed specs below to report every property mismatch.\n\n${userText}`,
    });
    contentBlocks.push({ type: 'image', mediaType: 'image/png', data: options.figmaBase64 });
    contentBlocks.push({ type: 'image', mediaType: 'image/png', data: options.liveBase64 });
  }

  const messages = contentBlocks.length > 0
    ? [
        { role: 'system', content: TESTER_SYSTEM_PROMPT },
        { role: 'user',   content: contentBlocks },
      ]
    : [
        { role: 'system', content: TESTER_SYSTEM_PROMPT },
        { role: 'user',   content: userText },
      ];

  let raw: string;
  try {
    raw = await model.invoke(messages, { maxTokens: 2_500 });
  } catch (err) {
    // If vision fails (e.g. model doesn't support images), retry text-only
    if (contentBlocks.length > 0) {
      try {
        raw = await model.invoke(
          [
            { role: 'system', content: TESTER_SYSTEM_PROMPT },
            { role: 'user',   content: userText },
          ],
          { maxTokens: 2_500 },
        );
      } catch { return []; }
    } else {
      void err;
      return [];
    }
  }

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const items = JSON.parse(match[0]) as FigmaDiscrepancy[];
    return items.filter(i => i.severity && i.element && i.issue).slice(0, 15);
  } catch { return []; }
}

// ── Per-discrepancy element screenshots ─────────────────────────────────────

/**
 * For each discrepancy, try to screenshot the relevant element on the live page.
 * Best-effort — failures are silently skipped.
 */
async function captureDiscrepancyScreenshots(
  page: Page,
  discrepancies: FigmaDiscrepancy[],
  screenshotsDir: string,
  safeName: string,
  workspaceDir: string,
): Promise<void> {
  for (let i = 0; i < discrepancies.length; i++) {
    const disc = discrepancies[i];
    const fileName = `${safeName}-disc-${i}.png`;
    const filePath = path.join(screenshotsDir, fileName);

    try {
      const name  = disc.element;
      // Clean parentheticals and pick the most meaningful words
      const words = name.replace(/\(.*?\)/g, '').split(/\s+/).filter(w => w.length > 3);
      let buf: Buffer | null = null;

      // Strategy 1 — named button role
      if (!buf && /button|cta|link/i.test(name)) {
        const label = words.filter(w => !/button|link/i.test(w)).slice(0, 4).join(' ');
        if (label) {
          const loc = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
          if (await loc.count() > 0) buf = await loc.screenshot({ timeout: 3_000 }).catch(() => null);
        }
      }

      // Strategy 2 — heading / section title
      if (!buf && /heading|title|section|hero|banner/i.test(name)) {
        const keywords = words.filter(w => !/heading|title|section|hero|banner/i.test(w)).slice(0, 3);
        if (keywords.length > 0) {
          const loc = page.getByRole('heading')
            .filter({ hasText: new RegExp(keywords.join('|'), 'i') }).first();
          if (await loc.count() > 0) buf = await loc.screenshot({ timeout: 3_000 }).catch(() => null);
        }
      }

      // Strategy 3 — generic text search
      if (!buf && words.length > 0) {
        const pattern = new RegExp(words.slice(0, 3).join('.*'), 'i');
        const loc = page.getByText(pattern, { exact: false }).first();
        if (await loc.count() > 0) buf = await loc.screenshot({ timeout: 3_000 }).catch(() => null);
      }

      if (buf) {
        writeFileSync(filePath, buf);
        disc.screenshotPath = path.relative(workspaceDir, filePath);
      }
    } catch {
      // Non-fatal — discrepancy still listed, just without a screenshot
    }
  }
}

// ── Pixel diff ───────────────────────────────────────────────────────────────

/**
 * Generate a pixel-diff overlay image:
 * Matching pixels → dimmed live screenshot.
 * Different pixels → bright red highlight.
 */
/**
 * Mean SSIM (Structural Similarity Index) over 8×8 blocks — the standard
 * perceptual image-similarity metric. Returns 0–1 (1 = identical). Far more
 * faithful to "how similar do these look" than a raw pixel-diff ratio, because
 * it compares local luminance/contrast/structure rather than exact pixels.
 */
function meanSsim(grayA: Float64Array, grayB: Float64Array, w: number, h: number): number {
  const C1 = (0.01 * 255) ** 2; // 6.5025
  const C2 = (0.03 * 255) ** 2; // 58.5225
  const B = 8;
  let total = 0, blocks = 0;
  for (let by = 0; by + B <= h; by += B) {
    for (let bx = 0; bx + B <= w; bx += B) {
      let sumA = 0, sumB = 0;
      for (let y = 0; y < B; y++) {
        const row = (by + y) * w + bx;
        for (let x = 0; x < B; x++) { sumA += grayA[row + x]; sumB += grayB[row + x]; }
      }
      const n = B * B;
      const muA = sumA / n, muB = sumB / n;
      let varA = 0, varB = 0, cov = 0;
      for (let y = 0; y < B; y++) {
        const row = (by + y) * w + bx;
        for (let x = 0; x < B; x++) {
          const da = grayA[row + x] - muA, db = grayB[row + x] - muB;
          varA += da * da; varB += db * db; cov += da * db;
        }
      }
      varA /= n - 1; varB /= n - 1; cov /= n - 1;
      const ssim = ((2 * muA * muB + C1) * (2 * cov + C2)) /
                   ((muA * muA + muB * muB + C1) * (varA + varB + C2));
      total += ssim; blocks++;
    }
  }
  return blocks > 0 ? total / blocks : 0;
}

async function generatePixelDiff(
  figmaPath: string, livePath: string, diffPath: string,
): Promise<{ diffPath: string; ssim: number } | null> {
  try {
    const [figMeta, liveMeta] = await Promise.all([
      sharp(figmaPath).metadata(),
      sharp(livePath).metadata(),
    ]);
    const figW = figMeta.width  ?? 0, figH = figMeta.height  ?? 0;
    const liveW = liveMeta.width ?? 0, liveH = liveMeta.height ?? 0;
    if (!figW || !figH || !liveW || !liveH) return null;

    // Align by WIDTH, preserving each image's aspect ratio (no cover-crop / stretch).
    // The frame and the live page are already captured at matched widths, so this
    // keeps content lined up. We then compare over the overlapping height only —
    // pages are often taller or shorter than the frame, and that's expected.
    const w = Math.min(figW, liveW);
    const scaledFigH  = Math.round(figH  * (w / figW));
    const scaledLiveH = Math.round(liveH * (w / liveW));
    const h = Math.min(scaledFigH, scaledLiveH);
    if (w < 2 || h < 2) return null;

    const [figmaBuf, liveBuf] = await Promise.all([
      sharp(figmaPath).resize(w, scaledFigH).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer(),
      sharp(livePath).resize(w, scaledLiveH).extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer(),
    ]);

    const figmaCh = (figmaBuf.length / (w * h)) | 0;
    const liveCh  = (liveBuf.length  / (w * h)) | 0;
    const pixels  = w * h;
    const diffRgba = Buffer.alloc(pixels * 4);
    // Grayscale (luma) buffers feed the SSIM score.
    const grayFig = new Float64Array(pixels);
    const grayLive = new Float64Array(pixels);

    for (let i = 0; i < pixels; i++) {
      const fi = i * figmaCh;
      const li = i * liveCh;
      const fr = figmaBuf[fi] ?? 0; const fg = figmaBuf[fi+1] ?? 0; const fb = figmaBuf[fi+2] ?? 0;
      const lr = liveBuf[li]  ?? 0; const lg = liveBuf[li+1]  ?? 0; const lb = liveBuf[li+2]  ?? 0;
      grayFig[i]  = 0.299 * fr + 0.587 * fg + 0.114 * fb;
      grayLive[i] = 0.299 * lr + 0.587 * lg + 0.114 * lb;
      const dist = Math.sqrt((fr-lr)**2 + (fg-lg)**2 + (fb-lb)**2);
      const di = i * 4;
      if (dist > 30) {
        diffRgba[di]=220; diffRgba[di+1]=30; diffRgba[di+2]=30;
        diffRgba[di+3]=Math.min(255, Math.round((dist/441)*255*1.5));
      } else {
        diffRgba[di]=lr>>1; diffRgba[di+1]=lg>>1; diffRgba[di+2]=lb>>1;
        diffRgba[di+3]=255;
      }
    }
    await sharp(diffRgba, { raw: { width: w, height: h, channels: 4 } }).png().toFile(diffPath);
    const ssim = meanSsim(grayFig, grayLive, w, h);
    return { diffPath, ssim };
  } catch { return null; }
}

// ── URL guessing ─────────────────────────────────────────────────────────────

/** Common frame-name → path guesses, shared by guessUrl and suggestFramePath. */
const WELL_KNOWN: Record<string, string> = {
  home: '/', homepage: '/', landing: '/', index: '/', main: '/', page: '/',
  login: '/login', 'log in': '/login', 'sign in': '/login', signin: '/login',
  register: '/register', signup: '/register', 'sign up': '/register', 'create account': '/register',
  dashboard: '/dashboard', overview: '/dashboard',
  profile: '/profile', account: '/profile', 'my account': '/profile',
  settings: '/settings', preferences: '/settings',
  about: '/about', 'about us': '/about',
  contact: '/contact', 'contact us': '/contact',
  cart: '/cart', basket: '/cart', checkout: '/checkout',
  inventory: '/inventory', products: '/inventory', shop: '/shop',
};

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

/**
 * Suggest a URL path for a frame from its name ALONE (no crawl data) — used to
 * pre-fill the frame→page mapping UI on the prepare page. Returns '' when there
 * is no confident guess, so the user supplies it.
 */
function suggestFramePath(frameName: string): string {
  const hint = frameName.match(/\((\/[^)]+)\)/)?.[1];
  if (hint) return hint;
  const cleaned = cleanFrameName(frameName);
  if (WELL_KNOWN[cleaned]) return WELL_KNOWN[cleaned];
  return '';
}

/**
 * List the top-level frames in a Figma file with size + a suggested path.
 * Used by the prepare-page mapping UI. Pure Figma API — no LLM tokens consumed.
 */
export async function listFigmaFrames(
  token: string,
  figmaFileUrl: string,
): Promise<{ name: string; width?: number; height?: number; suggestedPath: string }[]> {
  // No separate token validation here — fetchTopLevelFrames surfaces a clear
  // error on a bad/rate-limited token, so we avoid an extra /me API call.
  const fileKey = parseFigmaFileKey(figmaFileUrl);
  const frames = await fetchTopLevelFrames(token, fileKey);
  return frames.map(f => ({
    name: f.name,
    width:  f.absoluteBoundingBox?.width  ? Math.round(f.absoluteBoundingBox.width)  : undefined,
    height: f.absoluteBoundingBox?.height ? Math.round(f.absoluteBoundingBox.height) : undefined,
    suggestedPath: suggestFramePath(f.name),
  }));
}

/**
 * Try to map a Figma frame name to a real page URL.
 *
 * Strategy (in order):
 *   1. Frame name contains a path hint: "Cart Page (/cart.html)" → use that path
 *   2. Exact slug match against a crawled URL
 *   3. Partial keyword match against crawled URLs
 *   4. Well-known name dictionary (home, login, cart, …)
 *   5. If crawled URLs exist but none match → fall back to baseUrl (homepage)
 *      NEVER construct a made-up slug when we have real crawled pages to compare.
 *   6. No crawled URLs at all → construct slug as last resort
 *
 * Returns { url, confident } — confident=false when we fell back to baseUrl.
 */
function guessUrl(
  frameName: string,
  baseUrl: string,
  knownUrls: string[] = [],
): { url: string; confident: boolean } {
  const base    = baseUrl.replace(/\/$/, '');
  const cleaned = cleanFrameName(frameName);
  if (!cleaned) return { url: base + '/', confident: true };

  // 1. Explicit path hint in the frame name: "Cart (/cart.html)"
  const pathHint = frameName.match(/\((\/[^)]+)\)/)?.[1];
  if (pathHint) {
    try {
      const origin = new URL(baseUrl).origin;
      return { url: origin + pathHint, confident: true };
    } catch { /* fall through */ }
  }

  if (knownUrls.length > 0) {
    const slug = cleaned.replace(/\s+/g, '-');

    // 2. Exact slug match
    const exact = knownUrls.find(u => {
      const p = new URL(u).pathname.replace(/\/$/, '');
      return p.endsWith('/' + slug) || p === '/' + slug;
    });
    if (exact) return { url: exact, confident: true };

    // 3. Partial keyword match — every significant word in the frame name
    //    must appear somewhere in the URL
    const words = cleaned.split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      const partial = knownUrls.find(u => {
        const lower = u.toLowerCase();
        return words.every(w => lower.includes(w));
      });
      if (partial) return { url: partial, confident: true };
    }
  }

  // 4. Well-known names
  if (WELL_KNOWN[cleaned]) return { url: base + WELL_KNOWN[cleaned], confident: true };

  // 5. Have crawled URLs but no match → fall back to homepage rather than inventing a URL
  if (knownUrls.length > 0) {
    // Pick the shortest crawled URL (closest to root) as a best-effort match
    const sorted  = [...knownUrls].sort((a, b) => a.length - b.length);
    const closest = sorted[0];
    return { url: closest, confident: false };
  }

  // 6. No crawled pages at all → construct slug as absolute last resort
  const slug = cleaned.replace(/\s+/g, '-');
  if (/^[\d-]+$/.test(slug) || slug.length <= 1) return { url: base + '/', confident: true };
  return { url: `${base}/${slug}`, confident: false };
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * For each Figma frame:
 *  1. Download the Figma PNG
 *  2. Navigate to the matched live URL, take a screenshot
 *  3. Fetch the full Figma node tree — extract visual spec + design content
 *  4. Extract live DOM computed styles via Playwright
 *  5. Send both screenshots + specs to the LLM (vision + text)
 *  6. Generate pixel-diff image
 *  7. Return structured discrepancies + match score
 */
export async function runFigmaComparison(
  token:        string,
  figmaFileUrl: string,
  baseUrl:      string,
  workspaceDir: string,
  knownUrls:    string[],
  onProgress?:  (msg: string) => void,
  model?:       ChatModel,
  frameMap?:    Record<string, string> | null,
): Promise<FigmaResult> {
  const log = (msg: string) => onProgress?.(msg);

  // ── Validate token before doing anything else ────────────────────────────
  log('Validating Figma token…');
  const tokenError = await validateFigmaToken(token);
  if (tokenError) throw new Error(tokenError);
  log('  ✓ Token valid');

  const fileKey = parseFigmaFileKey(figmaFileUrl);
  log(`Fetching Figma file ${fileKey}…`);

  const frames = await fetchTopLevelFrames(token, fileKey, log);
  if (frames.length === 0) {
    throw new Error(
      'No top-level frames found. Make sure the file has FRAME nodes at the top level of a page. ' +
      `File key: ${fileKey}`,
    );
  }
  log(`Found ${frames.length} frame(s): ${frames.map(f => f.name).join(', ')}`);

  log('Exporting Figma frames as PNG…');
  const imageUrls = await fetchImageUrls(token, fileKey, frames.map(f => f.id));

  const figmaDir        = path.join(workspaceDir, 'figma-snapshots');
  const screenshotsDir  = path.join(workspaceDir, 'figma-live-screenshots');
  mkdirSync(figmaDir,       { recursive: true });
  mkdirSync(screenshotsDir, { recursive: true });

  // Download Figma PNGs — small pause between each to respect rate limits
  const downloaded: { frame: FigmaNode; figmaFile: string }[] = [];
  for (const frame of frames) {
    const url = imageUrls[frame.id];
    if (!url) { log(`⚠ No export URL for "${frame.name}" — skipping`); continue; }
    const safeName  = frame.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-');
    const figmaFile = `${safeName}.png`;
    log(`Downloading Figma export: ${frame.name}`);
    await sleep(300);
    const imgRes = await fetch(url);
    if (!imgRes.ok) { log(`⚠ Failed to download "${frame.name}"`); continue; }
    writeFileSync(path.join(figmaDir, figmaFile), Buffer.from(await imgRes.arrayBuffer()));
    downloaded.push({ frame, figmaFile });
  }
  if (downloaded.length === 0) throw new Error('Could not download any Figma frame images');

  log('Launching browser for live page analysis…');
  const browser: Browser = await launchBrowser();
  const comparisons: FigmaComparison[] = [];

  try {
    for (const { frame, figmaFile } of downloaded) {
      // Prefer the user-confirmed frame→page mapping; fall back to heuristics.
      const mapped = frameMap?.[frame.name]?.trim();
      const { url: targetUrl, confident } = mapped
        ? { url: mapped, confident: true }
        : guessUrl(frame.name, baseUrl, knownUrls);
      if (mapped) log(`  Using mapped URL for "${frame.name}": ${targetUrl}`);
      const safeName        = figmaFile.replace('.png', '');
      const screenshotFile  = `${safeName}-live.png`;
      const screenshotPath  = path.join(screenshotsDir, screenshotFile);
      const figmaFullPath   = path.join(figmaDir, figmaFile);
      const diffFullPath    = path.join(screenshotsDir, `${safeName}-diff.png`);

      if (!confident) {
        log(
          `⚠ Could not map frame "${frame.name}" to a specific page URL — ` +
          `falling back to ${targetUrl}. ` +
          `Tip: rename the Figma frame to include the path, e.g. "Home (/en/)" or "About (/en/about-us/)"`,
        );
      }
      log(`Analysing "${frame.name}" → ${targetUrl}`);

      let discrepancies: FigmaDiscrepancy[] = [];
      let matchScore:    number | undefined;  // undefined = not analysed / page unreachable
      let liveScreenshot = false;
      let diffImagePath: string | undefined;
      let navigationFailed = false;

      try {
        // Match the live viewport to the Figma frame's width — same as a tester
        // resizing their browser to the design breakpoint. Height is generous;
        // the fullPage screenshot captures everything below the fold anyway.
        const vpWidth = frameViewportWidth(frame);
        const context = await browser.newContext({ viewport: { width: vpWidth, height: 900 } });
        const page    = await context.newPage();
        log(`  Matched viewport to frame width: ${vpWidth}px`);

        // Use domcontentloaded as fallback if networkidle times out
        try {
          await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20_000 });
        } catch {
          try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
            log(`  ⚠ networkidle timed out — using domcontentloaded`);
          } catch (navErr) {
            navigationFailed = true;
            throw navErr; // bubble up to outer catch
          }
        }

        // Full-page screenshot at the matched width → same "canvas" as the
        // Figma frame, so the visual diff and vision comparison actually align.
        await page.screenshot({ path: screenshotPath, fullPage: true });
        liveScreenshot = true;
        log(`  ✓ Live full-page screenshot captured`);

        // ── Pixel diff ─────────────────────────────────────────────────────
        log(`  Generating pixel diff…`);
        const diffResult = await generatePixelDiff(figmaFullPath, screenshotPath, diffFullPath);
        if (diffResult) {
          diffImagePath = path.relative(workspaceDir, diffFullPath);
          // Standard perceptual similarity (mean SSIM, 0–100) is the headline
          // match score. The LLM discrepancies below are the explanatory detail,
          // not the score.
          matchScore = Math.round(Math.max(0, Math.min(1, diffResult.ssim)) * 100);
          log(`  ✓ Pixel diff saved · SSIM match ${matchScore}/100`);
        }

        if (model) {
          // ── Fetch Figma deep node tree ─────────────────────────────────
          // Small pause before each node fetch — Figma API has a 60 req/min limit
          await sleep(500);
          log(`  Fetching Figma node tree…`);
          const tree = await fetchFrameNodes(token, fileKey, frame.id, log);

          let figmaVisualSpec: string | undefined;
          let designContent: DesignContent = {
            texts: [], componentNames: [], buttonLabels: [], inputLabels: [], headings: [],
          };

          if (tree) {
            figmaVisualSpec = buildFigmaVisualSpec(tree);
            designContent   = extractDesignContent(tree);
            log(`  Figma spec: ${designContent.headings.length} heading(s), ${designContent.buttonLabels.length} button(s)`);
          }

          // ── Extract live DOM visual spec ───────────────────────────────
          log(`  Extracting DOM styles…`);
          const domVisualSpec  = await extractDomVisualSpec(page);
          const liveContent    = await extractLivePageContent(page);
          log(`  Live DOM: ${liveContent.headings.length} heading(s), ${liveContent.buttonTexts.length} button(s)`);

          // ── Prepare base64 images for vision ──────────────────────────
          log(`  Preparing images for vision comparison…`);
          const [figmaBase64, liveBase64] = await Promise.all([
            pngToBase64(figmaFullPath),
            pngToBase64(screenshotPath),
          ]);

          // ── LLM comparison ─────────────────────────────────────────────
          log(`  Running LLM comparison (vision + CSS properties)…`);
          discrepancies = await compareWithLlm(
            frame.name, designContent, liveContent, targetUrl, model,
            { figmaBase64, liveBase64, figmaVisualSpec, domVisualSpec },
          );
          log(`  Found ${discrepancies.length} discrepancy(ies) for "${frame.name}"`);

          // Capture a screenshot of each discrepancy's element while the page is open
          if (discrepancies.length > 0) {
            log(`  Capturing element screenshots for ${discrepancies.length} discrepancy(ies)…`);
            await captureDiscrepancyScreenshots(page, discrepancies, screenshotsDir, safeName, workspaceDir);
            const captured = discrepancies.filter(d => d.screenshotPath).length;
            if (captured > 0) log(`  ✓ Element screenshots captured for ${captured} discrepancy(ies)`);
          }

          // matchScore comes from SSIM (set above). If the pixel diff couldn't
          // run (e.g. an image was missing) fall back to the issue-weighted
          // heuristic so the score isn't left blank.
          if (matchScore == null) {
            const high   = discrepancies.filter(d => d.severity === 'high').length;
            const medium = discrepancies.filter(d => d.severity === 'medium').length;
            const low    = discrepancies.filter(d => d.severity === 'low').length;
            const lowPenalty = Math.min(low * 1.5, 12);
            matchScore   = Math.max(0, Math.round(100 - high * 12 - medium * 5 - lowPenalty));
          }
        }

        await context.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (navigationFailed) {
          log(`⚠ Could not load "${targetUrl}" — page may not exist or requires authentication. Skipping comparison.`);
          // Push a single "page unreachable" discrepancy so it shows in the report
          discrepancies = [{
            severity: 'high',
            element:  'Page',
            issue:    `Could not load ${targetUrl} — ${msg.slice(0, 120)}`,
          }];
          matchScore = 0; // unreachable page = 0% match, not 100%
        } else {
          log(`⚠ Analysis failed for "${frame.name}": ${msg}`);
        }
      }

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

  const testFiles = generateVerificationTestFiles(workspaceDir, comparisons);
  log(`Generated ${testFiles.length} figma verification test file(s) in tests/figma/`);

  return { comparisons, testFiles };
}

// ── Verification test files (one per frame, under tests/figma/) ───────────────

function frameSlug(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 60) || 'frame';
}

/**
 * Write one spec file per frame into tests/figma/, each verifying that frame's
 * page against the design (with assertions derived from the discrepancies).
 * Returns the relative paths so the caller can add them to the suite.
 */
function generateVerificationTestFiles(
  workspaceDir: string,
  comparisons:  FigmaComparison[],
): string[] {
  const figmaDir = path.join(workspaceDir, 'tests', 'figma');
  mkdirSync(figmaDir, { recursive: true });

  const written: string[] = [];
  const usedSlugs = new Set<string>();

  for (const c of comparisons) {
    let slug = frameSlug(c.frameName);
    // De-dupe slugs so two similarly-named frames don't overwrite each other.
    let n = 1;
    while (usedSlugs.has(slug)) { slug = `${frameSlug(c.frameName)}-${++n}`; }
    usedSlugs.add(slug);

    const safeName = c.frameName.replace(/'/g, "\\'");
    const assertions = (c.discrepancies ?? [])
      .filter(d => d.severity !== 'low')
      .slice(0, 5)
      .map(d => {
        const comment = `    // ${d.severity.toUpperCase()}: ${d.element} — ${d.issue}`;
        if (d.figmaValue && d.figmaValue.length < 60) {
          const escaped = d.figmaValue.replace(/'/g, "\\'");
          return `${comment}\n    await expect(page.getByText('${escaped}', { exact: false })).toBeVisible();`;
        }
        return `${comment}\n    // TODO: add assertion for this element`;
      }).join('\n\n');

    const score = c.matchScore != null ? `${c.matchScore}/100` : 'n/a';
    const content = `// Auto-generated by TestPilot — Figma design verification
// Frame: ${c.frameName}   ·   design match: ${score}
import { test, expect } from '@playwright/test';

test.describe('Figma: ${safeName}', () => {
  test('${safeName} — design verification', async ({ page }) => {
    await page.goto('${c.url}');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
${assertions || '    // No high/medium discrepancies found — page matches design'}
  });
});
`;
    const filePath = path.join(figmaDir, `${slug}.spec.ts`);
    writeFileSync(filePath, content, 'utf8');
    written.push(path.relative(workspaceDir, filePath));
  }

  return written;
}

/** Returns true when a Figma file URL + token are both configured. */
export function isFigmaConfigured(
  token:        string | undefined,
  figmaFileUrl: string | null | undefined,
): figmaFileUrl is string {
  return !!token && !!figmaFileUrl;
}
