// Prisma 7 config — used by the CLI for migrations and db push.
// PrismaClient at runtime reads DATABASE_URL via the adapter in lib/prisma.ts.
//
// dotenv/config only loads .env by default — Next.js uses .env.local so we
// must load it explicitly. Override order: .env.local > .env
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env for anything not in .env.local

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use DIRECT_URL for migrations (bypasses Neon's pooler)
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]!,
  },
});
