/**
 * Turn a recorded action trace into a Playwright spec.
 *
 * Deterministic (no LLM): each recorded action maps to a Playwright call, using
 * the same `./fixtures.js` import + login() the rest of the suite uses. Explicit
 * assertions the user marked are emitted directly; an LLM "fill-in" pass can
 * enrich this afterward, but the spec is already valid and runnable on its own.
 */
import type { RecordedAction, RecordedAssertion } from './types';

export interface CodegenOptions {
  targetUrl: string;
  title?: string;
  needsLogin?: boolean;
}

const q = (s: string) => JSON.stringify(s);

/** Convert our recorder's selector format into a Playwright locator expression. */
function toLocator(selector: string): string {
  // The recorder pins an ambiguous role/text selector with a trailing ">> nth=i".
  // getByRole/getByText can't carry the ">>" chain syntax, so translate it into a
  // .nth(i) call. CSS selectors keep ">> nth"/">> text" inline — page.locator()
  // understands those natively — so we only split the suffix for role/text.
  let base = selector;
  let suffix = '';
  if (selector.startsWith('role=') || selector.startsWith('text=')) {
    const nth = selector.match(/^(.*?)\s*>>\s*nth=(\d+)$/);
    if (nth) { base = nth[1]; suffix = `.nth(${nth[2]})`; }
  }

  const role = base.match(/^role=([a-zA-Z]+)(?:\[name="(.*)"\])?$/);
  if (role) {
    return (role[2]
      ? `page.getByRole('${role[1]}', { name: ${q(role[2])} })`
      : `page.getByRole('${role[1]}')`) + suffix;
  }
  if (base.startsWith('text=')) return `page.getByText(${q(base.slice(5))})` + suffix;
  return `page.locator(${q(selector)})`;
}

/**
 * Lines that arm cookie/consent-banner auto-dismissal. Recorded specs are
 * self-contained (no shared fixtures), so the handler is inlined: addLocatorHandler
 * fires whenever a banner appears — before any action — and clicks it away, so it
 * can't intercept the recorded clicks. Multilingual; matches OneTrust/Cookiebot/
 * Usercentrics by id and the generic Accept buttons by accessible name.
 */
function consentDismissLines(): string[] {
  return [
    `  // Auto-dismiss cookie / consent banners so they can't intercept clicks.`,
    `  const __accept = page.getByRole('button', { name: /^(accept all|accept|allow all|allow|agree|i agree|i accept|got it|ok|okay|akzeptieren|alle akzeptieren|zustimmen|einverstanden|tout accepter|accepter)/i }).first();`,
    `  await page.addLocatorHandler(__accept, async () => { await __accept.click({ timeout: 2000 }).catch(() => {}); });`,
    `  const __acceptId = page.locator('#onetrust-accept-btn-handler, #CybotCookiebotDialogBodyButtonAccept, #CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, [data-testid="uc-accept-all-button"]').first();`,
    `  await page.addLocatorHandler(__acceptId, async () => { await __acceptId.click({ timeout: 2000 }).catch(() => {}); });`,
  ];
}

function assertLine(a: RecordedAssertion): string {
  switch (a.kind) {
    case 'visible': return `await expect(${toLocator(a.selector)}).toBeVisible();`;
    case 'text':    return `await expect(${toLocator(a.selector)}).toContainText(${q(a.expected)});`;
    case 'value':   return `await expect(${toLocator(a.selector)}).toHaveValue(${q(a.expected)});`;
    case 'url':     return `await expect(page).toHaveURL(${q(a.expected)});`;
  }
}

export function traceToSpec(actions: RecordedAction[], opts: CodegenOptions): string {
  // Recordings are self-contained: the user performed the WHOLE flow in the live
  // browser (including any login), so we replay exactly that — no auto-login(),
  // no dependency on a fixtures.js file. Import straight from @playwright/test.
  const header = `import { test, expect } from '@playwright/test';\n`;

  const body: string[] = [];
  // Arm consent-banner auto-dismissal BEFORE navigating, so a banner can't block
  // any of the replayed clicks (the original failure mode on consent-gated sites).
  body.push(...consentDismissLines());
  // Start where the recording started; replay the captured actions verbatim.
  body.push(`  await page.goto(${q(opts.targetUrl)});`);

  const pushLine = (line: string) => {
    // Collapse consecutive duplicate steps (e.g. a double-click captured twice).
    if (body[body.length - 1] !== line) body.push(line);
  };

  for (const a of actions) {
    switch (a.type) {
      // Navigations are consequences of clicks/links, not address-bar entries —
      // codegen doesn't insert goto for them (matches Playwright codegen).
      case 'navigate': break;
      case 'click':  pushLine(`  await ${toLocator(a.selector)}.click();`); break;
      case 'fill':   pushLine(`  await ${toLocator(a.selector)}.fill(${q(a.value)});`); break;
      case 'select': pushLine(`  await ${toLocator(a.selector)}.selectOption(${q(a.value)});`); break;
      case 'check':  pushLine(`  await ${toLocator(a.selector)}.${a.checked ? 'check' : 'uncheck'}();`); break;
      case 'press':  pushLine(`  await ${toLocator(a.selector)}.press(${q(a.key)});`); break;
      case 'assert': pushLine(`  ${assertLine(a.assertion)}`); break;
    }
  }

  // Guardrail: every test needs an assertion. If the user marked none, add a
  // non-failing smoke check (the page rendered) — never a hardcoded URL that
  // breaks when the flow navigates, and no TODO comment in the emitted test.
  if (!body.some(l => l.includes('expect('))) {
    body.push(`  await expect(page.locator('body')).toBeVisible();`);
  }

  const title = opts.title || 'recorded user flow';
  return `${header}\ntest(${q(title)}, async ({ page }) => {\n${body.join('\n')}\n});\n`;
}
