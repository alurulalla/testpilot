"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Zap,
  ArrowLeft,
  RefreshCw,
  Play,
  Wrench,
  Globe,
  Code2,
  RotateCcw,
  AlertCircle,
  Square,
  ChevronDown,
  ChevronRight,
  Monitor,
  Video,
  Layers,
  Sparkles,
  Loader2,
} from "lucide-react";
import type { ScenarioResult, AvailableTest } from "@/types/session";
import { Session } from "@/types/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhaseCard } from "@/components/phase-card";
import { ExecutionLog } from "@/components/execution-log";
import { SiteMapViewer } from "@/components/site-map-viewer";
import { StatsBar } from "@/components/stats-bar";

type PhaseState = "pending" | "running" | "done" | "failed";

function getPhaseState(session: Session, phase: string): PhaseState {
  const active: Record<string, string> = {
    explore: "exploring",
    generate: "generating",
    run: "running",
    fix: "fixing",
  };

  // Active status always wins — critical for iterations 2+ where testResult/fixResult
  // already exist from the previous iteration but the phase is running again.
  if (session.status === active[phase]) return "running";

  // Completion checks (phases that finished and are no longer active)
  if (phase === "explore" && session.siteMap) return "done";
  if (phase === "generate" && (session.testFiles ?? []).length > 0)
    return "done";
  if (phase === "run" && session.testResult) return "done";
  if (phase === "fix" && session.fixResult) return "done";

  if (session.status === "failed") return "failed";
  return "pending";
}

function statusBadgeVariant(status: string) {
  if (status === "complete") return "success" as const;
  if (status === "failed") return "destructive" as const;
  if (
    ["exploring", "generating", "running", "fixing", "figma-checking"].includes(
      status,
    )
  )
    return "running" as const;
  return "secondary" as const;
}

function isValidSession(data: unknown): data is Session {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "url" in data &&
    "status" in data
  );
}

// ── ScenarioRunner component ──────────────────────────────────────────────────

function ScenarioRunner({
  sessionId,
  siteReady,
  scenario,
  input,
  loading,
  onInputChange,
  onSubmit,
  onRun,
  onFix,
  onRunFile,
}: {
  sessionId: string;
  siteReady: boolean;
  scenario: ScenarioResult | null;
  input: string;
  loading: boolean;
  onInputChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  onRun: () => Promise<void>;
  onFix: () => Promise<void>;
  onRunFile: (testFile: string) => Promise<void>;
}) {
  // Both states live here so SSE re-renders never reset them
  const [open, setOpen] = useState(true);
  const [showCode, setShowCode] = useState(false);

  const isBusy =
    scenario?.status === 'searching' ||
    scenario?.status === 'generating' ||
    scenario?.status === 'running';

  const hasFailed =
    scenario?.status === 'done' &&
    (scenario.testResult?.stats.failed ?? 0) > 0;

  const statusLabel: Record<string, string> = {
    searching:  'Searching existing tests…',
    generating: 'Generating test…',
    running:    'Running test…',
    found:      '✅ Found existing test',
    ready:      '✅ Test generated',
    done:       (scenario?.testResult?.stats.failed ?? 0) === 0
                  ? '✅ All passed'
                  : `❌ ${scenario?.testResult?.stats.failed} test(s) failed`,
    failed:     '❌ Error — see log below',
  };

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 overflow-hidden">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 border-b border-violet-500/20 hover:bg-violet-500/10 transition text-left"
      >
        <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
        <h2 className="text-sm font-semibold text-zinc-100 flex-1">Test a Scenario</h2>

        {/* Status summary shown in header when collapsed */}
        {!open && scenario && scenario.status !== 'idle' && (
          <span className={`text-xs font-medium ${
            scenario.status === 'done' && (scenario.testResult?.stats.failed ?? 0) === 0
              ? 'text-emerald-400'
              : hasFailed || scenario.status === 'failed'
                ? 'text-red-400'
                : 'text-violet-300'
          }`}>
            {statusLabel[scenario.status] ?? scenario.status}
          </span>
        )}

        {isBusy && (
          <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin shrink-0" />
        )}

        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        }
      </button>

      {open && <div className="px-4 py-4 space-y-4">
        {/* Input row */}
        <form
          onSubmit={(e) => { e.preventDefault(); void onSubmit(); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="e.g. user can log in with valid credentials"
            disabled={isBusy}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-violet-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim() || !siteReady}
            title={!siteReady ? "Run exploration first so the app knows your site's pages" : ''}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy
              ? <><Loader2 className="h-4 w-4 animate-spin" />Working…</>
              : <><Sparkles className="h-4 w-4" />Run</>
            }
          </button>
        </form>

        {!siteReady && (
          <p className="text-xs text-amber-400/80">
            ⚠ Run exploration first so the scenario generator knows your site&apos;s pages.
          </p>
        )}

        {/* Status + action buttons */}
        {scenario && scenario.status !== 'idle' && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className={`text-xs font-medium ${
              scenario.status === 'done' && (scenario.testResult?.stats.failed ?? 0) === 0
                ? 'text-emerald-400'
                : hasFailed || scenario.status === 'failed'
                  ? 'text-red-400'
                  : isBusy ? 'text-violet-300' : 'text-zinc-300'
            }`}>
              {statusLabel[scenario.status] ?? scenario.status}
            </span>

            <div className="flex items-center gap-2">
              {/* Run — when test was found but not yet executed */}
              {scenario.status === 'found' && (
                <button
                  type="button"
                  onClick={() => void onRun()}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                >
                  <Play className="h-3.5 w-3.5" /> Run Test
                </button>
              )}

              {/* Fix — when tests failed */}
              {hasFailed && (
                <button
                  type="button"
                  onClick={() => void onFix()}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 transition"
                >
                  <Wrench className="h-3.5 w-3.5" /> Auto-fix
                </button>
              )}

              {/* Re-run — when done (pass or fail) */}
              {(scenario.status === 'done' || scenario.status === 'failed') && (
                <button
                  type="button"
                  onClick={() => void onRun()}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white transition"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Re-run
                </button>
              )}
            </div>
          </div>
        )}

        {/* Available tests list with Run button per file */}
        {(scenario?.availableTests?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Available test files
            </p>
            {scenario!.availableTests.map((t: AvailableTest, i: number) => {
              const isActive = t.testFile === scenario!.testFile;
              return (
                <div
                  key={i}
                  className={`border rounded-lg overflow-hidden ${
                    isActive
                      ? 'border-violet-500/50 bg-violet-500/5'
                      : 'border-zinc-800 bg-zinc-900/50'
                  }`}
                >
                  {/* File header row */}
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Code2 className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                    <span className="flex-1 min-w-0 text-xs font-mono text-zinc-300 truncate">
                      {t.fileName}
                    </span>
                    <span className="text-xs text-zinc-600 shrink-0 mr-2">
                      {t.testNames.length} test{t.testNames.length !== 1 ? 's' : ''}
                    </span>
                    {isActive && (
                      <span className="text-[10px] font-semibold text-violet-400 bg-violet-500/20 px-1.5 py-0.5 rounded mr-1">
                        active
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onRunFile(t.testFile)}
                      className="flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 transition disabled:opacity-40 shrink-0"
                    >
                      <Play className="h-3 w-3" /> Run
                    </button>
                  </div>
                  {/* Individual test names */}
                  {t.testNames.length > 0 && (
                    <div className="px-3 pb-2 space-y-0.5">
                      {t.testNames.map((name: string, j: number) => (
                        <div key={j} className="flex items-center gap-2 text-xs text-zinc-500">
                          <span className="h-1 w-1 rounded-full bg-zinc-600 shrink-0" />
                          {name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Collapsible test code — state managed internally */}
        {scenario?.testContent && (
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowCode(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900 hover:bg-zinc-800 transition text-left"
            >
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Code2 className="h-3.5 w-3.5" />
                {scenario.wasFound ? 'Existing test' : 'Generated test'}
                {scenario.testFile && (
                  <span className="text-zinc-600 font-mono">
                    — {scenario.testFile.split('/').pop()}
                  </span>
                )}
              </span>
              {showCode
                ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                : <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
              }
            </button>
            {showCode && (
              <pre className="bg-zinc-950 p-3 text-[11px] text-zinc-300 font-mono overflow-auto max-h-80 whitespace-pre">
                {scenario.testContent}
              </pre>
            )}
          </div>
        )}

        {/* Error */}
        {scenario?.error && (
          <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 font-mono">
            {scenario.error}
          </p>
        )}
      </div>}
    </div>
  );
}

// ── TestFileCard — one generated spec file with Run / Stop ────────────────────

function extractTestNamesFromContent(content: string): string[] {
  const names: string[] = [];
  const re = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) names.push(m[1]);
  return names;
}

function TestFileCard({
  testFile,
  sessionId,
  isRunning,
  globalRunning,
  onRun,
  onStop,
}: {
  testFile: string;
  sessionId: string;
  isRunning: boolean;
  globalRunning: boolean;
  onRun: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [testNames, setTestNames] = useState<string[] | null>(null);

  // Lazily fetch and parse test names when the card is expanded
  useEffect(() => {
    if (!open || testNames !== null) return;
    const relPath = testFile.includes('.testpilot')
      ? testFile.split('.testpilot/').pop()?.split('/').slice(1).join('/') ?? ''
      : testFile.split('/tests/').pop() ?? '';

    fetch(`/api/sessions/${sessionId}/assets/tests/${relPath.replace(/^tests\//, '')}`)
      .then(r => r.text())
      .then(content => setTestNames(extractTestNamesFromContent(content)))
      .catch(() => setTestNames([]));
  }, [open, testNames, testFile, sessionId]);

  const fileName = testFile.split('/').pop() ?? testFile;

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isRunning ? 'border-violet-500/50 bg-violet-500/5' : 'border-zinc-800 bg-zinc-900'
    }`}>
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          }
          <Code2 className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <span className="flex-1 text-xs font-mono text-zinc-300 truncate">{fileName}</span>
        </button>

        {/* Status / Run / Stop */}
        {isRunning ? (
          <>
            <span className="flex items-center gap-1 text-xs text-violet-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Running…
            </span>
            <button
              type="button"
              onClick={() => void onStop()}
              className="flex items-center gap-1 rounded bg-red-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-600 transition shrink-0"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={globalRunning}
            onClick={() => void onRun()}
            className="flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 transition disabled:opacity-40 shrink-0"
          >
            <Play className="h-3 w-3" /> Run
          </button>
        )}
      </div>

      {/* Expandable test names */}
      {open && (
        <div className="px-4 pb-2.5 border-t border-zinc-800 pt-2 space-y-1">
          {testNames === null ? (
            <span className="text-xs text-zinc-600">Loading…</span>
          ) : testNames.length === 0 ? (
            <span className="text-xs text-zinc-600">No test() found in file</span>
          ) : (
            testNames.map((name, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 shrink-0" />
                {name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── CollapsibleVideo — one expandable video card ──────────────────────────────

function CollapsibleVideo({ videoPath, src }: { videoPath: string; src: string }) {
  const [open, setOpen] = useState(false); // collapsed by default
  const label = videoPath.split('/').slice(-2).join('/');

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-900 transition text-left"
      >
        <Video className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        <span className="flex-1 text-xs text-zinc-400 font-mono truncate">{label}</span>
        {!open && (
          <span className="text-[10px] text-zinc-600 mr-1">click to watch</span>
        )}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        }
      </button>
      {open && (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <video src={src} controls autoPlay className="w-full max-h-[480px] bg-black" />
      )}
    </div>
  );
}

// ── ScenarioRecording component ───────────────────────────────────────────────

function ScenarioRecording({
  sessionId,
  scenario,
}: {
  sessionId: string;
  scenario: ScenarioResult;
}) {
  const [open, setOpen] = useState(true); // expanded by default once videos arrive

  const isRunning = scenario.status === 'running';
  const videos = scenario.videos ?? [];
  const hasVideos = videos.length > 0;

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden">
      {/* Clickable header — toggles body */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 border-b border-zinc-800 hover:bg-zinc-800/60 transition text-left"
      >
        <Video className="h-4 w-4 text-zinc-400 shrink-0" />
        <h2 className="text-sm font-semibold text-zinc-100 flex-1">Scenario Recording</h2>

        {/* Running spinner */}
        {isRunning && (
          <span className="flex items-center gap-1.5 text-xs text-violet-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…
          </span>
        )}

        {/* Pass / fail badge */}
        {scenario.testResult && !isRunning && (
          <span className={`text-xs font-medium ${
            scenario.testResult.stats.failed === 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {scenario.testResult.stats.passed}/{scenario.testResult.stats.total} passed
            {scenario.testResult.stats.failed > 0 && ` · ${scenario.testResult.stats.failed} failed`}
          </span>
        )}

        {/* Video count chip */}
        {hasVideos && (
          <span className="text-xs text-zinc-500">
            {videos.length} video{videos.length !== 1 ? 's' : ''}
          </span>
        )}

        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        }
      </button>

      {/* Body */}
      {open && (
        <div className="px-4 py-4">
          {isRunning && !hasVideos && (
            <div className="flex items-center justify-center py-10 text-zinc-600 text-sm gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Recording in progress…
            </div>
          )}

          {!isRunning && !hasVideos && (
            <p className="text-xs text-zinc-600 text-center py-6">
              No recording yet — run the scenario to capture a video.
            </p>
          )}

          {hasVideos && (
            <div className="space-y-3">
              {videos.map((videoPath, i) => (
                <CollapsibleVideo
                  key={i}
                  videoPath={videoPath}
                  src={`/api/sessions/${sessionId}/assets/${videoPath}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SessionPage() {
  const params = useParams();
  const id =
    typeof params.id === "string"
      ? params.id
      : Array.isArray(params.id)
        ? params.id[0]
        : "";
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [sseConnected, setSseConnected] = useState(true);
  // Scenario runner
  const [scenarioInput, setScenarioInput] = useState('');
  const [scenarioLoading, setScenarioLoading] = useState(false);
  // Which specific test file is currently being run via the run-file endpoint
  const [runningFile, setRunningFile] = useState<string | null>(null);
  // All sections collapsed by default except Live Log (logs key not present = open)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    sitemap: true,
    testfiles: true,
    videos: true,
    figma: true,
  });
  const sessionRef = useRef<Session | null>(null);

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  function applySession(data: unknown) {
    if (!isValidSession(data)) return;
    // Ensure arrays are always defined to prevent runtime crashes
    const safe: Session = {
      ...data,
      logs: data.logs ?? [],
      testFiles: data.testFiles ?? [],
      scenarioResult: (data as Session).scenarioResult ?? null,
    };
    sessionRef.current = safe;
    setSession(safe);
    // Clear per-file running indicator once the session goes idle again
    if (!['running', 'fixing', 'exploring', 'generating'].includes(safe.status)) {
      setRunningFile(null);
    }
  }

  // Initial fetch → then auto-start the loop
  useEffect(() => {
    if (!id) return;
    fetch(`/api/sessions/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Session not found (${r.status})`);
        return r.json();
      })
      .then((data: unknown) => {
        applySession(data);
        // Auto-start only if freshly created (still idle, no work done)
        if (
          isValidSession(data) &&
          data.status === "idle" &&
          !data.siteMap &&
          (data.testFiles ?? []).length === 0
        ) {
          fetch(`/api/sessions/${id}/loop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ maxIterations: 5 }),
          }).catch(() => {});
        }
      })
      .catch((err) => {
        setFetchError((err as Error).message ?? "Could not load session");
      });
  }, [id]);

  // SSE real-time updates with polling fallback while stream is down
  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let destroyed = false;

    function handleMessage(e: MessageEvent) {
      try {
        const event = JSON.parse(e.data as string) as {
          type: string;
          session?: unknown;
          entry?: {
            ts: number;
            msg: string;
            level: "info" | "error" | "success";
          };
        };
        if (event.type === "init" || event.type === "update") {
          applySession(event.session);
        } else if (event.type === "log" && event.entry) {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              logs: [...(prev.logs ?? []), event.entry!],
              updatedAt: Date.now(),
            };
          });
        }
      } catch {
        /* ignore malformed frames */
      }
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`/api/sessions/${id}`);
          if (r.ok) applySession(await r.json());
        } catch {
          /* ignore */
        }
      }, 4000);
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function connect() {
      if (destroyed) return;
      es = new EventSource(`/api/sessions/${id}/stream`);
      es.onopen = () => {
        setSseConnected(true);
        stopPolling();
      };
      es.onmessage = handleMessage;
      es.onerror = () => {
        es?.close();
        es = null;
        setSseConnected(false);
        startPolling();
        reconnectTimer = setTimeout(connect, 6000);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      es?.close();
    };
  }, [id]);

  const triggerPhase = useCallback(
    async (phase: string, body?: object) => {
      setActionLoading(true);
      setActionError("");
      try {
        const r = await fetch(`/api/sessions/${id}/${phase}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        if (!r.ok) {
          const data = (await r.json().catch(() => ({}))) as { error?: string };
          setActionError(data.error ?? `Error ${r.status}`);
        }
      } catch (err) {
        setActionError((err as Error).message ?? "Network error");
      } finally {
        setActionLoading(false);
      }
    },
    [id],
  );

  const toggleHeadedMode = useCallback(async () => {
    if (!session) return;
    const next = !session.headedMode;
    // Optimistically update local state
    setSession((prev) => (prev ? { ...prev, headedMode: next } : prev));
    try {
      await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headedMode: next }),
      });
    } catch {
      // Revert on failure
      setSession((prev) => (prev ? { ...prev, headedMode: !next } : prev));
    }
  }, [id, session]);

  // ── Render states ────────────────────────────────────────────────────────────

  if (fetchError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-300">{fetchError}</p>
        <Button variant="secondary" size="sm" onClick={() => router.push("/")}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </Button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          <p className="text-sm text-zinc-500">Loading session…</p>
        </div>
      </div>
    );
  }

  const testFiles = session.testFiles ?? [];
  const logs = session.logs ?? [];
  const isRunning = [
    "exploring",
    "generating",
    "running",
    "fixing",
    "figma-checking",
  ].includes(session.status);
  const canExplore = !isRunning && !session.siteMap;
  const canGenerate = !isRunning && !!session.siteMap && testFiles.length === 0;
  const canRun = !isRunning && testFiles.length > 0;
  const canFix =
    !isRunning &&
    !!session.testResult &&
    (session.testResult.stats.failed ?? 0) > 0;
  const hasLayers = !!session.figmaFileUrl;
  const canLayers = !isRunning && hasLayers;

  return (
    <main className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4 shrink-0">
        <Link
          href="/"
          className="text-zinc-500 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Zap className="h-4 w-4 text-violet-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-100 truncate">
            {session.url}
          </p>
          <p className="text-xs text-zinc-500">
            Session {session.id.slice(0, 8)}
            <span className="mx-1.5 text-zinc-700">·</span>
            {session.maxPages ?? 10} pages
          </p>
        </div>
        {/* Headed / headless toggle — only locked while tests are actually executing */}
        <button
          onClick={toggleHeadedMode}
          disabled={["running", "fixing"].includes(session.status)}
          title={
            session.headedMode
              ? "Switch to headless mode"
              : "Switch to headed mode (show browser)"
          }
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            session.headedMode
              ? "border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
              : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
          }`}
        >
          <Monitor className="h-3.5 w-3.5" />
          {session.headedMode ? "Headed" : "Headless"}
          <span
            className={`h-2 w-2 rounded-full ${session.headedMode ? "bg-violet-400" : "bg-zinc-600"}`}
          />
        </button>

        <Badge variant={statusBadgeVariant(session.status)}>
          {session.status}
        </Badge>
        {isRunning && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => triggerPhase("stop")}
            disabled={actionLoading}
            className="gap-1.5"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </Button>
        )}
        {!sseConnected && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            polling
          </span>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto w-full">
          {/* ── Left: Pipeline ─────────────────────────────────────────────── */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs text-zinc-500 uppercase tracking-widest">
                Pipeline
              </h2>
              {!isRunning && (
                <Button
                  size="sm"
                  onClick={() => triggerPhase("loop", { maxIterations: 5 })}
                  disabled={actionLoading}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Run Full Loop
                </Button>
              )}
            </div>

            <PhaseCard
              step={1}
              title="Feature Discovery"
              description="Crawl the site and build a page/element map."
              state={getPhaseState(session, "explore")}
            >
              {session.siteMap ? (
                <p className="text-xs text-emerald-400">
                  {session.siteMap.pages.length} pages found
                </p>
              ) : canExplore ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerPhase("explore")}
                  disabled={actionLoading}
                >
                  <Globe className="h-3.5 w-3.5" /> Explore
                </Button>
              ) : null}
            </PhaseCard>

            <PhaseCard
              step={2}
              title="Test Generation"
              description="Generates a full Playwright test suite."
              state={getPhaseState(session, "generate")}
            >
              {testFiles.length > 0 ? (
                <p className="text-xs text-emerald-400">
                  {testFiles.length} file(s) generated
                </p>
              ) : canGenerate ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerPhase("generate")}
                  disabled={actionLoading}
                >
                  <Code2 className="h-3.5 w-3.5" /> Generate
                </Button>
              ) : null}
            </PhaseCard>

            <PhaseCard
              step={3}
              title="Test Execution"
              description="Run all tests and collect results."
              state={getPhaseState(session, "run")}
            >
              {canRun && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerPhase("run")}
                  disabled={actionLoading}
                >
                  <Play className="h-3.5 w-3.5" /> Run Tests
                </Button>
              )}
            </PhaseCard>

            <PhaseCard
              step={4}
              title="Self-Healing"
              description="Auto-fix failures and re-run until all pass."
              state={getPhaseState(session, "fix")}
            >
              {canFix && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerPhase("fix")}
                  disabled={actionLoading}
                >
                  <Wrench className="h-3.5 w-3.5" /> Auto-Fix
                </Button>
              )}
              {session.fixResult && (
                <p className="text-xs text-emerald-400">
                  {session.fixResult.fixed
                    ? `${session.fixResult.filesChanged} file(s) fixed`
                    : "No fixes needed"}
                </p>
              )}
            </PhaseCard>

            {/* Layers verification phase — only shown when a Layers URL is set */}
            {hasLayers && (
              <PhaseCard
                step={5}
                title="Layers Verification"
                description="Compare live screenshots against Layers designs."
                state={
                  session.status === "figma-checking"
                    ? "running"
                    : session.figmaResult
                      ? "done"
                      : "pending"
                }
              >
                {canLayers && !session.figmaResult && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => triggerPhase("figma")}
                    disabled={actionLoading}
                  >
                    <Layers className="h-3.5 w-3.5" /> Compare Layers
                  </Button>
                )}
                {session.figmaResult && (
                  <p className="text-xs text-emerald-400">
                    {session.figmaResult.comparisons.length} frame(s) compared
                  </p>
                )}
              </PhaseCard>
            )}

            {(session.iteration ?? 0) > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
                <span className="text-xs text-zinc-400">
                  Iteration {session.iteration}
                </span>
              </div>
            )}
          </div>

          {/* ── Right: Results ─────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            {session.testResult && (
              <StatsBar
                stats={session.testResult.stats}
                duration={session.testResult.duration}
              />
            )}

            {/* ── Scenario Runner ────────────────────────────────────────── */}
            <ScenarioRunner
              sessionId={id}
              siteReady={!!session.siteMap}
              scenario={session.scenarioResult}
              input={scenarioInput}
              loading={scenarioLoading}
              onInputChange={setScenarioInput}
              onSubmit={async () => {
                if (!scenarioInput.trim()) return;
                setScenarioLoading(true);
                await fetch(`/api/sessions/${id}/scenario`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ description: scenarioInput.trim() }),
                }).catch(() => {});
                setScenarioLoading(false);
              }}
              onRun={async () => {
                await fetch(`/api/sessions/${id}/scenario/run`, { method: 'POST' }).catch(() => {});
              }}
              onFix={async () => {
                await fetch(`/api/sessions/${id}/scenario/fix`, { method: 'POST' }).catch(() => {});
              }}
              onRunFile={async (testFile: string) => {
                await fetch(`/api/sessions/${id}/scenario/run`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ testFile }),
                }).catch(() => {});
              }}
            />

            {/* ── Scenario Recording ─────────────────────────────────────── */}
            {session.scenarioResult &&
              (session.scenarioResult.status === 'running' ||
               session.scenarioResult.status === 'done' ||
               session.scenarioResult.status === 'failed' ||
               (session.scenarioResult.videos?.length ?? 0) > 0) && (
              <ScenarioRecording
                sessionId={id}
                scenario={session.scenarioResult}
              />
            )}

            {/* ── Video recordings ───────────────────────────────────────── */}
            {(session.testResult?.videos ?? []).length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection("videos")}
                  className="w-full flex items-center justify-between mb-2 group"
                >
                  <h2 className="text-xs text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                    Test Recordings
                    <span className="ml-2 text-zinc-600 normal-case">
                      ({session.testResult!.videos.length} video
                      {session.testResult!.videos.length !== 1 ? "s" : ""})
                    </span>
                  </h2>
                  {collapsed["videos"] ? (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                  )}
                </button>
                {!collapsed["videos"] && (
                  <div className="space-y-3">
                    {session.testResult!.videos.map((videoPath, i) => (
                      <CollapsibleVideo
                        key={i}
                        videoPath={videoPath}
                        src={`/api/sessions/${session.id}/assets/${videoPath}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Layers comparison ───────────────────────────────────────── */}
            {session.figmaResult &&
              session.figmaResult.comparisons.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleSection("figma")}
                    className="w-full flex items-center justify-between mb-2 group"
                  >
                    <h2 className="text-xs text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                      Layers Comparison
                      <span className="ml-2 text-zinc-600 normal-case">
                        ({session.figmaResult.comparisons.length} frame
                        {session.figmaResult.comparisons.length !== 1
                          ? "s"
                          : ""}
                        )
                      </span>
                    </h2>
                    {collapsed["figma"] ? (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                    )}
                  </button>
                  {!collapsed["figma"] && (
                    <div className="space-y-4">
                      {session.figmaResult.comparisons.map((c, i) => (
                        <div
                          key={i}
                          className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden"
                        >
                          {/* Frame header */}
                          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800">
                            <Layers className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                            <span className="text-sm font-medium text-zinc-200">
                              {c.frameName}
                            </span>
                            <span className="text-xs text-zinc-600 font-mono ml-auto truncate">
                              {c.url}
                            </span>
                          </div>
                          {/* Side-by-side */}
                          <div className="grid grid-cols-2 divide-x divide-zinc-800">
                            {(
                              [
                                {
                                  label: "Layers design",
                                  icon: <Layers className="h-3 w-3" />,
                                  src: `/api/sessions/${session.id}/assets/${c.figmaImagePath}`,
                                  alt: `Figma: ${c.frameName}`,
                                },
                                {
                                  label: "Live app",
                                  icon: <Globe className="h-3 w-3" />,
                                  src: `/api/sessions/${session.id}/assets/${c.screenshotPath}`,
                                  alt: `Live: ${c.frameName}`,
                                },
                              ] as const
                            ).map(({ label, icon, src, alt }) => (
                              <div key={label} className="p-3">
                                <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
                                  {icon} {label}
                                </p>
                                {/* Scrollable so very wide/tall Figma frames are fully explorable */}
                                <div className="overflow-auto rounded border border-zinc-700 bg-zinc-950 max-h-80">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={src}
                                    alt={alt}
                                    className="w-full h-auto block"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      <p className="text-xs text-zinc-600 px-1">
                        Test file generated at{" "}
                        <code className="text-zinc-500">
                          {session.figmaResult.testFile}
                        </code>{" "}
                        — run with{" "}
                        <code className="text-zinc-500">
                          npx playwright test figma-visual.spec.ts
                          --reporter=html
                        </code>
                      </p>
                    </div>
                  )}
                </div>
              )}

            {session.siteMap && (
              <div>
                <button
                  onClick={() => toggleSection("sitemap")}
                  className="w-full flex items-center justify-between mb-2 group"
                >
                  <h2 className="text-xs text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                    Site Map
                    <span className="ml-2 text-zinc-600 normal-case">
                      ({session.siteMap.pages.length} pages)
                    </span>
                  </h2>
                  {collapsed["sitemap"] ? (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                  )}
                </button>
                {!collapsed["sitemap"] && (
                  <SiteMapViewer siteMap={session.siteMap} />
                )}
              </div>
            )}

            {testFiles.length > 0 && (
              <div>
                <button
                  onClick={() => toggleSection("testfiles")}
                  className="w-full flex items-center justify-between mb-2 group"
                >
                  <h2 className="text-xs text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                    Generated Tests
                    <span className="ml-2 text-zinc-600 normal-case">
                      ({testFiles.length} file{testFiles.length !== 1 ? 's' : ''})
                    </span>
                  </h2>
                  {collapsed["testfiles"] ? (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                  )}
                </button>
                {!collapsed["testfiles"] && (
                  <div className="space-y-2">
                    {testFiles.map((f, i) => (
                      <TestFileCard
                        key={i}
                        testFile={f}
                        sessionId={session.id}
                        isRunning={runningFile === f && session.status === 'running'}
                        globalRunning={session.status === 'running'}
                        onRun={async () => {
                          setRunningFile(f);
                          await fetch(`/api/sessions/${session.id}/run-file`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ testFile: f }),
                          }).catch(() => {});
                        }}
                        onStop={async () => {
                          await fetch(`/api/sessions/${session.id}/stop`, {
                            method: 'POST',
                          }).catch(() => {});
                          setRunningFile(null);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {session.error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
                <h3 className="text-sm font-medium text-red-400 mb-1">Error</h3>
                <pre className="text-xs text-red-300 whitespace-pre-wrap break-all">
                  {session.error}
                </pre>
              </div>
            )}

            {actionError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">{actionError}</p>
              </div>
            )}

            <div>
              <button
                onClick={() => toggleSection("logs")}
                className="w-full flex items-center justify-between mb-2 group"
              >
                <h2 className="text-xs text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                  Live Log
                  <span className="ml-2 text-zinc-600 normal-case">
                    ({logs.length} entries)
                  </span>
                </h2>
                {collapsed["logs"] ? (
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-600" />
                )}
              </button>
              {!collapsed["logs"] && <ExecutionLog logs={logs} />}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
