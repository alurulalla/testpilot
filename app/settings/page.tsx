'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Users, Key, Building2, Plus, Loader2, Trash2, RefreshCw,
  CheckCircle, XCircle, Clock, ShieldCheck, Mail, Eye, EyeOff,
  Save, LogOut, ChevronDown, Cpu,
} from 'lucide-react';
import { PROVIDERS } from '@/lib/pilot/providers';
import { Button } from '@/components/ui/button';
import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  licenseStatus: string;
  maxMembers: number;
}

interface Member {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  invitedAt: string;
  joinedAt: string | null;
}

interface ApiKeyRow {
  id: string;
  keyName: string;
  maskedValue: string;
  updatedAt: string;
}

interface CurrentMember {
  role: string;
  email: string;
  displayName: string | null;
}

// Build key list dynamically from providers that require an API key, plus Figma.
const SUPPORTED_KEYS: { name: string; label: string; placeholder: string; hint: string }[] = [
  ...PROVIDERS
    .filter(p => p.apiKeyRequired && p.apiKeyEnvVar)
    .map(p => ({
      name:        p.apiKeyEnvVar!,
      label:       `${p.name} API Key`,
      placeholder: p.apiKeyPlaceholder ?? '…',
      hint:        `Used when the ${p.name} provider is selected.`,
    })),
  {
    name:        'FIGMA_TOKEN',
    label:       'Figma Personal Access Token',
    placeholder: 'figd_…',
    hint:        'Optional — enables Figma design verification.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts: string) {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
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
      <XCircle className="h-2.5 w-2.5" /> Suspended
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const { signOut } = useClerk();

  const [tab, setTab] = useState<'members' | 'ai' | 'app' | 'org'>('members');
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [currentMember, setCurrentMember] = useState<CurrentMember | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Members tab state ──────────────────────────────────────────────────────
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('MEMBER');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── API Keys tab state ─────────────────────────────────────────────────────
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  const [keysSaving, setKeysSaving] = useState<Record<string, boolean>>({});
  const [keysMsgs, setKeysMsgs] = useState<Record<string, string>>({});

  // ── Model tab state ────────────────────────────────────────────────────────
  const [modelProvider, setModelProvider]     = useState('anthropic');
  const [modelModel, setModelModel]           = useState('claude-sonnet-4-6');
  const [modelBaseUrl, setModelBaseUrl]       = useState('');
  const [modelCustomModel, setModelCustomModel] = useState('');
  const [modelSaving, setModelSaving]         = useState(false);
  const [modelMsg, setModelMsg]               = useState('');
  const [appMaxPages, setAppMaxPages]         = useState(10);
  const [appDeepMax, setAppDeepMax]           = useState(50);
  const [appAutoHeal, setAppAutoHeal]         = useState(false);
  const [appSaving, setAppSaving]             = useState(false);
  const [appMsg, setAppMsg]                   = useState('');

  // ── Org tab state ──────────────────────────────────────────────────────────
  const [editName, setEditName] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgSaveMsg, setOrgSaveMsg] = useState('');

  const isAdmin = currentMember?.role === 'ORG_ADMIN';

  // ── Load org info ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/settings/org')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ org, member }: { org: OrgInfo; member: CurrentMember }) => {
        setOrg(org);
        setCurrentMember(member);
        setEditName(org.name);
      })
      .catch(() => router.replace('/'))
      .finally(() => setLoading(false));
  }, [router]);

  // ── Load members ───────────────────────────────────────────────────────────
  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const r = await fetch('/api/settings/members');
      if (r.ok) setMembers(await r.json());
    } finally {
      setMembersLoading(false);
    }
  }, []);

  // ── Load API keys ──────────────────────────────────────────────────────────
  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    try {
      const r = await fetch('/api/settings/api-keys');
      if (r.ok) setApiKeys(await r.json());
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      loadMembers();
      if (isAdmin) loadApiKeys();
      // Load model config and app settings for the Model tab
      fetch('/api/llm-config').then(r => r.ok ? r.json() : null).then(d => {
        if (!d) return;
        setModelProvider(d.provider ?? 'anthropic');
        setModelModel(d.model ?? 'claude-sonnet-4-6');
        setModelBaseUrl(d.baseUrl ?? '');
        // If model isn't in the preset list, treat it as custom
        const prov = PROVIDERS.find(p => p.id === (d.provider ?? 'anthropic'));
        if (prov?.customModel && d.model && !prov.models.includes(d.model)) {
          setModelCustomModel(d.model);
        }
      }).catch(() => {});
      fetch('/api/app-settings').then(r => r.ok ? r.json() : null).then(d => {
        if (!d) return;
        setAppMaxPages(d.maxPages ?? 10);
        setAppDeepMax(d.deepCrawlMaxPages ?? 50);
        setAppAutoHeal(d.autoSelfHeal ?? false);
      }).catch(() => {});
    }
  }, [loading, isAdmin, loadMembers, loadApiKeys]);

  // ── Invite member ──────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const res = await fetch('/api/settings/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json() as { member?: Member; error?: string; warning?: string };
      if (!res.ok) { setInviteError(data.error ?? 'Failed to invite'); return; }
      setInviteSuccess(data.warning ?? `Invite sent to ${inviteEmail}`);
      setInviteEmail('');
      await loadMembers();
    } catch {
      setInviteError('Network error');
    } finally {
      setInviting(false);
    }
  }

  // ── Member actions ─────────────────────────────────────────────────────────
  async function resendInvite(memberId: string) {
    setActionLoading(memberId);
    await fetch(`/api/settings/members/${memberId}`, { method: 'POST' });
    setActionLoading(null);
    alert('Invite resent');
  }

  async function toggleMemberStatus(m: Member) {
    const newStatus = m.status === 'active' ? 'suspended' : 'active';
    if (!confirm(`${newStatus === 'suspended' ? 'Suspend' : 'Reactivate'} ${m.email}?`)) return;
    setActionLoading(m.id);
    await fetch(`/api/settings/members/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    await loadMembers();
    setActionLoading(null);
  }

  async function changeRole(m: Member, role: string) {
    setActionLoading(m.id);
    await fetch(`/api/settings/members/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    await loadMembers();
    setActionLoading(null);
  }

  async function removeMember(m: Member) {
    if (!confirm(`Remove ${m.email} from the organisation? This cannot be undone.`)) return;
    setActionLoading(m.id);
    await fetch(`/api/settings/members/${m.id}`, { method: 'DELETE' });
    await loadMembers();
    setActionLoading(null);
  }

  // ── Save API key ───────────────────────────────────────────────────────────
  async function saveApiKey(keyName: string) {
    const val = keyInputs[keyName]?.trim();
    if (!val) return;
    setKeysSaving(s => ({ ...s, [keyName]: true }));
    setKeysMsgs(m => ({ ...m, [keyName]: '' }));
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyName, keyValue: val }),
      });
      if (res.ok) {
        setKeysMsgs(m => ({ ...m, [keyName]: 'Saved' }));
        setKeyInputs(i => ({ ...i, [keyName]: '' }));
        await loadApiKeys();
        setTimeout(() => setKeysMsgs(m => ({ ...m, [keyName]: '' })), 2500);
      } else {
        const d = await res.json() as { error?: string };
        setKeysMsgs(m => ({ ...m, [keyName]: d.error ?? 'Failed' }));
      }
    } catch {
      setKeysMsgs(m => ({ ...m, [keyName]: 'Network error' }));
    } finally {
      setKeysSaving(s => ({ ...s, [keyName]: false }));
    }
  }

  async function deleteApiKey(keyName: string) {
    if (!confirm(`Remove ${keyName}? Sessions will fail until a new key is added.`)) return;
    await fetch(`/api/settings/api-keys/${keyName}`, { method: 'DELETE' });
    await loadApiKeys();
  }

  // ── Save model config ──────────────────────────────────────────────────────
  async function saveModelConfig() {
    setModelSaving(true);
    setModelMsg('');
    const prov = PROVIDERS.find(p => p.id === modelProvider);
    const effectiveModel = (prov?.customModel && modelCustomModel.trim())
      ? modelCustomModel.trim()
      : modelModel;
    const body: Record<string, string> = { provider: modelProvider, model: effectiveModel };
    if (modelBaseUrl.trim()) body.baseUrl = modelBaseUrl.trim();
    const res = await fetch('/api/llm-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setModelMsg(res.ok ? 'Saved' : 'Save failed');
    if (res.ok) setTimeout(() => setModelMsg(''), 2500);
    setModelSaving(false);
  }

  // ── Save app settings ──────────────────────────────────────────────────────
  async function saveAppSettings() {
    setAppSaving(true);
    setAppMsg('');
    const res = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPages: appMaxPages, deepCrawlMaxPages: appDeepMax, autoSelfHeal: appAutoHeal }),
    });
    setAppMsg(res.ok ? 'Saved' : 'Save failed');
    if (res.ok) setTimeout(() => setAppMsg(''), 2500);
    setAppSaving(false);
  }

  // ── Save org name ──────────────────────────────────────────────────────────
  async function saveOrgName() {
    setOrgSaving(true);
    setOrgSaveMsg('');
    const res = await fetch('/api/settings/org', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName }),
    });
    if (res.ok) {
      setOrg(o => o ? { ...o, name: editName } : o);
      setOrgSaveMsg('Saved');
      setTimeout(() => setOrgSaveMsg(''), 2000);
    } else {
      setOrgSaveMsg('Save failed');
    }
    setOrgSaving(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-3.5 flex items-center gap-4">
        <Building2 className="h-4 w-4 text-violet-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-zinc-100">{org?.name}</p>
          <p className="text-xs text-zinc-500">{currentMember?.email} · {currentMember?.role === 'ORG_ADMIN' ? 'Admin' : 'Member'}</p>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => router.push('/')}>
          ← Back to app
        </Button>
        <button
          onClick={() => signOut(() => router.push('/sign-in'))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Manage your organisation</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-800">
          {([
            { id: 'members', icon: Users,     label: 'Members' },
            { id: 'ai',      icon: Cpu,       label: 'AI' },
            { id: 'app',     icon: Key,       label: 'App Settings' },
            { id: 'org',     icon: Building2, label: 'Organisation' },
          ] as Array<{ id: string; icon: React.ElementType; label: string }>).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.id
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Members tab ──────────────────────────────────────────────────── */}
        {tab === 'members' && (
          <div className="space-y-5">
            {/* Invite form — admins only */}
            {isAdmin && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-zinc-100">Invite Member</h2>
                <form onSubmit={handleInvite} className="flex gap-2 flex-wrap">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    required
                    className="flex-1 min-w-48 h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                  />
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value)}
                    className="h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ORG_ADMIN">Admin</option>
                  </select>
                  <Button type="submit" size="sm" disabled={inviting}>
                    {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    {inviting ? 'Inviting…' : 'Send Invite'}
                  </Button>
                </form>
                {inviteError && <p className="text-xs text-red-400">{inviteError}</p>}
                {inviteSuccess && <p className="text-xs text-emerald-400">{inviteSuccess}</p>}
                <p className="text-xs text-zinc-600">
                  {members.filter(m => m.status !== 'suspended').length} / {org?.maxMembers} members used
                </p>
              </div>
            )}

            {/* Members list */}
            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-2">
                <Users className="h-4 w-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-100">Members</h2>
                <button onClick={loadMembers} className="ml-auto text-zinc-600 hover:text-zinc-400 transition-colors">
                  <RefreshCw className={`h-3.5 w-3.5 ${membersLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <table className="w-full text-sm bg-zinc-900">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-5 py-2.5 text-xs font-semibold text-zinc-500">Member</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Role</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500">Joined</th>
                    {isAdmin && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-zinc-100 font-medium">{m.displayName ?? '—'}</p>
                        <p className="text-xs text-zinc-500">{m.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin && m.email !== currentMember?.email ? (
                          <div className="relative group">
                            <button className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                              {m.role === 'ORG_ADMIN'
                                ? <><ShieldCheck className="h-3 w-3 text-violet-400" /> Admin</>
                                : 'Member'}
                              <ChevronDown className="h-3 w-3" />
                            </button>
                            <div className="absolute left-0 top-full mt-1 w-32 rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl z-10 hidden group-focus-within:block">
                              {['MEMBER', 'ORG_ADMIN'].map(r => (
                                <button
                                  key={r}
                                  onClick={() => changeRole(m, r)}
                                  className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 first:rounded-t-lg last:rounded-b-lg"
                                >
                                  {r === 'ORG_ADMIN' ? 'Admin' : 'Member'}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">
                            {m.role === 'ORG_ADMIN'
                              ? <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-violet-400" />Admin</span>
                              : 'Member'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3"><MemberStatusBadge status={m.status} /></td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {m.joinedAt ? timeAgo(m.joinedAt) : `Invited ${timeAgo(m.invitedAt)}`}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            {actionLoading === m.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />}
                            {m.status === 'invited' && (
                              <button
                                onClick={() => resendInvite(m.id)}
                                className="text-xs text-zinc-500 hover:text-violet-400 transition-colors flex items-center gap-1"
                              >
                                <Mail className="h-3 w-3" /> Resend
                              </button>
                            )}
                            {m.status === 'active' && (
                              <button
                                onClick={() => toggleMemberStatus(m)}
                                className="text-xs text-zinc-500 hover:text-amber-400 transition-colors"
                              >
                                Suspend
                              </button>
                            )}
                            {m.status === 'suspended' && (
                              <button
                                onClick={() => toggleMemberStatus(m)}
                                className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
                              >
                                Reactivate
                              </button>
                            )}
                            <button
                              onClick={() => removeMember(m)}
                              className="text-zinc-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── AI tab ────────────────────────────────────────────────────────── */}
        {tab === 'ai' && (() => {
          const prov = PROVIDERS.find(p => p.id === modelProvider) ?? PROVIDERS[0];
          return (
            <div className="space-y-5">

              {/* Provider & Model */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">Provider &amp; Model</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Used for test generation, analysis, and Figma comparison.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">Provider</label>
                    <select
                      value={modelProvider}
                      onChange={e => {
                        const p = PROVIDERS.find(pr => pr.id === e.target.value) ?? PROVIDERS[0];
                        setModelProvider(p.id);
                        setModelModel(p.defaultModel);
                        setModelBaseUrl(p.defaultBaseUrl ?? '');
                        setModelCustomModel('');
                      }}
                      className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                    >
                      {PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.local ? ' (local)' : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">Model</label>
                    {prov.models.length > 0 ? (
                      <select
                        value={prov.customModel && modelCustomModel ? '__custom__' : modelModel}
                        onChange={e => {
                          if (e.target.value === '__custom__') {
                            setModelModel('');
                          } else {
                            setModelModel(e.target.value);
                            setModelCustomModel('');
                          }
                        }}
                        className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                      >
                        {prov.models.map(m => <option key={m} value={m}>{m}</option>)}
                        {prov.customModel && <option value="__custom__">Custom…</option>}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={modelCustomModel}
                        onChange={e => setModelCustomModel(e.target.value)}
                        placeholder="Enter model name"
                        className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                      />
                    )}
                  </div>
                </div>

                {prov.customModel && (!prov.models.length || modelCustomModel !== '' || modelModel === '') && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">Custom model name</label>
                    <input
                      type="text"
                      value={modelCustomModel}
                      onChange={e => setModelCustomModel(e.target.value)}
                      placeholder="e.g. anthropic/claude-3-7-sonnet"
                      className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                    />
                  </div>
                )}

                {prov.customBaseUrl && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">Base URL</label>
                    <input
                      type="text"
                      value={modelBaseUrl}
                      onChange={e => setModelBaseUrl(e.target.value)}
                      placeholder={prov.defaultBaseUrl ?? 'https://…'}
                      className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm font-mono"
                    />
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <Button size="sm" onClick={saveModelConfig} disabled={modelSaving}>
                    {modelSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {modelSaving ? 'Saving…' : 'Save'}
                  </Button>
                  {modelMsg && (
                    <span className={`text-xs ${modelMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{modelMsg}</span>
                  )}
                </div>
              </div>

              {/* API Keys — admin only */}
              {isAdmin ? (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">API Keys</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Encrypted at rest, scoped to your org. Takes precedence over server environment variables.
                    </p>
                  </div>
                  {SUPPORTED_KEYS.map(def => {
                    const existing = apiKeys.find(k => k.keyName === def.name);
                    const inputVal = keyInputs[def.name] ?? '';
                    const visible  = keyVisible[def.name] ?? false;
                    const msg      = keysMsgs[def.name] ?? '';
                    const saving   = keysSaving[def.name] ?? false;
                    return (
                      <div key={def.name} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-zinc-100">{def.label}</p>
                            <p className="text-xs font-mono text-zinc-500 mt-0.5">{def.name}</p>
                          </div>
                          {existing && (
                            <div className="text-right shrink-0">
                              <p className="text-xs font-mono text-zinc-400">{existing.maskedValue}</p>
                              <p className="text-[10px] text-zinc-600 mt-0.5">Updated {timeAgo(existing.updatedAt)}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type={visible ? 'text' : 'password'}
                              value={inputVal}
                              onChange={e => setKeyInputs(k => ({ ...k, [def.name]: e.target.value }))}
                              placeholder={existing ? `Rotate: enter new ${def.placeholder}` : def.placeholder}
                              className="w-full h-9 px-3 pr-8 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => setKeyVisible(v => ({ ...v, [def.name]: !v[def.name] }))}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                            >
                              {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                          <Button size="sm" onClick={() => saveApiKey(def.name)} disabled={!inputVal.trim() || saving}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            {existing ? 'Rotate' : 'Save'}
                          </Button>
                          {existing && (
                            <Button size="sm" variant="secondary" onClick={() => deleteApiKey(def.name)} className="text-red-400 hover:text-red-300">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>

                        {msg && <p className={`text-xs ${msg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{msg}</p>}
                        {!existing && (
                          <p className="text-xs text-zinc-600">{def.hint}</p>
                        )}
                      </div>
                    );
                  })}
                  {apiKeysLoading && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading keys…
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">API keys are managed by your organisation admin.</p>
              )}
            </div>
          );
        })()}

        {/* ── App Settings tab ──────────────────────────────────────────────── */}
        {tab === 'app' && (
          <div className="space-y-5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Crawl Settings</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Controls how many pages TestPilot crawls per session.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Max pages — standard crawl</label>
                  <input
                    type="number" min={1} max={500}
                    value={appMaxPages}
                    onChange={e => setAppMaxPages(Number(e.target.value))}
                    disabled={!isAdmin}
                    className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-400">Max pages — authenticated crawl</label>
                  <input
                    type="number" min={1} max={500}
                    value={appDeepMax}
                    onChange={e => setAppDeepMax(Number(e.target.value))}
                    disabled={!isAdmin}
                    className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm disabled:opacity-50"
                  />
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-3 pt-1">
                  <Button size="sm" onClick={saveAppSettings} disabled={appSaving}>
                    {appSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {appSaving ? 'Saving…' : 'Save'}
                  </Button>
                  {appMsg && <span className={`text-xs ${appMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{appMsg}</span>}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Pipeline</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Controls test-run behaviour.</p>
              </div>

              <label className={`flex items-center gap-3 select-none ${isAdmin ? 'cursor-pointer' : 'opacity-50'}`}>
                <div
                  onClick={() => isAdmin && setAppAutoHeal(v => !v)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${appAutoHeal ? 'bg-violet-600' : 'bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${appAutoHeal ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <div>
                  <p className="text-sm text-zinc-200">Auto self-heal</p>
                  <p className="text-xs text-zinc-500">Automatically fix failing tests after each run</p>
                </div>
              </label>

              {isAdmin && (
                <div className="flex items-center gap-3 pt-1">
                  <Button size="sm" onClick={saveAppSettings} disabled={appSaving}>
                    {appSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {appSaving ? 'Saving…' : 'Save'}
                  </Button>
                  {appMsg && <span className={`text-xs ${appMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{appMsg}</span>}
                </div>
              )}

              {!isAdmin && <p className="text-xs text-zinc-500">Only admins can change pipeline settings.</p>}
            </div>
          </div>
        )}

        {/* ── Org tab ───────────────────────────────────────────────────────── */}
        {tab === 'org' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-100">Organisation Info</h2>

              {isAdmin ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">Display Name</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm max-w-sm"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={saveOrgName} disabled={orgSaving}>
                      {orgSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {orgSaving ? 'Saving…' : 'Save'}
                    </Button>
                    {orgSaveMsg && (
                      <span className={`text-xs ${orgSaveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {orgSaveMsg}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-300">{org?.name}</p>
              )}

              <div className="pt-3 border-t border-zinc-800 space-y-2">
                {[
                  { label: 'Slug', value: org?.slug ?? '—', mono: true },
                  { label: 'Status', value: org?.licenseStatus ?? '—', mono: false },
                  { label: 'Member limit', value: `${org?.maxMembers} members`, mono: false },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-4 text-sm">
                    <span className="text-zinc-500 w-28 shrink-0">{row.label}</span>
                    <span className={`text-zinc-300 ${row.mono ? 'font-mono text-xs' : ''}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
