"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FeatureCanvas } from "@/components/feature-canvas";
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
  Download,
  FileText,
  ListChecks,
  UploadCloud,
  Network,
  X,
  Bug,
  FlaskConical,
  HelpCircle,
  FileJson,
  FileSpreadsheet,
  FileCode2,
  ZoomIn,
} from "lucide-react";
import type { ScenarioResult, AvailableTest, TriageResult, FailureVerdict, ImportedProject, CoverageAnalysis } from "@/types/session";
import { Session } from "@/types/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhaseCard } from "@/components/phase-card";
import { ExecutionLog } from "@/components/execution-log";
import { SiteMapViewer } from "@/components/site-map-viewer";
import { StatsBar } from "@/components/stats-bar";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/user-menu";

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
    ["exploring", "analyzing", "generating", "running", "fixing", "figma-checking"].includes(
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

// ── CoverageGapPanel ──────────────────────────────────────────────────────────

function CoverageGapPanel({
  sessionId,
  analysis,
  isAnalyzing,
  isRunning,
}: {
  sessionId: string;
  analysis: CoverageAnalysis | null;
  isAnalyzing: boolean;
  isRunning: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(analysis?.selectedGapIds ?? []),
  );
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Keep local selection in sync when analysis updates (e.g. fresh analysis)
  useEffect(() => {
    if (analysis) setSelected(new Set(analysis.selectedGapIds));
  }, [analysis?.analyzedAt]);

  const isBusy = isAnalyzing || isRunning || saving || generating;

  async function toggleGap(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
    setSaving(true);
    await fetch(`/api/sessions/${sessionId}/analyze-gaps`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedGapIds: [...next] }),
    }).catch(() => {});
    setSaving(false);
  }

  async function toggleAll() {
    const allIds = analysis?.gaps.map(g => g.id) ?? [];
    const next = selected.size === allIds.length ? new Set<string>() : new Set(allIds);
    setSelected(next);
    setSaving(true);
    await fetch(`/api/sessions/${sessionId}/analyze-gaps`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedGapIds: [...next] }),
    }).catch(() => {});
    setSaving(false);
  }

  async function analyzeGaps() {
    await fetch(`/api/sessions/${sessionId}/analyze-gaps`, { method: 'POST' }).catch(() => {});
  }

  async function generateSelected() {
    setGenerating(true);
    await fetch(`/api/sessions/${sessionId}/generate-selected`, { method: 'POST' }).catch(() => {});
    setGenerating(false);
  }

  if (!analysis && !isAnalyzing) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-semibold text-zinc-100">Coverage Gap Analysis</span>
        </div>
        <p className="text-xs text-zinc-500">
          Crawl the site to compare your existing tests against all discovered features
          and find what&apos;s missing.
        </p>
        <button
          type="button"
          disabled={isBusy}
          onClick={analyzeGaps}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition disabled:opacity-40"
        >
          <Globe className="h-4 w-4" />
          Analyze Coverage Gaps
        </button>
      </div>
    );
  }

  if (isAnalyzing) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 text-violet-400 animate-spin shrink-0" />
        <div>
          <p className="text-sm font-semibold text-zinc-100">Analysing coverage…</p>
          <p className="text-xs text-zinc-500">Crawling site and comparing against imported tests</p>
        </div>
      </div>
    );
  }

  const gaps = analysis?.gaps ?? [];
  const coveredCount = analysis?.coveredCount ?? 0;
  const totalFeatures = analysis?.totalFeatures ?? 0;
  const selectedCount = selected.size;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <ListChecks className="h-4 w-4 text-zinc-400 shrink-0" />
        <span className="flex-1 text-sm font-semibold text-zinc-100">Coverage Gap Analysis</span>
        <button
          type="button"
          disabled={isBusy}
          onClick={analyzeGaps}
          className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition disabled:opacity-40"
          title="Re-run analysis"
        >
          <RefreshCw className="h-3 w-3" /> Re-analyse
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Summary chips */}
        <div className="flex gap-2 flex-wrap">
          <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full px-2.5 py-0.5">
            ✓ {coveredCount} covered
          </span>
          <span className="text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-full px-2.5 py-0.5">
            ⚠ {gaps.length} gap{gaps.length !== 1 ? 's' : ''}
          </span>
          <span className="text-[11px] bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-full px-2.5 py-0.5">
            {totalFeatures} total features
          </span>
        </div>

        {gaps.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2.5">
            <span className="text-lg">🎉</span>
            <p className="text-xs text-emerald-300">All discovered features appear to be covered by your existing tests.</p>
          </div>
        ) : (
          <>
            {/* Select all */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleAll}
                disabled={isBusy}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition disabled:opacity-40"
              >
                {selected.size === gaps.length ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-[11px] text-zinc-600">{selectedCount} selected</span>
            </div>

            {/* Gap list */}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {gaps.map(gap => {
                const isSelected = selected.has(gap.id);
                return (
                  <button
                    key={gap.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => toggleGap(gap.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition group ${
                      isSelected
                        ? 'border-violet-500/40 bg-violet-500/5'
                        : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0 transition ${
                        isSelected ? 'bg-violet-600 border-violet-500' : 'border-zinc-600 group-hover:border-zinc-500'
                      }`}>
                        {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-200 truncate">{gap.feature}</p>
                        <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">{gap.pageUrl}</p>
                        {gap.suggestedTestNames.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {gap.suggestedTestNames.map((name, i) => (
                              <p key={i} className="text-[10px] text-zinc-500 flex items-center gap-1">
                                <span className="h-1 w-1 rounded-full bg-zinc-700 shrink-0" />
                                {name}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Generate button */}
            <button
              type="button"
              disabled={isBusy || selectedCount === 0}
              onClick={generateSelected}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition disabled:opacity-40"
            >
              {generating
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                : <><Code2 className="h-4 w-4" /> Generate &amp; Run {selectedCount > 0 ? `${selectedCount} Selected` : ''}</>
              }
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── ReportDownloadMenu ────────────────────────────────────────────────────────

const REPORT_FORMATS = [
  { format: 'html',     label: 'HTML Report',     icon: FileCode2,       ext: '.html', desc: 'Self-contained styled report' },
  { format: 'pdf',      label: 'PDF Report',      icon: FileText,        ext: '.pdf',  desc: 'Print-ready A4 PDF' },
  { format: 'markdown', label: 'Markdown',        icon: FileText,        ext: '.md',   desc: 'For wikis and pull requests' },
  { format: 'json',     label: 'JSON',            icon: FileJson,        ext: '.json', desc: 'Structured data for CI' },
  { format: 'csv',      label: 'CSV',             icon: FileSpreadsheet, ext: '.csv',  desc: 'Flat table for spreadsheets' },
] as const;

function ReportDownloadMenu({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-50 transition"
      >
        <Download className="h-4 w-4" />
        Download Report
        <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-60 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Export Format</p>
          </div>
          {REPORT_FORMATS.map(({ format, label, icon: Icon, ext, desc }) => (
            <a
              key={format}
              href={`/api/sessions/${sessionId}/report?format=${format}`}
              download
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800 transition group"
            >
              <Icon className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-sm font-medium text-zinc-200 group-hover:text-zinc-50 transition">{label}</span>
                <span className="text-[10px] text-zinc-600 font-mono">{ext}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
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
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-zinc-50 transition"
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

// ── TriagePanel — failure classification results ──────────────────────────────

const VERDICT_META: Record<FailureVerdict, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  app_bug:   { label: 'App Bug',    color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30',    icon: <Bug        className="h-3 w-3" /> },
  test_bug:  { label: 'Test Bug',   color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30', icon: <FlaskConical className="h-3 w-3" /> },
  ambiguous: { label: 'Ambiguous',  color: 'text-zinc-400',   bg: 'bg-zinc-700/40 border-zinc-600/40',  icon: <HelpCircle  className="h-3 w-3" /> },
};

function TriagePanel({ triage }: { triage: TriageResult }) {
  const [open, setOpen] = useState(false);

  const counts = [
    triage.appBugCount   > 0 && { verdict: 'app_bug'   as FailureVerdict, count: triage.appBugCount },
    triage.testBugCount  > 0 && { verdict: 'test_bug'  as FailureVerdict, count: triage.testBugCount },
    triage.ambiguousCount > 0 && { verdict: 'ambiguous' as FailureVerdict, count: triage.ambiguousCount },
  ].filter(Boolean) as { verdict: FailureVerdict; count: number }[];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800/60 transition text-left"
      >
        <Wrench className="h-4 w-4 text-zinc-400 shrink-0" />
        <span className="flex-1 text-sm font-semibold text-zinc-100">Failure Analysis</span>

        {/* Verdict count chips */}
        <div className="flex items-center gap-1.5 mr-1">
          {counts.map(({ verdict, count }) => {
            const m = VERDICT_META[verdict];
            return (
              <span key={verdict}
                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${m.color} ${m.bg}`}>
                {m.icon} {count}
              </span>
            );
          })}
        </div>

        {open
          ? <ChevronDown  className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-zinc-800 divide-y divide-zinc-800/60">
          {/* Legend */}
          <div className="px-4 py-2 flex flex-wrap gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1 text-red-400"><Bug className="h-3 w-3" /> App Bug — real product gap</span>
            <span className="flex items-center gap-1 text-amber-400"><FlaskConical className="h-3 w-3" /> Test Bug — fix the test code</span>
            <span className="flex items-center gap-1 text-zinc-400"><HelpCircle className="h-3 w-3" /> Ambiguous — heal conservatively</span>
          </div>

          {triage.analyses.map((a, i) => {
            const m = VERDICT_META[a.verdict];
            return (
              <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${m.color} ${m.bg}`}>
                  {m.icon} {m.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-200 truncate">{a.testName}</p>
                  {a.file && (
                    <p className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate">
                      📄 {a.file.split('/').pop()}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500 mt-0.5">{a.reasoning}</p>
                  {a.verdict === 'app_bug' && (
                    <p className="text-[10px] text-red-400/70 mt-0.5 italic">
                      ↳ Will not be auto-healed — update the application instead.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── DocumentationPanel ────────────────────────────────────────────────────────

function DocumentationPanel({
  sessionId,
  contextDoc,
  contextDocName,
  onOpenCanvas,
}: {
  sessionId: string;
  contextDoc: string | null;
  contextDocName: string | null;
  onOpenCanvas: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true); setMsg('');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/sessions/${sessionId}/context`, { method: 'POST', body: form }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => ({})) as { autoFlowsAdded?: number };
      const flowNote = (data.autoFlowsAdded ?? 0) > 0
        ? ` · ${data.autoFlowsAdded} flow${data.autoFlowsAdded === 1 ? '' : 's'} auto-extracted`
        : '';
      setMsg(`✓ Uploaded${flowNote}`);
    } else {
      setMsg('✗ Upload failed');
    }
    setUploading(false);
    setTimeout(() => setMsg(''), 4000);
  }

  async function handleClear() {
    await fetch(`/api/sessions/${sessionId}/context`, { method: 'DELETE' }).catch(() => null);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800/60 transition text-left"
      >
        <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
        <span className="flex-1 text-sm font-semibold text-zinc-100">Product Documentation</span>
        {contextDoc && (
          <span className="text-xs text-emerald-400 mr-1">✓ loaded</span>
        )}
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
               : <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
          <p className="text-xs text-zinc-500">
            Upload your product&apos;s <code className="text-zinc-400">.md</code> or <code className="text-zinc-400">.txt</code> spec file. The AI will use it to understand features and generate better tests.
          </p>

          {contextDoc ? (
            <div className="space-y-3">
              {/* File info row */}
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <FileText className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="flex-1 text-xs text-emerald-300 truncate font-mono">
                  {contextDocName ?? 'documentation.md'}
                </span>
                <span className="text-xs text-zinc-500 shrink-0">
                  {(contextDoc.length / 1024).toFixed(1)} KB
                </span>
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-zinc-500 hover:text-red-400 transition shrink-0"
                  title="Remove documentation"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Open canvas button — opens inline in the session page */}
              <button
                type="button"
                onClick={onOpenCanvas}
                className="flex items-center justify-between w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600 transition px-3 py-2.5 group"
              >
                <span className="flex items-center gap-2 text-xs text-zinc-300 group-hover:text-zinc-100 transition">
                  <Network className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300 transition" />
                  Feature Canvas
                </span>
                <span className="text-zinc-600 group-hover:text-zinc-400 transition text-xs">→</span>
              </button>

              {/* Raw text toggle */}
              <button
                type="button"
                onClick={() => setPreview(v => !v)}
                className="text-[11px] text-zinc-600 hover:text-zinc-400 transition"
              >
                {preview ? '▲ Hide raw text' : '▼ Show raw text'}
              </button>
              {preview && (
                <pre className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-400 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
                  {contextDoc.slice(0, 1200)}{contextDoc.length > 1200 ? '\n\n…' : ''}
                </pre>
              )}
            </div>
          ) : (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt,.markdown"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 w-full justify-center rounded-lg border-2 border-dashed border-zinc-700 px-4 py-4 text-xs text-zinc-500 hover:border-violet-500/50 hover:text-zinc-300 transition disabled:opacity-40"
              >
                <UploadCloud className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Click to upload .md / .txt'}
              </button>
            </div>
          )}
          {msg && (
            <p className={`text-xs ${msg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{msg}</p>
          )}
        </div>
      )}
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
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [autoSelfHeal, setAutoSelfHeal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [sseConnected, setSseConnected] = useState(true);
  // Scenario runner
  const [scenarioInput, setScenarioInput] = useState('');
  const [scenarioLoading, setScenarioLoading] = useState(false);
  // Which specific test file is currently being run via the run-file endpoint
  const [runningFile, setRunningFile] = useState<string | null>(null);
  // Image lightbox modal
  const [imageModal, setImageModal] = useState<{ src: string; alt: string; label: string } | null>(null);
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

  /**
   * Apply an incoming session snapshot from SSE or polling.
   *
   * @param data          - Raw JSON value to validate and apply.
   * @param preserveLogs  - When true the existing client-side log array is kept
   *                        unchanged.  Pass true for { type:'update', logsOmitted:true }
   *                        events where logs have intentionally been stripped from the
   *                        payload to keep it small — individual log entries arrive via
   *                        separate { type:'log' } events and accumulate in state.
   */
  function applySession(data: unknown, preserveLogs = false) {
    if (!isValidSession(data)) return;
    const incoming = data as Session;

    const current = sessionRef.current;

    if (!preserveLogs) {
      // Guard against cold-Lambda skeleton responses overwriting real state.
      //
      // When a Vercel Lambda container is cold-started for a session that was
      // created by a different container, getSessionOrRestore() reconstructs a
      // minimal skeleton from the cookie (status='idle', no logs, no testFiles,
      // no siteMap). If the client already has meaningful state from a prior SSE
      // stream, receiving that skeleton via polling would blank the UI entirely.
      //
      // Detection: incoming looks like a skeleton iff it has no logs, no testFiles,
      // no siteMap, and no testResult.  We only reject it when our current local
      // state already has data (otherwise a genuinely empty session is fine).
      //
      // NOTE: this guard is intentionally skipped when preserveLogs=true because in
      // that case logs are omitted from the payload by design, not because the
      // session is a skeleton.
      if (current) {
        const incomingIsEmpty =
          (incoming.logs?.length ?? 0) === 0 &&
          (incoming.testFiles?.length ?? 0) === 0 &&
          !incoming.siteMap &&
          !incoming.testResult;
        const currentHasData =
          (current.logs?.length ?? 0) > 0 ||
          (current.testFiles?.length ?? 0) > 0 ||
          !!current.siteMap ||
          !!current.testResult;
        if (incomingIsEmpty && currentHasData) return; // skeleton from cold Lambda — ignore
      }
    }

    // Ensure arrays are always defined to prevent runtime crashes.
    // When preserveLogs is true we keep the existing log array so that
    // logs accumulated via real-time { type:'log' } events are not lost.
    const safe: Session = {
      ...incoming,
      logs: preserveLogs ? (current?.logs ?? []) : (incoming.logs ?? []),
      testFiles: incoming.testFiles ?? [],
      scenarioResult: incoming.scenarioResult ?? null,
      userFlows: incoming.userFlows ?? [],
      contextDoc: incoming.contextDoc ?? null,
      contextDocName: incoming.contextDocName ?? null,
      importedProject: incoming.importedProject ?? null,
      coverageAnalysis: incoming.coverageAnalysis ?? null,
    };
    sessionRef.current = safe;
    setSession(safe);
    // Clear per-file running indicator once the session goes idle again
    if (!['running', 'fixing', 'exploring', 'generating'].includes(safe.status)) {
      setRunningFile(null);
    }
  }

  // Fetch server-side config (AUTO_SELF_HEAL flag etc.)
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then((cfg: { autoSelfHeal?: boolean }) => setAutoSelfHeal(cfg.autoSelfHeal ?? false))
      .catch(() => {});
  }, []);

  // Live-updates effect:
  //   1. Fetch current session state.
  //   2a. If the session is freshly created (idle, no work) → POST /loop and
  //       read SSE events directly from the streaming response body.  Both the
  //       loop and the event stream share the same Lambda invocation so events
  //       are never lost across container boundaries.
  //   2b. If the session already has work / is running → open an EventSource to
  //       /stream for live updates (reconnect scenario, e.g. page refresh).
  //   3.  Polling fallback at 4 s whenever the stream is not connected.
  useEffect(() => {
    if (!id) return;

    let destroyed = false;
    let loopReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // ── helpers ──────────────────────────────────────────────────────────────

    function handleSseData(data: string) {
      try {
        const event = JSON.parse(data) as {
          type: string;
          session?: unknown;
          entry?: { ts: number; msg: string; level: "info" | "error" | "success" };
          /** true when the server intentionally stripped logs from this update payload */
          logsOmitted?: boolean;
        };
        if (event.type === "init") {
          // Full snapshot — replace everything including the log array
          applySession(event.session, false);
        } else if (event.type === "update") {
          // State-only update — preserve the existing client-side log array when
          // the server signals it has omitted logs from this payload.  Individual
          // log entries arrive via separate { type:'log' } events.
          applySession(event.session, event.logsOmitted === true);
        } else if (event.type === "log" && event.entry) {
          setSession((prev) => {
            if (!prev) return prev;
            // Deduplicate: skip entries that are already in the log array
            if (prev.logs?.some((l) => l.ts === event.entry!.ts && l.msg === event.entry!.msg)) return prev;
            return { ...prev, logs: [...(prev.logs ?? []), event.entry!], updatedAt: Date.now() };
          });
        }
      } catch { /* ignore malformed frames */ }
    }

    function startPolling() {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const r = await fetch(`/api/sessions/${id}`);
          if (r.ok) applySession(await r.json());
        } catch { /* ignore */ }
      }, 4000);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // ── stream reader (for POST /loop SSE response body) ─────────────────────

    async function readLoopStream(body: ReadableStream<Uint8Array>) {
      const reader = body.getReader();
      loopReader = reader;
      const decoder = new TextDecoder();
      let buf = "";
      setSseConnected(true);
      stopPolling();
      try {
        while (!destroyed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ") && line.length > 6) {
              handleSseData(line.slice(6));
            }
          }
        }
      } catch { /* stream cancelled or errored */ } finally {
        setSseConnected(false);
        startPolling(); // fall back to polling once loop stream closes
      }
    }

    // ── EventSource (for reconnect / already-running sessions) ───────────────

    function connectEventSource() {
      if (destroyed) return;
      es = new EventSource(`/api/sessions/${id}/stream`);
      es.onopen = () => { setSseConnected(true); stopPolling(); };
      es.onmessage = (e: MessageEvent) => handleSseData(e.data as string);
      es.onerror = () => {
        es?.close(); es = null;
        setSseConnected(false);
        startPolling();
        reconnectTimer = setTimeout(connectEventSource, 6000);
      };
    }

    // ── main ─────────────────────────────────────────────────────────────────

    (async () => {
      // Always load current session state first
      let data: unknown;
      try {
        const r = await fetch(`/api/sessions/${id}`);
        if (!r.ok) throw new Error(`Session not found (${r.status})`);
        data = await r.json();
        applySession(data);
      } catch (err) {
        setFetchError((err as Error).message ?? "Could not load session");
        return;
      }

      if (destroyed) return;

      const isFresh =
        isValidSession(data) &&
        (data as { status: string }).status === "idle" &&
        !(data as { siteMap: unknown }).siteMap &&
        ((data as { testFiles?: unknown[] }).testFiles ?? []).length === 0;

      if (isFresh) {
        const isFigmaOnly =
          isValidSession(data) && !!(data as { figmaOnly?: boolean }).figmaOnly;

        if (isFigmaOnly) {
          // Design QA only — skip test generation and run only Figma verification
          try {
            await fetch(`/api/sessions/${id}/figma`, { method: "POST" });
          } catch { /* non-fatal */ }
          startPolling();
        } else {
          // Full pipeline — start loop and stream from the same response.
          // Figma verification is triggered automatically inside the loop
          // once exploration completes (so knownUrls are available for URL mapping).
          try {
            const res = await fetch(`/api/sessions/${id}/loop`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ maxIterations: 5 }),
            });
            if (!res.ok || !res.body) {
              startPolling();
            } else {
              await readLoopStream(res.body);
            }
          } catch {
            startPolling();
          }
        }
      } else {
        // Session has existing work — connect via EventSource for live updates
        connectEventSource();
      }
    })();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPolling();
      loopReader?.cancel();
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

  const toggleAutoSelfHeal = useCallback(async () => {
    const next = !autoSelfHeal;
    // Optimistically update local state so the badge flips immediately
    setAutoSelfHeal(next);
    try {
      await fetch('/api/app-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSelfHeal: next }),
      });
    } catch {
      // Revert on failure
      setAutoSelfHeal(!next);
    }
  }, [autoSelfHeal]);

  // Close image lightbox on Escape — must be before any conditional returns
  useEffect(() => {
    if (!imageModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setImageModal(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [imageModal]);

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
    "analyzing",
    "generating",
    "running",
    "fixing",
    "figma-checking",
  ].includes(session.status);
  const canExplore = !isRunning && !session.siteMap;
  const canGenerate = !isRunning && !!session.siteMap && testFiles.length === 0;
  const canRun = !isRunning && testFiles.length > 0;
  const hasFailures = !!session.testResult && (session.testResult.stats.failed ?? 0) > 0;
  const triage = session.triageResult ?? null;
  // canFix: there are failures AND (no triage yet OR triage recommends healing)
  const canFix = !isRunning && hasFailures && (!triage || triage.selfHealRecommended);
  const hasLayers = !!session.figmaFileUrl;
  // Figma verification is independent of the pipeline — canLayers is true whenever
  // the session has a Figma URL, regardless of whether tests are running.
  const canLayers = hasLayers;

  return (
    <main className="flex-1 flex flex-col min-h-0">

      {/* ── Image lightbox modal ─────────────────────────────────────── */}
      {imageModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setImageModal(null)}
        >
          <div
            className="relative max-w-6xl w-full max-h-[90vh] flex flex-col bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
              <span className="text-sm font-medium text-zinc-200 truncate">{imageModal.label}</span>
              <button
                onClick={() => setImageModal(null)}
                className="text-zinc-500 hover:text-zinc-100 transition-colors ml-3 shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Modal image */}
            <div className="overflow-auto flex-1 flex items-start justify-center p-4 bg-zinc-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageModal.src}
                alt={imageModal.alt}
                className="max-w-full h-auto rounded block"
                style={{ imageRendering: 'auto' }}
              />
            </div>
            <p className="px-4 py-2 text-[10px] text-zinc-600 border-t border-zinc-800 shrink-0">
              Click outside or press Esc to close
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4 shrink-0">
        <Link
          href="/dashboard"
          className="text-zinc-500 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Logo height={26} className="shrink-0" />
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
        <UserMenu />
      </header>

      {/* ── Feature Canvas — fixed full-screen overlay (concrete px dimensions guaranteed) ── */}
      {canvasOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          {/* Canvas header */}
          <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-4 py-2.5 flex items-center gap-3">
            <button
              onClick={() => setCanvasOpen(false)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to session
            </button>
            <span className="text-zinc-700">·</span>
            <span className="text-xs font-semibold text-zinc-300">Feature Canvas</span>
            <span className="text-zinc-700 text-[10px] truncate max-w-[300px] ml-1">{session.url}</span>
          </div>
          {/* Canvas body — flex-1 of a fixed-size parent = concrete pixel height */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <FeatureCanvas sessionId={session.id} showToolbar />
          </div>
        </div>
      )}

      {/* ── Normal session layout (scrollable, always rendered under canvas overlay) ── */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto w-full">
          {/* ── Left: Pipeline ─────────────────────────────────────────────── */}
          <div className="lg:col-span-1 space-y-4">

            {/* Documentation panel */}
            <DocumentationPanel
              sessionId={session.id}
              contextDoc={session.contextDoc}
              contextDocName={session.contextDocName}
              onOpenCanvas={() => setCanvasOpen(true)}
            />

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
              description={
                autoSelfHeal
                  ? "Auto-fix failures and re-run until all pass."
                  : "Analyse failures, then heal test-code issues on demand."
              }
              state={getPhaseState(session, "fix")}
            >
              {/* Auto-heal mode toggle */}
              <button
                onClick={toggleAutoSelfHeal}
                title={autoSelfHeal ? 'Auto-heal is ON — click to disable' : 'Auto-heal is OFF — click to enable'}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                  autoSelfHeal
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
                    : 'text-zinc-500 bg-zinc-800 border-zinc-700 hover:border-zinc-500 hover:text-zinc-300'
                }`}
              >
                {autoSelfHeal ? '⚡ Auto-heal ON' : '⏸ Auto-heal OFF'}
              </button>

              {/* Triage summary when available */}
              {triage && hasFailures && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {triage.appBugCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border text-red-400 bg-red-500/10 border-red-500/30">
                      <Bug className="h-2.5 w-2.5" /> {triage.appBugCount} app bug
                    </span>
                  )}
                  {triage.testBugCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border text-amber-400 bg-amber-500/10 border-amber-500/30">
                      <FlaskConical className="h-2.5 w-2.5" /> {triage.testBugCount} test bug
                    </span>
                  )}
                  {triage.ambiguousCount > 0 && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border text-zinc-400 bg-zinc-700/40 border-zinc-600/40">
                      <HelpCircle className="h-2.5 w-2.5" /> {triage.ambiguousCount} ambiguous
                    </span>
                  )}
                </div>
              )}

              {/* Only app bugs — nothing to heal */}
              {triage && hasFailures && !triage.selfHealRecommended && (
                <p className="text-[11px] text-red-400/80 mt-1">
                  All failures are application gaps — fix the app, not the tests.
                </p>
              )}

              {/* Self-heal button — shown when there are healable failures */}
              {canFix && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => triggerPhase("fix")}
                  disabled={actionLoading}
                  className="mt-1"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  {autoSelfHeal ? 'Re-run Self-Heal' : 'Self-Heal'}
                </Button>
              )}

              {session.fixResult && (
                <p className="text-xs text-emerald-400 mt-1">
                  {session.fixResult.fixed
                    ? `${session.fixResult.filesChanged} file(s) fixed`
                    : "No fixes applied"}
                </p>
              )}
            </PhaseCard>

            {/* Figma DOM verification phase — only shown when a Figma URL is set */}
            {hasLayers && (
              <PhaseCard
                step={5}
                title="Figma Verification"
                description="Compare live page DOM against Figma design spec."
                state={
                  session.figmaChecking
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
                    disabled={actionLoading || session.figmaChecking}
                  >
                    {session.figmaChecking
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
                      : <><Layers className="h-3.5 w-3.5" /> Verify vs Figma</>
                    }
                  </Button>
                )}
                {session.figmaResult && (() => {
                  const totalIssues = session.figmaResult.comparisons.reduce(
                    (n, c) => n + (c.discrepancies?.length ?? 0), 0,
                  );
                  const totalHigh   = session.figmaResult.comparisons.reduce((n, c) => n + (c.discrepancies ?? []).filter(d => d.severity === 'high').length, 0);
                  const totalMedium = session.figmaResult.comparisons.reduce((n, c) => n + (c.discrepancies ?? []).filter(d => d.severity === 'medium').length, 0);
                  const totalLow    = session.figmaResult.comparisons.reduce((n, c) => n + (c.discrepancies ?? []).filter(d => d.severity === 'low').length, 0);
                  return (
                    <div className="space-y-1">
                      <p className="text-xs text-zinc-400">
                        {session.figmaResult.comparisons.length} frame(s) checked
                      </p>
                      {totalIssues === 0 ? (
                        <p className="text-xs text-emerald-400">✓ No issues found</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {totalHigh > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{totalHigh} high</span>}
                          {totalMedium > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">{totalMedium} med</span>}
                          {totalLow > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">{totalLow} low</span>}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
              <div className="space-y-2">
                <StatsBar
                  stats={session.testResult.stats}
                  duration={session.testResult.duration}
                />
                {testFiles.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    <a
                      href={`/accuracy/${session.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-2 flex-1 min-w-[160px] rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-2.5 text-sm font-semibold text-violet-300 hover:border-violet-500/60 hover:bg-violet-500/15 hover:text-zinc-50 transition"
                    >
                      <ListChecks className="h-4 w-4" />
                      View Accuracy Report
                    </a>
                    <ReportDownloadMenu sessionId={session.id} />
                    <a
                      href={`/api/sessions/${session.id}/download`}
                      download
                      className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-50 transition"
                    >
                      <Download className="h-4 w-4" />
                      Tests ZIP
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* ── Coverage Gap Analysis — shown when a Playwright project is imported ── */}
            {session.importedProject && (
              <CoverageGapPanel
                sessionId={session.id}
                analysis={session.coverageAnalysis ?? null}
                isAnalyzing={session.status === 'analyzing'}
                isRunning={isRunning}
              />
            )}

            {/* ── Failure Triage panel ───────────────────────────────────── */}
            {triage && hasFailures && (
              <TriagePanel triage={triage} />
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

            {/* ── Figma DOM verification results ──────────────────────────── */}
            {session.figmaResult &&
              session.figmaResult.comparisons.length > 0 && (
                <div>
                  <button
                    onClick={() => toggleSection("figma")}
                    className="w-full flex items-center justify-between mb-2 group"
                  >
                    <h2 className="text-xs text-zinc-500 uppercase tracking-widest group-hover:text-zinc-300 transition-colors">
                      Figma Verification
                      <span className="ml-2 text-zinc-600 normal-case">
                        ({session.figmaResult.comparisons.length} frame
                        {session.figmaResult.comparisons.length !== 1 ? "s" : ""})
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
                      {session.figmaResult.comparisons.map((c, i) => {
                        const score = c.matchScore;
                        const issues = c.discrepancies ?? [];
                        const highCount   = issues.filter(d => d.severity === 'high').length;
                        const mediumCount = issues.filter(d => d.severity === 'medium').length;
                        const lowCount    = issues.filter(d => d.severity === 'low').length;

                        return (
                          <div
                            key={i}
                            className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden"
                          >
                            {/* Frame header */}
                            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800">
                              <Layers className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                              <span className="text-sm font-medium text-zinc-200 flex-1 truncate">
                                {c.frameName}
                              </span>
                              {/* Severity summary — more intuitive than a raw score */}
                              {issues.length === 0 && score != null ? (
                                <span className="text-xs font-semibold text-emerald-400 shrink-0">✓ Matches design</span>
                              ) : issues.length > 0 ? (
                                <span
                                  className="flex items-center gap-1.5 shrink-0"
                                  title={`Design match score: ${score ?? '–'}/100 (−15 per HIGH, −8 per MEDIUM, −3 per LOW issue)`}
                                >
                                  {highCount > 0 && (
                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                                      {highCount} high
                                    </span>
                                  )}
                                  {mediumCount > 0 && (
                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                      {mediumCount} med
                                    </span>
                                  )}
                                  {lowCount > 0 && (
                                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
                                      {lowCount} low
                                    </span>
                                  )}
                                </span>
                              ) : null}
                              <span className="text-xs text-zinc-600 font-mono shrink-0 hidden md:block truncate max-w-[200px]">
                                {c.url}
                              </span>
                            </div>

                            {/* ── Three-column image diff: Figma | Live | Diff ── */}
                            {(() => {
                              const cols = [
                                {
                                  label: 'Figma design',
                                  icon: <Layers className="h-3 w-3 text-violet-400 shrink-0" />,
                                  src: `/api/sessions/${session.id}/assets/${c.figmaImagePath}`,
                                  alt: `Figma: ${c.frameName}`,
                                },
                                {
                                  label: 'Live app',
                                  icon: <Globe className="h-3 w-3 text-zinc-500 shrink-0" />,
                                  src: `/api/sessions/${session.id}/assets/${c.screenshotPath}`,
                                  alt: `Live: ${c.frameName}`,
                                },
                                ...(c.diffImagePath ? [{
                                  label: 'Pixel diff',
                                  icon: <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />,
                                  src: `/api/sessions/${session.id}/assets/${c.diffImagePath}`,
                                  alt: `Diff: ${c.frameName}`,
                                }] : []),
                              ];
                              return (
                                <div className={`grid divide-x divide-zinc-800 ${cols.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                                  {cols.map(({ label, icon, src, alt }) => (
                                    <div key={label} className="space-y-0">
                                      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950/60">
                                        {icon}
                                        <span className="text-[10px] text-zinc-500">{label}</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setImageModal({ src, alt, label: `${c.frameName} — ${label}` })}
                                        className="relative w-full group bg-zinc-950 block"
                                        title="Click to enlarge"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={src}
                                          alt={alt}
                                          className="w-full h-52 object-cover object-top block transition-opacity group-hover:opacity-75"
                                        />
                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25">
                                          <ZoomIn className="h-7 w-7 text-white drop-shadow-lg" />
                                        </span>
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}

                            {/* ── Discrepancy findings ─────────────────────────── */}
                            {issues.length > 0 ? (
                              <div className="divide-y divide-zinc-800/60 border-t border-zinc-800">
                                {issues.map((d, j) => (
                                  <div key={j} className="px-4 py-3 flex items-start gap-3">
                                    <span className={`shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mt-0.5 ${
                                      d.severity === 'high'   ? 'bg-red-500/15 text-red-400'
                                      : d.severity === 'medium' ? 'bg-amber-500/15 text-amber-400'
                                      : 'bg-zinc-700/60 text-zinc-400'
                                    }`}>
                                      {d.severity}
                                    </span>
                                    <div className="flex-1 min-w-0 space-y-0.5">
                                      <p className="text-xs font-medium text-zinc-200">{d.element}</p>
                                      <p className="text-xs text-zinc-400">{d.issue}</p>
                                      {(d.figmaValue || d.liveValue) && (
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                          {d.figmaValue && (
                                            <span className="text-[10px] text-zinc-500">
                                              Design: <span className="text-violet-400 font-mono">{d.figmaValue}</span>
                                            </span>
                                          )}
                                          {d.liveValue && (
                                            <span className="text-[10px] text-zinc-500">
                                              Live: <span className="text-zinc-300 font-mono">{d.liveValue}</span>
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {/* Per-discrepancy element screenshot */}
                                    {d.screenshotPath && (
                                      <button
                                        type="button"
                                        onClick={() => setImageModal({
                                          src: `/api/sessions/${session.id}/assets/${d.screenshotPath}`,
                                          alt: `${d.element} — live element`,
                                          label: `${c.frameName} — ${d.element}`,
                                        })}
                                        className="shrink-0 rounded overflow-hidden border border-zinc-700 hover:border-zinc-500 transition-colors group relative"
                                        title={`Live element: ${d.element} — click to enlarge`}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={`/api/sessions/${session.id}/assets/${d.screenshotPath}`}
                                          alt={d.element}
                                          className="w-24 h-16 object-cover object-top block group-hover:opacity-75 transition-opacity"
                                        />
                                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                                          <ZoomIn className="h-4 w-4 text-white" />
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2 text-xs text-emerald-400">
                                <span>✓</span>
                                <span>No discrepancies found — page matches design</span>
                              </div>
                            )}

                            {/* ── Footer ─────────────────────────────────────── */}
                            <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-3 bg-zinc-950/40">
                              {highCount > 0 && (
                                <span className="text-[10px] text-red-400">{highCount} high</span>
                              )}
                              {mediumCount > 0 && (
                                <span className="text-[10px] text-amber-400">{mediumCount} medium</span>
                              )}
                              {lowCount > 0 && (
                                <span className="text-[10px] text-zinc-500">{lowCount} low</span>
                              )}
                              {issues.length === 0 && (
                                <span className="text-[10px] text-emerald-500">✓ Design matches</span>
                              )}
                              <span className="ml-auto text-[10px] text-zinc-500 flex items-center gap-1">
                                <ZoomIn className="h-3 w-3" /> Click images to enlarge
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-xs text-zinc-600 px-1">
                        Verification test file at{" "}
                        <code className="text-zinc-500">{session.figmaResult.testFile}</code>
                        {" "}— run with{" "}
                        <code className="text-zinc-500">npx playwright test figma-verification.spec.ts</code>
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
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => toggleSection("testfiles")}
                    className="flex items-center gap-2 flex-1 group"
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

                  {/* Download button */}
                  <a
                    href={`/api/sessions/${session.id}/download`}
                    download
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-zinc-50 transition shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download ZIP
                  </a>
                </div>
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
