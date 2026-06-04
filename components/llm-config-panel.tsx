'use client';

/**
 * LLM Config Panel — floating settings panel with two tabs:
 *   1. "AI Model"      — provider / model / API key (calls /api/llm-config)
 *   2. "App Settings"  — MAX_PAGES, DEEP_CRAWL_MAX_PAGES, FIGMA_TOKEN,
 *                        AUTO_SELF_HEAL  (calls /api/app-settings)
 *
 * Lives in the bottom-right corner of every page (rendered from layout.tsx).
 */

import { useState, useEffect, useRef } from 'react';
import { PROVIDERS } from '@/lib/pilot/providers';
import type { ProviderDef } from '@/lib/pilot/providers';
import { useTheme } from '@/components/theme-provider';

// ── tiny icon components ───────────────────────────────────────────────────────

function GearIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function EyeIcon({ show }: { show: boolean }) {
  return show ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

// ── types ──────────────────────────────────────────────────────────────────────

interface StoredLlmConfig {
  provider: string;
  model: string;
  apiKeyMasked?: string;
  baseUrl?: string;
}

interface AppSettingsData {
  maxPages: number;
  deepCrawlMaxPages: number;
  figmaTokenSet: boolean;
  figmaTokenMasked?: string;
  figmaTokenFromEnv?: boolean;
  autoSelfHeal: boolean;
}

// ── shared input styles ────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500 focus:outline-none';

// ── main component ─────────────────────────────────────────────────────────────

export default function LlmConfigPanel() {
  const [open, setOpen]     = useState(false);
  const [tab, setTab]       = useState<'model' | 'settings'>('model');
  const panelRef            = useRef<HTMLDivElement>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  // ── AI Model tab state ─────────────────────────────────────────────────────
  const [stored, setStored]       = useState<StoredLlmConfig | null>(null);
  const [provider, setProvider]   = useState('anthropic');
  const [model, setModel]         = useState('claude-sonnet-4-6');
  const [apiKey, setApiKey]       = useState('');
  const [baseUrl, setBaseUrl]     = useState('');
  const [showKey, setShowKey]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [testing, setTesting]     = useState(false);
  const [testMsg, setTestMsg]     = useState<{ ok: boolean; text: string; hint?: string } | null>(null);

  // ── App Settings tab state ─────────────────────────────────────────────────
  const [appSettings, setAppSettings]         = useState<AppSettingsData | null>(null);
  const [maxPages, setMaxPages]               = useState('10');
  const [deepCrawlMaxPages, setDeepCrawl]     = useState('50');
  const [figmaToken, setFigmaToken]           = useState('');
  const [showFigma, setShowFigma]             = useState(false);
  const [autoSelfHeal, setAutoSelfHeal]       = useState(false);
  const [appSaving, setAppSaving]             = useState(false);
  const [appSaveMsg, setAppSaveMsg]           = useState('');

  // Load configs on mount
  useEffect(() => {
    fetch('/api/llm-config')
      .then(r => r.json())
      .then((cfg: StoredLlmConfig) => {
        setStored(cfg);
        setProvider(cfg.provider ?? 'anthropic');
        setModel(cfg.model ?? 'claude-sonnet-4-6');
        setBaseUrl(cfg.baseUrl ?? '');
      })
      .catch(() => {});

    fetch('/api/app-settings')
      .then(r => r.json())
      .then((s: AppSettingsData) => {
        setAppSettings(s);
        setMaxPages(String(s.maxPages ?? 10));
        setDeepCrawl(String(s.deepCrawlMaxPages ?? 50));
        setAutoSelfHeal(s.autoSelfHeal ?? false);
      })
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const providerDef: ProviderDef | undefined = PROVIDERS.find(p => p.id === provider);

  function handleProviderChange(pid: string) {
    const def = PROVIDERS.find(p => p.id === pid);
    setProvider(pid);
    setModel(def?.defaultModel ?? '');
    setBaseUrl(def?.defaultBaseUrl ?? '');
    setApiKey('');
  }

  async function handleSaveLlm() {
    setSaving(true);
    setSaveMsg('');
    try {
      // Only include apiKey when the user actually typed a new one.
      // Omitting it tells the server to keep the existing stored key.
      const payload: Record<string, string> = { provider, model, baseUrl };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setSaveMsg(`Error: ${err.error ?? 'save failed'}`);
      } else {
        setSaveMsg('Saved ✓');
        const updated: StoredLlmConfig = await fetch('/api/llm-config').then(r => r.json());
        setStored(updated);
        setApiKey('');
        setTimeout(() => { setSaveMsg(''); setOpen(false); }, 1200);
      }
    } catch (e) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    // Never send the API key over the wire — the server always uses the stored key.
    // If the user has typed a new key that hasn't been saved yet, ask them to save first.
    if (apiKey.trim()) {
      setTestMsg({ ok: false, text: 'Save your settings first, then test the connection.' });
      return;
    }
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/llm-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // apiKey intentionally omitted — server uses the stored key
        body: JSON.stringify({ provider, model, baseUrl }),
      });
      const data = await res.json() as { ok: boolean; error?: string; hint?: string; model?: string };
      if (data.ok) {
        setTestMsg({ ok: true, text: `✓ Connected — model "${data.model}" is responding` });
      } else {
        setTestMsg({ ok: false, text: data.error ?? 'Connection failed', hint: data.hint });
      }
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveApp() {
    setAppSaving(true);
    setAppSaveMsg('');
    try {
      const body: Record<string, unknown> = {
        maxPages: Number(maxPages),
        deepCrawlMaxPages: Number(deepCrawlMaxPages),
        autoSelfHeal,
      };
      // Only send figmaToken if the user typed something
      if (figmaToken.trim()) body.figmaToken = figmaToken.trim();

      const res = await fetch('/api/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setAppSaveMsg(`Error: ${err.error ?? 'save failed'}`);
      } else {
        setAppSaveMsg('Saved ✓');
        const updated: AppSettingsData = await fetch('/api/app-settings').then(r => r.json());
        setAppSettings(updated);
        setFigmaToken('');
        setTimeout(() => { setAppSaveMsg(''); setOpen(false); }, 1200);
      }
    } catch (e) {
      setAppSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAppSaving(false);
    }
  }

  const cloudProviders = PROVIDERS.filter(p => !p.local);
  const localProviders = PROVIDERS.filter(p => p.local);

  const activeLabel = stored
    ? `${PROVIDERS.find(p => p.id === stored.provider)?.name ?? stored.provider} / ${stored.model}`
    : 'Settings';

  return (
    <div ref={panelRef} className="fixed bottom-4 right-2 sm:right-4 z-50 flex flex-col-reverse items-end gap-2">
      {/* Theme toggle button */}
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/95 p-2 text-zinc-400 shadow-xl backdrop-blur transition-all hover:border-zinc-500 hover:text-zinc-100"
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>

      {/* Gear / settings trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        title={activeLabel}
        className="group flex items-center rounded-full border border-zinc-700 bg-zinc-900/95 px-2.5 py-2 text-zinc-300 shadow-xl backdrop-blur transition-all hover:border-zinc-500 hover:text-zinc-50"
      >
        <GearIcon />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs transition-all duration-300 ease-in-out group-hover:max-w-[180px] group-hover:ml-2">
          {activeLabel}
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div className="w-[calc(100vw-1rem)] max-w-[360px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden mb-1">
          {/* Tab bar */}
          <div className="flex border-b border-zinc-800">
            <button
              onClick={() => setTab('model')}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === 'model'
                  ? 'text-violet-300 border-b-2 border-violet-500 -mb-px bg-zinc-800/40'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              AI Model
            </button>
            <button
              onClick={() => setTab('settings')}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === 'settings'
                  ? 'text-violet-300 border-b-2 border-violet-500 -mb-px bg-zinc-800/40'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              App Settings
            </button>
          </div>

          {/* ── AI Model tab ── */}
          {tab === 'model' && (
            <div className="px-4 py-4 space-y-4">
              {/* Provider grid */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">Provider</label>
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Cloud</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {cloudProviders.map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleProviderChange(p.id)}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                          provider === p.id
                            ? 'border-violet-500 bg-violet-500/15 text-violet-300'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mt-2 mb-1">Local</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {localProviders.map(p => (
                      <button
                        key={p.id}
                        onClick={() => handleProviderChange(p.id)}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                          provider === p.id
                            ? 'border-violet-500 bg-violet-500/15 text-violet-300'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Model</label>
                {providerDef?.customModel ? (
                  <input
                    type="text"
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    placeholder={providerDef.defaultModel}
                    className={inputCls}
                  />
                ) : (
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className={`${inputCls} appearance-none cursor-pointer`}
                  >
                    {(providerDef?.models ?? []).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* API Key */}
              {providerDef?.apiKeyRequired && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    API Key
                    {stored?.apiKeyMasked && (
                      <span className="ml-2 text-[10px] font-mono text-zinc-600">
                        current: {stored.apiKeyMasked}
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={
                        stored?.apiKeyMasked
                          ? 'Leave blank to keep existing key'
                          : (providerDef?.apiKeyPlaceholder ?? 'Enter API key…')
                      }
                      className={`${inputCls} pr-9 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(s => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      <EyeIcon show={showKey} />
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    Falls back to the <code className="text-zinc-500">{providerDef?.apiKeyEnvVar}</code> env var if left blank.
                  </p>
                </div>
              )}

              {/* Base URL */}
              {providerDef?.customBaseUrl && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Base URL</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    placeholder={providerDef.defaultBaseUrl ?? 'http://localhost:11434/v1'}
                    className={`${inputCls} font-mono`}
                  />
                </div>
              )}

              {/* Test result */}
              {testMsg && (
                <div className={`rounded-lg px-3 py-2 text-xs ${
                  testMsg.ok
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}>
                  <p>{testMsg.text}</p>
                  {testMsg.hint && <p className="mt-0.5 text-zinc-400">{testMsg.hint}</p>}
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-between gap-2 pt-1">
                {saveMsg ? (
                  <span className={`text-xs ${saveMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                    {saveMsg}
                  </span>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testing || saving || !provider || !model}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {testing ? 'Testing…' : 'Test Connection'}
                  </button>
                  <button
                    onClick={handleSaveLlm}
                    disabled={saving || !provider || !model}
                    className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── App Settings tab ── */}
          {tab === 'settings' && (
            <div className="px-4 py-4 space-y-4">
              {/* Crawl limits */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Crawl Limits</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Max Pages
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={maxPages}
                      onChange={e => setMaxPages(e.target.value)}
                      className={inputCls}
                    />
                    <p className="mt-1 text-[10px] text-zinc-600">Default: 10</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Auth Crawl Max
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={deepCrawlMaxPages}
                      onChange={e => setDeepCrawl(e.target.value)}
                      className={inputCls}
                    />
                    <p className="mt-1 text-[10px] text-zinc-600">Default: 50</p>
                  </div>
                </div>
              </div>

              {/* Figma token */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Figma Integration</p>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Personal Access Token
                  {appSettings?.figmaTokenMasked && (
                    <span className="ml-2 text-[10px] font-mono text-zinc-600">
                      current: {appSettings.figmaTokenMasked}
                    </span>
                  )}
                  {!appSettings?.figmaTokenMasked && appSettings?.figmaTokenFromEnv && (
                    <span className="ml-2 text-[10px] text-zinc-600">(set via env)</span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showFigma ? 'text' : 'password'}
                    value={figmaToken}
                    onChange={e => setFigmaToken(e.target.value)}
                    placeholder={
                      appSettings?.figmaTokenSet
                        ? 'Leave blank to keep existing token'
                        : 'figd_…'
                    }
                    className={`${inputCls} pr-9 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowFigma(s => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <EyeIcon show={showFigma} />
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Enables Figma visual comparison. Generate at figma.com → Settings → Security.
                </p>
              </div>

              {/* Auto self-heal toggle */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Self-Healing</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-zinc-300">Auto Self-Heal</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoSelfHeal}
                    onClick={() => setAutoSelfHeal(v => !v)}
                    className={`relative flex-shrink-0 h-5 w-9 rounded-full transition-colors ${
                      autoSelfHeal
                        ? 'bg-violet-600'
                        : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        autoSelfHeal ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">
                  {autoSelfHeal
                    ? 'ON — self-healing runs automatically after every failing run.'
                    : 'OFF — click Self-Heal manually to fix failures.'}
                </p>
              </div>

              {/* Save button */}
              <div className="flex items-center justify-between gap-2 pt-1">
                {appSaveMsg ? (
                  <span className={`text-xs ${appSaveMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                    {appSaveMsg}
                  </span>
                ) : <span />}
                <button
                  onClick={handleSaveApp}
                  disabled={appSaving}
                  className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {appSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
