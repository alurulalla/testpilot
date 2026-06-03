import type { NextConfig } from 'next';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Turbopack does not inject .env.local values into process.env the same way
// webpack does. Load the file manually so API routes see all variables.
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local is optional
}

const nextConfig: NextConfig = {
  // These packages must NOT be bundled by webpack — they either contain native
  // binaries, binary asset files (.br), or are ES-module-only packages that
  // webpack can't inline.  They are required at runtime from node_modules.
  serverExternalPackages: [
    'playwright',
    'playwright-core',
    '@playwright/test',   // test runner — must stay external (spawned as CLI, not bundled)
    '@sparticuz/chromium', // ES module + compressed Chromium binary (.br files)
  ],

  // Vercel's static file tracer (@vercel/nft) cannot follow dynamic require()
  // calls like `require(path.join(packageRoot, "browsers.json"))`.  Force-include
  // the files that playwright-core and @sparticuz/chromium need at runtime.
  //
  // Using '/api/**' covers every API route — many of them import playwright
  // (form detection, session loop, test runner, scenario runner, etc.).
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/playwright-core/browsers.json',
      './node_modules/playwright-core/lib/**',
      './node_modules/@sparticuz/chromium/bin/**',
      './node_modules/@sparticuz/chromium/build/**',
      // playwright/cli.js requires('./lib/program') — lib/ is not statically
      // imported by app code so nft misses it without this explicit include.
      './node_modules/playwright/cli.js',
      './node_modules/playwright/lib/**',
      // @playwright/test contains the actual test runner (reporters, fixtures, etc.)
      './node_modules/@playwright/test/cli.js',
      './node_modules/@playwright/test/lib/**',
    ],
  },
};

export default nextConfig;
