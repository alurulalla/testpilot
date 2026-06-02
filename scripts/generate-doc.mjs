/**
 * Generates TestPilot_Solution_Brief.docx  (detailed version)
 * Run: node scripts/generate-doc.mjs
 */

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, VerticalAlign, TableBorders,
  PageBreak, convertInchesToTwip,
} from 'docx';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'TestPilot_Solution_Brief.docx');

// ── Palette ──────────────────────────────────────────────────────────────────
const BRAND    = '2563EB';
const ACCENT   = '7C3AED';
const SUCCESS  = '059669';
const WARN     = 'B45309';
const DANGER   = 'BE123C';
const DARK     = '111827';
const MID      = '374151';
const LIGHT    = '6B7280';
const XLIGHT   = '9CA3AF';
const WHITE    = 'FFFFFF';
const BG_BLUE  = 'EFF6FF';
const BG_VIO   = 'F5F3FF';
const BG_GRN   = 'ECFDF5';
const BG_AMB   = 'FFFBEB';
const BG_DARK  = '1E1E2E';
const BG_GRAY  = 'F9FAFB';
const BG_LGRAY = 'F3F4F6';
const BORDER_C = 'E5E7EB';

const FONT  = 'Calibri';
const MONO  = 'Consolas';

// ── Unit helpers ─────────────────────────────────────────────────────────────
const pt   = n => n * 2;            // half-points
const twip = convertInchesToTwip;

// ── Text primitives ───────────────────────────────────────────────────────────
const t  = (text, opts = {}) => new TextRun({ text, font: FONT, size: pt(11), color: MID,  ...opts });
const b  = (text, c = DARK)  => new TextRun({ text, font: FONT, size: pt(11), color: c,    bold: true });
const sm = (text, opts = {}) => new TextRun({ text, font: FONT, size: pt(10), color: LIGHT, ...opts });
const mk = (text)            => new TextRun({ text, font: MONO, size: pt(10), color: ACCENT });
const br = ()                => new TextRun({ break: 1 });

// ── Paragraph helpers ─────────────────────────────────────────────────────────
const para = (children, opts = {}) =>
  new Paragraph({ spacing: { before: pt(3), after: pt(6) }, alignment: AlignmentType.LEFT, ...opts, children });

const justPara = (children, opts = {}) =>
  new Paragraph({ spacing: { before: pt(3), after: pt(7) }, alignment: AlignmentType.JUSTIFIED, ...opts, children });

const spacer = (p = 8) =>
  new Paragraph({ spacing: { before: 0, after: pt(p) }, children: [] });

const divider = (color = BORDER_C) =>
  new Paragraph({
    spacing: { before: pt(8), after: pt(8) },
    border: { bottom: { color, style: BorderStyle.SINGLE, size: 6 } },
    children: [],
  });

const pageBreak = () =>
  new Paragraph({ children: [new PageBreak()] });

// ── Section banner ────────────────────────────────────────────────────────────
const banner = (num, title, bg = BG_DARK, fg = WHITE, subColor = 'A5B4FC') =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: bg },
        margins: { top: 160, bottom: 160, left: 280, right: 280 },
        children: [para([
          new TextRun({ text: num + '  ', bold: true, font: FONT, size: pt(9), color: subColor }),
          new TextRun({ text: title,       bold: true, font: FONT, size: pt(18), color: fg }),
        ], { spacing: { before: 0, after: 0 } })],
      })],
    })],
  });

// ── Sub-section header ────────────────────────────────────────────────────────
const sh = (text, color = BRAND) =>
  new Paragraph({
    spacing: { before: pt(14), after: pt(6) },
    border: { left: { color, style: BorderStyle.SINGLE, size: 20 } },
    indent: { left: twip(0.15) },
    children: [new TextRun({ text, bold: true, font: FONT, size: pt(13), color })],
  });

// ── Small section label ───────────────────────────────────────────────────────
const label = (text, color = BRAND) =>
  new Paragraph({
    spacing: { before: pt(12), after: pt(4) },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, font: FONT, size: pt(9), color, characterSpacing: 40 })],
  });

// ── Bullet lists ──────────────────────────────────────────────────────────────
const bulletPara = (children, level = 0) =>
  new Paragraph({
    spacing: { before: pt(3), after: pt(4) },
    indent: { left: twip(0.2 + level * 0.2), hanging: twip(0.18) },
    bullet: { level },
    children,
  });

const bullets = items =>
  items.map(item => {
    if (typeof item === 'string') {
      return bulletPara([t(item)]);
    }
    const [head, rest] = item;
    return bulletPara([b(head + '  '), t(rest)]);
  });

const subBullets = items =>
  items.map(item => bulletPara([sm(typeof item === 'string' ? item : item[0] + ' — ' + item[1])], 1));

// ── Numbered steps ────────────────────────────────────────────────────────────
const stepRow = (num, title, desc, bg = BG_GRAY, numColor = BRAND) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 8, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: bg },
          margins: { top: 80, bottom: 80, left: 100, right: 40 },
          verticalAlign: VerticalAlign.CENTER,
          children: [para([
            new TextRun({ text: num, bold: true, font: FONT, size: pt(18), color: numColor }),
          ], { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })],
        }),
        new TableCell({
          width: { size: 92, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: bg },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            para([b(title, DARK)], { spacing: { before: 0, after: pt(2) } }),
            para([t(desc)],        { spacing: { before: 0, after: pt(2) }, alignment: AlignmentType.JUSTIFIED }),
          ],
        }),
      ],
    })],
  });

// ── Two-column info card ──────────────────────────────────────────────────────
const infoCard = (left, right, bgL = BG_GRAY, bgR = WHITE) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:     { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      bottom:  { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      left:    { style: BorderStyle.NONE },
      right:   { style: BorderStyle.NONE },
      insideH: { style: BorderStyle.NONE },
      insideV: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
    },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 38, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: bgL },
          margins: { top: 100, bottom: 100, left: 120, right: 100 },
          verticalAlign: VerticalAlign.TOP,
          children: left,
        }),
        new TableCell({
          width: { size: 62, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: bgR },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          verticalAlign: VerticalAlign.TOP,
          children: right,
        }),
      ],
    })],
  });

// ── Full-width highlight box ───────────────────────────────────────────────────
const callout = (children, bg = BG_BLUE, borderColor = BRAND) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: [new TableRow({
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: bg },
        margins: { top: 100, bottom: 100, left: 200, right: 200 },
        borders: {
          left:   { style: BorderStyle.SINGLE, color: borderColor, size: 24 },
          top:    { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          right:  { style: BorderStyle.NONE },
        },
        children,
      })],
    })],
  });

// ── Tech stack table ──────────────────────────────────────────────────────────
const techTable = rows =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:     { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      bottom:  { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      left:    { style: BorderStyle.NONE },
      right:   { style: BorderStyle.NONE },
      insideH: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      insideV: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
    },
    rows: rows.map(([layer, tech, why], i) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 18, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? BG_BLUE : BG_VIO },
            margins: { top: 90, bottom: 90, left: 120, right: 80 },
            verticalAlign: VerticalAlign.TOP,
            children: [para([new TextRun({ text: layer, bold: true, font: FONT, size: pt(10), color: i % 2 === 0 ? BRAND : ACCENT })],
              { spacing: { before: 0, after: 0 } })],
          }),
          new TableCell({
            width: { size: 32, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: BG_GRAY },
            margins: { top: 90, bottom: 90, left: 100, right: 80 },
            verticalAlign: VerticalAlign.TOP,
            children: tech.map(item =>
              para([new TextRun({ text: item, font: MONO, size: pt(9.5), color: DARK })],
                { spacing: { before: 0, after: pt(2) } })
            ),
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: WHITE },
            margins: { top: 90, bottom: 90, left: 100, right: 120 },
            verticalAlign: VerticalAlign.TOP,
            children: [para([t(why)], { alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: 0 } })],
          }),
        ],
      })
    ),
  });

// ── Outcome cards (3-col grid) ────────────────────────────────────────────────
const outcomeGrid = items => {
  const rows = [];
  for (let i = 0; i < items.length; i += 3) {
    const trio = [items[i], items[i+1], items[i+2]];
    rows.push(new TableRow({
      children: trio.map((item, j) => {
        if (!item) return new TableCell({ children: [spacer()] });
        const [emoji, title, stat, desc, bg] = item;
        return new TableCell({
          width: { size: 33, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: bg ?? BG_GRAY },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          borders: {
            top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
            left: { style: j === 0 ? BorderStyle.NONE : BorderStyle.SINGLE, color: BORDER_C, size: 4 },
            right: { style: BorderStyle.NONE },
          },
          children: [
            para([new TextRun({ text: emoji, font: FONT, size: pt(16) })],
              { spacing: { before: 0, after: pt(3) } }),
            para([new TextRun({ text: stat, bold: true, font: FONT, size: pt(14), color: DARK })],
              { spacing: { before: 0, after: pt(2) } }),
            para([new TextRun({ text: title, bold: true, font: FONT, size: pt(10), color: MID })],
              { spacing: { before: 0, after: pt(3) } }),
            para([sm(desc)], { spacing: { before: 0, after: 0 }, alignment: AlignmentType.JUSTIFIED }),
          ],
        });
      }),
    }));
    // row gap
    if (i + 3 < items.length) {
      rows.push(new TableRow({
        children: [new TableCell({
          columnSpan: 3,
          shading: { type: ShadingType.CLEAR, fill: WHITE },
          margins: { top: 40, bottom: 40 },
          children: [spacer(2)],
        })],
      }));
    }
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows,
  });
};

// ── Scalability pillar table ──────────────────────────────────────────────────
const scalabilityTable = items =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:     { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      bottom:  { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      left:    { style: BorderStyle.NONE },
      right:   { style: BorderStyle.NONE },
      insideH: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
      insideV: { style: BorderStyle.NONE },
    },
    rows: items.map(([icon, pillar, detail, sub], i) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 6, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? BG_GRN : BG_GRAY },
            margins: { top: 80, bottom: 80, left: 80, right: 40 },
            verticalAlign: VerticalAlign.CENTER,
            children: [para([new TextRun({ text: icon, font: FONT, size: pt(14) })],
              { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } })],
          }),
          new TableCell({
            width: { size: 24, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? BG_GRN : BG_GRAY },
            margins: { top: 80, bottom: 80, left: 100, right: 80 },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              para([new TextRun({ text: pillar, bold: true, font: FONT, size: pt(11), color: DARK })],
                { spacing: { before: 0, after: pt(2) } }),
              para([sm(sub)], { spacing: { before: 0, after: 0 } }),
            ],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: WHITE },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            verticalAlign: VerticalAlign.CENTER,
            children: [para([t(detail)],
              { alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: 0 } })],
          }),
        ],
      })
    ),
  });

// ════════════════════════════════════════════════════════════════════════════════
// DOCUMENT CONTENT
// ════════════════════════════════════════════════════════════════════════════════

const doc = new Document({
  styles: {
    paragraphStyles: [{
      id: 'Normal', name: 'Normal',
      run: { font: FONT, size: pt(11), color: MID },
    }],
  },
  sections: [{
    properties: {
      page: {
        margin: { top: twip(0.75), bottom: twip(0.75), left: twip(0.85), right: twip(0.85) },
      },
    },
    children: [

      // ══════════════════════════════════════════════════════════════════════
      // COVER BLOCK
      // ══════════════════════════════════════════════════════════════════════
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: TableBorders.NONE,
        rows: [new TableRow({
          children: [
            new TableCell({
              width: { size: 68, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: BG_DARK },
              margins: { top: 240, bottom: 240, left: 280, right: 160 },
              children: [
                para([
                  new TextRun({ text: 'TestPilot', bold: true, font: FONT, size: pt(32), color: WHITE }),
                ], { spacing: { before: 0, after: pt(4) } }),
                para([
                  new TextRun({ text: 'AI-Powered End-to-End Testing Platform', font: FONT, size: pt(12), color: 'A5B4FC' }),
                ], { spacing: { before: 0, after: pt(8) } }),
                para([
                  new TextRun({ text: 'Solution Brief  |  Tech Stack  |  Outcomes & Scalability', font: FONT, size: pt(10), color: XLIGHT }),
                ], { spacing: { before: 0, after: 0 } }),
              ],
            }),
            new TableCell({
              width: { size: 32, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: BRAND },
              margins: { top: 240, bottom: 240, left: 200, right: 200 },
              verticalAlign: VerticalAlign.CENTER,
              children: [
                para([new TextRun({ text: 'Zero to Tests', bold: true, font: FONT, size: pt(13), color: WHITE })],
                  { alignment: AlignmentType.CENTER, spacing: { before: 0, after: pt(4) } }),
                para([new TextRun({ text: 'in under 5 minutes', font: FONT, size: pt(10), color: 'BFDBFE' })],
                  { alignment: AlignmentType.CENTER, spacing: { before: 0, after: pt(12) } }),
                para([new TextRun({ text: 'Self-healing  ·  AI-generated  ·  CI-ready', font: FONT, size: pt(9), color: 'BFDBFE' })],
                  { alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 } }),
              ],
            }),
          ],
        })],
      }),

      spacer(12),

      // ── PROBLEM STATEMENT ─────────────────────────────────────────────────
      callout([
        para([b('The Problem: ', DANGER), t('Writing and maintaining end-to-end tests is one of the most time-consuming, brittle, and skill-dependent tasks in modern software delivery. Teams spend days authoring Playwright or Cypress suites, only to have them break the moment a button moves or a selector changes. Most startups skip testing entirely — and pay for it in production.')],
          { alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: pt(4) } }),
        para([b('TestPilot fixes this: ', SUCCESS), t('One URL. Five minutes. A full running test suite — generated, executed, and automatically repaired by AI.')],
          { spacing: { before: 0, after: 0 } }),
      ], BG_GRAY, DANGER),

      spacer(10),

      // ══════════════════════════════════════════════════════════════════════
      // PAGE 1 — SECTION 01: SOLUTION
      // ══════════════════════════════════════════════════════════════════════
      banner('01', 'Solution', BG_DARK, WHITE, '93C5FD'),
      spacer(10),

      justPara([
        t('TestPilot is a full-stack AI testing platform built on Next.js and Playwright. It replaces the manual test-writing workflow with an autonomous pipeline: the system explores a live web application, understands its structure and intended behavior from documentation, generates idiomatic TypeScript Playwright tests, runs them, and — when failures occur — diagnoses and repairs the test code automatically. Every step is visible in real time through a live log stream.'),
      ]),

      spacer(4),
      sh('How It Works — The Seven-Phase Pipeline', BRAND),
      spacer(4),

      stepRow('1', 'Feature Discovery (Site Crawling)',
        'TestPilot navigates the target URL using a headless Playwright browser. It recursively maps every reachable page, captures route paths, identifies interactive elements (forms, buttons, links, modals), and builds a structured site map. This map is the foundation for every subsequent AI prompt — ensuring tests are grounded in what the application actually does, not assumptions.',
        BG_BLUE, BRAND),
      spacer(3),

      stepRow('2', 'Documentation Ingestion',
        'Users optionally upload a product specification file (.md or .txt). TestPilot parses it into structured feature groups — one group per ## or ### heading — and extracts bullet-point use cases as pre-built test scenarios. This context is injected into every LLM prompt, dramatically improving test relevance. The system also auto-extracts "Typical User Journey" sections and converts them into named User Flows.',
        BG_VIO, ACCENT),
      spacer(3),

      stepRow('3', 'AI Test Generation',
        'The site map and documentation context are combined into a rich prompt sent to an LLM (Claude, GPT-4, or Gemini). The model generates a complete, idiomatic Playwright TypeScript test suite covering navigation, interactions, form submissions, and user flows. Tests are written to best-practice standards: explicit waits, descriptive test names, proper selectors, and grouped by feature. Files are written to a per-session workspace.',
        BG_GRN, SUCCESS),
      spacer(3),

      stepRow('4', 'Test Execution',
        'Generated tests are executed against the live application using Playwright. Both headless (CI-friendly) and headed (watch the browser) modes are supported, togglable per session. Execution is streamed in real time via Server-Sent Events — every log line, error trace, and test result appears in the UI as it happens. Video recordings and screenshots are captured automatically.',
        BG_AMB, WARN),
      spacer(3),

      stepRow('5', 'Self-Healing',
        'When tests fail, TestPilot reads the full error trace (broken selectors, timeout errors, assertion mismatches), passes the failure context back to the LLM with the original test code, and requests a corrected version. The patched file is written back to disk and re-executed. This loop continues automatically across multiple iterations until all tests pass or a maximum iteration count is reached.',
        '{ "fill": "FFF1F2" }' === '{}' ? 'FFF1F2' : 'FFF1F2', DANGER),
      spacer(3),

      stepRow('6', 'Feature Canvas',
        'A pannable, zoomable ReactFlow board gives stakeholders a visual map of the product. Each documentation feature becomes a colour-coded group. Inside each group: read-only use-case cards (extracted from docs) and user-added scenario cards. Anyone can click "Add use case" to describe a new scenario in plain language — it is saved and included in the next test generation run. No coding required.',
        BG_VIO, ACCENT),
      spacer(3),

      stepRow('7', 'Scenario & Visual Testing',
        'Beyond the full suite, individual natural-language scenarios can be tested on demand: type "user can reset their password" and TestPilot searches for an existing matching test, or generates a new targeted one, then runs it immediately. For design-driven teams, the Layers/Figma integration captures live screenshots and produces a pixel-accurate side-by-side comparison against design frames.',
        BG_BLUE, BRAND),

      spacer(10),
      sh('User-Facing Capabilities', BRAND),

      infoCard(
        [
          label('Core Features', BRAND),
          ...bullets([
            ['Real-time Log Stream', 'SSE-powered live execution logs — watch every Playwright step as it runs.'],
            ['Session Management', 'Multiple independent test sessions, each with its own workspace, site map, and test files.'],
            ['Headed / Headless Toggle', 'Switch browser visibility per-session without restarting — useful for debugging.'],
            ['Download ZIP', 'Export the full Playwright project as a ZIP; drop directly into any CI pipeline.'],
            ['Multi-LLM Support', 'Switch between Claude, GPT-4, and Gemini from the settings panel at runtime.'],
          ]),
        ],
        [
          label('Advanced Features', ACCENT),
          ...bullets([
            ['Scenario Runner', 'Natural-language test on demand — finds or generates and immediately executes.'],
            ['Feature Canvas', 'Visual stakeholder board; doc-driven and user-extensible without code.'],
            ['Self-Healing Loop', 'Up to N automatic fix-and-rerun iterations on failing tests.'],
            ['Visual Regression', 'Figma / Layers frame-by-frame screenshot comparison with test generation.'],
            ['Accuracy Report', 'Per-session report scoring generated test quality against the original site map.'],
            ['Iteration Tracking', 'Session records how many fix cycles ran and which files changed each time.'],
          ]),
        ]
      ),

      // ══════════════════════════════════════════════════════════════════════
      // PAGE 2 — SECTION 02: TECH STACK
      // ══════════════════════════════════════════════════════════════════════
      pageBreak(),
      banner('02', 'Tech Stack', BG_DARK, WHITE, 'C4B5FD'),
      spacer(10),

      justPara([
        t('Every technology in TestPilot was chosen to minimise latency between idea and running test. The stack is fully TypeScript end-to-end, runs in a single Next.js process (no separate backend needed), and is designed so individual layers — LLM provider, persistence store, test executor — can be swapped without touching application logic.'),
      ]),

      spacer(6),
      sh('Layer-by-Layer Breakdown', BRAND),
      spacer(4),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, color: BRAND, size: 8 },
          bottom: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
          left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
          insideH: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
          insideV: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
        },
        rows: [
          // Header row
          new TableRow({
            tableHeader: true,
            children: [
              ['Layer', 18], ['Technology', 32], ['Role & Rationale', 50],
            ].map(([text, pct]) => new TableCell({
              width: { size: pct, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: BG_DARK },
              margins: { top: 80, bottom: 80, left: 120, right: 80 },
              children: [para([new TextRun({ text, bold: true, font: FONT, size: pt(10), color: WHITE })],
                { spacing: { before: 0, after: 0 } })],
            })),
          }),
          // Data rows
          ...[
            ['Frontend Framework',
              ['Next.js 16 — App Router', 'React 19'],
              'App Router provides file-based routing, streaming SSR, and co-located API routes. React 19 brings concurrent rendering for smooth real-time log updates without blocking the UI thread. Running frontend and backend in one process eliminates a network hop.',
              BG_BLUE, BRAND],
            ['Language',
              ['TypeScript 5'],
              'Full static typing across the entire codebase — API route parameters, session state, Playwright result shapes, and React component props are all typed. Catches integration bugs at compile time that would only surface at runtime.',
              BG_GRAY, MID],
            ['Styling',
              ['Tailwind CSS v4', 'class-variance-authority', 'tailwind-merge'],
              'Utility-first CSS with zero runtime — styles are compiled at build time. CVA provides type-safe variant patterns for the component library. Tailwind Merge resolves class conflicts when combining dynamic utility strings.',
              BG_VIO, ACCENT],
            ['Canvas / Diagramming',
              ['@xyflow/react v12 (ReactFlow)'],
              'Industry-standard React graph library. Provides pan, zoom, custom node types, and edge routing out of the box. Custom node components (AppNode, GroupNode, UseCaseNode, AddUseCaseNode) are pure React with full event handling. A custom DOM event bus avoids stale-closure issues with callback props.',
              BG_BLUE, BRAND],
            ['AI / LLM',
              ['Anthropic Claude (primary)', 'OpenAI GPT-4', 'Google Gemini'],
              'Multi-provider adapter pattern: all LLM calls go through a shared interface, making the active model a runtime setting. Claude is the primary model for test generation and self-healing due to its longer context window and strong code quality. Gemini and GPT-4 are available as drop-in alternatives.',
              BG_VIO, ACCENT],
            ['Test Execution',
              ['Playwright v1.60'],
              'Playwright is the de-facto standard for modern web E2E testing. It supports Chromium, Firefox, and WebKit; runs in headed or headless mode; captures video recordings, screenshots, and traces automatically. Tests run inside a managed child process, and output is streamed back to the Next.js server via stdout piping.',
              BG_GRN, SUCCESS],
            ['API Layer',
              ['Next.js Route Handlers', 'Server-Sent Events (SSE)'],
              'All backend logic lives in Next.js API routes — no Express, no separate server. SSE provides a persistent one-directional stream from server to browser for real-time logs, which is lighter than WebSockets for this use case and works through most reverse proxies without configuration.',
              BG_GRAY, MID],
            ['Session Store',
              ['In-memory Map', 'File-based workspace (.testpilot/)'],
              'Session state (URL, status, logs, test files, site map) is held in a server-side Map for zero-latency reads. Generated Playwright files, videos, and screenshots live in a per-session directory. The store interface is thin — swapping to Redis or PostgreSQL requires changing one file.',
              BG_BLUE, BRAND],
            ['Packaging & Export',
              ['adm-zip', 'CONTEXT.md builder'],
              'adm-zip bundles generated test files, playwright.config.ts, and package.json into a ready-to-use ZIP download. The CONTEXT.md builder serialises documentation and user flows into a single LLM context file injected at generation time — keeping prompts focused and reproducible.',
              BG_AMB, WARN],
          ].map(([layer, tech, why, bg, color], i) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 18, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, fill: bg },
                  margins: { top: 90, bottom: 90, left: 120, right: 80 },
                  verticalAlign: VerticalAlign.TOP,
                  children: [para([new TextRun({ text: layer, bold: true, font: FONT, size: pt(10), color })],
                    { spacing: { before: 0, after: 0 } })],
                }),
                new TableCell({
                  width: { size: 32, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, fill: BG_GRAY },
                  margins: { top: 90, bottom: 90, left: 100, right: 80 },
                  verticalAlign: VerticalAlign.TOP,
                  children: tech.map(item =>
                    para([new TextRun({ text: item, font: MONO, size: pt(9.5), color: DARK })],
                      { spacing: { before: 0, after: pt(2) } })
                  ),
                }),
                new TableCell({
                  width: { size: 50, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, fill: WHITE },
                  margins: { top: 90, bottom: 90, left: 100, right: 120 },
                  verticalAlign: VerticalAlign.TOP,
                  children: [para([t(why)],
                    { alignment: AlignmentType.JUSTIFIED, spacing: { before: 0, after: 0 } })],
                }),
              ],
            })
          ),
        ],
      }),

      spacer(10),
      sh('Architecture Flow', BRAND),
      spacer(4),

      callout([
        para([b('Request path: ', BRAND), t('Browser → Next.js API Route → Session Store → LLM Provider → Playwright subprocess → SSE stream → Browser')],
          { spacing: { before: 0, after: pt(6) } }),
        para([b('Data isolation: ', SUCCESS), t('Each session has an independent in-memory slot and a dedicated .testpilot/[sessionId]/ directory. Sessions never share state.')],
          { spacing: { before: 0, after: pt(6) } }),
        para([b('LLM context assembly: ', ACCENT), t('At generation time, site map JSON + CONTEXT.md (documentation + user flows) are concatenated into a single prompt. Token budget is managed by truncating the site map to the most-visited pages first.')],
          { spacing: { before: 0, after: pt(6) } }),
        para([b('Self-heal loop: ', WARN), t('Status machine: idle → exploring → generating → running → fixing → complete. Each transition is persisted to the session store and broadcast over SSE. The fix phase re-uses the same prompt template with the failure trace appended.')],
          { spacing: { before: 0, after: 0 } }),
      ], BG_GRAY, BRAND),

      // ══════════════════════════════════════════════════════════════════════
      // PAGE 3 — SECTION 03: OUTCOMES & SCALABILITY
      // ══════════════════════════════════════════════════════════════════════
      pageBreak(),
      banner('03', 'Outcomes & Scalability', BG_DARK, WHITE, '6EE7B7'),
      spacer(10),

      sh('Measured Outcomes', SUCCESS),
      spacer(6),

      outcomeGrid([
        ['⚡', 'Time to First Test', '< 5 min',     'From pasting a URL to a passing Playwright test — including crawl, generation, and execution — on a typical single-page app.', BG_BLUE],
        ['🔧', 'Self-Healing Rate', 'Up to 5×',     'Automatic fix-and-rerun loops eliminate the most common failure classes (stale selectors, timing issues) without developer intervention.', BG_GRN],
        ['📄', 'Coverage Breadth',  '100% of pages','The crawler visits every reachable URL and generates at least one test per discovered page, ensuring no route is left untested.', BG_VIO],
        ['🎨', 'Visual Coverage',   'Per frame',    'Each Figma/Layers frame gets a dedicated screenshot comparison test, giving design teams a continuous regression baseline.', BG_AMB],
        ['💬', 'Scenario Turnaround','< 30 sec',    'Natural-language scenario → search existing tests → generate if needed → execute: the entire cycle completes in under 30 seconds.', BG_BLUE],
        ['📦', 'CI Integration',    '0 config',     'Downloaded ZIP is a fully self-contained Playwright project. Add one line to your GitHub Actions workflow and it runs immediately.', BG_GRN],
      ]),

      spacer(12),
      sh('Before vs After', SUCCESS),
      spacer(4),

      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top:     { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
          bottom:  { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
          left:    { style: BorderStyle.NONE },
          right:   { style: BorderStyle.NONE },
          insideH: { style: BorderStyle.SINGLE, color: BORDER_C, size: 4 },
          insideV: { style: BorderStyle.SINGLE, color: BORDER_C, size: 8 },
        },
        rows: [
          // Header
          new TableRow({
            tableHeader: true,
            children: [
              ['Metric', 28], ['Without TestPilot', 36], ['With TestPilot', 36],
            ].map(([text, pct], i) => new TableCell({
              width: { size: pct, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, fill: i === 0 ? BG_DARK : i === 1 ? 'FFF1F2' : BG_GRN },
              margins: { top: 80, bottom: 80, left: 120, right: 80 },
              children: [para([new TextRun({ text, bold: true, font: FONT, size: pt(10), color: i === 0 ? WHITE : DARK })],
                { spacing: { before: 0, after: 0 } })],
            })),
          }),
          ...[
            ['Test authoring',        'Days of manual Playwright scripting',          'Under 5 minutes — fully automated'],
            ['Selector maintenance',  'Manual updates every UI change',               'Self-healing fixes broken selectors automatically'],
            ['Coverage decisions',    'Ad-hoc, dependent on developer knowledge',     'Systematic — every crawled page and doc feature covered'],
            ['Stakeholder visibility','None until QA sign-off',                       'Real-time canvas board; non-technical users can add scenarios'],
            ['CI setup',              'Configure Playwright, write scripts, debug CI','Download ZIP → one-line GitHub Actions step'],
            ['Visual regression',     'Manual screenshot comparison or paid tool',    'Built-in Figma/Layers integration, no extra subscription'],
            ['LLM flexibility',       'Hardcoded model dependency',                   'Switch Claude / GPT-4 / Gemini from settings panel'],
          ].map(([metric, before, after], i) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 28, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? BG_GRAY : WHITE },
                  margins: { top: 80, bottom: 80, left: 120, right: 80 },
                  children: [para([new TextRun({ text: metric, bold: true, font: FONT, size: pt(10), color: DARK })],
                    { spacing: { before: 0, after: 0 } })],
                }),
                new TableCell({
                  width: { size: 36, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? 'FFF1F2' : 'FFF8F8' },
                  margins: { top: 80, bottom: 80, left: 100, right: 80 },
                  children: [para([sm(before, { color: '9F1239' })],
                    { spacing: { before: 0, after: 0 } })],
                }),
                new TableCell({
                  width: { size: 36, type: WidthType.PERCENTAGE },
                  shading: { type: ShadingType.CLEAR, fill: i % 2 === 0 ? BG_GRN : 'F0FDF4' },
                  margins: { top: 80, bottom: 80, left: 100, right: 120 },
                  children: [para([sm(after, { color: SUCCESS })],
                    { spacing: { before: 0, after: 0 } })],
                }),
              ],
            })
          ),
        ],
      }),

      spacer(12),
      sh('Scalability Architecture', SUCCESS),
      spacer(4),

      scalabilityTable([
        ['🗂️', 'Session Isolation',       'Each test session owns a dedicated in-memory slot and a .testpilot/[id]/ directory. Sessions never share state, file handles, or browser processes — a crash in one session cannot affect others.', 'Zero cross-contamination'],
        ['🔄', 'Swappable Persistence',   'The session store is accessed through a thin five-method interface (get, set, list, delete, update). Replacing the in-memory Map with Redis, PostgreSQL, or DynamoDB requires editing a single file with no changes to any API route or UI component.', 'Pluggable storage layer'],
        ['🤖', 'Multi-Provider LLM',      'All AI calls are routed through a provider-agnostic adapter. The active model is a runtime setting — teams can switch from Claude to GPT-4 to Gemini based on cost, performance, or availability without touching a line of application code.', 'Runtime model switching'],
        ['📦', 'Horizontal Scaling',      'Stateless API routes combined with externalised session storage enable straightforward containerisation. Deploy on Kubernetes: route sessions via a consistent-hash load balancer so each session lands on the same node, or let any node serve any session once storage is externalised.', 'Container-ready'],
        ['⚙️', 'Parallel Test Execution', "Playwright's built-in worker model runs test files in parallel across multiple CPU cores. The reporting layer aggregates results from all workers in real time. Large suites of 50+ files complete proportionally faster on higher-core machines.", 'Linear throughput scaling'],
        ['📐', 'Feature Canvas Growth',   'Each new ## heading in a documentation file automatically becomes a feature group on the canvas. The layout algorithm re-computes positions dynamically — there is no upper limit on the number of feature groups or use-case cards the board can display.', 'Unbounded board growth'],
        ['🔁', 'CI/CD Integration',       'Exported test ZIPs are standard Playwright projects requiring no TestPilot infrastructure at runtime. They integrate with GitHub Actions, GitLab CI, CircleCI, Jenkins, and any tool that can run `npx playwright test`. Self-healing can also be triggered headlessly via the API.', 'Pipeline-native'],
        ['📊', 'Observability',           'Every session phase transition, log line, and error is emitted over SSE and stored in the session record. The accuracy report provides a structured JSON score for automated quality gates. Future: plug any OpenTelemetry-compatible collector into the session store writes.', 'Structured event log'],
      ]),

      spacer(12),
      sh('Roadmap — What Scales Next', SUCCESS),
      spacer(4),

      ...bullets([
        ['Persistent Storage', 'Drop-in Redis / PostgreSQL adapter to survive server restarts and support multi-instance deployments.'],
        ['Team Workspaces', 'Multi-user sessions with role-based access: developers, QA engineers, and product managers each see a tailored view.'],
        ['Scheduled Runs', 'Cron-triggered test pipelines that run against staging or production on every deploy, reporting regressions via Slack/email.'],
        ['Test Impact Analysis', 'Given a code diff, identify which existing tests are likely affected and run only those — dramatically reducing feedback loop time.'],
        ['MCP / Agent Integration', 'Expose TestPilot as an MCP server so AI coding agents (Claude Code, Cursor) can trigger tests and read results inline in the editor.'],
        ['Expanded LLM Context', 'Stream the live DOM and network activity into the LLM context during generation for even more accurate selector choices.'],
      ]),

      spacer(12),
      divider(BRAND),

      para([
        new TextRun({ text: 'TestPilot', bold: true, font: FONT, size: pt(10), color: BRAND }),
        sm('  ·  Next.js 16  ·  React 19  ·  Playwright  ·  Anthropic Claude  ·  '),
        sm(String(new Date().getFullYear())),
      ], { alignment: AlignmentType.CENTER }),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  writeFileSync(OUT, buffer);
  console.log('Done:', OUT);
});
