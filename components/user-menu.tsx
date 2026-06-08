'use client';

/**
 * UserMenu — avatar button + dropdown shown in every page header.
 *
 * Shows:
 *   • User initials / name
 *   • Settings  (all active members)
 *   • Admin     (super-admin emails only — checked via /api/admin/me)
 *   • Sign out
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { Settings, Shield, LogOut, ChevronDown } from 'lucide-react';

export function UserMenu() {
  const router = useRouter();
  const { signOut } = useClerk();
  const { user } = useUser();

  const [open, setOpen] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Check super-admin status once on mount
  useEffect(() => {
    fetch('/api/admin/me')
      .then(r => { if (r.ok) setIsSuperAdmin(true); })
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const name = user?.fullName ?? email.split('@')[0] ?? '?';
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative shrink-0" ref={menuRef}>
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors group"
      >
        {/* Initials avatar */}
        <div className="h-7 w-7 rounded-full bg-violet-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
          {initials}
        </div>
        <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors hidden sm:block max-w-28 truncate">
          {name}
        </span>
        <ChevronDown className={`h-3 w-3 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-zinc-700 bg-zinc-800 shadow-2xl z-50 overflow-hidden">
          {/* User info */}
          <div className="px-3 py-2.5 border-b border-zinc-700">
            <p className="text-xs font-semibold text-zinc-100 truncate">{name}</p>
            <p className="text-[10px] text-zinc-500 truncate mt-0.5">{email}</p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => { setOpen(false); router.push('/settings'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors text-left"
            >
              <Settings className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              Settings
            </button>

            {isSuperAdmin && (
              <button
                onClick={() => { setOpen(false); router.push('/admin'); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors text-left"
              >
                <Shield className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                Admin Panel
              </button>
            )}
          </div>

          {/* Sign out */}
          <div className="border-t border-zinc-700 py-1">
            <button
              onClick={() => signOut(() => router.push('/sign-in'))}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-700 hover:text-red-400 transition-colors text-left"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
