/**
 * Builds the CONTEXT.md file content from the session's uploaded product
 * documentation and manually added user flows.
 *
 * This file is read by generate-suite.ts and generate-scenario.ts so the LLM
 * always knows which flows to cover when writing tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { UserFlow, ImportedProject } from '@/types/session';

/** Format user flows as a markdown section. */
function formatFlows(flows: UserFlow[]): string {
  if (flows.length === 0) return '';
  const lines: string[] = [
    '',
    '---',
    '',
    '# User Flows to Test',
    '',
    'The following user flows MUST be covered by the generated tests:',
    '',
  ];
  for (const flow of flows) {
    lines.push(`## ${flow.title}`);
    lines.push('');
    lines.push(flow.description);
    if (flow.steps.length > 0) {
      lines.push('');
      lines.push('Steps:');
      flow.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Format an imported Playwright project's use cases as a markdown section. */
function formatImportedProject(p: ImportedProject): string {
  const totalTests = p.useCases.reduce((n, u) => n + u.tests.length, 0);
  const lines: string[] = [
    '',
    '---',
    '',
    '# Imported Test Cases',
    '',
    `The following ${totalTests} test case(s) from ${p.specFilesCount} spec file(s) ` +
    `were extracted from the uploaded Playwright project ("${p.fileName}"). ` +
    `PRESERVE and IMPROVE this coverage — every listed test must have a corresponding ` +
    `test in the generated suite. You may rewrite selectors and assertions using the ` +
    `crawled page data, but do NOT drop any use case.`,
    '',
  ];

  // Group by file
  const byFile = new Map<string, typeof p.useCases[number][]>();
  for (const u of p.useCases) {
    const list = byFile.get(u.file) ?? [];
    list.push(u);
    byFile.set(u.file, list);
  }

  for (const [file, suites] of byFile) {
    lines.push(`## ${file}`);
    lines.push('');
    for (const s of suites) {
      if (s.suite !== file.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '')) {
        lines.push(`### ${s.suite}`);
        lines.push('');
      }
      for (const t of s.tests) {
        lines.push(`- ${t}`);
      }
      if (s.tests.length === 0) {
        lines.push('- *(spec file found but no test() names detected)*');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Write (or clear) CONTEXT.md in the workspace directory.
 * Creates the workspace directory if it doesn't exist yet.
 */
export function writeContextMd(
  workspaceDir: string,
  contextDoc: string | null,
  userFlows: UserFlow[],
  importedProject?: ImportedProject | null,
): void {
  mkdirSync(workspaceDir, { recursive: true });
  const contextPath = path.join(workspaceDir, 'CONTEXT.md');

  if (!contextDoc && userFlows.length === 0 && !importedProject) {
    // Nothing to write — remove if it exists
    try { require('fs').unlinkSync(contextPath); } catch { /* ok */ }
    return;
  }

  const parts: string[] = [];
  if (contextDoc) {
    parts.push('# Product Documentation\n');
    parts.push(contextDoc.trim());
  }
  parts.push(formatFlows(userFlows));
  if (importedProject) {
    parts.push(formatImportedProject(importedProject));
  }

  writeFileSync(contextPath, parts.join('\n').trim() + '\n', 'utf8');
}

/** Read current CONTEXT.md from the workspace (null if absent). */
export function readContextMd(workspaceDir: string): string | null {
  const contextPath = path.join(workspaceDir, 'CONTEXT.md');
  if (!existsSync(contextPath)) return null;
  try { return readFileSync(contextPath, 'utf8').trim(); } catch { return null; }
}
