/**
 * Shared browser launcher.
 *
 * Uses Playwright's standard Chromium. On Railway/self-hosted the system
 * Chromium is available at PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (set in
 * Dockerfile). On local dev Playwright's own downloaded Chromium is used.
 *
 * All files that need to launch a browser should call `launchBrowser()`
 * from here rather than calling `chromium.launch()` directly.
 */
import { chromium, type Browser } from 'playwright';

/** Stealth args that reduce bot-detection fingerprinting on most sites. */
export const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];

export async function launchBrowser(extraArgs: string[] = []): Promise<Browser> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await chromium.launch({
        headless: true,
        args: [...STEALTH_ARGS, ...extraArgs],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // RLIMIT_NPROC hit — previous crashed browsers left zombie threads.
      // Wait for the OS to reap them, then retry.
      const isThreadExhaustion = msg.includes('pthread_create') || msg.includes('Resource temporarily unavailable');
      if (isThreadExhaustion && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 4_000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Browser launch failed after retries — server thread limit exhausted. Try again in a moment.');
}
