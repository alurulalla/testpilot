/**
 * Credential extractor — reads product documentation and pulls out any
 * username / password / email pairs so TestPilot can perform a pre-login
 * and authenticated crawl without the user manually entering credentials.
 *
 * Patterns recognised (case-insensitive):
 *   Username: value     Password: value
 *   User: value         Pass: value
 *   Login: value        Email: value
 *   user = value        password = value
 *   | Username | value |  (Markdown table row)
 *
 * Returns null if no credentials are found so the caller can skip.
 */

export interface ExtractedCredentials {
  username: string;
  password: string;
  /** Which label was used for the username field (e.g. "Username", "Email") */
  usernameLabel: string;
}

// ── Label groups ──────────────────────────────────────────────────────────────

const USERNAME_LABELS = ['username', 'user', 'login', 'email', 'user name', 'user_name'];
const PASSWORD_LABELS = ['password', 'pass', 'passwd', 'pwd', 'secret', 'passphrase'];

// ── Parsers ───────────────────────────────────────────────────────────────────

/**
 * Match `Label: value` or `Label = value` lines (with optional bold/backtick markup).
 * Also handles Markdown table rows `| Label | value |`.
 */
function extractKVPairs(doc: string): Map<string, string> {
  const map = new Map<string, string>();

  // Pattern 1: "Key: value" or "Key = value"
  const kvRe = /^\s*(?:\*{1,2}|_{1,2})?([A-Za-z][A-Za-z _-]{1,30})(?:\*{1,2}|_{1,2})?\s*[:=]\s*`?([^\s`|,\n]+)`?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(doc)) !== null) {
    map.set(m[1].trim().toLowerCase(), m[2].trim());
  }

  // Pattern 2: Markdown table "| Label | value |"
  const tableRe = /\|\s*([A-Za-z][A-Za-z _-]{1,30})\s*\|\s*([^\s|]+)\s*\|/g;
  while ((m = tableRe.exec(doc)) !== null) {
    const key = m[1].trim().toLowerCase();
    const val = m[2].trim();
    // Skip header separators like "---"
    if (/^[-:]+$/.test(val)) continue;
    map.set(key, val);
  }

  return map;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Extract a username + password pair from product documentation markdown.
 *
 * Returns null when no credentials are found — callers should treat this as
 * "not available" and fall through to manual credential entry.
 */
export function extractCredentialsFromDoc(doc: string): ExtractedCredentials | null {
  if (!doc || doc.trim().length === 0) return null;

  const kvMap = extractKVPairs(doc);

  // Find a username-like entry
  let username = '';
  let usernameLabel = '';
  for (const label of USERNAME_LABELS) {
    const val = kvMap.get(label);
    if (val && val.length > 0 && !/^[-:]+$/.test(val)) {
      username = val;
      usernameLabel = label.charAt(0).toUpperCase() + label.slice(1);
      break;
    }
  }

  // Find a password-like entry
  let password = '';
  for (const label of PASSWORD_LABELS) {
    const val = kvMap.get(label);
    if (val && val.length > 0 && !/^[-:]+$/.test(val)) {
      password = val;
      break;
    }
  }

  if (!username || !password) return null;

  return { username, password, usernameLabel };
}
