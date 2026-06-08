'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowRight, ChevronLeft, ChevronRight,
  Clock, FileCode2, Globe, Layers3,
  PanelLeftClose, PanelLeftOpen, User,
  Zap,
} from 'lucide-react';
import type { Session } from '@/types/session';

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
      {/* Track — light in light mode, dark in dark mode */}
      <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={11}
        className="stroke-zinc-200 dark:stroke-zinc-800" />
      {passed > 0 && arc('#10b981', pL, 0)}
      {failed > 0 && arc('#ef4444', fL, pL)}
      {errors > 0 && arc('#f59e0b', eL, pL + fL)}
      {/* Centre label — dark in light mode, light in dark mode */}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={17} fontWeight="bold"
        className="fill-zinc-900 dark:fill-zinc-100">
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
}

function SidebarItem({ session: s, initiator, selected, onClick }: SidebarItemProps) {
  const host = hostname(s.url);
  const path = shortPath(s.url);
  const stats = s.testResult?.stats;
  const total = stats ? stats.passed + stats.failed + (stats.errors ?? 0) : 0;
  const rate  = total > 0 ? Math.round(stats!.passed / total * 100) : null;

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
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
        selected ? 'bg-zinc-800 text-zinc-100' : 'hover:bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {dot()}
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-xs font-medium truncate leading-tight">
          {host}
          {path && <span className="text-zinc-500 font-normal">{path}</span>}
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
                  Duration: {formatDuration(s.testResult.duration)}
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
            <p className="text-xs text-zinc-600 dark:text-zinc-300 font-mono leading-relaxed break-all">{s.error}</p>
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
}

export function DashboardShell({ sessions, membersMap }: ShellProps) {
  const [selectedId, setSelectedId] = useState<string>(sessions[0]?.id ?? '');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const selected = useMemo(
    () => sessions.find(s => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId],
  );

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

  // Grouped for sidebar
  const activeSessions  = sessions.filter(s => isActive(s.status));
  const finishedSessions = sessions.filter(s => !isActive(s.status));

  return (
    <div className="flex flex-1 min-h-0">

      {/* ── Sidebar ── */}
      <aside className={`shrink-0 border-r border-zinc-800 flex flex-col transition-all duration-200 ${
        sidebarOpen ? 'w-56 lg:w-64' : 'w-12'
      }`}>
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
          {sidebarOpen && (
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Sessions</span>
          )}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="ml-auto p-1.5 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen
              ? <PanelLeftClose className="h-3.5 w-3.5" />
              : <PanelLeftOpen  className="h-3.5 w-3.5" />
            }
          </button>
        </div>

        {sidebarOpen ? (
          <div className="flex-1 overflow-y-auto py-2 px-1.5 space-y-4">
            {/* Active */}
            {activeSessions.length > 0 && (
              <div>
                <p className="px-2 mb-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                  Active
                </p>
                {activeSessions.map(s => (
                  <SidebarItem
                    key={s.id}
                    session={s}
                    initiator={membersMap[s.createdByUserId] ?? null}
                    selected={s.id === selectedId}
                    onClick={() => setSelectedId(s.id)}
                  />
                ))}
              </div>
            )}

            {/* Recent */}
            {finishedSessions.length > 0 && (
              <div>
                <p className="px-2 mb-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
                  Recent
                </p>
                {finishedSessions.map(s => (
                  <SidebarItem
                    key={s.id}
                    session={s}
                    initiator={membersMap[s.createdByUserId] ?? null}
                    selected={s.id === selectedId}
                    onClick={() => setSelectedId(s.id)}
                  />
                ))}
              </div>
            )}

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
                  onClick={() => setSelectedId(s.id)}
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
        <div className="max-w-3xl mx-auto px-6 py-8">
          {selected
            ? <SessionDetail session={selected} membersMap={membersMap} domainHistory={domainHistory} domainCreatedAts={domainCreatedAts} />
            : <EmptyState />
          }
        </div>
      </main>
    </div>
  );
}
