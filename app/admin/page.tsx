'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Building2, Users, Activity, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Org {
  id: string;
  name: string;
  slug: string;
  licenseStatus: string;
  maxMembers: number;
  createdAt: string;
  createdByAdmin: string;
  _count: { members: number; sessions: number };
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
      <CheckCircle className="h-2.5 w-2.5" /> Active
    </span>
  );
  if (status === 'suspended') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
      <XCircle className="h-2.5 w-2.5" /> Suspended
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-zinc-700/60 text-zinc-400">
      <Clock className="h-2.5 w-2.5" /> {status}
    </span>
  );
}

function timeAgo(ts: string) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function AdminOrgsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/orgs');
      if (!res.ok) throw new Error('Failed to load');
      setOrgs(await res.json());
    } catch {
      setError('Failed to load organisations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Organisations</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{orgs.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Link href="/admin/orgs/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New Organisation
            </Button>
          </Link>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && orgs.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
        </div>
      )}

      {/* Empty */}
      {!loading && orgs.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Building2 className="h-10 w-10 text-zinc-700" />
          <p className="text-sm text-zinc-500">No organisations yet</p>
          <Link href="/admin/orgs/new">
            <Button size="sm"><Plus className="h-3.5 w-3.5" /> Create first org</Button>
          </Link>
        </div>
      )}

      {/* Org table */}
      {orgs.length > 0 && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60">
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Organisation</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Sessions</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {orgs.map(org => (
                <tr key={org.id} className="bg-zinc-900 hover:bg-zinc-800/60 transition-colors">
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-zinc-100">{org.name}</p>
                    <p className="text-xs text-zinc-500 font-mono mt-0.5">{org.slug}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={org.licenseStatus} />
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <Users className="h-3.5 w-3.5 text-zinc-600" />
                      {org._count.members}
                      <span className="text-zinc-600">/ {org.maxMembers}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <Activity className="h-3.5 w-3.5 text-zinc-600" />
                      {org._count.sessions}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-zinc-500">
                    {timeAgo(org.createdAt)}
                    <p className="text-zinc-600 mt-0.5">by {org.createdByAdmin}</p>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Link
                      href={`/admin/orgs/${org.id}`}
                      className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
