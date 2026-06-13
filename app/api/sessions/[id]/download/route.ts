/**
 * GET /api/sessions/[id]/download
 *
 * Builds a runnable Playwright project ZIP — entirely from the database, never
 * from the server's (ephemeral) disk. The recipient unzips, `npm install`,
 * `npx playwright install`, `npx playwright test`.
 *
 * Contents:
 *   tests/**           — the suite (specs + fixtures) from SessionFile
 *   playwright.config.ts / package.json / tsconfig.json / .gitignore — templates
 *   .env                — regenerated from the org's saved URL context
 *   README.md           — setup instructions
 *
 * By construction this NEVER includes server artifacts (videos, screenshots,
 * reports, site_map.json) or secrets like auth.json (live session cookies).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAccess } from '@/lib/session-access';
import AdmZip from 'adm-zip';
import { prisma } from '@/lib/prisma';
import {
  buildPlaywrightConfigContent,
  buildWorkspacePackageJson,
  buildWorkspaceTsConfig,
  WORKSPACE_GITIGNORE,
} from '@/lib/pilot/workspace';
import { getUrlContext, contextToEnv } from '@/lib/url-context-store';

/** Generate a README so the recipient knows how to run the suite. */
function buildReadme(url: string, hasEnv: boolean): string {
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
${hasEnv ? `
## Credentials

Test credentials are stored in \`.env\` and loaded by \`playwright.config.ts\`
(via dotenv). To override any value, edit \`.env\` or set the environment
variable before running.

> ⚠️  **Do not commit \`.env\` to source control.** It is already listed in \`.gitignore\`.
` : ''}`;
}

function urlSlug(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/\./g, '-');
  } catch {
    return 'tests';
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSessionAccess(id);
  if ('error' in access) return access.error;
  const session = access.session;

  // ── The suite, straight from the DB ───────────────────────────────────────
  const files = await prisma.sessionFile.findMany({
    where: { sessionId: id },
    orderBy: { path: 'asc' },
  });
  const testFiles = files.filter(f => f.path.startsWith('tests/'));

  if (testFiles.length === 0) {
    return NextResponse.json(
      { error: 'No tests saved for this session yet — run Generate first.' },
      { status: 404 },
    );
  }

  const zip = new AdmZip();

  for (const f of testFiles) {
    zip.addFile(f.path, Buffer.from(f.content, 'utf8'));
  }

  // ── Project scaffolding from the shared templates ─────────────────────────
  zip.addFile('playwright.config.ts', Buffer.from(buildPlaywrightConfigContent(session.url), 'utf8'));
  zip.addFile('package.json',         Buffer.from(buildWorkspacePackageJson(urlSlug(session.url)), 'utf8'));
  zip.addFile('tsconfig.json',        Buffer.from(buildWorkspaceTsConfig(), 'utf8'));
  zip.addFile('.gitignore',           Buffer.from(WORKSPACE_GITIGNORE, 'utf8'));

  // ── .env from the org's saved URL context (its own credentials) ───────────
  let hasEnv = false;
  try {
    const urlCtx = await getUrlContext(session.url, session.orgId);
    if (urlCtx) {
      const env = contextToEnv(urlCtx);
      const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
      if (lines.length > 0) {
        zip.addFile('.env', Buffer.from(lines.join('\n') + '\n', 'utf8'));
        hasEnv = true;
      }
    }
  } catch { /* no context — fixtures carry fallback values anyway */ }

  zip.addFile('README.md', Buffer.from(buildReadme(session.url, hasEnv), 'utf8'));

  const buffer = zip.toBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="testpilot-${urlSlug(session.url)}.zip"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
