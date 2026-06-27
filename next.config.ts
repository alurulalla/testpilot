import type { NextConfig } from 'next';

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

  // Runtime workspaces and repository tooling must never be copied into route
  // output when a dynamic filesystem path is traced.
  outputFileTracingExcludes: {
    '/*': [
      './.git/**/*',
      './.next/**/*',
      './.testpilot/**/*',
      './tests/**/*',
      './scripts/**/*',
      './next.config.ts',
    ],
  },
};

export default nextConfig;
