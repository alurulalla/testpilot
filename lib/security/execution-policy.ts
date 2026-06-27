/**
 * Imported projects contain user-controlled JavaScript and must not execute in
 * the trusted web process. This temporary opt-in exists only for explicitly
 * isolated development deployments while the worker sandbox is introduced.
 */
export function importedExecutionBlocked(importedProject: unknown): boolean {
  return Boolean(importedProject) && process.env.ALLOW_UNSANDBOXED_IMPORTED_TESTS !== 'true';
}

export const IMPORTED_EXECUTION_BLOCKED_MESSAGE =
  'Imported Playwright code cannot run in the web process. Configure an isolated execution worker first.';
