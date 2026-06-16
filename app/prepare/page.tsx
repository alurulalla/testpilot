'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Zap, ArrowLeft, Globe, Search, Loader2, Check, RefreshCw, ArrowRight,
  ChevronDown, ChevronRight, Eye, EyeOff, X, Layers, Edit2, FileText, Upload,
  Lock, ShieldCheck, PackageOpen, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { UserMenu } from '@/components/user-menu';
import { ModelStatusBadge } from '@/components/model-status-badge';
import type { ContextField } from '@/lib/url-context-store';
import type { DetectedFormGroup, SignInPresenceInfo } from '@/lib/detect-form-fields';
import type { Session, ImportedUseCase } from '@/types/session';

// ── Types ────────────────────────────────────────────────────────────────────

interface StoredContext {
  urlKey: string;
  url: string;
  fields: ContextField[];
  updatedAt: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Prettify a raw HTML name/id attribute into a human-readable label.
 * e.g. "firstName" → "First Name", "address.street" → "Address Street"
 */
function prettifyKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase → words
    .replace(/[._-]+/g, ' ')                 // dots, underscores, hyphens → spaces
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, c => c.toUpperCase());
}

/**
 * Strip the "FormLabel — " prefix that groupsToContextFields adds to labels,
 * then prettify whatever's left if it looks like a raw key (all-lowercase / dots).
 */
function displayLabel(label: string): string {
  const stripped = label.replace(/^[^—]*—\s*/, '').trim();
  // If it still looks like a raw key (lowercase, dots, underscores) → prettify
  if (/^[a-z][a-z0-9._]*$/.test(stripped)) return prettifyKey(stripped);
  return stripped;
}

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

function urlHostMatches(a: string, b: string): boolean {
  try {
    const hostA = new URL(a).hostname.replace(/^www\./, '');
    const hostB = new URL(b).hostname.replace(/^www\./, '');
    return hostA === hostB;
  } catch {
    return false;
  }
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * Re-group a flat ContextField array into labelled sections.
 *
 * groupsToContextFields() stores labels as "{FormLabel} — {fieldLabel}" for
 * multi-group forms, and plain "{fieldLabel}" for single-group forms.
 * We split on " — " to recover the original form section name so the
 * Context panel can render a header above each group of fields.
 */
function groupFieldsByFormLabel(
  fields: ContextField[],
): Array<{ groupLabel: string; groupFields: ContextField[] }> {
  const map = new Map<string, ContextField[]>();
  for (const f of fields) {
    const sep = f.label.indexOf(' — ');
    const key = sep > 0 ? f.label.slice(0, sep).trim() : '';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  return Array.from(map.entries()).map(([groupLabel, groupFields]) => ({
    groupLabel,
    groupFields,
  }));
}

// ── FieldInput ────────────────────────────────────────────────────────────────

interface FieldInputProps {
  field: ContextField;
  displayLabel: string;
  showValue: boolean;
  onToggleShow: () => void;
  onChange: (val: string) => void;
}

function FieldInput({ field, displayLabel, showValue, onToggleShow, onChange }: FieldInputProps) {
  const isSensitive = field.sensitive;
  return (
    <div className="flex items-center gap-2">
      <label className="w-28 shrink-0 text-xs text-zinc-400 truncate" title={displayLabel}>
        {displayLabel}
      </label>
      <div className="relative flex-1">
        <input
          type={isSensitive && !showValue ? 'password' : 'text'}
          value={field.value}
          onChange={e => onChange(e.target.value)}
          placeholder={isSensitive ? '••••••••' : `Enter ${displayLabel.toLowerCase()}`}
          className="w-full h-8 px-2.5 rounded-md bg-zinc-800/80 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 text-xs pr-8"
          autoComplete="off"
        />
        {isSensitive && (
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-400 transition-colors"
            tabIndex={-1}
          >
            {showValue ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

function PrepareContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawUrl = searchParams.get('url') ?? '';
  const url = normalizeUrl(rawUrl);

  // URL editing
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(rawUrl);

  // Context / form detection
  const [storedContext, setStoredContext] = useState<StoredContext | null>(null);
  const [fields, setFields] = useState<ContextField[]>([]);
  const [groups, setGroups] = useState<DetectedFormGroup[]>([]);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [detectLoading, setDetectLoading] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Auto-detection: tracks whether the initial background scan has run
  const autoDetectRan = useRef(false);

  // Three-stage auth fallback (when no forms found in auto-scan)
  const [signInInfo, setSignInInfo] = useState<SignInPresenceInfo | null>(null);
  // 'none' | 'prompt-url' | 'scanning-url' | 'manual'
  const [authFallbackStage, setAuthFallbackStage] = useState<string>('none');
  const [loginUrlInput, setLoginUrlInput] = useState('');
  const [loginUrlScanLoading, setLoginUrlScanLoading] = useState(false);
  const [loginUrlScanError, setLoginUrlScanError] = useState('');
  // Which form group is active in the inline credential tabs (default: Login)
  const [activeGroupLabel, setActiveGroupLabel] = useState<string>('');

  // Figma
  const [figmaFileUrl, setFigmaFileUrl] = useState('');
  const [showFigma, setShowFigma] = useState(false);
  const [figmaFrames, setFigmaFrames] = useState<{ name: string; width?: number; height?: number; suggestedPath: string }[]>([]);
  const [figmaFrameMap, setFigmaFrameMap] = useState<Record<string, string>>({});
  const [loadingFrames, setLoadingFrames] = useState(false);
  const [framesError, setFramesError] = useState('');

  // Product Documentation
  const [docContent, setDocContent] = useState('');
  const [docFileName, setDocFileName] = useState('');
  const [showDoc, setShowDoc] = useState(false);
  const [docPasting, setDocPasting] = useState(false);
  const [docPasteText, setDocPasteText] = useState('');

  // Sessions
  const [existingSessions, setExistingSessions] = useState<Session[]>([]);

  // Import existing Playwright project
  const [importZipFile, setImportZipFile] = useState<File | null>(null);
  const [importValidation, setImportValidation] = useState<{
    valid: true; detectedBaseUrl?: string | null; specFilesCount: number; useCases: ImportedUseCase[];
  } | { valid: false; reason: string } | null>(null);
  const [importValidating, setImportValidating] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Submit
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');

  // ── Redirect if no URL ────────────────────────────────────────────────────
  useEffect(() => {
    if (!rawUrl) router.replace('/');
  }, [rawUrl, router]);

  // ── Load stored context + sessions on mount ───────────────────────────────
  const loadData = useCallback(async (targetUrl: string): Promise<boolean> => {
    const [ctxRes, sessRes] = await Promise.all([
      fetch(`/api/contexts?url=${encodeURIComponent(targetUrl)}`).catch(() => null),
      fetch(`/api/sessions?url=${encodeURIComponent(targetUrl)}`).catch(() => null),
    ]);
    let hasStoredContext = false;
    if (ctxRes?.ok) {
      const ctx = await ctxRes.json() as StoredContext;
      setStoredContext(ctx);
      setFields(ctx.fields.map(f => ({ ...f })));
      setSavedAt(ctx.updatedAt);
      hasStoredContext = true;
    }
    if (sessRes?.ok) {
      setExistingSessions((await sessRes.json() as Session[]).slice(0, 3));
    }
    return hasStoredContext;
  }, []);

  // ── Auto-detect forms on load (only if no stored context) ─────────────────
  useEffect(() => {
    if (!url || autoDetectRan.current) return;
    autoDetectRan.current = true;

    loadData(url).then(hasStoredContext => {
      // If no saved credentials for this URL, automatically scan for login forms
      if (!hasStoredContext) {
        detectForms();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── Detect forms ──────────────────────────────────────────────────────────
  async function detectForms() {
    if (!url) return;
    setDetectLoading(true);
    setDetectError('');
    setGroups([]);
    setSignInInfo(null);
    setAuthFallbackStage('none');
    setLoginUrlInput('');
    setLoginUrlScanError('');
    try {
      const res = await fetch('/api/contexts/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as {
        groups?: DetectedFormGroup[];
        fields?: ContextField[];
        error?: string;
        signInInfo?: SignInPresenceInfo;
      };

      // Helper: apply signInInfo and pre-fill external URL when detected
      const applySignInInfo = (info: SignInPresenceInfo | undefined) => {
        if (info) {
          setSignInInfo(info);
          if (info.isExternalAuth && info.externalAuthUrl) {
            setLoginUrlInput(info.externalAuthUrl);
          }
        }
      };

      if (!res.ok || data.error) {
        applySignInInfo(data.signInInfo);
        setDetectError(data.error ?? 'Detection failed');
        setAuthFallbackStage('prompt-url');
      } else if (!data.fields?.length) {
        applySignInInfo(data.signInInfo);
        setDetectError('No form fields detected on this page or its linked pages.');
        setAuthFallbackStage('prompt-url');
      } else {
        const detectedGroups = data.groups ?? [];
        setGroups(detectedGroups);
        // Merge detected fields with any already-saved values
        setFields(prev => (data.fields ?? []).map(f => {
          const stored = prev.find(s => s.key === f.key);
          return stored?.value ? { ...f, value: stored.value } : f;
        }));
        // Auto-select the Login/Sign-in group; fall back to the first group.
        const loginIdx = detectedGroups.findIndex(g => /login|sign.?in/i.test(g.formLabel));
        const defaultIdx = loginIdx >= 0 ? loginIdx : 0;
        setActiveGroupLabel(`${detectedGroups[defaultIdx]?.formLabel ?? ''}__${defaultIdx}`);

        // If none of the detected groups are auth forms, check whether there's a
        // sign-in button pointing somewhere else and surface the fallback UI.
        const hasAuth = detectedGroups.some(g =>
          /login|sign.?in|sign.?up|register|auth/i.test(g.formLabel),
        );
        if (!hasAuth) {
          applySignInInfo(data.signInInfo);
          setAuthFallbackStage('prompt-url');
        }
      }
    } catch {
      setDetectError('Network error during detection');
      setAuthFallbackStage('prompt-url');
    } finally {
      setDetectLoading(false);
    }
  }

  // ── Scan a single user-provided login URL ─────────────────────────────────
  async function scanUserLoginUrl() {
    const targetUrl = loginUrlInput.trim();
    if (!targetUrl) return;
    setLoginUrlScanLoading(true);
    setLoginUrlScanError('');
    try {
      const res = await fetch('/api/contexts/detect-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizeUrl(targetUrl) }),
      });
      const data = await res.json() as {
        groups?: DetectedFormGroup[];
        fields?: ContextField[];
        error?: string;
      };
      if (!res.ok || data.error || !data.fields?.length) {
        // Nothing found on this page either → fall back to manual entry
        setLoginUrlScanError(data.error ?? 'No login form found on this page.');
        setAuthFallbackStage('manual');
        // Seed manual fields: username + password
        setFields([
          { key: 'username', label: 'Username', type: 'text', value: '', sensitive: false },
          { key: 'password', label: 'Password', type: 'password', value: '', sensitive: true },
        ]);
        setGroups([]);
      } else {
        const detectedGroups = data.groups ?? [];
        setGroups(detectedGroups);
        setAuthFallbackStage('none');
        setLoginUrlScanError('');
        setFields(prev => (data.fields ?? []).map(f => {
          const stored = prev.find(s => s.key === f.key);
          return stored?.value ? { ...f, value: stored.value } : f;
        }));
        const loginIdx = detectedGroups.findIndex(g => /login|sign.?in/i.test(g.formLabel));
        const defaultIdx = loginIdx >= 0 ? loginIdx : 0;
        setActiveGroupLabel(`${detectedGroups[defaultIdx]?.formLabel ?? ''}__${defaultIdx}`);
      }
    } catch {
      setLoginUrlScanError('Network error while scanning login page.');
      setAuthFallbackStage('manual');
    } finally {
      setLoginUrlScanLoading(false);
    }
  }

  // ── Enable manual credential entry ────────────────────────────────────────
  function useManualEntry() {
    setAuthFallbackStage('manual');
    setLoginUrlScanError('');
    setFields([
      { key: 'username', label: 'Username', type: 'text', value: '', sensitive: false },
      { key: 'password', label: 'Password', type: 'password', value: '', sensitive: true },
    ]);
    setGroups([]);
  }

  // ── Save context ──────────────────────────────────────────────────────────
  async function saveContext() {
    if (!url) return;
    await fetch('/api/contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, fields }),
    });
    const now = Date.now();
    setStoredContext({ urlKey: url, url, fields, updatedAt: now });
    setSavedAt(now);
  }

  // ── Launch session ────────────────────────────────────────────────────────
  async function loadFigmaFrames() {
    if (!figmaFileUrl.trim()) return;
    setLoadingFrames(true);
    setFramesError('');
    try {
      // When frames are already loaded, this call is a manual "Reload" — force
      // a fresh fetch so newly-added Figma frames show up (the server caches
      // the frame list for 30 minutes otherwise).
      const refresh = figmaFrames.length > 0;
      const res = await fetch('/api/figma/frames', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ figmaFileUrl: figmaFileUrl.trim(), refresh }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load frames');
      const frames = (data.frames ?? []) as typeof figmaFrames;
      setFigmaFrames(frames);
      // Pre-fill the mapping with suggested URLs (origin + suggested path).
      let origin = '';
      try { origin = new URL(url).origin; } catch { /* ignore */ }
      const initial: Record<string, string> = {};
      for (const f of frames) {
        initial[f.name] = f.suggestedPath ? origin + f.suggestedPath : '';
      }
      setFigmaFrameMap(initial);
    } catch (err) {
      setFramesError(err instanceof Error ? err.message : 'Failed to load frames');
      setFigmaFrames([]);
    } finally {
      setLoadingFrames(false);
    }
  }

  async function launch() {
    if (!url || importUrlMismatch) return;
    setLaunching(true);
    setLaunchError('');
    if (fields.some(f => f.value)) await saveContext();
    try {
      const body: Record<string, unknown> = { url };
      if (figmaFileUrl.trim()) body.figmaFileUrl = figmaFileUrl.trim();
      // Only send non-empty frame→page mappings.
      const cleanedMap = Object.fromEntries(
        Object.entries(figmaFrameMap).filter(([, v]) => v && v.trim()),
      );
      if (Object.keys(cleanedMap).length > 0) body.figmaFrameMap = cleanedMap;
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to create session');
      const session = await res.json() as Session;

      // Upload imported Playwright project before navigating so the session
      // page sees it and skips exploration/generation.
      if (importZipFile && importValidation?.valid) {
        const fd = new FormData();
        fd.append('file', importZipFile);
        await fetch(`/api/sessions/${session.id}/import-playwright`, {
          method: 'POST',
          body: fd,
        }).catch(() => {});
      }

      // Upload product documentation before navigating so it's in place when
      // the test generator runs — the loop route will inject it into CONTEXT.md.
      if (docContent.trim()) {
        await fetch(`/api/sessions/${session.id}/context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: docContent,
            fileName: docFileName || 'documentation.md',
          }),
        });
      }

      router.push(`/session/${session.id}`);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Something went wrong');
      setLaunching(false);
    }
  }

  // ── Validate ZIP on selection ─────────────────────────────────────────────
  async function handleImportZip(file: File) {
    setImportZipFile(file);
    setImportValidation(null);
    setImportValidating(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/import-playwright/validate', { method: 'POST', body: fd });
      const data = await res.json() as typeof importValidation;
      setImportValidation(data);
    } catch {
      setImportValidation({ valid: false, reason: 'Validation request failed.' });
    } finally {
      setImportValidating(false);
    }
  }

  function clearImport() {
    setImportZipFile(null);
    setImportValidation(null);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const hasContext = fields.length > 0;
  const hasFilledFields = fields.some(f => f.value);
  // True when a login/signup/auth form was found in the scan
  const hasAuthForm = groups.some(g =>
    /login|sign.?in|sign.?up|register|auth/i.test(g.formLabel)
  );
  // Manual entry also counts as auth context for deep crawl
  const hasManualAuth = authFallbackStage === 'manual' && hasFilledFields;
  // True when the user has provided auth credentials → deep crawl will be enabled
  const deepCrawlEnabled = hasFilledFields && (hasAuthForm || hasManualAuth);
  // True when an import is loaded and its baseURL doesn't match the target URL
  const importUrlMismatch =
    importValidation?.valid === true &&
    !!importValidation.detectedBaseUrl &&
    !urlHostMatches(importValidation.detectedBaseUrl, url);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex flex-col min-h-0">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800 px-6 py-3.5 flex items-center gap-4 shrink-0">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-zinc-400 hover:text-zinc-100 transition-colors"
          title="Back to home"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <Logo height={30} />

        {/* URL display / editor */}
        <div className="flex-1 min-w-0">
          {editingUrl ? (
            <form
              className="flex items-center gap-2"
              onSubmit={e => {
                e.preventDefault();
                const next = normalizeUrl(urlDraft);
                if (next) router.push(`/prepare?url=${encodeURIComponent(next)}`);
                setEditingUrl(false);
              }}
            >
              <input
                autoFocus
                value={urlDraft}
                onChange={e => setUrlDraft(e.target.value)}
                className="flex-1 h-8 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <Button type="submit" size="sm" variant="secondary">Go</Button>
              <button
                type="button"
                onClick={() => { setUrlDraft(rawUrl); setEditingUrl(false); }}
                className="text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <p className="text-sm text-zinc-100 truncate">{url}</p>
              <button
                onClick={() => { setUrlDraft(rawUrl); setEditingUrl(true); }}
                className="text-zinc-400 hover:text-zinc-400 transition-colors shrink-0"
                title="Edit URL"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Launch button in header (desktop shortcut) */}
        <Button size="sm" onClick={launch} disabled={launching || importUrlMismatch} className="shrink-0" title={importUrlMismatch ? 'Fix the project URL mismatch before running' : undefined}>
          {launching
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Zap className="h-3.5 w-3.5" />}
          {launching ? 'Launching…' : 'Run TestPilot'}
        </Button>
        <ModelStatusBadge />
        <UserMenu />
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto w-full">

          {/* ── Left: main configuration ─────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* ── Authentication & Deep Crawl card ─────────────────────── */}
            <div className={`rounded-xl border p-5 space-y-4 transition-colors ${
              deepCrawlEnabled
                ? 'border-violet-500/40 bg-violet-500/5'
                : hasAuthForm || authFallbackStage === 'manual'
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : authFallbackStage === 'prompt-url'
                    ? 'border-amber-500/20 bg-zinc-900'
                    : 'border-zinc-800 bg-zinc-900'
            }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {deepCrawlEnabled
                    ? <ShieldCheck className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                    : hasAuthForm || authFallbackStage === 'manual'
                      ? <Lock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      : <Search className="h-4 w-4 text-zinc-400 mt-0.5 shrink-0" />
                  }
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      {deepCrawlEnabled
                        ? 'Deep Crawl Enabled'
                        : hasAuthForm
                          ? 'Login Form Detected'
                          : authFallbackStage === 'manual'
                            ? 'Manual Credentials'
                            : authFallbackStage === 'prompt-url'
                              ? 'Login Page Not Found'
                              : 'Form Detection'}
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {deepCrawlEnabled
                        ? 'TestPilot will log in and crawl the full authenticated app before generating tests.'
                        : hasAuthForm
                          ? 'Enter your credentials below to unlock deep authenticated crawling of every page.'
                          : authFallbackStage === 'manual'
                            ? 'Credentials entered manually — TestPilot will use these to authenticate.'
                            : authFallbackStage === 'prompt-url'
                              ? 'Provide your login page URL or enter credentials manually.'
                              : detectLoading
                                ? 'Scanning for login and signup forms…'
                                : 'Automatically scans the site for login, register, and other forms.'}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={detectForms}
                  disabled={detectLoading}
                  className="shrink-0"
                >
                  {detectLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  {detectLoading ? 'Scanning…' : groups.length > 0 ? 'Re-scan' : 'Scan'}
                </Button>
              </div>

              {/* Scanning indicator */}
              {detectLoading && (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
                  Scanning {url} for login and signup forms…
                </div>
              )}

              {/* Three-stage auth fallback UI — shown whenever auth forms weren't found */}
              {!detectLoading && authFallbackStage !== 'none' && (() => {
                // Stage 2: prompt-url — no forms found, ask user for login URL
                if (authFallbackStage === 'prompt-url') {
                  const externalDomain = signInInfo?.isExternalAuth && signInInfo.externalAuthUrl
                    ? (() => { try { return new URL(signInInfo.externalAuthUrl).hostname; } catch { return signInInfo.externalAuthUrl; } })()
                    : null;
                  return (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 shrink-0" />
                        {signInInfo?.hasSignInButton
                          ? externalDomain
                            ? `Sign In detected — redirects to ${externalDomain}`
                            : 'Sign In button detected on this page'
                          : 'No login form detected automatically'}
                      </p>
                      <p className="text-xs text-zinc-200">
                        {externalDomain
                          ? `Your sign-in page appears to be hosted on ${externalDomain}. Confirm the URL below or enter a different login URL to scan.`
                          : signInInfo?.hasSignInButton
                            ? "The sign-in link couldn't be followed automatically. Enter your login page URL to scan it directly."
                            : 'Enter your login page URL so TestPilot can find the credential fields.'}
                      </p>
                      <form
                        className="flex gap-2"
                        onSubmit={e => { e.preventDefault(); scanUserLoginUrl(); }}
                      >
                        <input
                          type="text"
                          value={loginUrlInput}
                          onChange={e => setLoginUrlInput(e.target.value)}
                          placeholder="https://login.example.com"
                          className="flex-1 h-8 px-2.5 rounded-md bg-zinc-800 border border-amber-500/40 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-400 text-xs"
                        />
                        <Button
                          size="sm"
                          type="submit"
                          variant="secondary"
                          disabled={!loginUrlInput.trim() || loginUrlScanLoading}
                          className="shrink-0"
                        >
                          {loginUrlScanLoading
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Search className="h-3 w-3" />}
                          Scan
                        </Button>
                      </form>
                      {loginUrlScanError && (
                        <p className="text-xs text-red-400 flex items-center gap-1">
                          <X className="h-3 w-3 shrink-0" /> {loginUrlScanError}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={useManualEntry}
                        className="text-xs text-zinc-400 hover:text-zinc-100 transition-colors underline underline-offset-2"
                      >
                        Enter credentials manually instead
                      </button>
                    </div>
                  );
                }

                // Stage 3: manual — no form found anywhere, show manual username/password
                if (authFallbackStage === 'manual') {
                  return (
                    <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        Enter your login credentials manually
                      </p>
                      <p className="text-xs text-zinc-300">
                        No login form was detected automatically. Enter your credentials below
                        so TestPilot can authenticate during testing.
                      </p>
                      <div className="space-y-2">
                        {fields.map((f, idx) => (
                          <FieldInput
                            key={f.key}
                            field={f}
                            displayLabel={f.label}
                            showValue={showValues[f.key] ?? false}
                            onToggleShow={() => setShowValues(v => ({ ...v, [f.key]: !v[f.key] }))}
                            onChange={val => {
                              const updated = [...fields];
                              updated[idx] = { ...f, value: val };
                              setFields(updated);
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        {fields.some(f => f.value) && (
                          <button
                            type="button"
                            onClick={saveContext}
                            className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            <Check className="h-3 w-3" /> Save credentials
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setAuthFallbackStage('prompt-url')}
                          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                          ← Try scanning a URL instead
                        </button>
                      </div>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Auth form detected → tabbed credential entry */}
              {hasAuthForm && groups.length > 0 && (() => {
                // Build prefix → fields mapping per group.
                // Use index-keyed entries to avoid collisions when two groups share
                // the same formLabel (e.g. two "Login" groups — deduplicated in
                // the backend, but we guard here too).
                const groupEntries = groups.map((g, idx) => {
                  const prefix = g.formLabel.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_';
                  let groupFields = fields.filter(f => f.key.startsWith(prefix));
                  // Single-group case: groupsToContextFields skips the prefix, so keys
                  // are plain ("username", "password") — fall back to all fields.
                  if (groupFields.length === 0 && groups.length === 1) {
                    groupFields = fields;
                  }
                  return { g, idx, groupFields, tabKey: `${g.formLabel}__${idx}` };
                });
                // Active group resolved by tabKey
                const activeEntry = groupEntries.find(e => e.tabKey === activeGroupLabel)
                  ?? groupEntries[0];
                const activeFields = activeEntry?.groupFields ?? [];

                return (
                  <div className="space-y-3">
                    {/* Group tabs */}
                    <div className="flex flex-wrap gap-1">
                      {groupEntries.map(({ g, tabKey }) => (
                        <button
                          key={tabKey}
                          type="button"
                          onClick={() => setActiveGroupLabel(tabKey)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            activeGroupLabel === tabKey || (!activeGroupLabel && tabKey === groupEntries[0]?.tabKey)
                              ? 'bg-zinc-700 text-zinc-100 border border-zinc-600'
                              : 'bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 hover:text-zinc-200 hover:border-zinc-600'
                          }`}
                          title={g.pageUrl}
                        >
                          <Lock className={`h-2.5 w-2.5 ${activeGroupLabel === tabKey ? 'text-amber-400' : 'text-zinc-400'}`} />
                          {g.formLabel}
                          <span className={`text-[10px] ${activeGroupLabel === tabKey ? 'text-zinc-400' : 'text-zinc-400'}`}>
                            {g.fields.length}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Fields for active group */}
                    <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/60 p-3 space-y-2">
                      <p className="text-xs text-zinc-400 font-medium mb-2">
                        {activeEntry?.g.formLabel} credentials for authenticated testing:
                      </p>
                      {activeFields.map(f => {
                        const idx = fields.findIndex(x => x.key === f.key);
                        return (
                          <FieldInput
                            key={f.key}
                            field={f}
                            displayLabel={displayLabel(f.label)}
                            showValue={showValues[f.key] ?? false}
                            onToggleShow={() => setShowValues(v => ({ ...v, [f.key]: !v[f.key] }))}
                            onChange={val => {
                              const updated = [...fields];
                              updated[idx] = { ...f, value: val };
                              setFields(updated);
                            }}
                          />
                        );
                      })}
                      {hasFilledFields && (
                        <button
                          type="button"
                          onClick={saveContext}
                          className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors mt-1"
                        >
                          <Check className="h-3 w-3" /> Save credentials
                        </button>
                      )}
                    </div>

                    {deepCrawlEnabled && (
                      <div className="flex items-center gap-2 text-xs text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                        Deep crawl mode — TestPilot will log in, explore all pages, and compare them against your documentation.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* No auth form + no error → show non-auth crawl notice */}
              {!hasAuthForm && groups.length === 0 && !detectLoading && !detectError && (
                <p className="text-xs text-zinc-400">
                  No forms detected yet — scanning automatically on page load.
                </p>
              )}

              {/* Non-auth forms found */}
              {!hasAuthForm && groups.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-zinc-400">
                    {groups.length} form{groups.length !== 1 ? 's' : ''} found (no login form detected):
                  </p>
                  {groups.map(g => (
                    <div
                      key={g.formLabel}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700/50"
                    >
                      <span className="text-xs font-medium text-zinc-200">{g.formLabel}</span>
                      <span className="text-[10px] text-zinc-400 font-mono truncate flex-1">{g.pageUrl}</span>
                      <span className="text-[10px] text-zinc-400 shrink-0">{g.fields.length} field{g.fields.length !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Import Existing Playwright Project card */}
            <div className={`rounded-xl border overflow-hidden transition-colors ${
              importUrlMismatch
                ? 'border-red-500/40 bg-red-500/5'
                : importValidation?.valid
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-zinc-800 bg-zinc-900'
            }`}>
              <button
                type="button"
                onClick={() => setShowImport(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <PackageOpen className={`h-4 w-4 shrink-0 ${importUrlMismatch ? 'text-red-400' : importValidation?.valid ? 'text-emerald-400' : 'text-zinc-400'}`} />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Import Existing Tests</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {importUrlMismatch && importValidation?.valid && importValidation.detectedBaseUrl ? (
                        <span className="text-red-400">URL mismatch — project targets {importValidation.detectedBaseUrl}</span>
                      ) : importValidation?.valid ? (
                        <span className="text-emerald-400">{importValidation.specFilesCount} spec file{importValidation.specFilesCount !== 1 ? 's' : ''} · {importZipFile?.name}</span>
                      ) : (
                        'Already have Playwright tests? Upload your project ZIP to skip exploration.'
                      )}
                    </p>
                  </div>
                </div>
                {showImport
                  ? <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />}
              </button>

              {showImport && (
                <div className="px-5 pb-5 pt-4 border-t border-zinc-800 space-y-3">
                  {/* URL mismatch warning */}
                  {importUrlMismatch && importValidation?.valid && importValidation.detectedBaseUrl && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-red-300">Project URL mismatch</p>
                        <p className="text-xs text-zinc-400">
                          This project targets <span className="font-mono text-red-300">{importValidation.detectedBaseUrl}</span> but your
                          target URL is <span className="font-mono text-zinc-200">{url}</span>.
                          Please upload a project that matches your target, or change the target URL.
                        </p>
                      </div>
                    </div>
                  )}

                  {importValidation?.valid ? (
                    /* ── Loaded state ── */
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-400 flex items-center gap-1.5">
                          <Check className="h-3 w-3" />
                          {importZipFile?.name} · {importValidation.specFilesCount} spec file{importValidation.specFilesCount !== 1 ? 's' : ''}
                        </span>
                        <button
                          type="button"
                          onClick={clearImport}
                          className="text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-1"
                        >
                          <X className="h-3 w-3" /> Clear
                        </button>
                      </div>
                      {importValidation.useCases.length > 0 && (
                        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 px-3 py-2.5 space-y-1 max-h-36 overflow-y-auto">
                          {importValidation.useCases.map((uc, i) => (
                            <div key={i} className="text-xs text-zinc-400">
                              <span className="text-zinc-300 font-medium">{uc.suite}</span>
                              {uc.tests.length > 0 && (
                                <span className="text-zinc-400"> · {uc.tests.length} test{uc.tests.length !== 1 ? 's' : ''}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : importValidation?.valid === false ? (
                    /* ── Validation error ── */
                    <div className="flex items-start gap-2 text-xs text-red-400">
                      <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{importValidation.reason}</span>
                    </div>
                  ) : importValidating ? (
                    /* ── Validating ── */
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Validating Playwright project…
                    </div>
                  ) : (
                    /* ── Empty dropzone ── */
                    <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-zinc-700 rounded-lg p-5 cursor-pointer hover:border-violet-500/50 hover:bg-zinc-800/40 transition-colors">
                      <Upload className="h-5 w-5 text-zinc-400" />
                      <span className="text-xs text-zinc-400 text-center">
                        Upload your Playwright project <code className="text-zinc-300">.zip</code>
                      </span>
                      <span className="text-[10px] text-zinc-400 text-center">Must contain playwright.config.ts and spec files</span>
                      <input
                        type="file"
                        accept=".zip"
                        className="sr-only"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleImportZip(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}

                  {/* Replace dropzone after clear */}
                  {importValidation !== null && (
                    <label className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-400 cursor-pointer transition-colors">
                      <Upload className="h-3.5 w-3.5" />
                      Replace ZIP
                      <input
                        type="file"
                        accept=".zip"
                        className="sr-only"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleImportZip(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}

                  <p className="text-xs text-zinc-400 pt-1 border-t border-zinc-800">
                    TestPilot will run your existing tests directly — no site exploration or test generation.
                  </p>
                </div>
              )}
            </div>

            {/* Figma Verification card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFigma(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Layers className="h-4 w-4 text-zinc-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Figma Verification</p>
                    <p className="text-xs text-zinc-400">
                      {figmaFileUrl.trim()
                        ? <span className="text-violet-400 font-mono truncate">{figmaFileUrl}</span>
                        : 'Optional — compare live UI against Figma designs'}
                    </p>
                  </div>
                </div>
                {showFigma
                  ? <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />}
              </button>

              {showFigma && (
                <div className="px-5 pb-5 pt-4 border-t border-zinc-800 space-y-2">
                  <div className="relative">
                    <Layers className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input
                      type="text"
                      value={figmaFileUrl}
                      onChange={e => setFigmaFileUrl(e.target.value)}
                      placeholder="https://www.figma.com/design/XXXXX/My-Design"
                      className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                    />
                  </div>
                  <p className="text-xs text-zinc-400">
                    Requires a Figma token in{' '}
                    <code className="text-zinc-400">Settings → AI → API Keys</code>
                  </p>

                  {/* Frame → page mapping */}
                  {figmaFileUrl.trim() && (
                    <div className="pt-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-zinc-400">
                          Map each design frame to the page it should be compared against.
                        </p>
                        <Button
                          type="button" size="sm" variant="secondary"
                          onClick={loadFigmaFrames} disabled={loadingFrames}
                        >
                          {loadingFrames
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
                            : <>{figmaFrames.length > 0 ? 'Reload frames' : 'Load frames'}</>}
                        </Button>
                      </div>

                      {framesError && <p className="text-xs text-red-400">{framesError}</p>}

                      {figmaFrames.length > 0 && (
                        <div className="space-y-2">
                          {figmaFrames.map(f => (
                            <div key={f.name} className="flex items-center gap-2">
                              <span className="text-xs text-zinc-300 w-40 shrink-0 truncate" title={f.name}>
                                {f.name}
                                {f.width ? <span className="text-zinc-400"> · {f.width}px</span> : null}
                              </span>
                              <input
                                type="text"
                                value={figmaFrameMap[f.name] ?? ''}
                                onChange={e => setFigmaFrameMap(m => ({ ...m, [f.name]: e.target.value }))}
                                placeholder="https://your-app.com/page"
                                className="flex-1 h-8 px-2.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 text-xs font-mono"
                              />
                            </div>
                          ))}
                          <p className="text-[11px] text-zinc-400">
                            Leave a field blank to let TestPilot guess that frame&apos;s page automatically.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Product Documentation card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDoc(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Product Documentation</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {docContent.trim()
                        ? <span className="text-emerald-400">{docFileName} · {docContent.length.toLocaleString()} chars</span>
                        : 'Optional — generate tests guided by your product spec or docs'}
                    </p>
                  </div>
                </div>
                {showDoc
                  ? <ChevronDown className="h-4 w-4 text-zinc-400 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-zinc-400 shrink-0" />}
              </button>

              {showDoc && (
                <div className="px-5 pb-5 pt-4 border-t border-zinc-800 space-y-3">
                  {docContent.trim() ? (
                    /* ── Doc loaded ── */
                    <div className="space-y-3">
                      {/* File badge + clear */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-400 flex items-center gap-1.5">
                          <Check className="h-3 w-3" />
                          {docFileName} · {docContent.length.toLocaleString()} chars
                        </span>
                        <button
                          type="button"
                          onClick={() => { setDocContent(''); setDocFileName(''); setDocPasting(false); setDocPasteText(''); }}
                          className="text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-1"
                        >
                          <X className="h-3 w-3" /> Clear
                        </button>
                      </div>
                      {/* Open canvas button */}
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.setItem('canvasPreviewDoc', docContent);
                          sessionStorage.setItem('canvasPreviewFileName', docFileName || 'documentation.md');
                          window.open('/canvas/preview', '_blank');
                        }}
                        className="flex items-center justify-between w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600 transition px-3 py-2.5 group"
                      >
                        <span className="text-xs text-zinc-300 group-hover:text-zinc-100 transition">
                          Open Feature Canvas
                        </span>
                        <span className="text-zinc-400 group-hover:text-zinc-400 transition text-xs">↗</span>
                      </button>
                    </div>
                  ) : docPasting ? (
                    /* ── Paste mode ── */
                    <div className="space-y-2">
                      <textarea
                        autoFocus
                        rows={7}
                        value={docPasteText}
                        onChange={e => setDocPasteText(e.target.value)}
                        placeholder="Paste your product documentation, feature spec, or user flows here…"
                        className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-xs resize-none"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            if (docPasteText.trim()) {
                              setDocContent(docPasteText.trim());
                              setDocFileName('documentation.md');
                              setShowDoc(true); // expand card to show canvas
                            }
                            setDocPasting(false);
                          }}
                        >
                          <Check className="h-3 w-3" /> Use This
                        </Button>
                        <button
                          type="button"
                          onClick={() => { setDocPasting(false); setDocPasteText(''); }}
                          className="text-xs text-zinc-400 hover:text-zinc-400 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Empty state ── */
                    <div className="space-y-3">
                      <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-zinc-700 rounded-lg p-5 cursor-pointer hover:border-violet-500/50 hover:bg-zinc-800/40 transition-colors">
                        <Upload className="h-5 w-5 text-zinc-400" />
                        <span className="text-xs text-zinc-400">Upload <code className="text-zinc-300">.md</code> or <code className="text-zinc-300">.txt</code> file</span>
                        <input
                          type="file"
                          accept=".md,.txt,.markdown"
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const text = await file.text();
                            setDocContent(text);
                            setDocFileName(file.name);
                            setShowDoc(true); // expand card to show canvas
                          }}
                        />
                      </label>
                      <div className="flex items-center gap-3 text-xs text-zinc-400">
                        <div className="flex-1 h-px bg-zinc-800" />
                        or
                        <div className="flex-1 h-px bg-zinc-800" />
                      </div>
                      <button
                        type="button"
                        onClick={() => setDocPasting(true)}
                        className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-800"
                      >
                        Paste text instead
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-zinc-400 pt-1 border-t border-zinc-800">
                    When provided, tests are generated against your documented features and user flows
                    rather than relying solely on site crawling.
                  </p>
                </div>
              )}
            </div>

            {/* Existing sessions */}
            {existingSessions.length > 0 && (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-3">
                <p className="text-xs font-medium text-violet-400 flex items-center gap-1.5">
                  <RefreshCw className="h-3 w-3" />
                  {existingSessions.length} existing session
                  {existingSessions.length !== 1 ? 's' : ''} for this URL
                </p>
                <div className="space-y-1.5">
                  {existingSessions.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => router.push(`/session/${s.id}`)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500/40 hover:bg-zinc-800 transition-colors group text-left"
                    >
                      <span className="text-xs text-zinc-300 font-mono">
                        {s.id.slice(0, 8)}
                        <span className="mx-1.5 text-zinc-400">·</span>
                        <span className={s.status === 'idle' ? 'text-zinc-400' : 'text-violet-400'}>
                          {s.status}
                        </span>
                        <span className="mx-1.5 text-zinc-400">·</span>
                        <span className="text-zinc-400">{timeAgo(s.createdAt)}</span>
                        {(s.testFiles?.length ?? 0) > 0 && (
                          <span className="mx-1.5 text-zinc-400">
                            · {s.testFiles.length} test file(s)
                          </span>
                        )}
                      </span>
                      <ArrowRight className="h-3 w-3 text-zinc-400 group-hover:text-violet-400 transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-400">
                  Resume an existing session or click "Run TestPilot" to start fresh.
                </p>
              </div>
            )}

            {launchError && (
              <p className="text-sm text-red-400 px-1">{launchError}</p>
            )}

            {/* Launch button — shown below cards on mobile */}
            <div className="lg:hidden pt-1">
              <Button className="w-full" size="lg" onClick={launch} disabled={launching || importUrlMismatch} title={importUrlMismatch ? 'Fix the project URL mismatch before running' : undefined}>
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {launching ? 'Launching…' : 'Run TestPilot'}
              </Button>
            </div>
          </div>

          {/* ── Right: Context / Status sidebar ──────────────────────────── */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden lg:sticky lg:top-6">

              {/* Sidebar header */}
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">Context</h2>
                {savedAt && (
                  <span className="text-[10px] text-zinc-400">Saved {timeAgo(savedAt)}</span>
                )}
              </div>

              <div className="p-4 space-y-3">
                {/* Deep crawl status banner */}
                {deepCrawlEnabled ? (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-medium text-violet-300 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Deep Crawl Active
                    </p>
                    <p className="text-xs text-zinc-400">
                      After login, TestPilot will crawl up to 50 pages of the authenticated app
                      and compare them against your documentation.
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-1">
                      Override with <code>DEEP_CRAWL_MAX_PAGES</code> in .env.local
                    </p>
                  </div>
                ) : hasAuthForm || authFallbackStage === 'manual' ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                    <p className="text-xs text-amber-300 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" />
                      {authFallbackStage === 'manual'
                        ? 'Enter credentials to enable authenticated testing'
                        : 'Fill in credentials to enable deep crawl'}
                    </p>
                  </div>
                ) : storedContext ? (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                    <p className="text-xs text-emerald-300 flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      Credentials saved
                    </p>
                  </div>
                ) : null}

                {/* Saved context summary (when auth fields shown inline above, just show summary here) */}
                {hasContext && (hasAuthForm || authFallbackStage === 'manual') ? (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-400">
                      Credentials for <span className="text-zinc-300 break-all">{url}</span>
                    </p>
                    {hasFilledFields ? (
                      groupFieldsByFormLabel(fields.filter(f => f.value)).map(({ groupLabel, groupFields }) => (
                        <div key={groupLabel || '__all__'} className="space-y-1">
                          {groupLabel && (
                            <div className="flex items-center gap-2 pt-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                {groupLabel}
                              </span>
                              <div className="flex-1 h-px bg-zinc-800" />
                            </div>
                          )}
                          {groupFields.map(f => (
                            <div key={f.key} className="flex items-center gap-2 text-xs">
                              <span className="text-zinc-400 w-24 truncate shrink-0">{displayLabel(f.label)}</span>
                              <span className="text-zinc-400 font-mono">
                                {f.sensitive ? '••••••••' : f.value.slice(0, 20)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-400">No values entered yet.</p>
                    )}
                  </div>
                ) : hasContext && !hasAuthForm ? (
                  /* Non-auth stored context — show editable fields grouped by form */
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-400">
                      Context for <span className="text-zinc-300">{url}</span>
                    </p>
                    <div className="space-y-4">
                      {groupFieldsByFormLabel(fields).map(({ groupLabel, groupFields }) => (
                        <div key={groupLabel || '__all__'} className="space-y-2">
                          {/* Section header — only shown when there are multiple form groups */}
                          {groupLabel && (
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                {groupLabel}
                              </span>
                              <div className="flex-1 h-px bg-zinc-700/60" />
                            </div>
                          )}
                          {groupFields.map(f => {
                            const idx = fields.findIndex(x => x.key === f.key);
                            return (
                              <FieldInput
                                key={f.key}
                                field={f}
                                displayLabel={displayLabel(f.label)}
                                showValue={showValues[f.key] ?? false}
                                onToggleShow={() => setShowValues(v => ({ ...v, [f.key]: !v[f.key] }))}
                                onChange={val => {
                                  const updated = [...fields];
                                  updated[idx] = { ...f, value: val };
                                  setFields(updated);
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="pt-1 border-t border-zinc-800 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={saveContext}
                        disabled={!hasFilledFields}
                        className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors flex items-center gap-1"
                      >
                        <Check className="h-3 w-3" /> Save context
                      </button>
                      {storedContext && (
                        <span className="text-[10px] text-zinc-400">Last saved {timeAgo(storedContext.updatedAt)}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-400">
                      {detectLoading
                        ? 'Scanning for forms…'
                        : 'No credentials saved for this URL.'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      If a login form is detected, credentials entered here will be
                      used to authenticate before crawling.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Page export (Suspense boundary required for useSearchParams) ──────────────

export default function PreparePage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center">
          <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      }
    >
      <PrepareContent />
    </Suspense>
  );
}
