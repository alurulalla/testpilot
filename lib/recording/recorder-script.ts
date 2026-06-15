/**
 * The recorder — injected into the page under test (via Playwright addInitScript
 * / page.evaluate). It watches user actions, builds a robust selector for each,
 * and BUFFERS them in sessionStorage. The backend drains that buffer with
 * page.evaluate (see drainActions) — this works reliably over connectOverCDP,
 * unlike exposeBinding which silently fails on browsers Playwright didn't launch.
 * sessionStorage also survives same-origin navigations, so a click that
 * navigates isn't lost. Assert mode records an expectation instead of clicking.
 *
 * Selector strategy mirrors Playwright's: test-id → role+name → text → scoped CSS.
 */
const ACTIONS_KEY = '__tpActions';

export function buildRecorderScript(): string {
  return `(() => {
  if (window.__tpRecorderInstalled) return;
  window.__tpRecorderInstalled = true;
  window.__tpAssertMode = false;
  window.__tpSetAssertMode = (on) => { window.__tpAssertMode = !!on; };

  var KEY = ${JSON.stringify(ACTIONS_KEY)};
  const send = (a) => {
    try {
      var arr = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      arr.push(Object.assign({ at: Date.now() }, a));
      sessionStorage.setItem(KEY, JSON.stringify(arr));
    } catch (e) {}
  };
  const css = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');

  // Disambiguate a CSS selector that matches MORE THAN ONE element (e.g. a
  // shared data-testid). Playwright throws in strict mode on >1 match, so we
  // pin it: prefer the element's visible text (robust), else its index.
  function refine(sel, el) {
    try {
      const all = document.querySelectorAll(sel);
      if (all.length <= 1) return sel;
      const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
      if (txt) return sel + ' >> text=' + JSON.stringify(txt);
      const idx = Array.prototype.indexOf.call(all, el);
      return idx >= 0 ? sel + ' >> nth=' + idx : sel;
    } catch (e) { return sel; }
  }

  // Robust selector: test-id → id → role+accessible-name → text → scoped CSS path.
  // CSS-queryable selectors are refined to guarantee a single match.
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    // Use the ACTUAL test-id attribute name present on the element — sites use
    // different ones (data-testid, data-test, data-cy, data-qa). Emitting the
    // wrong name (e.g. data-testid for a data-test site like saucedemo) makes the
    // selector match nothing on replay.
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const v = el.getAttribute(attr);
      if (v) return refine('[' + attr + '="' + v + '"]', el);
    }
    // Use the id ONLY if it looks stable. Framework-generated ids (react-…,
    // radix-…, anything with digits like react-autowhatever-1--item-1) change
    // between runs, so prefer role/text for those.
    const stableId = el.id && !/\\d/.test(el.id) && !/^(react-|radix-|headlessui-|mui-|:r|ember|downshift|rc_)/i.test(el.id);
    if (stableId) return refine('#' + css(el.id), el);
    const role = el.getAttribute('role') || implicitRole(el);
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    if (role && name) {
      // A role+name selector is the most robust — BUT the same accessible name
      // often repeats (a nav link in header + mega-menu + footer). Playwright's
      // strict mode throws on >1 match, so pin the clicked one with >> nth.
      var rsel = 'role=' + role + '[name="' + name + '"]';
      var rmatches = roleMatches(role, name);
      if (rmatches.length > 1) {
        var ridx = rmatches.indexOf(el);
        if (ridx >= 0) return rsel + ' >> nth=' + ridx;
      }
      return rsel;
    }
    if (name && (el.tagName === 'A' || el.tagName === 'BUTTON')) return 'text=' + name;
    return cssPath(el);
  }

  // All elements sharing a role + accessible name (computed the same way as
  // selectorFor above), so an ambiguous role selector can be disambiguated by index.
  function roleMatches(role, name) {
    var out = [];
    var nodes = document.querySelectorAll('a,button,input,select,textarea,[role]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var r = node.getAttribute('role') || implicitRole(node);
      if (r !== role) continue;
      var n = (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
      if (n === name) out.push(node);
    }
    return out;
  }

  function implicitRole(el) {
    const t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'submit' || ty === 'button') return 'button';
      return 'textbox';
    }
    return '';
  }

  // Short, reasonably-unique CSS path as a fallback.
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        part += '.' + Array.from(node.classList).slice(0, 2).map(css).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // ── Action capture ──────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const target = el.closest('a,button,input,select,textarea,[role],[onclick]') || el;
    const selector = selectorFor(target);
    if (window.__tpAssertMode) {
      // Assert mode: don't perform the click — record an expectation instead.
      e.preventDefault(); e.stopPropagation();
      send({ type: 'assert', assertion: { kind: 'visible', selector } });
      return;
    }
    // Skip clicks on form fields — they're just focus; the 'change' handler
    // captures the meaningful action (fill/select/check). Recording these adds
    // noise and can fail (e.g. a field clicked but never filled).
    const tag = target.tagName.toLowerCase();
    const itype = (target.getAttribute('type') || '').toLowerCase();
    const isTextField = tag === 'textarea' || (tag === 'input' && !['submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes(itype));
    if (isTextField || tag === 'select' || (tag === 'input' && (itype === 'checkbox' || itype === 'radio'))) return;
    send({ type: 'click', selector });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const selector = selectorFor(el);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') send({ type: 'select', selector, value: el.value });
    else if (type === 'checkbox' || type === 'radio') send({ type: 'check', selector, checked: !!el.checked });
    else if (tag === 'input' || tag === 'textarea') send({ type: 'fill', selector, value: el.value });
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el instanceof Element && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      send({ type: 'press', selector: selectorFor(el), key: 'Enter' });
    }
  }, true);

  // Navigation (initial + SPA route changes).
  send({ type: 'navigate', url: location.href });
  const reportNav = () => send({ type: 'navigate', url: location.href });
  window.addEventListener('popstate', reportNav);
  window.addEventListener('hashchange', reportNav);
})();`;
}

import type { Page } from 'playwright';
import type { RecordedAction } from './types';

/**
 * Drain buffered actions out of the page (reliable over connectOverCDP, unlike
 * exposeBinding). Reads + clears the sessionStorage buffer. Best-effort: returns
 * [] if the page is mid-navigation or the buffer is empty.
 */
export async function drainActions(page: Page): Promise<RecordedAction[]> {
  try {
    const drained = await page.evaluate((key: string) => {
      try {
        const raw = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    }, ACTIONS_KEY);
    return (drained as RecordedAction[]) ?? [];
  } catch {
    return [];
  }
}
