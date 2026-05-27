'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap, Globe, Loader2, Layers, ChevronDown, ChevronRight,
  Search, Eye, EyeOff, Check, RefreshCw, ArrowRight, X,
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

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return '';
  if (!u.startsWith('http')) u = `https://${u}`;
  return u;
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── FieldInput sub-component ──────────────────────────────────────────────────

interface FieldInputProps {
  field: ContextField;
  displayLabel: string;
  showValue: boolean;
  onToggleShow: () => void;
  onChange: (val: string) => void;
}

function FieldInput({ field, displayLabel, showValue, onToggleShow, onChange }: FieldInputProps) {
  const isSensitive = field.sensitive;
  const inputType = isSensitive && !showValue ? 'password' : 'text';

  return (
    <div className="flex items-center gap-2">
      <label className="w-32 shrink-0 text-xs text-zinc-500 truncate" title={displayLabel}>
        {displayLabel}
      </label>
      <div className="relative flex-1">
        <input
          type={inputType}
          value={field.value}
          onChange={e => onChange(e.target.value)}
          placeholder={isSensitive ? '••••••••' : `Enter ${displayLabel.toLowerCase()}`}
          className="w-full h-8 px-2.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500 text-xs pr-8"
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

// ── Component ─────────────────────────────────────────────────────────────────

export function UrlInputForm() {
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [figmaFileUrl, setFigmaFileUrl] = useState('');
  const [showFigma, setShowFigma] = useState(false);

  // Context state
  const [storedContext, setStoredContext] = useState<StoredContext | null>(null);
  const [fields, setFields] = useState<ContextField[]>([]);
  const [groups, setGroups] = useState<DetectedFormGroup[]>([]);
  const [showContext, setShowContext] = useState(false);
  const [detectLoading, setDetectLoading] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Session reuse
  const [existingSessions, setExistingSessions] = useState<Session[]>([]);

  // Submit
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Effects: look up context + sessions on URL change ──────────────────
  const lookupUrl = useCallback(async (normalized: string) => {
    if (!normalized) {
      setStoredContext(null);
      setFields([]);
      setExistingSessions([]);
      return;
    }

    // Fetch existing context
    const [ctxRes, sessRes] = await Promise.all([
      fetch(`/api/contexts?url=${encodeURIComponent(normalized)}`).catch(() => null),
      fetch(`/api/sessions?url=${encodeURIComponent(normalized)}`).catch(() => null),
    ]);

    if (ctxRes?.ok) {
      const ctx = await ctxRes.json() as StoredContext;
      setStoredContext(ctx);
      setFields(ctx.fields.map(f => ({ ...f }))); // clone for editing
      setShowContext(true);
    } else {
      setStoredContext(null);
      setFields([]);
      setShowContext(false);
    }

    if (sessRes?.ok) {
      setExistingSessions((await sessRes.json() as Session[]).slice(0, 3));
    } else {
      setExistingSessions([]);
    }
  }, []);

  useEffect(() => {
    const normalized = normalizeUrl(url);
    if (!normalized) { setStoredContext(null); setFields([]); setExistingSessions([]); return; }
    const t = setTimeout(() => lookupUrl(normalized), 600);
    return () => clearTimeout(t);
  }, [url, lookupUrl]);

  // ── Form field detection ───────────────────────────────────────────────
  async function detectForms() {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    setDetectLoading(true);
    setDetectError('');
    setGroups([]);
    try {
      const res = await fetch('/api/contexts/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      const data = await res.json() as {
        groups?: DetectedFormGroup[];
        fields?: ContextField[];
        error?: string;
      };
      if (!res.ok || data.error) {
        setDetectError(data.error ?? 'Detection failed');
      } else if ((data.fields ?? []).length === 0) {
        setDetectError('No form fields detected on this page or its linked pages.');
      } else {
        setGroups(data.groups ?? []);
        setFields(data.fields!);
        setShowContext(true);
      }
    } catch {
      setDetectError('Network error during detection');
    } finally {
      setDetectLoading(false);
    }
  }

  // ── Save context ───────────────────────────────────────────────────────
  async function saveContext() {
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    await fetch('/api/contexts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: normalized, fields }),
    });
    setStoredContext({ urlKey: normalized, url: normalized, fields, updatedAt: Date.now() });
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeUrl(url);
    if (!normalized) return;
    setError('');
    setLoading(true);

    // Save context if fields have values
    if (fields.some(f => f.value)) {
      await saveContext();
    }

    try {
      const body: Record<string, string> = { url: normalized };
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
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setLoading(false);
    }
  }

  const hasFilledFields = fields.some(f => f.value);
  const normalized = normalizeUrl(url);

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto space-y-3">

      {/* ── URL input ────────────────────────────────────────────────── */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            className="w-full h-12 pl-10 pr-4 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
            disabled={loading}
          />
        </div>
        <Button type="submit" size="lg" disabled={loading || !url.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {loading ? 'Starting…' : 'Run TestPilot'}
        </Button>
      </div>

      {/* ── Existing sessions for this URL ───────────────────────────── */}
      {existingSessions.length > 0 && normalized && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
          <p className="text-xs text-violet-400 font-medium flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3" />
            Existing session{existingSessions.length > 1 ? 's' : ''} found for this URL
          </p>
          <div className="space-y-1">
            {existingSessions.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => router.push(`/session/${s.id}`)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-violet-500/40 hover:bg-zinc-800 transition-colors group text-left"
              >
                <span className="text-xs text-zinc-300 font-mono">
                  {s.id.slice(0, 8)}
                  <span className="mx-1.5 text-zinc-600">·</span>
                  <span className={`${s.status === 'idle' ? 'text-zinc-500' : 'text-violet-400'}`}>{s.status}</span>
                  <span className="mx-1.5 text-zinc-600">·</span>
                  <span className="text-zinc-600">{timeAgo(s.createdAt)}</span>
                  {(s.testFiles?.length ?? 0) > 0 && (
                    <span className="mx-1.5 text-zinc-600">· {s.testFiles.length} test file(s)</span>
                  )}
                </span>
                <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-violet-400 transition-colors shrink-0" />
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600">↑ Resume an existing session, or click "Run TestPilot" to start fresh.</p>
        </div>
      )}

      {/* ── Context section ──────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Header row */}
        <div className="flex items-center gap-3 px-1">
          {/* Show/hide toggle */}
          {fields.length > 0 && (
            <button
              type="button"
              onClick={() => setShowContext(v => !v)}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {showContext ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {storedContext
                ? <><Check className="h-3 w-3 text-emerald-400" /> Context saved ({fields.length} field{fields.length !== 1 ? 's' : ''})</>
                : `Form context (${fields.length} field${fields.length !== 1 ? 's' : ''})`
              }
            </button>
          )}

          {/* Detect button */}
          {normalized && (
            <button
              type="button"
              onClick={detectForms}
              disabled={detectLoading || !url.trim()}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
            >
              {detectLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Search className="h-3.5 w-3.5" />}
              {detectLoading ? 'Detecting forms…' : fields.length > 0 ? 'Re-detect' : 'Detect forms'}
            </button>
          )}
        </div>

        {detectError && (
          <p className="text-xs text-amber-400 px-1 flex items-center gap-1.5">
            <X className="h-3 w-3 shrink-0" /> {detectError}
          </p>
        )}

        {/* Field inputs — grouped by page when detection found multiple forms */}
        {showContext && fields.length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-3">
            <p className="text-xs text-zinc-500">
              Values stored for <span className="text-zinc-300">{normalizeUrl(url)}</span> and injected during test generation and execution.
            </p>

            {/* Grouped view (when detection returned form groups) */}
            {groups.length > 1 ? (
              <div className="space-y-3">
                {groups.map((group) => {
                  const groupKey = group.formLabel;
                  const isCollapsed = collapsedGroups[groupKey];
                  // Find the matching flat fields for this group (by formLabel prefix)
                  const prefix = group.formLabel.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_';
                  const groupFields = fields.filter(f => f.key.startsWith(prefix));

                  return (
                    <div key={groupKey} className="border border-zinc-700/50 rounded-lg overflow-hidden">
                      {/* Group header */}
                      <button
                        type="button"
                        onClick={() => setCollapsedGroups(v => ({ ...v, [groupKey]: !v[groupKey] }))}
                        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 transition-colors text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-xs font-medium text-zinc-200">{group.formLabel}</span>
                          <span className="text-[10px] text-zinc-600 font-mono truncate max-w-48">{group.pageUrl}</span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-zinc-500">{group.fields.length} field{group.fields.length !== 1 ? 's' : ''}</span>
                          {isCollapsed ? <ChevronRight className="h-3 w-3 text-zinc-600" /> : <ChevronDown className="h-3 w-3 text-zinc-600" />}
                        </span>
                      </button>

                      {/* Group fields */}
                      {!isCollapsed && (
                        <div className="p-2.5 space-y-2">
                          {groupFields.map((f) => {
                            const idx = fields.findIndex(x => x.key === f.key);
                            const displayLabel = f.label.replace(/^[^—]*—\s*/, ''); // strip "FormLabel — " prefix
                            return (
                              <FieldInput
                                key={f.key}
                                field={f}
                                displayLabel={displayLabel}
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
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Flat view (single page or stored context) */
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    displayLabel={f.label}
                    showValue={showValues[f.key] ?? false}
                    onToggleShow={() => setShowValues(v => ({ ...v, [f.key]: !v[f.key] }))}
                    onChange={val => {
                      const updated = [...fields];
                      updated[i] = { ...f, value: val };
                      setFields(updated);
                    }}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
              <button
                type="button"
                onClick={saveContext}
                disabled={!hasFilledFields}
                className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
              >
                <Check className="h-3 w-3 inline mr-1" />
                Save context
              </button>
              {storedContext && (
                <span className="text-xs text-zinc-600">Last saved {timeAgo(storedContext.updatedAt)}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Optional Figma toggle ─────────────────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowFigma(v => !v)}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-1"
        >
          {showFigma ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Layers className="h-3.5 w-3.5" />
          Figma verification <span className="text-zinc-600">(optional)</span>
        </button>
        {showFigma && (
          <div className="mt-2 relative">
            <Layers className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              value={figmaFileUrl}
              onChange={e => setFigmaFileUrl(e.target.value)}
              placeholder="https://www.figma.com/design/XXXXX/My-Design"
              className="w-full h-10 pl-10 pr-4 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
              disabled={loading}
            />
            <p className="mt-1.5 text-xs text-zinc-600 px-1">
              Requires <code className="text-zinc-500">FIGMA_TOKEN</code> in <code className="text-zinc-500">.env.local</code>
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
