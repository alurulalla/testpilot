/**
 * Prisma 7 client singleton using the @prisma/adapter-pg adapter.
 *
 * Prisma 7 removed the `url` property from schema.prisma — the connection
 * is now passed directly to the PrismaClient constructor via an adapter.
 *
 * The globalThis cache prevents connection exhaustion during Next.js hot-reload
 * in development (each module reload would otherwise open a new pool).
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';

/**
 * Pin the SSL mode explicitly. `pg`/`pg-connection-string` currently treat
 * `prefer`/`require`/`verify-ca` as aliases for `verify-full` but warn that a
 * future major version will change that. Rewriting to the explicit
 * `verify-full` keeps the SAME (strong) behavior we have today and silences the
 * deprecation warning — Neon serves publicly-trusted certs, so verify-full
 * connects fine.
 */
function pinSslMode(cs: string): string {
  return cs.replace(/([?&]sslmode=)(prefer|require|verify-ca)\b/i, '$1verify-full');
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL
    ? pinSslMode(process.env.DATABASE_URL)
    : undefined;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env.local — see README for Neon setup.',
    );
  }

  const pool = new Pool({
    connectionString,
    // Keep connections alive so Neon doesn't scale to zero between requests.
    // idleTimeoutMillis: how long an idle connection stays in the pool before
    // being closed.  60 s is a reasonable balance for a dev/staging server.
    idleTimeoutMillis: 60_000,
    // max: cap at 5 so we don't exhaust Neon's connection limit.
    max: 5,
  });
  globalThis.__tp_pgpool = pool;
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

// ── Lazy singleton ────────────────────────────────────────────────────────────
//
// createPrismaClient() must NOT run at module-import time.
// During `next build`, modules are imported to collect page data but
// DATABASE_URL is not available (it's a runtime secret injected into the
// container, never a build arg).  Calling new Pool() or PrismaClient() here
// would throw and break the build.
//
// The Proxy below defers initialisation to the first actual DB call so the
// module can be safely imported at build time.

declare global {
  var __tp_prisma: PrismaClient | undefined;
  var __tp_pgpool: Pool | undefined;
}

function getClient(): PrismaClient {
  if (!globalThis.__tp_prisma) {
    globalThis.__tp_prisma = createPrismaClient();
  }
  return globalThis.__tp_prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Close resources owned by standalone workers and scripts. */
export async function disconnectPrisma(): Promise<void> {
  const client = globalThis.__tp_prisma;
  const pool = globalThis.__tp_pgpool;
  globalThis.__tp_prisma = undefined;
  globalThis.__tp_pgpool = undefined;
  if (client) await client.$disconnect().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
}
