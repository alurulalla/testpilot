import { loadEnvConfig } from '@next/env';

// Standalone processes (workers and maintenance scripts) run outside Next.js,
// so they must explicitly load the same .env* precedence as the web runtime.
loadEnvConfig(process.cwd());
