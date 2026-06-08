'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe, Loader2, X } from 'lucide-react';
import { Logo } from '@/components/logo';
import { UserMenu } from '@/components/user-menu';
import { Button } from '@/components/ui/button';

export function DashboardNav() {
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
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-3">
        <Logo height={28} />
        <span className="text-sm text-zinc-600 select-none">Sessions</span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Session
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
