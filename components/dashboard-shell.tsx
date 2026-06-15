'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, ArrowRight, Bug, ChevronDown, ChevronLeft, ChevronRight,
  Clock, FileCode2, Globe, Layers3, Loader2, Menu,
  PanelLeftClose, PanelLeftOpen, Trash2, User, X,
  Zap,
} from 'lucide-react';
import type { Session } from '@/types/session';
import { Paginator } from '@/components/paginator';

// ── helpers ───────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['exploring', 'analyzing', 'generating', 'running', 'fixing', 'figma-checking'];

function isActive(status: string) { return ACTIVE_STATUSES.includes(status); }

function timeAgo(ts: number) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function shortPath(url: string) {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '' : u.pathname;
  } catch { return ''; }
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const PHASE_ORDER: Session['status'][] = [
  'idle', 'exploring', 'analyzing', 'generating', 'running', 'fixing', 'complete',
];

// ── SVG Donut chart ───────────────────────────────────────────────────────────

interface DonutProps { passed: number; failed: number; errors: number }

function DonutChart({ passed, failed, errors }: DonutProps) {
  const total = passed + failed + errors;
  if (total === 0) return null;

  const r = 40; const cx = 52; const cy = 52;
  const C = 2 * Math.PI * r;

  const pL = (passed / total) * C;   // passed arc length
  const fL = (failed / total) * C;   // failed arc length
  const eL = (errors / total) * C;   // errors arc length
  const passRate = Math.round((passed / total) * 100);

  function arc(stroke: string, len: number, startAt: number) {
    return (
      <circle
        cx={cx} cy={cy} r={r}
        fill="none" stroke={stroke} strokeWidth={11}
        strokeDasharray={`${len} ${C}`}
        strokeDashoffset={-startAt}
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeLinecap="butt"
      />
    );
  }

  return (
    <svg viewBox="0 0 104 104" className="w-24 h-24 shrink-0">
      {/* Track — zinc-800 auto-inverts (subtle in both modes) */}
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={11}
        className="stroke-zinc-800" />
      {passed > 0 && arc('#10b981', pL, 0)}
      {failed > 0 && arc('#ef4444', fL, pL)}
      {errors > 0 && arc('#f59e0b', eL, pL + fL)}
      {/* Centre label — zinc-100 auto-inverts: near-white (dark) / near-black (light) */}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={17} fontWeight="bold"
        className="fill-zinc-100">
        {passRate}%
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize={9}
        className="fill-zinc-500">
        pass rate
      </text>
    </svg>
  );
}

// ── Pass rate history bar chart ───────────────────────────────────────────────

interface HistoryBarChartProps {
  values: (number | null)[];
  createdAts: number[];
}

function HistoryBarChart({ values, createdAts }: HistoryBarChartProps) {
  if (values.length === 0) return null;

  const MAX_BAR_PX = 64; // tallest a bar can be

  return (
    <div className="space-y-2">
      {/* Bars */}
      <div className="flex items-end gap-2">
        {values.map((v, i) => {
          const pct   = v !== null ? Math.round(v * 100) : null;
          const barH  = v !== null ? Math.max(4, Math.round(v * MAX_BAR_PX)) : 4;
          const color =
            v === null  ? 'bg-zinc-700'
            : v >= 0.8  ? 'bg-emerald-500'
            : v >= 0.5  ? 'bg-amber-500'
            :              'bg-red-500';
          const textColor =
            v === null  ? 'text-zinc-400'
            : v >= 0.8  ? 'text-emerald-400'
            : v >= 0.5  ? 'text-amber-400'
            :              'text-red-400';

          return (
            <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1">
              <span className={`text-[11px] font-semibold leading-none ${textColor}`}>
                {pct !== null ? `${pct}%` : '—'}
              </span>
              <div className={`w-full rounded-sm ${color}`} style={{ height: barH }} />
            </div>
          );
        })}
      </div>

      {/* Date labels */}
      <div className="flex gap-2">
        {createdAts.map((ts, i) => (
          <div key={i} className="flex-1 text-center min-w-0">
            <span className="text-[10px] text-zinc-400 truncate block">
              {new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Phase stepper (active sessions) ──────────────────────────────────────────

function PhaseStepper({ status }: { status: Session['status'] }) {
  if (status === 'complete' || status === 'failed' || status === 'idle') return null;
  const phases = ['exploring', 'analyzing', 'generating', 'running', 'fixing'];
  const current = phases.indexOf(status);
  return (
    <div className="flex items-center gap-0">
      {phases.map((ph, i) => {
        const done    = i < current;
        const active  = i === current;
        const pending = i > current;
        return (
          <div key={ph} className="flex items-center">
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium capitalize transition-all ${
              active  ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40'
              : done  ? 'text-emerald-500'
              : 'text-zinc-400'
            }`}>
              {active && <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />}
              {ph}
            </div>
            {i < phases.length - 1 && (
              <ChevronRight className={`h-3 w-3 mx-0.5 ${done ? 'text-zinc-400' : 'text-zinc-400'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (isActive(status)) return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 capitalize">
      <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
      {status}
    </span>
  );
  if (status === 'complete') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
      Complete
    </span>
  );
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
      Failed
    </span>
  );
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 capitalize">{status}</span>
  );
}

// ── Sidebar session item ──────────────────────────────────────────────────────

interface SidebarItemProps {
  session: Session;
  initiator: string | null;
  selected: boolean;
  onClick: () => void;
  isAdmin: boolean;
  deleting: boolean;
  onDelete: () => void;
  /** Hide the hostname (shown by the app group header it's nested under). */
  hideHost?: boolean;
}

function SidebarItem({ session: s, initiator, selected, onClick, isAdmin, deleting, onDelete, hideHost }: SidebarItemProps) {
  const host = hostname(s.url);
  const path = shortPath(s.url);
  const stats = s.testResult?.stats;
  const total = stats ? stats.passed + stats.failed + (stats.errors ?? 0) : 0;
  const rate  = total > 0 ? Math.round(stats!.passed / total * 100) : null;
  const running = isActive(s.status) || s.figmaChecking;

  function dot() {
    if (isActive(s.status)) return (
      <div className="relative h-2 w-2 shrink-0 mt-[3px]">
        <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-60" />
        <span className="absolute inset-0 rounded-full bg-violet-500" />
      </div>
    );
    if (s.status === 'complete') return <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 mt-[3px]" />;
    if (s.status === 'failed')   return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0 mt-[3px]" />;
    return <span className="h-2 w-2 rounded-full bg-zinc-600 shrink-0 mt-[3px]" />;
  }

  return (
    <div
      className={`group relative w-full flex items-start rounded-lg transition-colors ${
        selected ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <button
        onClick={onClick}
        className="flex-1 min-w-0 text-left flex items-start gap-2.5 px-3 py-2.5"
      >
        {dot()}
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-medium truncate leading-tight" title={hideHost ? s.id : undefined}>
            {hideHost
              ? <span className="font-mono">{s.id}</span>
              : <>{host}{path && <span className="text-zinc-400 font-normal">{path}</span>}</>}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span>{timeAgo(s.createdAt)}</span>
            {rate !== null && (
              <span className={`font-medium ${rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                · {rate}%
              </span>
            )}
          </div>
          {initiator && (
            <p className="text-[11px] text-zinc-400 truncate">{initiator}</p>
          )}
        </div>
      </button>

      {/* Admin delete — hidden for running sessions (can't delete those) */}
      {isAdmin && (
        running ? (
          <span
            className="shrink-0 mr-2 mt-2 text-zinc-400"
            title="Running sessions can't be deleted — stop it first"
          >
            <Trash2 className="h-3.5 w-3.5 opacity-40" />
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            title="Delete session"
            className="shrink-0 mr-2 mt-2 p-1 rounded text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-100"
          >
            {deleting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        )
      )}
    </div>
  );
}

// ── Session detail (main panel) ───────────────────────────────────────────────

interface DetailProps {
  session: Session;
  membersMap: Record<string, string>;
  domainHistory: (number | null)[];
  domainCreatedAts: number[];
}

function SessionDetail({ session: s, membersMap, domainHistory, domainCreatedAts }: DetailProps) {
  const stats     = s.testResult?.stats;
  const total     = stats ? stats.passed + stats.failed + (stats.errors ?? 0) : 0;
  const passRate  = total > 0 ? Math.round(stats!.passed / total * 100) : null;
  const pages     = s.siteMap?.total_pages ?? 0;
  const initiator = membersMap[s.createdByUserId] ?? null;

  const rateColor =
    passRate === null       ? 'text-zinc-400'
    : passRate >= 80        ? 'text-emerald-400'
    : passRate >= 50        ? 'text-amber-400'
    :                         'text-red-400';

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-lg font-semibold text-zinc-100 truncate">
                {hostname(s.url)}
                <span className="text-zinc-400 font-normal">{shortPath(s.url)}</span>
              </h1>
              <StatusBadge status={s.status} />
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
              {initiator && (
                <span className="flex items-center gap-1.5">
                  <span className="h-4 w-4 rounded-full bg-violet-700/60 flex items-center justify-center text-[10px] font-bold text-violet-200">
                    {initiator.charAt(0).toUpperCase()}
                  </span>
                  {initiator}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Started {timeAgo(s.createdAt)}
              </span>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-zinc-300 transition-colors"
              >
                <Globe className="h-3 w-3" />
                {s.url.replace(/^https?:\/\//, '')}
              </a>
            </div>
          </div>
          <Link
            href={`/session/${s.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors shrink-0"
          >
            Open session
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {/* Phase stepper (active sessions) */}
        {isActive(s.status) && (
          <div className="overflow-x-auto">
            <PhaseStepper status={s.status} />
          </div>
        )}
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Zap className="h-4 w-4 text-emerald-400" />} label="Passed" value={stats?.passed ?? '—'} accent="text-emerald-400" />
        <StatCard icon={<Zap className="h-4 w-4 text-red-400" />} label="Failed" value={stats ? (stats.failed + (stats.errors ?? 0)) : '—'} accent="text-red-400" />
        <StatCard icon={<Globe className="h-4 w-4 text-blue-400" />} label="Pages" value={pages > 0 ? pages : '—'} accent="text-blue-400" />
        <StatCard icon={<FileCode2 className="h-4 w-4 text-violet-400" />} label="Spec files" value={s.testFiles.length > 0 ? s.testFiles.length : '—'} accent="text-violet-400" />
      </div>

      {/* ── Analytics row ── */}
      {(total > 0 || domainHistory.length > 1) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Test results ring */}
          {total > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
                Test results
              </p>
              <div className="flex items-center gap-6">
                <DonutChart
                  passed={stats!.passed}
                  failed={stats!.failed}
                  errors={stats!.errors ?? 0}
                />
                <div className="space-y-2 text-xs">
                  <LegendRow color="bg-emerald-500" label="Passed" value={stats!.passed} total={total} />
                  <LegendRow color="bg-red-500"    label="Failed" value={stats!.failed} total={total} />
                  {(stats!.errors ?? 0) > 0 && (
                    <LegendRow color="bg-amber-500" label="Errors" value={stats!.errors!} total={total} />
                  )}
                  <div className="pt-1 border-t border-zinc-800">
                    <span className="text-zinc-400">Total: </span>
                    <span className="text-zinc-300 font-medium">{total} tests</span>
                  </div>
                </div>
              </div>
              {s.testResult?.duration != null && (
                <p className="mt-3 text-[11px] text-zinc-400">
                  Duration: {formatDuration(s.testResult.duration * 1000)}
                </p>
              )}
            </div>
          )}

          {/* Domain history chart */}
          {domainHistory.length > 1 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-0.5">
                Pass rate history
              </p>
              <p className="text-[11px] text-zinc-400 mb-4">
                Each bar is one test run on <span className="text-zinc-400">{hostname(s.url)}</span>.
                Height = pass rate. The dashed line marks 80%.
              </p>
              <HistoryBarChart values={domainHistory} createdAts={domainCreatedAts} />
            </div>
          )}
        </div>
      )}

      {/* ── Iterations ── */}
      {s.iteration > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 flex items-center gap-3">
          <Layers3 className="h-4 w-4 text-zinc-400 shrink-0" />
          <div>
            <p className="text-xs font-medium text-zinc-300">
              {s.iteration} self-heal iteration{s.iteration !== 1 ? 's' : ''}
            </p>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              TestPilot automatically fixed failing tests across {s.iteration} round{s.iteration !== 1 ? 's' : ''}.
            </p>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {s.error && (
        <div className="flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-red-500">Session failed</p>
            <p className="text-xs text-zinc-300 font-mono leading-relaxed break-all">{s.error}</p>
          </div>
        </div>
      )}

      {/* ── Recent logs ── */}
      {s.logs.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
            Recent activity
          </p>
          <div className="space-y-1.5">
            {s.logs.slice(-6).map((log, i) => (
              <p key={i} className={`text-xs font-mono leading-relaxed ${
                log.level === 'error'   ? 'text-red-400'
                : log.level === 'success' ? 'text-emerald-400'
                : 'text-zinc-400'
              }`}>
                <span className="text-zinc-400 mr-2">
                  {new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                {log.msg}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 font-medium uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none ${accent}`}>{value}</p>
    </div>
  );
}

function LegendRow({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round(value / total * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
      <span className="text-zinc-400 w-12">{label}</span>
      <span className="text-zinc-200 font-medium tabular-nums w-6">{value}</span>
      <span className="text-zinc-400">({pct}%)</span>
    </div>
  );
}

// ── App consolidated view — results across every session for one app ──────────

// ── Human time saved — a transparent estimate of manual-QA effort avoided ─────
// Three real, data-backed components: authoring each automated check, every
// automated run that replaces a manual pass, and every failure auto-triaged.
// Per-task minutes are deliberately conservative and shown in the UI so the
// headline number is defensible rather than a black box.
const MIN_AUTHOR = 15; // to hand-write one Playwright test (selectors + asserts + debug)
const MIN_EXEC   = 2;  // to manually click through one test case, once
const MIN_TRIAGE = 5;  // to manually diagnose one failing test

function SavedRow({ label, mins }: { label: string; mins: number }) {
  const h = mins / 60;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate">{label}</span>
      <span className="tabular-nums text-zinc-200 font-medium shrink-0">{h >= 1 ? `${h.toFixed(1)}h` : `${Math.round(mins)}m`}</span>
    </div>
  );
}

function TimeSavedCard({ host, sessions }: { host: string; sessions: Session[] }) {
  const [runs, setRuns] = useState<TrendRun[] | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/trends?host=${encodeURIComponent(host)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active) setRuns(d?.runs ?? []); })
      .catch(() => { if (active) setRuns([]); });
    return () => { active = false; };
  }, [host]);

  // Authored suite size = the largest single run's case count. Sessions for the
  // same app re-test the same suite, so we take the max instead of summing —
  // otherwise re-runs would inflate the "authoring" figure.
  const suiteSize = useMemo(() => {
    let max = 0;
    for (const s of sessions) {
      const st = s.testResult?.stats;
      if (st) max = Math.max(max, st.passed + st.failed + (st.errors ?? 0));
    }
    return max;
  }, [sessions]);

  const exec = useMemo(() => {
    let executions = 0, failures = 0;
    for (const r of runs ?? []) { executions += r.total || 0; failures += (r.failed || 0) + (r.errors || 0); }
    return { executions, failures, runCount: (runs ?? []).length };
  }, [runs]);

  const authorMin = suiteSize * MIN_AUTHOR;
  const execMin   = exec.executions * MIN_EXEC;
  const triageMin = exec.failures * MIN_TRIAGE;
  const hours = (authorMin + execMin + triageMin) / 60;
  const days  = hours / 8;

  if (suiteSize === 0 && exec.executions === 0) return null; // nothing to estimate yet
  const fmtH = hours >= 10 ? Math.round(hours).toString() : hours.toFixed(1);

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-5">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="h-4 w-4 text-emerald-400" />
        <p className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">Human time saved</p>
      </div>
      <p className="text-3xl font-bold text-emerald-400 tabular-nums">
        ≈ {fmtH} <span className="text-lg font-semibold text-emerald-400">hours</span>
      </p>
      {hours >= 8 && (
        <p className="text-xs text-zinc-400 mt-0.5">about {days.toFixed(1)} work-day{days >= 2 ? 's' : ''} of manual QA</p>
      )}

      <div className="mt-4 space-y-1 text-[11px] text-zinc-300">
        <SavedRow label={`Authoring ${suiteSize} test${suiteSize !== 1 ? 's' : ''}`} mins={authorMin} />
        {runs === null ? (
          <p className="text-zinc-400">Loading run history…</p>
        ) : (
          <>
            <SavedRow label={`Running ${exec.executions} checks across ${exec.runCount} run${exec.runCount !== 1 ? 's' : ''}`} mins={execMin} />
            <SavedRow label={`Triaging ${exec.failures} failure${exec.failures !== 1 ? 's' : ''}`} mins={triageMin} />
          </>
        )}
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">
        Estimate · {MIN_AUTHOR} min to author · {MIN_EXEC} min per manual run · {MIN_TRIAGE} min per triage
      </p>
    </div>
  );
}

// ── App Profile view — the editable feature-context "brief" ───────────────────
type PfCrit = 'critical' | 'normal' | 'low';
interface PfFeature {
  id: string; name: string; area: string | null;
  journeys: string[]; expectedOutcomes: string[];
  criticality: PfCrit; source: string; confidence: string; quarantined: boolean;
}
interface PfData {
  host: string; purpose: string | null;
  personas: { name: string; description: string }[];
  glossary: { term: string; definition: string }[];
  envSignals: { authModel?: string; spa?: boolean; consentVendor?: string | null; locales?: string[] };
  source: string; updatedAt: number; features: PfFeature[];
}

interface PfFeatureHealth { id: string; testCount: number; passRate: number | null; flaky: number; untested: boolean; trend: number[]; tests: string[] }

/** Tiny pass-rate sparkline (oldest→newest), coloured by the latest value. */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const w = 48, h = 14;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];
  const stroke = last >= 80 ? '#34d399' : last >= 50 ? '#fbbf24' : '#f87171';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
interface PfHealth { features: PfFeatureHealth[]; totalFeatures: number; untestedCount: number; criticalUntested: number; criticalFailing: number }

/** Per-feature health pill: pass rate %, flaky, or untested. */
function HealthBadge({ h }: { h?: PfFeatureHealth }) {
  if (!h || h.untested) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50">untested</span>;
  if (h.passRate == null) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50">not run</span>;
  const cls = h.passRate >= 80 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : h.passRate >= 50 ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
    : 'text-red-400 bg-red-500/10 border-red-500/30';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`text-[10px] px-2 py-0.5 rounded-full border tabular-nums ${cls}`}>{h.passRate}%</span>
      {h.flaky > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">flaky</span>}
    </span>
  );
}

const CRIT_META: Record<PfCrit, { label: string; cls: string }> = {
  critical: { label: 'Critical', cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
  normal:   { label: 'Normal',   cls: 'text-zinc-300 bg-zinc-700/40 border-zinc-600/40' },
  low:      { label: 'Low',      cls: 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40' },
};

function FeatureEditor({ initial, onSave, onCancel, saving }: {
  initial: Partial<PfFeature>;
  onSave: (f: { id?: string; name: string; area: string | null; criticality: PfCrit; journeys: string[]; expectedOutcomes: string[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [area, setArea] = useState(initial.area ?? '');
  const [crit, setCrit] = useState<PfCrit>(initial.criticality ?? 'normal');
  const [journeys, setJourneys] = useState((initial.journeys ?? []).join('\n'));
  const [outcomes, setOutcomes] = useState((initial.expectedOutcomes ?? []).join('\n'));
  const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
  const inp = 'text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-violet-500';
  return (
    <div className="rounded-xl border border-violet-500/30 bg-zinc-900/60 p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Feature name" className={`flex-1 min-w-[160px] ${inp}`} />
        <input value={area} onChange={e => setArea(e.target.value)} placeholder="Area" className={`w-36 ${inp}`} />
        <select value={crit} onChange={e => setCrit(e.target.value as PfCrit)} className="text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-zinc-200">
          <option value="critical">Critical</option><option value="normal">Normal</option><option value="low">Low</option>
        </select>
      </div>
      <div>
        <label className="text-[11px] text-zinc-400">Journeys (one per line)</label>
        <textarea value={journeys} onChange={e => setJourneys(e.target.value)} rows={3} className={`mt-1 w-full text-xs ${inp}`} />
      </div>
      <div>
        <label className="text-[11px] text-zinc-400">Expected outcomes (one per line)</label>
        <textarea value={outcomes} onChange={e => setOutcomes(e.target.value)} rows={2} className={`mt-1 w-full text-xs ${inp}`} />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancel</button>
        <button disabled={!name.trim() || saving}
          onClick={() => onSave({ id: initial.id, name: name.trim(), area: area.trim() || null, criticality: crit, journeys: lines(journeys), expectedOutcomes: lines(outcomes) })}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function ProfileView({ host }: { host: string }) {
  const [data, setData] = useState<PfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editPurpose, setEditPurpose] = useState(false);
  const [purposeDraft, setPurposeDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null); // feature id, or 'new'
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<PfHealth | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [genId, setGenId] = useState<string | null>(null);  // feature currently generating a test
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [askQ, setAskQ] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let active = true; setLoading(true);
    fetch(`/api/app-profile?host=${encodeURIComponent(host)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    // Feature health (coverage + pass rate + flaky) is best-effort, parallel.
    fetch(`/api/feature-health?host=${encodeURIComponent(host)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active) setHealth(d); })
      .catch(() => { if (active) setHealth(null); });
    return () => { active = false; };
  }, [host]);

  const healthById = useMemo(() => {
    const m: Record<string, PfFeatureHealth> = {};
    for (const h of health?.features ?? []) m[h.id] = h;
    return m;
  }, [health]);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    const d = await fetch('/api/app-profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, ...body }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setData(d);
    setSaving(false);
    return d;
  }

  async function genFeatureTest(featureId: string, name: string) {
    setGenId(featureId); setGenMsg(null);
    const d = await fetch('/api/app-profile/generate-feature', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, featureId }),
    }).then(r => (r.ok ? r.json() : r.json().then(e => Promise.reject(e)))).catch(e => ({ error: e?.error }));
    setGenId(null);
    setGenMsg(d?.ok ? `Generated ${d.testFile} for "${name}" — the feature now has coverage.` : `Could not generate: ${d?.error ?? 'error'}`);
    // Refresh health so the feature flips from "untested" and the button hides.
    if (d?.ok) {
      fetch(`/api/feature-health?host=${encodeURIComponent(host)}`)
        .then(r => (r.ok ? r.json() : null)).then(setHealth).catch(() => {});
    }
  }

  async function toggleQuarantine(featureId: string, quarantined: boolean) {
    const d = await patch({ quarantine: { featureId, quarantined } });
    if (d) {
      fetch(`/api/feature-health?host=${encodeURIComponent(host)}`)
        .then(r => (r.ok ? r.json() : null)).then(setHealth).catch(() => {});
    }
  }

  async function ask() {
    if (!askQ.trim()) return;
    setAsking(true); setAskAnswer(null);
    const d = await fetch('/api/app-profile/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, question: askQ }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    setAsking(false);
    setAskAnswer(d?.answer ?? 'Could not answer right now.');
  }

  async function runFeature(featureId: string, name: string) {
    setGenMsg(`Starting run for "${name}"…`);
    const d = await fetch('/api/app-profile/run-critical', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host, featureId }),
    }).then(r => (r.ok ? r.json() : r.json().then(e => Promise.reject(e)))).catch(e => ({ error: e?.error }));
    setGenMsg(d?.ok
      ? `Run started for "${name}" (${d.ran} test${d.ran !== 1 ? 's' : ''}) — watch the session log; health updates when it finishes.`
      : `Could not run: ${d?.error ?? 'error'}`);
  }

  async function runCritical() {
    setGenMsg('Starting critical smoke run…');
    const d = await fetch('/api/app-profile/run-critical', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host }),
    }).then(r => (r.ok ? r.json() : r.json().then(e => Promise.reject(e)))).catch(e => ({ error: e?.error }));
    setGenMsg(d?.ok
      ? `Critical smoke run started (${d.ran} test${d.ran !== 1 ? 's' : ''}) — watch the session log; health updates when it finishes.`
      : `Could not start: ${d?.error ?? 'error'}`);
  }

  async function rebuild() {
    setRebuilding(true);
    const d = await fetch('/api/app-profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setData(d);
    fetch(`/api/feature-health?host=${encodeURIComponent(host)}`)
      .then(r => (r.ok ? r.json() : null)).then(setHealth).catch(() => {});
    setRebuilding(false);
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 text-zinc-400 animate-spin" /></div>;
  if (!data) return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
      <p className="text-sm text-zinc-300 mb-1">No profile yet</p>
      <p className="text-xs text-zinc-400">The app brief — purpose, who uses it, and its features — is built automatically the next time this app is crawled.</p>
    </div>
  );

  const sectionCls = 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-5';
  return (
    <div className="space-y-5">
      {/* Header — refresh state + manual rebuild */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-400">
          Auto-rebuilds when your doc, Figma, or crawl changes · edits are preserved
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => void runCritical()}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition"
            title="Run only the tests that cover CRITICAL features (fast feedback)">
            Run critical
          </button>
          <button onClick={() => void rebuild()} disabled={rebuilding}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition disabled:opacity-50">
            {rebuilding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {rebuilding ? 'Rebuilding…' : 'Rebuild profile'}
          </button>
        </div>
      </div>

      {/* Ask about coverage (#11) */}
      <section className={sectionCls}>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Ask about coverage</p>
        <div className="flex gap-2">
          <input value={askQ} onChange={e => setAskQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void ask(); }}
            placeholder="e.g. what's critical and untested? is checkout covered?"
            className="flex-1 text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-violet-500" />
          <button onClick={() => void ask()} disabled={asking || !askQ.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition disabled:opacity-50">
            {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Ask
          </button>
        </div>
        {askAnswer && <p className="mt-3 text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{askAnswer}</p>}
      </section>

      {/* Purpose */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Purpose</p>
          {!editPurpose && <button onClick={() => { setPurposeDraft(data.purpose ?? ''); setEditPurpose(true); }} className="text-[11px] text-violet-400 hover:text-violet-300">Edit</button>}
        </div>
        {editPurpose ? (
          <div className="space-y-2">
            <textarea value={purposeDraft} onChange={e => setPurposeDraft(e.target.value)} rows={3}
              className="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none focus:border-violet-500" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditPurpose(false)} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800">Cancel</button>
              <button disabled={saving} onClick={async () => { await patch({ profile: { purpose: purposeDraft } }); setEditPurpose(false); }}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-200 leading-relaxed">{data.purpose || <span className="text-zinc-400 italic">No purpose set.</span>}</p>
        )}
      </section>

      {/* Personas + Glossary */}
      <div className="grid sm:grid-cols-2 gap-4">
        <section className={sectionCls}>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Personas</p>
          {data.personas.length ? (
            <ul className="space-y-2">
              {data.personas.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
                  <span><span className="text-zinc-100 font-medium">{p.name}</span> <span className="text-zinc-400">— {p.description}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-zinc-400 italic">None.</p>}
        </section>
        <section className={sectionCls}>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Glossary</p>
          {data.glossary.length ? (
            <ul className="space-y-1.5 text-sm">
              {data.glossary.map((g, i) => (<li key={i}><span className="text-zinc-100 font-medium">{g.term}</span> <span className="text-zinc-400">— {g.definition}</span></li>))}
            </ul>
          ) : <p className="text-xs text-zinc-400 italic">None.</p>}
        </section>
      </div>

      {/* Environment */}
      <section className={sectionCls}>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Environment</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {data.envSignals.authModel && <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300">Auth: {data.envSignals.authModel}</span>}
          {data.envSignals.spa !== undefined && <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300">{data.envSignals.spa ? 'SPA' : 'Multi-page'}</span>}
          {data.envSignals.consentVendor && <span className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300">Consent: {data.envSignals.consentVendor}</span>}
          {(data.envSignals.locales ?? []).map(l => (<span key={l} className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-300">{l}</span>))}
          {!data.envSignals.authModel && data.envSignals.spa === undefined && !data.envSignals.consentVendor && !(data.envSignals.locales?.length) &&
            <span className="text-zinc-400 italic">No signals captured.</span>}
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Features <span className="text-zinc-400">({data.features.length})</span></p>
          {editId !== 'new' && <button onClick={() => setEditId('new')} className="text-[11px] text-violet-400 hover:text-violet-300">+ Add feature</button>}
        </div>
        {health && (health.untestedCount > 0 || health.criticalFailing > 0) && (
          <p className="mb-2 text-[11px] text-zinc-400">
            Coverage: <span className="text-zinc-200">{health.totalFeatures - health.untestedCount}/{health.totalFeatures}</span> features have tests
            {health.criticalUntested > 0 && <span className="text-red-400"> · {health.criticalUntested} critical gap{health.criticalUntested !== 1 ? 's' : ''}</span>}
            {health.criticalFailing > 0 && <span className="text-red-400"> · {health.criticalFailing} critical feature{health.criticalFailing !== 1 ? 's' : ''} failing</span>}
          </p>
        )}
        {genMsg && <p className="mb-2 text-[11px] text-emerald-400">{genMsg}</p>}
        <div className="space-y-2">
          {editId === 'new' && (
            <FeatureEditor initial={{}} saving={saving} onCancel={() => setEditId(null)} onSave={async f => { await patch({ feature: f }); setEditId(null); }} />
          )}
          {data.features.map(f => editId === f.id ? (
            <FeatureEditor key={f.id} initial={f} saving={saving} onCancel={() => setEditId(null)} onSave={async nf => { await patch({ feature: nf }); setEditId(null); }} />
          ) : (
            <div key={f.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-100">{f.name}</span>
                    {f.area && <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{f.area}</span>}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CRIT_META[f.criticality].cls}`}>{CRIT_META[f.criticality].label}</span>
                    {f.source === 'user' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">edited</span>}
                    {f.source === 'crawl' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">proposed</span>}
                    {f.quarantined && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">quarantined</span>}
                    {!f.quarantined && <HealthBadge h={healthById[f.id]} />}
                    {!f.quarantined && <Sparkline data={healthById[f.id]?.trend ?? []} />}
                  </div>
                  {f.journeys.length > 0 && (
                    <ul className="mt-2 space-y-0.5">{f.journeys.map((j, i) => (<li key={i} className="text-xs text-zinc-300">→ {j}</li>))}</ul>
                  )}
                  {f.expectedOutcomes.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-zinc-400">Expected: {f.expectedOutcomes.join('; ')}</p>
                  )}
                  {(healthById[f.id]?.tests?.length ?? 0) > 0 && (
                    <p className="mt-1.5 text-[10px] text-zinc-400">
                      <span className="text-zinc-300">Verified by {healthById[f.id]!.tests.length} test{healthById[f.id]!.tests.length !== 1 ? 's' : ''}:</span>{' '}
                      {healthById[f.id]!.tests.slice(0, 3).join(' · ')}
                      {healthById[f.id]!.tests.length > 3 ? ` +${healthById[f.id]!.tests.length - 3} more` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Untested → offer generation; covered → offer a feature-scoped run (#6). */}
                  {healthById[f.id]?.untested !== false ? (
                    <button onClick={() => void genFeatureTest(f.id, f.name)} disabled={genId === f.id}
                      className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 px-2 py-1 disabled:opacity-50"
                      title="Generate an e2e test from this feature's journeys + expected outcomes">
                      {genId === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {genId === f.id ? 'Generating…' : 'Generate test'}
                    </button>
                  ) : (
                    <button onClick={() => void runFeature(f.id, f.name)}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1"
                      title="Run only this feature's tests">Run</button>
                  )}
                  <button onClick={() => void toggleQuarantine(f.id, !f.quarantined)}
                    className="text-[11px] text-zinc-400 hover:text-amber-400 px-2 py-1"
                    title={f.quarantined ? 'Restore — include in gate + counts' : 'Quarantine — exclude flaky/low-value feature from the gate + counts'}>
                    {f.quarantined ? 'Restore' : 'Quarantine'}
                  </button>
                  <button onClick={() => setEditId(f.id)} className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1">Edit</button>
                  <button onClick={() => { if (window.confirm(`Delete feature "${f.name}"?`)) void patch({ deleteFeatureId: f.id }); }}
                    className="text-zinc-400 hover:text-red-400 p-1" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
          {data.features.length === 0 && editId !== 'new' && <p className="text-xs text-zinc-400 italic">No features yet.</p>}
        </div>
      </section>
    </div>
  );
}

const SESSIONS_PAGE_SIZE = 8;

function AppConsolidated({
  host, sessions, onSelectSession,
}: {
  host: string;
  sessions: Session[];
  onSelectSession: (id: string) => void;
}) {
  const agg = useMemo(() => {
    let passed = 0, failed = 0, errors = 0, specs = 0, withResults = 0;
    for (const s of sessions) {
      const st = s.testResult?.stats;
      if (st) { passed += st.passed; failed += st.failed; errors += st.errors ?? 0; withResults++; }
      specs += s.testFiles?.length ?? 0;
    }
    const total = passed + failed + errors;
    return { passed, failed, errors, specs, total, withResults, rate: total > 0 ? Math.round(passed / total * 100) : null };
  }, [sessions]);

  const anyActive = sessions.some(s => isActive(s.status));
  const lastRun = sessions.reduce((m, s) => Math.max(m, s.createdAt), 0);
  const [tab, setTab] = useState<'overview' | 'profile' | 'cases' | 'areas' | 'trends'>('overview');
  const [sessionPage, setSessionPage] = useState(0);
  const [triage, setTriage] = useState<{ testBugs: number; appBugs: number; setupErrors: number } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/triage-summary?host=${encodeURIComponent(host)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active) setTriage(d); })
      .catch(() => { if (active) setTriage(null); });
    return () => { active = false; };
  }, [host]);

  function sessionDot(s: Session) {
    if (isActive(s.status)) return <span className="h-2 w-2 rounded-full bg-violet-500 shrink-0" />;
    if (s.status === 'complete') return <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />;
    if (s.status === 'failed')   return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />;
    return <span className="h-2 w-2 rounded-full bg-zinc-600 shrink-0" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="h-8 w-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
            <Globe className="h-4 w-4 text-violet-400" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100 truncate">{host}</h1>
          {anyActive && (
            <span className="text-[11px] font-semibold text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded-full">
              running
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-400">
          Consolidated results across {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          {lastRun > 0 && <> · last activity {timeAgo(lastRun)}</>}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 -mt-2">
        {([['overview', 'Overview'], ['profile', 'Profile'], ['cases', 'Test cases'], ['areas', 'Areas'], ['trends', 'Trends']] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'trends' ? (
        <TrendsView host={host} />
      ) : tab === 'profile' ? (
        <ProfileView host={host} />
      ) : tab === 'cases' ? (
        <TestCasesView host={host} />
      ) : tab === 'areas' ? (
        <AreasView host={host} />
      ) : (
      <>
      {/* Headline impact metric — manual-QA hours this app's automation saved */}
      <TimeSavedCard host={host} sessions={sessions} />

      {/* Aggregate stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={<Layers3 className="h-4 w-4 text-zinc-400" />} label="Sessions" value={sessions.length} accent="text-zinc-100" />
        <StatCard icon={<Zap className="h-4 w-4 text-emerald-400" />} label="Passed" value={agg.total > 0 ? agg.passed : '—'} accent="text-emerald-400" />
        <StatCard icon={<Zap className="h-4 w-4 text-red-400" />} label="Failed" value={agg.total > 0 ? agg.failed + agg.errors : '—'} accent="text-red-400" />
        <StatCard icon={<FileCode2 className="h-4 w-4 text-violet-400" />} label="Spec files" value={agg.specs > 0 ? agg.specs : '—'} accent="text-violet-400" />
        <StatCard icon={<AlertCircle className="h-4 w-4 text-amber-400" />} label="Test bugs" value={triage ? triage.testBugs : '—'} accent="text-amber-400" />
        <StatCard icon={<Bug className="h-4 w-4 text-red-400" />} label="App bugs" value={triage ? triage.appBugs : '—'} accent="text-red-400" />
      </div>

      {/* Combined test-results ring */}
      {agg.total > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
            Combined test results
          </p>
          <div className="flex items-center gap-6">
            <DonutChart passed={agg.passed} failed={agg.failed} errors={agg.errors} />
            <div className="space-y-2 text-xs">
              <LegendRow color="bg-emerald-500" label="Passed" value={agg.passed} total={agg.total} />
              <LegendRow color="bg-red-500"    label="Failed" value={agg.failed} total={agg.total} />
              {agg.errors > 0 && <LegendRow color="bg-amber-500" label="Errors" value={agg.errors} total={agg.total} />}
              <div className="pt-1 border-t border-zinc-800">
                <span className="text-zinc-400">Total: </span>
                <span className="text-zinc-300 font-medium">{agg.total} tests across {agg.withResults} run session(s)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-session breakdown — click to drill into one session */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Sessions</p>
        <div className="space-y-1.5">
          {sessions.slice(sessionPage * SESSIONS_PAGE_SIZE, (sessionPage + 1) * SESSIONS_PAGE_SIZE).map(s => {
            const st = s.testResult?.stats;
            const t = st ? st.passed + st.failed + (st.errors ?? 0) : 0;
            const rate = t > 0 ? Math.round(st!.passed / t * 100) : null;
            return (
              <button
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className="w-full flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
              >
                {sessionDot(s)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-zinc-200 truncate">{s.id}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {timeAgo(s.createdAt)} · {s.status}
                    {s.testFiles.length > 0 && <> · {s.testFiles.length} spec{s.testFiles.length !== 1 ? 's' : ''}</>}
                  </p>
                </div>
                {rate !== null && (
                  <span className={`text-xs font-semibold tabular-nums shrink-0 ${rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {rate}%
                  </span>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              </button>
            );
          })}
        </div>
        <Paginator page={sessionPage} pageSize={SESSIONS_PAGE_SIZE} total={sessions.length} onPage={setSessionPage} />
      </div>
      </>
      )}
    </div>
  );
}

// ── App test cases view (what TestPilot identified/generated/added) ───────────

type TestCaseSource = 'generated' | 'scenario' | 'figma';
interface AppTestCase { title: string; description: string; area: string; file: string; source: TestCaseSource; sessionCount: number; coverage: number }
interface AppTestCasesData {
  host: string; totalSessions: number; suiteSessions: number;
  uniqueCount: number; avgPerSession: number; consistentCount: number;
  cases: AppTestCase[];
}

const SOURCE_META: Record<TestCaseSource, { label: string; cls: string }> = {
  generated: { label: 'generated', cls: 'text-violet-300 bg-violet-500/10 border-violet-500/30' },
  scenario:  { label: 'scenario',  cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  figma:     { label: 'figma',     cls: 'text-blue-300 bg-blue-500/10 border-blue-500/30' },
};

const TEST_CASES_PAGE_SIZE = 20;

function TestCasesView({ host }: { host: string }) {
  const [data, setData] = useState<AppTestCasesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [area, setArea] = useState<string | null>(null); // functional-area filter

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPage(0);
    setArea(null);
    fetch(`/api/test-cases?host=${encodeURIComponent(host)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [host]);

  // Area chips with counts (most tests first), plus the filtered + paged view.
  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data?.cases ?? []) counts.set(c.area, (counts.get(c.area) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const filtered = useMemo(
    () => (area ? (data?.cases ?? []).filter(c => c.area === area) : (data?.cases ?? [])),
    [data, area],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 text-zinc-400 animate-spin" />
      </div>
    );
  }
  if (!data || data.uniqueCount === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm text-zinc-400 mb-1">No test cases yet</p>
        <p className="text-xs text-zinc-400">
          Generate a suite for this app and the identified test cases will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<FileCode2 className="h-4 w-4 text-violet-400" />} label="Unique tests" value={data.uniqueCount} accent="text-zinc-100" />
        <StatCard icon={<Layers3 className="h-4 w-4 text-zinc-400" />} label="Suite sessions" value={data.suiteSessions} accent="text-zinc-100" />
        <StatCard icon={<Zap className="h-4 w-4 text-blue-400" />} label="Avg / session" value={data.avgPerSession} accent="text-blue-400" />
        <StatCard icon={<Zap className="h-4 w-4 text-emerald-400" />} label="In every run" value={data.consistentCount} accent="text-emerald-400" />
      </div>

      <p className="text-[11px] text-zinc-400">
        Coverage shows how many of the {data.suiteSessions} session(s) with a suite contained each test —
        a high, stable coverage means we generate this test consistently from <span className="text-zinc-400">{host}</span>.
      </p>

      {/* Functional-area filter */}
      {areas.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => { setArea(null); setPage(0); }}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition ${
              area === null ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            All <span className="tabular-nums opacity-70">{data.cases.length}</span>
          </button>
          {areas.map(([name, count]) => (
            <button
              key={name}
              onClick={() => { setArea(name); setPage(0); }}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition ${
                area === name ? 'border-violet-500/50 bg-violet-500/15 text-violet-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {name} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Test list (filtered + paginated) */}
      <div className="space-y-1.5">
        {filtered.slice(page * TEST_CASES_PAGE_SIZE, (page + 1) * TEST_CASES_PAGE_SIZE).map((c, i) => {
          const meta = SOURCE_META[c.source];
          const consistent = c.coverage === 100 && data.suiteSessions > 1;
          return (
            <div key={`${c.file}:${c.title}:${i}`} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
              <span className={`shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${meta.cls}`}>
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs text-zinc-200 truncate" title={c.title}>{c.title}</p>
                  {c.area && c.area !== 'Uncategorized' && (
                    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">{c.area}</span>
                  )}
                </div>
                {c.description && c.description !== c.title && (
                  <p className="text-[11px] text-zinc-400 truncate" title={c.description}>{c.description}</p>
                )}
                <p className="text-[11px] font-mono text-zinc-400 truncate">{c.file}</p>
              </div>
              {/* Coverage */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:block w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full ${consistent ? 'bg-emerald-500' : c.coverage >= 50 ? 'bg-violet-500' : 'bg-amber-500'}`}
                    style={{ width: `${c.coverage}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-zinc-400 w-12 text-right">
                  {c.sessionCount}/{data.suiteSessions}
                </span>
              </div>
            </div>
          );
        })}
        <Paginator page={page} pageSize={TEST_CASES_PAGE_SIZE} total={filtered.length} onPage={setPage} />
      </div>
    </div>
  );
}

// ── Areas view — tests grouped by functional area ────────────────────────────

function AreasView({ host }: { host: string }) {
  const [data, setData] = useState<AppTestCasesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCollapsed(new Set());
    fetch(`/api/test-cases?host=${encodeURIComponent(host)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [host]);

  // Group cases by functional area, areas with most tests first.
  const groups = useMemo(() => {
    const m = new Map<string, AppTestCase[]>();
    for (const c of data?.cases ?? []) {
      const a = c.area || 'Uncategorized';
      (m.get(a) ?? m.set(a, []).get(a)!).push(c);
    }
    return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 text-zinc-400 animate-spin" />
      </div>
    );
  }
  if (!data || groups.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm text-zinc-400 mb-1">No areas yet</p>
        <p className="text-xs text-zinc-400">Functional areas appear once test cases have been generated for this app.</p>
      </div>
    );
  }

  function toggle(area: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(area) ? next.delete(area) : next.add(area);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={<Layers3 className="h-4 w-4 text-zinc-400" />} label="Areas" value={groups.length} accent="text-zinc-100" />
        <StatCard icon={<FileCode2 className="h-4 w-4 text-violet-400" />} label="Tests" value={data.uniqueCount} accent="text-violet-400" />
        <StatCard icon={<Layers3 className="h-4 w-4 text-zinc-400" />} label="Suite sessions" value={data.suiteSessions} accent="text-zinc-100" />
      </div>

      {groups.map(([area, cases]) => {
        const open = !collapsed.has(area);
        return (
          <div key={area} className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
            <button
              onClick={() => toggle(area)}
              className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-800/50 transition text-left"
            >
              {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
              <span className="flex-1 text-sm font-semibold text-zinc-100">{area}</span>
              <span className="text-[11px] text-zinc-400 tabular-nums">{cases.length} test{cases.length !== 1 ? 's' : ''}</span>
            </button>
            {open && (
              <div className="border-t border-zinc-800 divide-y divide-zinc-800/60">
                {cases.map((c, i) => (
                  <div key={`${c.file}:${c.title}:${i}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 truncate" title={c.title}>{c.title}</p>
                      {c.description && c.description !== c.title && (
                        <p className="text-[11px] text-zinc-400 truncate" title={c.description}>{c.description}</p>
                      )}
                      <p className="text-[11px] font-mono text-zinc-400 truncate">{c.file}</p>
                    </div>
                    <span className="text-[11px] tabular-nums text-zinc-400 shrink-0">{c.sessionCount}/{data.suiteSessions}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── App trends view (pass-rate over time + flaky tests, from run history) ─────

interface TrendRun { t: number; passed: number; failed: number; errors: number; total: number; rate: number | null; durationMs: number | null; trigger: string }
interface FlakyTest { name: string; passed: number; failed: number; runs: number }
interface AppTrendsData {
  host: string; totalRuns: number; sessionCount: number;
  runs: TrendRun[]; flaky: FlakyTest[];
  avgDurationMs: number | null; firstRate: number | null; lastRate: number | null;
}

function TrendsView({ host }: { host: string }) {
  const [data, setData] = useState<AppTrendsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/trends?host=${encodeURIComponent(host)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [host]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 text-zinc-400 animate-spin" />
      </div>
    );
  }
  if (!data || data.totalRuns === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm text-zinc-400 mb-1">No run history yet</p>
        <p className="text-xs text-zinc-400">
          Trends appear once this app&apos;s tests have been run a few times. Each run is recorded automatically.
        </p>
      </div>
    );
  }

  const trendDelta = data.firstRate != null && data.lastRate != null ? data.lastRate - data.firstRate : null;

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Layers3 className="h-4 w-4 text-zinc-400" />} label="Total runs" value={data.totalRuns} accent="text-zinc-100" />
        <StatCard icon={<Zap className="h-4 w-4 text-emerald-400" />} label="Current rate" value={data.lastRate != null ? `${data.lastRate}%` : '—'} accent="text-emerald-400" />
        <StatCard
          icon={<ArrowRight className={`h-4 w-4 ${trendDelta == null ? 'text-zinc-400' : trendDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`} />}
          label="Trend"
          value={trendDelta == null ? '—' : `${trendDelta >= 0 ? '+' : ''}${trendDelta}%`}
          accent={trendDelta == null ? 'text-zinc-400' : trendDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard icon={<Clock className="h-4 w-4 text-blue-400" />} label="Avg duration" value={data.avgDurationMs != null ? formatDuration(data.avgDurationMs) : '—'} accent="text-blue-400" />
      </div>

      {/* Pass-rate over time */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Pass rate over time
        </p>
        <TrendChart runs={data.runs} />
      </div>

      {/* Flaky tests */}
      <div>
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">
          Flaky tests
          <span className="ml-2 text-zinc-400 normal-case font-normal">passed in some runs, failed in others</span>
        </p>
        {data.flaky.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            <p className="text-xs text-zinc-400">No flaky tests detected — outcomes have been consistent across runs. 🎉</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.flaky.map((f, i) => {
              const failRate = Math.round((f.failed / f.runs) * 100);
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-200 truncate" title={f.name}>{f.name.split(' › ').slice(1).join(' › ') || f.name}</p>
                    <p className="text-[11px] font-mono text-zinc-400 truncate">{f.name.split(' › ')[0]}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[11px] font-medium tabular-nums">
                    <span className="text-emerald-400">{f.passed}✓</span>
                    <span className="text-red-400">{f.failed}✗</span>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                    {failRate}% fail
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pass-rate line/area chart over chronological runs. */
function TrendChart({ runs }: { runs: TrendRun[] }) {
  const pts = runs.filter(r => r.rate != null) as (TrendRun & { rate: number })[];
  if (pts.length < 2) {
    return <p className="text-xs text-zinc-400 py-6 text-center">Need at least 2 runs with results to chart a trend.</p>;
  }
  const W = 600, H = 140, padX = 8, padY = 12;
  const n = pts.length;
  const x = (i: number) => padX + (i / (n - 1)) * (W - padX * 2);
  const y = (rate: number) => padY + (1 - rate / 100) * (H - padY * 2);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.rate).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H - padY} L ${x(0).toFixed(1)} ${H - padY} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 140 }}>
      {/* gridlines at 0/50/100% */}
      {[0, 50, 100].map(g => (
        <line key={g} x1={padX} x2={W - padX} y1={y(g)} y2={y(g)} stroke="#27272a" strokeWidth="1" strokeDasharray="3 3" />
      ))}
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.rate)} r="2.5"
          fill={p.rate >= 80 ? '#22c55e' : p.rate >= 50 ? '#f59e0b' : '#ef4444'} />
      ))}
    </svg>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-32 text-center px-6">
      <div className="h-12 w-12 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
        <Globe className="h-6 w-6 text-zinc-400" />
      </div>
      <p className="text-zinc-300 text-sm font-medium mb-1">No sessions yet</p>
      <p className="text-zinc-400 text-xs max-w-xs">
        Click <span className="text-violet-400 font-medium">+ New Session</span> in the top bar to crawl your app and auto-generate a Playwright test suite.
      </p>
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────

interface ShellProps {
  sessions: Session[];
  membersMap: Record<string, string>;
  isAdmin?: boolean;
}

export function DashboardShell({ sessions, membersMap, isAdmin = false }: ShellProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string>(sessions[0]?.id ?? '');
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop collapse
  const [mobileOpen, setMobileOpen]   = useState(false); // mobile drawer
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [deleteError, setDeleteError]   = useState<string | null>(null);

  // The main panel shows either a single session OR an app's consolidated view.
  // selectedApp != null means we're showing the consolidated view for that app.
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  // Selecting a session shows that session only, dismisses the mobile drawer,
  // and keeps its app group expanded.
  function selectSession(sid: string) {
    setSelectedId(sid);
    setSelectedApp(null);
    setMobileOpen(false);
    const s = sessions.find(x => x.id === sid);
    if (s) setExpandedApps(prev => new Set(prev).add(hostname(s.url)));
  }

  // Clicking an app name shows its consolidated results and reveals its sessions.
  function selectApp(host: string) {
    setSelectedApp(host);
    setMobileOpen(false);
    setExpandedApps(prev => new Set(prev).add(host));
  }

  // Admin: open the confirm modal for a (non-running) session.
  function requestDelete(s: Session) {
    setDeleteError(null);
    setPendingDelete(s);
  }

  // Run the actual delete once the user confirms in the modal.
  async function confirmDelete() {
    if (!pendingDelete) return;
    const s = pendingDelete;
    setDeletingId(s.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/sessions/${s.id}`, { method: 'DELETE' });
      if (res.ok) {
        setPendingDelete(null);
        router.refresh(); // re-fetch the (now shorter) session list from the server
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error ?? 'Could not delete this session.');
      }
    } catch {
      setDeleteError('Could not delete this session.');
    } finally {
      setDeletingId(null);
    }
  }

  const selected = useMemo(
    () => sessions.find(s => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId],
  );

  // Sidebar grouped by unique app (hostname): one entry per app, expandable to
  // its sessions. Apps with a running session float to the top, then by recency.
  const appGroups = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const h = hostname(s.url);
      const list = map.get(h) ?? [];
      list.push(s);
      map.set(h, list);
    }
    return [...map.entries()]
      .map(([host, list]) => {
        const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
        return {
          host,
          sessions: sorted,
          hasActive: sorted.some(s => isActive(s.status)),
          lastActivity: Math.max(...sorted.map(s => s.createdAt)),
        };
      })
      .sort((a, b) => Number(b.hasActive) - Number(a.hasActive) || b.lastActivity - a.lastActivity);
  }, [sessions]);

  // Which app groups are expanded. Default: the app holding the selected session.
  const [expandedApps, setExpandedApps] = useState<Set<string>>(
    () => new Set(selected ? [hostname(selected.url)] : []),
  );
  function toggleApp(host: string) {
    setExpandedApps(prev => {
      const next = new Set(prev);
      next.has(host) ? next.delete(host) : next.add(host);
      return next;
    });
  }

  // If the selected app no longer has any sessions (e.g. all were deleted),
  // drop the selection so the panel falls back to the empty state instead of
  // showing a stale "0 sessions" app view.
  useEffect(() => {
    if (selectedApp && !appGroups.some(g => g.host === selectedApp)) setSelectedApp(null);
  }, [appGroups, selectedApp]);

  // Domain history: pass-rate + dates for sessions on the same hostname, oldest → newest
  const { domainHistory, domainCreatedAts } = useMemo(() => {
    if (!selected) return { domainHistory: [] as (number | null)[], domainCreatedAts: [] as number[] };
    const host = hostname(selected.url);
    const sorted = sessions
      .filter(s => { try { return hostname(s.url) === host; } catch { return false; } })
      .sort((a, b) => a.createdAt - b.createdAt);
    return {
      domainHistory: sorted.map(s => {
        const st = s.testResult?.stats;
        const total = st ? st.passed + st.failed + (st.errors ?? 0) : 0;
        return total > 0 ? st!.passed / total : null;
      }),
      domainCreatedAts: sorted.map(s => s.createdAt),
    };
  }, [selected, sessions]);

  return (
    <div className="flex flex-1 min-h-0 relative">

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      )}

      {/* ── Sidebar — fixed drawer on mobile, inline collapsible column on desktop ── */}
      <aside
        className={`
          flex flex-col border-r border-zinc-800 bg-zinc-950 z-40
          fixed inset-y-0 left-0 w-64 transform transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:shrink-0 md:transition-[width]
          ${sidebarOpen ? 'md:w-64' : 'md:w-12'}
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
          {(sidebarOpen || mobileOpen) && (
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest md:inline">Sessions</span>
          )}
          {/* Mobile: close drawer */}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors md:hidden"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
          {/* Desktop: collapse/expand */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="ml-auto p-1.5 rounded-md text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 transition-colors hidden md:inline-flex"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen
              ? <PanelLeftClose className="h-3.5 w-3.5" />
              : <PanelLeftOpen  className="h-3.5 w-3.5" />
            }
          </button>
        </div>

        {sidebarOpen ? (
          <div className="flex-1 overflow-y-auto py-2 px-1.5 space-y-1">
            {/* One row per unique app; expand to reveal that app's sessions. */}
            {appGroups.map(g => {
              const expanded = expandedApps.has(g.host);
              const appSelected = selectedApp === g.host;
              return (
                <div key={g.host}>
                  <div
                    className={`w-full flex items-center gap-1 pr-2 rounded-lg transition-colors ${
                      appSelected ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800/60'
                    }`}
                  >
                    {/* Chevron toggles expand without changing the view */}
                    <button
                      onClick={() => toggleApp(g.host)}
                      className="p-2 rounded-lg text-zinc-400 hover:text-zinc-300 shrink-0"
                      title={expanded ? 'Collapse' : 'Expand'}
                    >
                      {expanded
                        ? <ChevronDown  className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    {/* App name → consolidated results for the whole app */}
                    <button
                      onClick={() => selectApp(g.host)}
                      className="flex-1 min-w-0 flex items-center gap-2 py-2 text-left"
                      title={`Consolidated results for ${g.host}`}
                    >
                      <Globe className={`h-3.5 w-3.5 shrink-0 ${appSelected ? 'text-violet-400' : 'text-zinc-400'}`} />
                      <span className={`flex-1 min-w-0 text-xs font-medium truncate ${appSelected ? 'text-zinc-100' : 'text-zinc-200'}`}>
                        {g.host}
                      </span>
                      {g.hasActive && (
                        <span className="relative h-2 w-2 shrink-0">
                          <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-60" />
                          <span className="absolute inset-0 rounded-full bg-violet-500" />
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-400 tabular-nums shrink-0">{g.sessions.length}</span>
                    </button>
                  </div>

                  {expanded && (
                    <div className="ml-3 pl-1 border-l border-zinc-800/80 space-y-0.5 mt-0.5 mb-1">
                      {g.sessions.map(s => (
                        <SidebarItem
                          key={s.id}
                          session={s}
                          initiator={membersMap[s.createdByUserId] ?? null}
                          selected={!selectedApp && s.id === selectedId}
                          onClick={() => selectSession(s.id)}
                          isAdmin={isAdmin}
                          deleting={deletingId === s.id}
                          onDelete={() => requestDelete(s)}
                          hideHost
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {sessions.length === 0 && (
              <p className="px-2 text-[11px] text-zinc-400 py-4">No sessions yet.</p>
            )}
          </div>
        ) : (
          /* Collapsed: icon-only dots */
          <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1.5 pt-3">
            {sessions.map(s => {
              const isSelected = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  title={hostname(s.url)}
                  className={`h-2.5 w-2.5 rounded-full transition-all ${
                    isSelected ? 'ring-2 ring-violet-500 ring-offset-1 ring-offset-zinc-950' : ''
                  } ${
                    isActive(s.status) ? 'bg-violet-500'
                    : s.status === 'complete' ? 'bg-emerald-500'
                    : s.status === 'failed'   ? 'bg-red-500'
                    : 'bg-zinc-600'
                  }`}
                />
              );
            })}
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* Mobile: button to open the sessions drawer */}
        <div className="md:hidden flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 sticky top-0 bg-zinc-950/95 backdrop-blur z-20">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-zinc-300 hover:text-zinc-100"
          >
            <Menu className="h-4 w-4" />
            Sessions
            <span className="text-[11px] text-zinc-400">({sessions.length})</span>
          </button>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {selectedApp
            ? <AppConsolidated
                host={selectedApp}
                sessions={appGroups.find(g => g.host === selectedApp)?.sessions ?? []}
                onSelectSession={selectSession}
              />
            : selected
            ? <SessionDetail session={selected} membersMap={membersMap} domainHistory={domainHistory} domainCreatedAts={domainCreatedAts} />
            : <EmptyState />
          }
        </div>
      </main>

      {/* Delete-confirmation modal */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => { if (!deletingId) setPendingDelete(null); }}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <Trash2 className="h-4 w-4 text-red-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-zinc-100">Delete this session?</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  <span className="text-zinc-300 font-medium">{hostname(pendingDelete.url)}{shortPath(pendingDelete.url)}</span>
                  {' '}— its tests, results, and recordings will be permanently removed. This can&apos;t be undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {deleteError}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={!!deletingId}
                className="px-3.5 py-2 rounded-lg text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={!!deletingId}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-60"
              >
                {deletingId
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
                  : <><Trash2 className="h-3.5 w-3.5" /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
