'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle, ArrowRight, ChevronDown, ChevronLeft, ChevronRight,
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
            v === null  ? 'text-zinc-600'
            : v >= 0.8  ? 'text-emerald-400'
            : v >= 0.5  ? 'text-amber-400'
            :              'text-red-400';

          return (
            <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1">
              <span className={`text-[10px] font-semibold leading-none ${textColor}`}>
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
            <span className="text-[9px] text-zinc-600 truncate block">
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
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize transition-all ${
              active  ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40'
              : done  ? 'text-emerald-500'
              : 'text-zinc-600'
            }`}>
              {active && <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />}
              {ph}
            </div>
            {i < phases.length - 1 && (
              <ChevronRight className={`h-3 w-3 mx-0.5 ${done ? 'text-zinc-500' : 'text-zinc-700'}`} />
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
    <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 capitalize">{status}</span>
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
              : <>{host}{path && <span className="text-zinc-500 font-normal">{path}</span>}</>}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
            <span>{timeAgo(s.createdAt)}</span>
            {rate !== null && (
              <span className={`font-medium ${rate >= 80 ? 'text-emerald-600' : rate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                · {rate}%
              </span>
            )}
          </div>
          {initiator && (
            <p className="text-[10px] text-zinc-600 truncate">{initiator}</p>
          )}
        </div>
      </button>

      {/* Admin delete — hidden for running sessions (can't delete those) */}
      {isAdmin && (
        running ? (
          <span
            className="shrink-0 mr-2 mt-2 text-zinc-700"
            title="Running sessions can't be deleted — stop it first"
          >
            <Trash2 className="h-3.5 w-3.5 opacity-40" />
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={deleting}
            title="Delete session"
            className="shrink-0 mr-2 mt-2 p-1 rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-100"
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
                <span className="text-zinc-500 font-normal">{shortPath(s.url)}</span>
              </h1>
              <StatusBadge status={s.status} />
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
              {initiator && (
                <span className="flex items-center gap-1.5">
                  <span className="h-4 w-4 rounded-full bg-violet-700/60 flex items-center justify-center text-[9px] font-bold text-violet-200">
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
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
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
                    <span className="text-zinc-500">Total: </span>
                    <span className="text-zinc-300 font-medium">{total} tests</span>
                  </div>
                </div>
              </div>
              {s.testResult?.duration != null && (
                <p className="mt-3 text-[11px] text-zinc-600">
                  Duration: {formatDuration(s.testResult.duration * 1000)}
                </p>
              )}
            </div>
          )}

          {/* Domain history chart */}
          {domainHistory.length > 1 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-0.5">
                Pass rate history
              </p>
              <p className="text-[10px] text-zinc-600 mb-4">
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
          <Layers3 className="h-4 w-4 text-zinc-500 shrink-0" />
          <div>
            <p className="text-xs font-medium text-zinc-300">
              {s.iteration} self-heal iteration{s.iteration !== 1 ? 's' : ''}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
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
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">
            Recent activity
          </p>
          <div className="space-y-1.5">
            {s.logs.slice(-6).map((log, i) => (
              <p key={i} className={`text-xs font-mono leading-relaxed ${
                log.level === 'error'   ? 'text-red-400'
                : log.level === 'success' ? 'text-emerald-400'
                : 'text-zinc-400'
              }`}>
                <span className="text-zinc-700 mr-2">
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
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-medium uppercase tracking-wide">
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
      <span className="text-zinc-600">({pct}%)</span>
    </div>
  );
}

// ── App consolidated view — results across every session for one app ──────────

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
  const [tab, setTab] = useState<'overview' | 'cases' | 'areas' | 'trends'>('overview');

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
            <span className="text-[10px] font-semibold text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded-full">
              running
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Consolidated results across {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          {lastRun > 0 && <> · last activity {timeAgo(lastRun)}</>}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 -mt-2">
        {([['overview', 'Overview'], ['cases', 'Test cases'], ['areas', 'Areas'], ['trends', 'Trends']] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'trends' ? (
        <TrendsView host={host} />
      ) : tab === 'cases' ? (
        <TestCasesView host={host} />
      ) : tab === 'areas' ? (
        <AreasView host={host} />
      ) : (
      <>
      {/* Aggregate stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<Layers3 className="h-4 w-4 text-zinc-400" />} label="Sessions" value={sessions.length} accent="text-zinc-100" />
        <StatCard icon={<Zap className="h-4 w-4 text-emerald-400" />} label="Passed" value={agg.total > 0 ? agg.passed : '—'} accent="text-emerald-400" />
        <StatCard icon={<Zap className="h-4 w-4 text-red-400" />} label="Failed" value={agg.total > 0 ? agg.failed + agg.errors : '—'} accent="text-red-400" />
        <StatCard icon={<FileCode2 className="h-4 w-4 text-violet-400" />} label="Spec files" value={agg.specs > 0 ? agg.specs : '—'} accent="text-violet-400" />
      </div>

      {/* Combined test-results ring */}
      {agg.total > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
            Combined test results
          </p>
          <div className="flex items-center gap-6">
            <DonutChart passed={agg.passed} failed={agg.failed} errors={agg.errors} />
            <div className="space-y-2 text-xs">
              <LegendRow color="bg-emerald-500" label="Passed" value={agg.passed} total={agg.total} />
              <LegendRow color="bg-red-500"    label="Failed" value={agg.failed} total={agg.total} />
              {agg.errors > 0 && <LegendRow color="bg-amber-500" label="Errors" value={agg.errors} total={agg.total} />}
              <div className="pt-1 border-t border-zinc-800">
                <span className="text-zinc-500">Total: </span>
                <span className="text-zinc-300 font-medium">{agg.total} tests across {agg.withResults} run session(s)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-session breakdown — click to drill into one session */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">Sessions</p>
        <div className="space-y-1.5">
          {sessions.map(s => {
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
                  <p className="text-[10px] text-zinc-600 mt-0.5">
                    {timeAgo(s.createdAt)} · {s.status}
                    {s.testFiles.length > 0 && <> · {s.testFiles.length} spec{s.testFiles.length !== 1 ? 's' : ''}</>}
                  </p>
                </div>
                {rate !== null && (
                  <span className={`text-xs font-semibold tabular-nums shrink-0 ${rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {rate}%
                  </span>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
              </button>
            );
          })}
        </div>
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
        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
      </div>
    );
  }
  if (!data || data.uniqueCount === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm text-zinc-400 mb-1">No test cases yet</p>
        <p className="text-xs text-zinc-600">
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

      <p className="text-[11px] text-zinc-600">
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
              <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${meta.cls}`}>
                {meta.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs text-zinc-200 truncate" title={c.title}>{c.title}</p>
                  {c.area && c.area !== 'Uncategorized' && (
                    <span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">{c.area}</span>
                  )}
                </div>
                {c.description && c.description !== c.title && (
                  <p className="text-[11px] text-zinc-500 truncate" title={c.description}>{c.description}</p>
                )}
                <p className="text-[10px] font-mono text-zinc-600 truncate">{c.file}</p>
              </div>
              {/* Coverage */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:block w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full ${consistent ? 'bg-emerald-500' : c.coverage >= 50 ? 'bg-violet-500' : 'bg-amber-500'}`}
                    style={{ width: `${c.coverage}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-zinc-500 w-12 text-right">
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
        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
      </div>
    );
  }
  if (!data || groups.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm text-zinc-400 mb-1">No areas yet</p>
        <p className="text-xs text-zinc-600">Functional areas appear once test cases have been generated for this app.</p>
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
              {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-600" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />}
              <span className="flex-1 text-sm font-semibold text-zinc-100">{area}</span>
              <span className="text-[11px] text-zinc-500 tabular-nums">{cases.length} test{cases.length !== 1 ? 's' : ''}</span>
            </button>
            {open && (
              <div className="border-t border-zinc-800 divide-y divide-zinc-800/60">
                {cases.map((c, i) => (
                  <div key={`${c.file}:${c.title}:${i}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 truncate" title={c.title}>{c.title}</p>
                      {c.description && c.description !== c.title && (
                        <p className="text-[11px] text-zinc-500 truncate" title={c.description}>{c.description}</p>
                      )}
                      <p className="text-[10px] font-mono text-zinc-600 truncate">{c.file}</p>
                    </div>
                    <span className="text-[10px] tabular-nums text-zinc-500 shrink-0">{c.sessionCount}/{data.suiteSessions}</span>
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
        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
      </div>
    );
  }
  if (!data || data.totalRuns === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <p className="text-sm text-zinc-400 mb-1">No run history yet</p>
        <p className="text-xs text-zinc-600">
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
          icon={<ArrowRight className={`h-4 w-4 ${trendDelta == null ? 'text-zinc-500' : trendDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`} />}
          label="Trend"
          value={trendDelta == null ? '—' : `${trendDelta >= 0 ? '+' : ''}${trendDelta}%`}
          accent={trendDelta == null ? 'text-zinc-400' : trendDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard icon={<Clock className="h-4 w-4 text-blue-400" />} label="Avg duration" value={data.avgDurationMs != null ? formatDuration(data.avgDurationMs) : '—'} accent="text-blue-400" />
      </div>

      {/* Pass-rate over time */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4">
          Pass rate over time
        </p>
        <TrendChart runs={data.runs} />
      </div>

      {/* Flaky tests */}
      <div>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-2">
          Flaky tests
          <span className="ml-2 text-zinc-600 normal-case font-normal">passed in some runs, failed in others</span>
        </p>
        {data.flaky.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            <p className="text-xs text-zinc-500">No flaky tests detected — outcomes have been consistent across runs. 🎉</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.flaky.map((f, i) => {
              const failRate = Math.round((f.failed / f.runs) * 100);
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-200 truncate" title={f.name}>{f.name.split(' › ').slice(1).join(' › ') || f.name}</p>
                    <p className="text-[10px] font-mono text-zinc-600 truncate">{f.name.split(' › ')[0]}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[10px] font-medium tabular-nums">
                    <span className="text-emerald-400">{f.passed}✓</span>
                    <span className="text-red-400">{f.failed}✗</span>
                  </div>
                  <span className="shrink-0 text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
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
    return <p className="text-xs text-zinc-600 py-6 text-center">Need at least 2 runs with results to chart a trend.</p>;
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
        <Globe className="h-6 w-6 text-zinc-500" />
      </div>
      <p className="text-zinc-300 text-sm font-medium mb-1">No sessions yet</p>
      <p className="text-zinc-600 text-xs max-w-xs">
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
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest md:inline">Sessions</span>
          )}
          {/* Mobile: close drawer */}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors md:hidden"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
          {/* Desktop: collapse/expand */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="ml-auto p-1.5 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors hidden md:inline-flex"
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
                      className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 shrink-0"
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
                      <Globe className={`h-3.5 w-3.5 shrink-0 ${appSelected ? 'text-violet-400' : 'text-zinc-500'}`} />
                      <span className={`flex-1 min-w-0 text-xs font-medium truncate ${appSelected ? 'text-zinc-100' : 'text-zinc-200'}`}>
                        {g.host}
                      </span>
                      {g.hasActive && (
                        <span className="relative h-2 w-2 shrink-0">
                          <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-60" />
                          <span className="absolute inset-0 rounded-full bg-violet-500" />
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{g.sessions.length}</span>
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
              <p className="px-2 text-[11px] text-zinc-700 py-4">No sessions yet.</p>
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
            <span className="text-[11px] text-zinc-600">({sessions.length})</span>
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
                <p className="text-xs text-zinc-500 mt-0.5">
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
