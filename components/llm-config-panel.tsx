'use client';

/**
 * LLM Config Panel — floating settings panel for selecting the AI provider.
 *
 * Lives in the top-right corner of every page (rendered from layout.tsx).
 * Opens/closes via a small gear icon button. Saves to /api/llm-config on Submit.
 */

import { useState, useEffect, useRef } from 'react';
import { PROVIDERS } from '@/lib/pilot/providers';
import type { ProviderDef } from '@/lib/pilot/providers';

// ── tiny icon components (inline SVG to avoid extra deps) ─────────────────────

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

// ── main component ─────────────────────────────────────────────────────────────

interface StoredConfig {
  provider: string;
  model: string;
  apiKeyMasked?: string;
  baseUrl?: string;
}

export default function LlmConfigPanel() {
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<StoredConfig | null>(null);

  // form state
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel]       = useState('claude-sonnet-4-6');
  const [apiKey, setApiKey]     = useState('');
  const [baseUrl, setBaseUrl]   = useState('');
  const [showKey, setShowKey]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState('');
  const [testing, setTesting]   = useState(false);
  const [testMsg, setTestMsg]   = useState<{ ok: boolean; text: string; hint?: string } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  // Load stored config on mount
  useEffect(() => {
    fetch('/api/llm-config')
      .then(r => r.json())
      .then((cfg: StoredConfig) => {
        setStored(cfg);
        setProvider(cfg.provider ?? 'anthropic');
        setModel(cfg.model ?? 'claude-sonnet-4-6');
        setBaseUrl(cfg.baseUrl ?? '');
        // apiKey is never sent back — leave the field blank
      })
      .catch(() => {/* silently ignore */});
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

  // When provider changes, reset model to the provider's default
  function handleProviderChange(pid: string) {
    const def = PROVIDERS.find(p => p.id === pid);
    setProvider(pid);
    setModel(def?.defaultModel ?? '');
    setBaseUrl(def?.defaultBaseUrl ?? '');
    setApiKey('');
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, apiKey, baseUrl }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        setSaveMsg(`Error: ${err.error ?? 'save failed'}`);
      } else {
        setSaveMsg('Saved ✓');
        // Refresh masked config
        const updated: StoredConfig = await fetch('/api/llm-config').then(r => r.json());
        setStored(updated);
        setApiKey(''); // clear input — key is now stored
        setTimeout(() => { setSaveMsg(''); setOpen(false); }, 1200);
      }
    } catch (e) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/llm-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, apiKey, baseUrl }),
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

  // Group providers for display
  const cloudProviders = PROVIDERS.filter(p => !p.local);
  const localProviders = PROVIDERS.filter(p => p.local);

  const activeLabel = stored
    ? `${PROVIDERS.find(p => p.id === stored.provider)?.name ?? stored.provider} / ${stored.model}`
    : 'LLM Settings';

  return (
    <div ref={panelRef} className="fixed bottom-4 right-4 z-50 flex flex-col-reverse items-end gap-2">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="LLM Settings"
        className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs text-zinc-300 shadow-xl backdrop-blur transition hover:border-zinc-500 hover:text-white"
      >
        <GearIcon />
        <span className="max-w-[160px] truncate">{activeLabel}</span>
      </button>

      {/* Panel — opens upward above the button */}
      {open && (
        <div className="w-[360px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden mb-1">
          {/* Header */}
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-100">AI Provider Settings</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Choose the model used for test generation and fixing.
            </p>
          </div>

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
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                />
              ) : (
                <select
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none appearance-none cursor-pointer"
                >
                  {(providerDef?.models ?? []).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>

            {/* API Key (only if required) */}
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
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 pr-9 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500 focus:outline-none font-mono"
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

            {/* Base URL (only if customizable) */}
            {providerDef?.customBaseUrl && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder={providerDef.defaultBaseUrl ?? 'http://localhost:11434/v1'}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:border-violet-500 focus:outline-none font-mono"
                />
              </div>
            )}

            {/* Test result message */}
            {testMsg && (
              <div className={`rounded-lg px-3 py-2 text-xs ${
                testMsg.ok
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border border-red-500/30 text-red-400'
              }`}>
                <p>{testMsg.text}</p>
                {testMsg.hint && (
                  <p className="mt-0.5 text-zinc-400">{testMsg.hint}</p>
                )}
              </div>
            )}

            {/* Save / Test buttons */}
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
                  className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {testing ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !provider || !model}
                  className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
