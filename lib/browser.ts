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
  return chromium.launch({
    headless: true,
    args: [...STEALTH_ARGS, ...extraArgs],
  });
}
