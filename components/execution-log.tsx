'use client';

import { useEffect, useRef } from 'react';
import { LogEntry } from '@/types/session';
import { formatTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface ExecutionLogProps {
  logs: LogEntry[];
}

export function ExecutionLog({ logs }: ExecutionLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-400">Execution Log</span>
        <span className="text-xs text-zinc-400">{logs.length} entries</span>
      </div>
      <div className="max-h-80 overflow-y-auto p-3 space-y-1 font-mono text-xs">
        {logs.length === 0 && (
          <p className="text-zinc-400 italic">Waiting for activity…</p>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-zinc-400 shrink-0">{formatTime(entry.ts)}</span>
            <span
              className={cn(
                entry.level === 'error' && 'text-red-400',
                entry.level === 'success' && 'text-emerald-400',
                entry.level === 'info' && 'text-zinc-300'
              )}
            >
              {entry.msg}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
