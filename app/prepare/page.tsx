'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Zap, ArrowLeft, Globe, Search, Loader2, Check, RefreshCw, ArrowRight,
  ChevronDown, ChevronRight, Eye, EyeOff, X, Layers, Edit2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ContextField } from '@/lib/url-context-store';
import type { DetectedFormGroup } from '@/lib/detect-form-fields';
import type { Session } from '@/types/session';

// ── Types ────────────────────────────────────────────────────────────────────

interface StoredContext {
  urlKey: string;
  url: string;
  fields: ContextField[];
  updatedAt: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
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
      <label className="w-28 shrink-0 text-xs text-zinc-500 truncate" title={displayLabel}>
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
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
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

  // Figma
  const [figmaFileUrl, setFigmaFileUrl] = useState('');
  const [showFigma, setShowFigma] = useState(false);

  // Sessions
  const [existingSessions, setExistingSessions] = useState<Session[]>([]);

  // Submit
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');

  // ── Redirect if no URL ────────────────────────────────────────────────────
  useEffect(() => {
    if (!rawUrl) router.replace('/');
  }, [rawUrl, router]);

  // ── Load stored context + sessions on mount ───────────────────────────────
  const loadData = useCallback(async (targetUrl: string) => {
    const [ctxRes, sessRes] = await Promise.all([
      fetch(`/api/contexts?url=${encodeURIComponent(targetUrl)}`).catch(() => null),
      fetch(`/api/sessions?url=${encodeURIComponent(targetUrl)}`).catch(() => null),
    ]);
    if (ctxRes?.ok) {
      const ctx = await ctxRes.json() as StoredContext;
      setStoredContext(ctx);
      setFields(ctx.fields.map(f => ({ ...f })));
      setSavedAt(ctx.updatedAt);
    }
    if (sessRes?.ok) {
      setExistingSessions((await sessRes.json() as Session[]).slice(0, 3));
    }
  }, []);

  useEffect(() => {
    if (url) loadData(url);
  }, [url, loadData]);

  // ── Detect forms ──────────────────────────────────────────────────────────
  async function detectForms() {
    if (!url) return;
    setDetectLoading(true);
    setDetectError('');
    setGroups([]);
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
      };
      if (!res.ok || data.error) {
        setDetectError(data.error ?? 'Detection failed');
      } else if (!data.fields?.length) {
        setDetectError('No form fields detected on this page or its linked pages.');
      } else {
        setGroups(data.groups ?? []);
        // Merge detected fields with any already-saved values
        setFields(prev => (data.fields ?? []).map(f => {
          const stored = prev.find(s => s.key === f.key);
          return stored?.value ? { ...f, value: stored.value } : f;
        }));
      }
    } catch {
      setDetectError('Network error during detection');
    } finally {
      setDetectLoading(false);
    }
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
  async function launch() {
    if (!url) return;
    setLaunching(true);
    setLaunchError('');
    if (fields.some(f => f.value)) await saveContext();
    try {
      const body: Record<string, string> = { url };
      if (figmaFileUrl.trim()) body.figmaFileUrl = figmaFileUrl.trim();
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to create session');
      const session = await res.json() as Session;
      router.push(`/session/${session.id}`);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Something went wrong');
      setLaunching(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const hasContext = fields.length > 0;
  const hasFilledFields = fields.some(f => f.value);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex flex-col min-h-0">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-800 px-6 py-3.5 flex items-center gap-4 shrink-0">
        <button
          onClick={() => router.push('/')}
          className="text-zinc-500 hover:text-zinc-100 transition-colors"
          title="Back to home"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <Zap className="h-4 w-4 text-violet-400 shrink-0" />

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
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <p className="text-sm text-zinc-100 truncate">{url}</p>
              <button
                onClick={() => { setUrlDraft(rawUrl); setEditingUrl(true); }}
                className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
                title="Edit URL"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Launch button in header (desktop shortcut) */}
        <Button size="sm" onClick={launch} disabled={launching} className="shrink-0">
          {launching
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Zap className="h-3.5 w-3.5" />}
          {launching ? 'Launching…' : 'Run TestPilot'}
        </Button>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto w-full">

          {/* ── Left: main configuration ─────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Form Detection card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">Form Detection</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Scan the site for login, registration, and other forms. Fill in values in the
                    Context panel to enable authenticated testing.
                  </p>
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
                    : <Search className="h-3.5 w-3.5" />}
                  {detectLoading ? 'Scanning…' : groups.length > 0 ? 'Re-detect' : 'Detect Forms'}
                </Button>
              </div>

              {/* Detect error */}
              {detectError && (
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                  <X className="h-3 w-3 shrink-0" /> {detectError}
                </p>
              )}

              {/* Detection results */}
              {groups.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <Check className="h-3 w-3" />
                    {groups.length} form{groups.length !== 1 ? 's' : ''} found across{' '}
                    {groups.length} page{groups.length !== 1 ? 's' : ''}
                  </p>
                  {groups.map(g => (
                    <div
                      key={g.formLabel}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700/50"
                    >
                      <span className="text-xs font-medium text-zinc-200">{g.formLabel}</span>
                      <span className="text-[10px] text-zinc-600 font-mono truncate flex-1">
                        {g.pageUrl}
                      </span>
                      <span className="text-[10px] text-zinc-500 shrink-0">
                        {g.fields.length} field{g.fields.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                  <p className="text-xs text-zinc-600 pt-1">
                    Fill in credentials in the Context panel →
                  </p>
                </div>
              ) : !detectLoading && !detectError ? (
                <p className="text-xs text-zinc-600">
                  Click "Detect Forms" to discover forms on this site.
                </p>
              ) : null}
            </div>

            {/* Figma Verification card */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowFigma(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/40 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Layers className="h-4 w-4 text-zinc-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">Figma Verification</p>
                    <p className="text-xs text-zinc-500">
                      {figmaFileUrl.trim()
                        ? <span className="text-violet-400 font-mono truncate">{figmaFileUrl}</span>
                        : 'Optional — compare live UI against Figma designs'}
                    </p>
                  </div>
                </div>
                {showFigma
                  ? <ChevronDown className="h-4 w-4 text-zinc-600 shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-zinc-600 shrink-0" />}
              </button>

              {showFigma && (
                <div className="px-5 pb-5 pt-4 border-t border-zinc-800 space-y-2">
                  <div className="relative">
                    <Layers className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      value={figmaFileUrl}
                      onChange={e => setFigmaFileUrl(e.target.value)}
                      placeholder="https://www.figma.com/design/XXXXX/My-Design"
                      className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                    />
                  </div>
                  <p className="text-xs text-zinc-600">
                    Requires <code className="text-zinc-500">FIGMA_TOKEN</code> in{' '}
                    <code className="text-zinc-500">.env.local</code>
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
                        <span className="mx-1.5 text-zinc-600">·</span>
                        <span className={s.status === 'idle' ? 'text-zinc-500' : 'text-violet-400'}>
                          {s.status}
                        </span>
                        <span className="mx-1.5 text-zinc-600">·</span>
                        <span className="text-zinc-600">{timeAgo(s.createdAt)}</span>
                        {(s.testFiles?.length ?? 0) > 0 && (
                          <span className="mx-1.5 text-zinc-600">
                            · {s.testFiles.length} test file(s)
                          </span>
                        )}
                      </span>
                      <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-violet-400 transition-colors shrink-0" />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-600">
                  Resume an existing session or click "Run TestPilot" to start fresh.
                </p>
              </div>
            )}

            {launchError && (
              <p className="text-sm text-red-400 px-1">{launchError}</p>
            )}

            {/* Launch button — shown below cards on mobile */}
            <div className="lg:hidden pt-1">
              <Button className="w-full" size="lg" onClick={launch} disabled={launching}>
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                {launching ? 'Launching…' : 'Run TestPilot'}
              </Button>
            </div>
          </div>

          {/* ── Right: Context sidebar ────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden lg:sticky lg:top-6">

              {/* Sidebar header */}
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-100">Context</h2>
                {savedAt && (
                  <span className="text-[10px] text-zinc-600">
                    Saved {timeAgo(savedAt)}
                  </span>
                )}
              </div>

              {hasContext ? (
                <div className="p-4 space-y-4">
                  <p className="text-xs text-zinc-500">
                    Values injected during test generation and execution for{' '}
                    <span className="text-zinc-300">{url}</span>.
                  </p>

                  {/* Grouped view (multiple form pages detected) */}
                  {groups.length > 1 ? (
                    <div className="space-y-2">
                      {groups.map(group => {
                        const isCollapsed = collapsedGroups[group.formLabel] ?? false;
                        const prefix = group.formLabel.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_';
                        const groupFields = fields.filter(f => f.key.startsWith(prefix));
                        return (
                          <div
                            key={group.formLabel}
                            className="border border-zinc-700/50 rounded-lg overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedGroups(v => ({
                                  ...v,
                                  [group.formLabel]: !v[group.formLabel],
                                }))
                              }
                              className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 transition-colors text-left"
                            >
                              <span className="text-xs font-medium text-zinc-200">
                                {group.formLabel}
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="text-[10px] text-zinc-500">
                                  {group.fields.length} field{group.fields.length !== 1 ? 's' : ''}
                                </span>
                                {isCollapsed
                                  ? <ChevronRight className="h-3 w-3 text-zinc-600" />
                                  : <ChevronDown className="h-3 w-3 text-zinc-600" />}
                              </span>
                            </button>
                            {!isCollapsed && (
                              <div className="p-2.5 space-y-2">
                                {groupFields.map(f => {
                                  const idx = fields.findIndex(x => x.key === f.key);
                                  const label = f.label.replace(/^[^—]*—\s*/, '');
                                  return (
                                    <FieldInput
                                      key={f.key}
                                      field={f}
                                      displayLabel={label}
                                      showValue={showValues[f.key] ?? false}
                                      onToggleShow={() =>
                                        setShowValues(v => ({ ...v, [f.key]: !v[f.key] }))
                                      }
                                      onChange={val => {
                                        const updated = [...fields];
                                        updated[idx] = { ...f, value: val };
                                        setFields(updated);
                                      }}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Flat view for single form or stored context */
                    <div className="space-y-2">
                      {fields.map((f, i) => (
                        <FieldInput
                          key={f.key}
                          field={f}
                          displayLabel={f.label}
                          showValue={showValues[f.key] ?? false}
                          onToggleShow={() =>
                            setShowValues(v => ({ ...v, [f.key]: !v[f.key] }))
                          }
                          onChange={val => {
                            const updated = [...fields];
                            updated[i] = { ...f, value: val };
                            setFields(updated);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={saveContext}
                      disabled={!hasFilledFields}
                      className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors flex items-center gap-1"
                    >
                      <Check className="h-3 w-3" />
                      Save context
                    </button>
                    {storedContext && (
                      <span className="text-[10px] text-zinc-600">
                        Last saved {timeAgo(storedContext.updatedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  <p className="text-xs text-zinc-500">No context saved for this URL.</p>
                  <p className="text-xs text-zinc-600">
                    Click "Detect Forms" in the main panel to discover login, register, and other
                    forms on this site, then fill in your credentials to enable authenticated
                    testing.
                  </p>
                  <button
                    type="button"
                    onClick={detectForms}
                    disabled={detectLoading}
                    className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-40"
                  >
                    {detectLoading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Search className="h-3.5 w-3.5" />}
                    {detectLoading ? 'Scanning…' : 'Detect Forms'}
                  </button>
                </div>
              )}
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
