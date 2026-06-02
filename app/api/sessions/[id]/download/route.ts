/**
 * GET /api/sessions/[id]/download
 *
 * Packages the generated Playwright test suite into a ZIP file and streams
 * it to the browser as a download.
 *
 * Included in the ZIP:
 *  tests/             ← all spec files + fixtures.ts
 *  playwright.config.ts
 *  package.json
 *  tsconfig.json      (if present)
 *  README.md          (auto-generated with run instructions)
 *
 * Excluded: node_modules, reports, test-results, snapshots, site_map.json
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import AdmZip from 'adm-zip';
import { getSession } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';

/** Recursively add every file under `dir` into the zip under `zipPrefix`. */
function addDirToZip(zip: AdmZip, dir: string, zipPrefix: string) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const zipPath  = path.join(zipPrefix, entry.name);
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, zipPath);
    } else if (entry.isFile()) {
      zip.addLocalFile(fullPath, path.dirname(zipPath));
    }
  }
}

/** Generate a minimal README so the recipient knows how to run the suite. */
function buildReadme(url: string): string {
  return `# TestPilot — Generated Test Suite

Auto-generated Playwright tests for: **${url}**

## Setup

\`\`\`bash
npm install
npx playwright install --with-deps
\`\`\`

## Run all tests

\`\`\`bash
npx playwright test
\`\`\`

## Run a single file

\`\`\`bash
npx playwright test tests/<filename>.spec.ts
\`\`\`

## View HTML report

\`\`\`bash
npx playwright show-report
\`\`\`
`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id),
  });

  if (!existsSync(workspace.dir)) {
    return NextResponse.json({ error: 'No workspace found — run Generate first' }, { status: 404 });
  }

  const zip = new AdmZip();

  // ── tests/ directory ──────────────────────────────────────────────────────
  addDirToZip(zip, workspace.testsDir, 'tests');

  // ── root config files ──────────────────────────────────────────────────────
  const rootFiles = ['playwright.config.ts', 'package.json', 'tsconfig.json'];
  for (const file of rootFiles) {
    const fullPath = path.join(workspace.dir, file);
    if (existsSync(fullPath)) {
      zip.addLocalFile(fullPath, '');   // add to zip root
    }
  }

  // ── auto-generated README ─────────────────────────────────────────────────
  zip.addFile('README.md', Buffer.from(buildReadme(session.url), 'utf8'));

  // ── build a clean filename from the URL ───────────────────────────────────
  let slug = '';
  try {
    const u = new URL(session.url);
    slug = u.hostname.replace(/^www\./, '').replace(/\./g, '-');
  } catch {
    slug = 'tests';
  }
  const zipName = `testpilot-${slug}.zip`;

  const buffer = zip.toBuffer();

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
