'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe, Loader2, X, ChevronsUpDown, Check, Building2 } from 'lucide-react';
import { Logo } from '@/components/logo';
import { UserMenu } from '@/components/user-menu';
import { ModelStatusBadge } from '@/components/model-status-badge';
import { Button } from '@/components/ui/button';

interface OrgOption { id: string; name: string }

interface DashboardNavProps {
  orgs?: OrgOption[];
  currentOrgId?: string;
}

export function DashboardNav({ orgs = [], currentOrgId }: DashboardNavProps) {
  const [open, setOpen]     = useState(false);
  const [url, setUrl]       = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let u = url.trim();
    if (!u) return;
    if (!u.startsWith('http')) u = `https://${u}`;
    setLoading(true);
    router.push(`/prepare?url=${encodeURIComponent(u)}`);
  }

  function closeModal() {
    if (loading) return;
    setOpen(false);
    setUrl('');
  }

  return (
    <>
      <header className="border-b border-zinc-800 px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-3">
        <Logo height={30} />
        <OrgSwitcher orgs={orgs} currentOrgId={currentOrgId} />
        <div className="flex-1" />
        <ModelStatusBadge />
        <Button size="sm" onClick={() => setOpen(true)} className="shrink-0">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New Session</span>
        </Button>
        <UserMenu />
      </header>

      {/* New Session modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 space-y-5"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Start New Session</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Enter your app's URL. TestPilot will explore it, generate a Playwright suite, run it, and self-heal failures automatically.
                </p>
              </div>
              <button
                onClick={closeModal}
                className="ml-4 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://your-app.com"
                  autoFocus
                  disabled={loading}
                  className="w-full h-11 pl-10 pr-4 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm disabled:opacity-60"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="secondary" size="sm" onClick={closeModal} disabled={loading}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={loading || !url.trim()}>
                  {loading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening…</>
                    : <><Plus className="h-3.5 w-3.5" /> Configure →</>}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Org switcher ────────────────────────────────────────────────────────────

function OrgSwitcher({ orgs, currentOrgId }: { orgs: OrgOption[]; currentOrgId?: string }) {
  const [open, setOpen]       = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const current = orgs.find(o => o.id === currentOrgId) ?? orgs[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function switchTo(orgId: string) {
    if (orgId === current?.id) { setOpen(false); return; }
    setSwitching(orgId);
    try {
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      if (res.ok) {
        setOpen(false);
        // Full reload: every org-scoped surface (sessions, members, model badge,
        // API keys) re-derives from the new tp_org cookie in one consistent pass.
        // router.refresh() would only re-run server components, leaving client
        // fetches like the model badge showing the previous org.
        window.location.reload();
      }
    } finally {
      setSwitching(null);
    }
  }

  if (orgs.length === 0) return null;

  // Single org — show the name as a static label, no dropdown.
  if (orgs.length === 1) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-zinc-400 select-none min-w-0">
        <Building2 className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        <span className="truncate max-w-[120px] sm:max-w-[200px]">{current?.name}</span>
      </span>
    );
  }

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800 transition-colors min-w-0 max-w-full"
      >
        <Building2 className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
        <span className="truncate max-w-[90px] sm:max-w-[160px]">{current?.name}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-60 z-50 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl py-1.5">
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
            Organisations
          </p>
          {orgs.map(o => {
            const isCurrent = o.id === current?.id;
            return (
              <button
                key={o.id}
                onClick={() => switchTo(o.id)}
                disabled={switching !== null}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  isCurrent ? 'text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                } disabled:opacity-50`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="flex-1 truncate">{o.name}</span>
                {switching === o.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500 shrink-0" />
                  : isCurrent && <Check className="h-3.5 w-3.5 text-violet-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
