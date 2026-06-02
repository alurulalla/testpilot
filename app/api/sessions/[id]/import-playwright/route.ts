import { NextRequest, NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { getSession, setImportedProject, updateSession } from '@/lib/session-store';
import { importPlaywrightProject } from '@/lib/import-playwright';
import { Workspace } from '@/lib/pilot';

/** Minimal fixtures.ts that makes existing Playwright specs runnable in our workspace. */
function buildFixturesTs(targetUrl: string): string {
  return `import { test as base } from '@playwright/test';

export const TARGET_URL = ${JSON.stringify(targetUrl)};

export const test = base.extend<{ targetUrl: string }>({
  targetUrl: async ({}, use) => { await use(TARGET_URL); },
});

export { expect } from '@playwright/test';
`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }); }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large. Maximum 50 MB.' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = importPlaywrightProject(buffer);

  if (!result.valid) {
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }

  // ── Write spec files into the TestPilot workspace ─────────────────────────
  const rootDir   = path.join(process.cwd(), '.testpilot', id);
  const workspace = new Workspace({ url: session.url, rootDir });
  workspace.init();

  // Write each spec file (imports already rewritten by importPlaywrightProject)
  for (const { fileName, content } of result.specFiles) {
    writeFileSync(path.join(workspace.testsDir, fileName), content, 'utf8');
  }

  // Write fixtures.ts so the specs can resolve their imports
  writeFileSync(
    path.join(workspace.testsDir, 'fixtures.ts'),
    buildFixturesTs(session.url),
    'utf8',
  );

  // Write playwright.config.ts if not already present (uses workspace helper)
  workspace.writePlaywrightConfig();

  // ── Persist to session ─────────────────────────────────────────────────────
  const totalTests = result.useCases.reduce((n, u) => n + u.tests.length, 0);

  setImportedProject(id, {
    fileName:       file.name,
    useCases:       result.useCases,
    specFilesCount: result.specFilesCount,
    importedAt:     Date.now(),
  });

  // Expose the written test files in the session so the UI shows them
  updateSession(id, { testFiles: workspace.testFiles() });

  return NextResponse.json({
    ok:             true,
    fileName:       file.name,
    specFilesCount: result.specFilesCount,
    suitesCount:    result.useCases.length,
    totalTests,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  setImportedProject(id, null);
  // Reset test files — they came from the import
  updateSession(id, { testFiles: [], siteMap: null, coverageAnalysis: null });
  return NextResponse.json({ ok: true });
}
