/**
 * Shared browser launcher.
 *
 * On Vercel (serverless), Playwright's bundled Chromium binaries are not
 * deployed with the app. Instead, @sparticuz/chromium provides a compressed
 * binary that self-extracts to /tmp on first use.
 *
 * On local dev / self-hosted, we just launch Playwright's own Chromium.
 *
 * All files that need to launch a browser should call `launchBrowser()`
 * from here rather than calling `chromium.launch()` directly.
 */
import { chromium, type Browser } from 'playwright';

const IS_VERCEL = process.env.VERCEL === '1';

/** Stealth args that reduce bot-detection fingerprinting on most sites. */
export const STEALTH_ARGS = ['--disable-blink-features=AutomationControlled'];

export async function launchBrowser(extraArgs: string[] = []): Promise<Browser> {
  if (IS_VERCEL) {
    const { default: Chromium } = await import('@sparticuz/chromium') as {
      default: { executablePath: () => Promise<string>; args: string[] };
    };
    const executablePath = await Chromium.executablePath();
    return chromium.launch({
      headless: true,
      executablePath,
      args: [...Chromium.args, ...STEALTH_ARGS, ...extraArgs],
    });
  }

  return chromium.launch({
    headless: true,
    args: [...STEALTH_ARGS, ...extraArgs],
  });
}
