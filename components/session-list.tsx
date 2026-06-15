'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Session } from '@/types/session';

// ── helpers ───────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['exploring', 'analyzing', 'generating', 'running', 'fixing', 'figma-checking'];

function isActive(status: string) {
  return ACTIVE_STATUSES.includes(status);
}

function timeAgo(ts: number) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function domain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '' : u.pathname;
  } catch { return ''; }
}

// ── sub-components ────────────────────────────────────────────────────────────

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
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 capitalize">
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  if (isActive(status)) return (
    <div className="relative h-2.5 w-2.5 shrink-0 mt-0.5">
      <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping opacity-60" />
      <span className="absolute inset-0 rounded-full bg-violet-500" />
    </div>
  );
  if (status === 'complete') return <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0 mt-0.5" />;
  if (status === 'failed')   return <span className="h-2.5 w-2.5 rounded-full bg-red-500 shrink-0 mt-0.5" />;
  return                             <span className="h-2.5 w-2.5 rounded-full bg-zinc-700 shrink-0 mt-0.5" />;
}

// ── main component ────────────────────────────────────────────────────────────

type Filter = 'all' | 'active' | 'complete' | 'failed';

export function SessionList({ sessions }: { sessions: Session[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  const counts = {
    all:      sessions.length,
    active:   sessions.filter(s => isActive(s.status)).length,
    complete: sessions.filter(s => s.status === 'complete').length,
    failed:   sessions.filter(s => s.status === 'failed').length,
  };

  const filtered = sessions.filter(s => {
    if (filter === 'active')   return isActive(s.status);
    if (filter === 'complete') return s.status === 'complete';
    if (filter === 'failed')   return s.status === 'failed';
    return true;
  });

  const tabs: { id: Filter; label: string }[] = [
    { id: 'all',      label: 'All' },
    { id: 'active',   label: 'Active' },
    { id: 'complete', label: 'Complete' },
    { id: 'failed',   label: 'Failed' },
  ];

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-zinc-400 text-sm font-medium">No sessions yet</p>
        <p className="text-zinc-400 text-xs mt-1">Click <span className="text-violet-400">+ New Session</span> to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === t.id
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {t.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              filter === t.id ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-800 text-zinc-400'
            }`}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <p className="text-zinc-400 text-sm py-10 text-center">No sessions in this category.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => {
            const stats = s.testResult?.stats;
            const total = stats ? stats.passed + stats.failed + (stats.errors ?? 0) : 0;
            const passRate = total > 0 ? Math.round(stats!.passed / total * 100) : null;
            const pages = s.siteMap?.total_pages ?? 0;
            const d = domain(s.url);
            const p = pathOf(s.url);

            return (
              <Link
                key={s.id}
                href={`/session/${s.id}`}
                className="flex items-start gap-3 px-5 py-4 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/60 transition-colors group"
              >
                {/* Status dot */}
                <StatusDot status={s.status} />

                {/* Main info */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-100">
                      {d}
                      {p && <span className="text-zinc-400 font-normal">{p}</span>}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>

                  <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                    {pages > 0 && <span>{pages} page{pages !== 1 ? 's' : ''}</span>}
                    {s.testFiles.length > 0 && <span>{s.testFiles.length} spec{s.testFiles.length !== 1 ? 's' : ''}</span>}
                    {s.iteration > 0 && <span>iter {s.iteration}</span>}
                    <span>{timeAgo(s.updatedAt)}</span>
                  </div>

                  {/* Pass/fail bar */}
                  {stats && total > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="flex-1 max-w-[120px] h-1 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${passRate}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-emerald-400 font-medium">{stats.passed} ✓</span>
                      {(stats.failed + (stats.errors ?? 0)) > 0 && (
                        <span className="text-[11px] text-red-400 font-medium">
                          {stats.failed + (stats.errors ?? 0)} ✗
                        </span>
                      )}
                      {passRate !== null && (
                        <span className="text-[11px] text-zinc-400">{passRate}%</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <ArrowRight className="h-4 w-4 text-zinc-400 group-hover:text-zinc-300 shrink-0 mt-1 transition-colors" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
