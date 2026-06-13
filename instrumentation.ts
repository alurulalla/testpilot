/**
 * Next.js instrumentation — runs once when the server starts.
 *
 * The actual work lives in instrumentation-node.ts; the conditional import
 * below is dead-code-eliminated from the Edge bundle (NEXT_RUNTIME is inlined
 * at build time), so Node-only modules (fs, prisma) are never traced there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { sweepOrphanWorkspaces } = await import('./instrumentation-node');
    await sweepOrphanWorkspaces();
  }
}
