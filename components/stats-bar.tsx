import { TestStats } from '@/types/session';
import { formatDuration } from '@/lib/utils';

interface StatsBarProps {
  stats: TestStats;
  duration: number;
}

export function StatsBar({ stats, duration }: StatsBarProps) {
  const pct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-400">Test Results</span>
        <span className="text-zinc-400 text-xs">{formatDuration(duration)}</span>
      </div>
      <div className="flex gap-4 text-sm">
        <div className="flex-1 text-center">
          <div className="text-2xl font-bold text-emerald-400">{stats.passed}</div>
          <div className="text-xs text-zinc-400">Passed</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-2xl font-bold text-red-400">{stats.failed}</div>
          <div className="text-xs text-zinc-400">Failed</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-2xl font-bold text-amber-400">{stats.errors}</div>
          <div className="text-xs text-zinc-400">Errors</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-2xl font-bold text-zinc-100">{stats.total}</div>
          <div className="text-xs text-zinc-400">Total</div>
        </div>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-center text-zinc-400">{pct}% passing</div>
    </div>
  );
}
