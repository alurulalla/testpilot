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
  // Playwright packages must NOT be bundled by webpack — they must be
  // required at runtime from node_modules (spawned as a CLI child process).
  serverExternalPackages: [
    'playwright',
    'playwright-core',
    '@playwright/test',
  ],

  // Allow ngrok tunnels to access Next.js dev resources (HMR, error overlays).
  // Any *.ngrok-free.app subdomain is permitted so you don't need to update
  // this every time ngrok gives you a new URL.
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.io'],
};

export default nextConfig;
