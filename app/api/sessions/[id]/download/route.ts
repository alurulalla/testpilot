/**
 * GET /api/sessions/[id]/download
 *
 * Packages the entire workspace into a ZIP file and streams it to the browser.
 *
 * Includes everything except node_modules (which the recipient runs `npm install`
 * to recreate) and any symlinks pointing outside the workspace.
 *
 * Excluded: node_modules/
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { existsSync, readdirSync, lstatSync } from 'fs';
import AdmZip from 'adm-zip';
import { getSession } from '@/lib/session-store';
import { Workspace } from '@/lib/pilot';
import { getSessionDir } from '@/lib/config';

/** Directories to skip entirely — too large or not useful outside the server. */
const SKIP_DIRS = new Set(['node_modules']);

/**
 * Recursively add every file under `dir` into the zip under `zipPrefix`.
 * Skips node_modules and symlinks (node_modules is often a symlink on Railway).
 */
function addDirToZip(zip: AdmZip, dir: string, zipPrefix: string) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const zipPath  = zipPrefix ? path.join(zipPrefix, entry.name) : entry.name;

    // Skip symlinks — node_modules on Railway is a symlink to the app-level
    // node_modules. Following it would bundle the entire dependency tree.
    try {
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
    } catch { continue; }

    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, zipPath);
    } else if (entry.isFile()) {
      zip.addLocalFile(fullPath, path.dirname(zipPath) === '.' ? '' : path.dirname(zipPath));
    }
  }
}

/** Generate a README so the recipient knows how to run the suite. */
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

## Credentials

Test credentials are stored in \`.env\`. Playwright loads this file automatically.
To override any value, edit \`.env\` or set the environment variable before running.

> ⚠️  **Do not commit \`.env\` to source control.** It is already listed in \`.gitignore\`.
`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const workspace = new Workspace({
    url: session.url,
    rootDir: getSessionDir(id, session.orgId),
  });

  if (!existsSync(workspace.dir)) {
    return NextResponse.json({ error: 'No workspace found — run Generate first' }, { status: 404 });
  }

  const zip = new AdmZip();

  // ── Add everything in the workspace except node_modules ───────────────────
  addDirToZip(zip, workspace.dir, '');

  // ── Strip storageState from playwright.config.ts in the zip ──────────────
  // Generated spec files use manual login helpers, not Playwright storageState.
  // If the server previously patched storageState into the config (for the crawler),
  // remove it so the downloaded project doesn't start browsers pre-authenticated,
  // which would redirect away from the login page and break every login helper.
  const configZipPath = 'playwright.config.ts';
  const configEntry = zip.getEntry(configZipPath);
  if (configEntry) {
    const configContent = configEntry.getData().toString('utf8');
    if (configContent.includes('storageState')) {
      const cleaned = configContent
        .replace(/\s*storageState\s*:\s*['"][^'"]+['"]\s*,?\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n'); // collapse extra blank lines
      zip.updateFile(configZipPath, Buffer.from(cleaned, 'utf8'));
    }
  }

  // ── Inject a fresh README at the zip root (replaces any existing one) ─────
  zip.addFile('README.md', Buffer.from(buildReadme(session.url), 'utf8'));

  // ── Build a clean filename from the URL ───────────────────────────────────
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
