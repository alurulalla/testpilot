'use client';

/**
 * "Connected model" badge shown in page nav headers.
 *
 * Fetches the current org's active provider/model. Renders nothing when the
 * request isn't authenticated (landing / sign-in pages) or no model is set.
 * Clicking deep-links to the AI tab of the settings page.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cpu } from 'lucide-react';

interface Status {
  providerLabel: string;
  model: string;
  keyConfigured: boolean;
}

export function ModelStatusBadge() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/llm-config/status')
      .then(r => (r.ok ? r.json() : null))
      .then((d: Status | null) => { if (active && d?.model) setStatus(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!status) return null;

  const ok = status.keyConfigured;
  return (
    <Link
      href="/settings?tab=ai"
      title={ok
        ? `Connected to ${status.providerLabel} · ${status.model}`
        : `No API key for ${status.providerLabel} — click to configure`}
      className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/60 transition-colors group max-w-[260px] shrink-0"
    >
      <Cpu className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs text-zinc-400 group-hover:text-zinc-200 truncate">{status.providerLabel}</span>
        <span className="text-zinc-400">·</span>
        <span className="text-xs font-medium text-zinc-200 truncate">{status.model}</span>
      </span>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
    </Link>
  );
}
