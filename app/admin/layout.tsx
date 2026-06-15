'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shield, Building2, LogOut } from 'lucide-react';
import { useClerk } from '@clerk/nextjs';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { signOut } = useClerk();
  const [checking, setChecking] = useState(true);

  // Verify super admin access on the client by hitting a lightweight check endpoint
  useEffect(() => {
    fetch('/api/admin/me')
      .then(r => {
        if (!r.ok) router.replace('/');
        else setChecking(false);
      })
      .catch(() => router.replace('/'));
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Admin header */}
      <header className="border-b border-zinc-800 px-6 py-3.5 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-zinc-100">TestPilot Admin</span>
        </div>
        <div className="flex-1" />
        <nav className="flex items-center gap-1">
          <Link
            href="/admin"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <Building2 className="h-3.5 w-3.5" />
            Organisations
          </Link>
          <button
            onClick={() => signOut(() => router.push('/sign-in'))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </nav>
      </header>

      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
}
