'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Users, CheckCircle, XCircle, Clock, Mail,
  Loader2, Save, RefreshCw, ShieldCheck, UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Member {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  invitedAt: string;
  joinedAt: string | null;
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  licenseKey: string;
  licenseStatus: string;
  maxMembers: number;
  createdAt: string;
  createdByAdmin: string;
  members: Member[];
  _count: { sessions: number };
}

function MemberStatusBadge({ status }: { status: string }) {
  if (status === 'active') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
      <CheckCircle className="h-2.5 w-2.5" /> Active
    </span>
  );
  if (status === 'invited') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
      <Clock className="h-2.5 w-2.5" /> Invited
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
      <XCircle className="h-2.5 w-2.5" /> {status}
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

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editMaxMembers, setEditMaxMembers] = useState(5);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Re-invite
  const [reinviting, setReinviting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/orgs/${id}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json() as OrgDetail;
      setOrg(data);
      setEditName(data.name);
      setEditMaxMembers(data.maxMembers);
    } catch {
      setError('Failed to load organisation');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function saveChanges() {
    if (!org) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, maxMembers: editMaxMembers }),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json() as OrgDetail;
      setOrg(prev => prev ? { ...prev, name: updated.name, maxMembers: updated.maxMembers } : prev);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!org) return;
    const newStatus = org.licenseStatus === 'active' ? 'suspended' : 'active';
    const confirmed = confirm(
      newStatus === 'suspended'
        ? `Suspend "${org.name}"? Members will lose access immediately.`
        : `Reactivate "${org.name}"?`,
    );
    if (!confirmed) return;
    const res = await fetch(`/api/admin/orgs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseStatus: newStatus }),
    });
    if (res.ok) setOrg(prev => prev ? { ...prev, licenseStatus: newStatus } : prev);
  }

  async function resendInvite(email: string) {
    setReinviting(email);
    try {
      const res = await fetch(`/api/admin/orgs/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Failed');
      alert(`Invite resent to ${email}`);
    } catch {
      alert('Failed to resend invite');
    } finally {
      setReinviting(null);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
    </div>
  );

  if (error || !org) return (
    <div className="max-w-2xl mx-auto">
      <p className="text-red-400 text-sm">{error || 'Organisation not found'}</p>
      <button onClick={() => router.push('/admin')} className="text-xs text-zinc-500 mt-2 hover:text-zinc-300">← Back</button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/admin" className="text-zinc-500 hover:text-zinc-100 transition-colors mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">{org.name}</h1>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">{org.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={toggleStatus}
            className={org.licenseStatus === 'active' ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'}
          >
            {org.licenseStatus === 'active'
              ? <><UserX className="h-3.5 w-3.5" /> Suspend</>
              : <><CheckCircle className="h-3.5 w-3.5" /> Reactivate</>}
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Status', value: org.licenseStatus, highlight: org.licenseStatus === 'active' ? 'text-emerald-400' : 'text-red-400' },
          { label: 'Members', value: `${org.members.length} / ${org.maxMembers}`, highlight: 'text-zinc-100' },
          { label: 'Sessions', value: org._count.sessions, highlight: 'text-zinc-100' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className={`text-lg font-bold mt-0.5 capitalize ${s.highlight}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Edit basic info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-100">Organisation Settings</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Name</label>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400">Max Members</label>
            <input
              type="number"
              min={1}
              value={editMaxMembers}
              onChange={e => setEditMaxMembers(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={saveChanges} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
          {saveMsg && (
            <span className={`text-xs ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>
              {saveMsg}
            </span>
          )}
        </div>
        <div className="pt-2 border-t border-zinc-800">
          <p className="text-xs text-zinc-600">
            License key: <span className="font-mono text-zinc-500">{org.licenseKey}</span>
          </p>
        </div>
      </div>

      {/* Members list */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-2">
          <Users className="h-4 w-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-100">Members</h2>
          <span className="text-xs text-zinc-500 ml-auto">{org.members.length} / {org.maxMembers}</span>
        </div>
        {org.members.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-zinc-600 bg-zinc-900">No members yet</div>
        ) : (
          <table className="w-full text-sm bg-zinc-900">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-zinc-500">Member</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {org.members.map(m => (
                <tr key={m.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-zinc-100 font-medium">{m.displayName ?? '—'}</p>
                    <p className="text-xs text-zinc-500">{m.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {m.role === 'ORG_ADMIN' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">
                        <ShieldCheck className="h-2.5 w-2.5" /> Admin
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">Member</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <MemberStatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {m.joinedAt ? timeAgo(m.joinedAt) : `Invited ${timeAgo(m.invitedAt)}`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.status === 'invited' && (
                      <button
                        onClick={() => resendInvite(m.email)}
                        disabled={reinviting === m.email}
                        className="flex items-center gap-1 text-xs text-zinc-400 hover:text-violet-400 transition-colors disabled:opacity-50 ml-auto"
                      >
                        {reinviting === m.email
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Mail className="h-3 w-3" />}
                        Resend
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
