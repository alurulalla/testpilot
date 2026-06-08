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

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
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
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
