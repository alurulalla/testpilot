'use client';

import { useEffect, useRef, useState } from 'react';
import { Video, Crosshair, Loader2, Save, X, ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';

interface Action {
  type: string;
  selector?: string;
  value?: string;
  url?: string;
  key?: string;
  assertion?: { kind: string; selector?: string; expected?: string };
}

/** Recorder UI: Browserbase Live View (interactive iframe) + live action list + assert mode. */
export function RecordingPanel({
  sessionId, defaultUrl, onSaved,
}: {
  sessionId: string;
  defaultUrl: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const url = defaultUrl; // recording target is fixed to the session's app — not editable
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assertMode, setAssertMode] = useState(false);
  const [actions, setActions] = useState<Action[]>([]);
  const [viewUrl, setViewUrl] = useState<string>(''); // Browserbase Live View URL (iframe)
  const [title, setTitle] = useState('');
  const [expanded, setExpanded] = useState(false); // maximize the live view

  const esRef = useRef<EventSource | null>(null);

  async function post(body: Record<string, unknown>) {
    const r = await fetch(`/api/sessions/${sessionId}/recording`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => null);
    return r && r.ok ? r.json() : null;
  }

  async function start() {
    setBusy(true); setActions([]);
    const res = await post({ action: 'start', url });
    setBusy(false);
    if (!res?.recordingId) return;
    setRecordingId(res.recordingId);
    setViewUrl(res.viewUrl || '');
    const es = new EventSource(`/api/sessions/${sessionId}/recording/stream?recordingId=${res.recordingId}`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; actions?: Action[] };
        if (msg.type === 'trace' && msg.actions) setActions(msg.actions);
        else if (msg.type === 'ended') es.close();
      } catch { /* ignore malformed */ }
    };
    esRef.current = es;
  }

  async function toggleAssert() {
    const next = !assertMode; setAssertMode(next);
    if (recordingId) await post({ action: 'assert', recordingId, on: next });
  }

  async function stop(save: boolean) {
    if (!recordingId) return;
    setBusy(true);
    esRef.current?.close(); esRef.current = null;
    await post({ action: 'stop', recordingId, save, title: title || undefined, url });
    setBusy(false); setRecordingId(null); setViewUrl(''); setAssertMode(false); setActions([]); setTitle(''); setExpanded(false);
    if (save) onSaved?.();
  }

  useEffect(() => () => { esRef.current?.close(); }, []);

  const recording = !!recordingId;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800/40 transition text-left">
        <Video className="h-4 w-4 text-violet-400 shrink-0" />
        <span className="text-sm font-semibold text-zinc-100 flex-1">Record a Test</span>
        {recording && <span className="flex items-center gap-1 text-[10px] font-semibold text-red-400"><span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" /> REC</span>}
        {open ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-zinc-800 pt-3 space-y-3">
          {!recording ? (
            <div className="flex items-center gap-2">
              {/* URL is fixed to the session's app — not editable here. */}
              <div
                title={url}
                className="flex-1 min-w-0 text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-400 truncate select-none"
              >
                {url}
              </div>
              <button onClick={() => void start()} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />} Start recording
              </button>
            </div>
          ) : (() => {
            const stage = (
              <>
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => void toggleAssert()}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition border ${
                      assertMode ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}>
                    <Crosshair className="h-3.5 w-3.5" /> {assertMode ? 'Assert mode ON — click to verify' : 'Add assertion'}
                  </button>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Test name (optional)"
                    className="flex-1 min-w-[140px] text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-violet-500" />
                  <button onClick={() => void stop(true)} disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 transition disabled:opacity-50">
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Stop & save test
                  </button>
                  <button onClick={() => void stop(false)} disabled={busy} title="Discard"
                    className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => setExpanded(v => !v)} title={expanded ? 'Minimize' : 'Maximize'}
                    className="flex items-center gap-1 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition">
                    {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Live browser view: Browserbase interactive Live View (iframe) */}
                <div className={`relative rounded-lg overflow-hidden border ${assertMode ? 'border-amber-500/50' : 'border-zinc-800'} bg-black ${expanded ? 'flex-1 min-h-0 flex items-center justify-center' : ''}`}>
                  {viewUrl ? (
                    <iframe
                      src={viewUrl}
                      title="Live browser"
                      className="w-full block"
                      style={{ height: expanded ? '100%' : 520, border: 0 }}
                      // Browserbase Live View is interactive ONLY with this sandbox
                      // and no pointer-events:none. Without it, clicks do nothing.
                      sandbox="allow-same-origin allow-scripts allow-forms"
                      allow="clipboard-read; clipboard-write"
                    />
                  ) : (
                    <div className="flex items-center justify-center py-20 text-zinc-400 text-xs gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading live browser…
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-zinc-400 shrink-0">Click and type in the view to drive the app. Toggle “Add assertion” then click an element to record a check.</p>

                {/* Live action list */}
                {actions.length > 0 && (
                  <div className={`space-y-0.5 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2 shrink-0 ${expanded ? 'max-h-28' : 'max-h-48'}`}>
                    {actions.map((a, i) => (
                      <div key={i} className="text-[11px] font-mono text-zinc-400 truncate">
                        {a.type === 'assert'
                          ? <span className="text-amber-400">assert {a.assertion?.kind} {a.assertion?.selector ?? a.assertion?.expected ?? ''}</span>
                          : <span><span className="text-violet-400">{a.type}</span> {a.selector ?? a.url ?? ''} {a.value ?? a.key ?? ''}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
            return expanded
              ? (
                <div className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-sm p-4 flex flex-col gap-3">
                  {stage}
                </div>
              )
              : <div className="space-y-3">{stage}</div>;
          })()}
        </div>
      )}
    </div>
  );
}
