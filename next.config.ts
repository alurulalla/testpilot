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
    '@sparticuz/chromium', // ES module + compressed Chromium binary (.br files)
  ],
};

export default nextConfig;
