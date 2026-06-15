'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export default function NewOrgPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [maxMembers, setMaxMembers] = useState(5);
  const [adminEmail, setAdminEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function handleNameChange(val: string) {
    setName(val);
    if (!slugEdited) setSlug(slugify(val));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, maxMembers, adminEmail }),
      });
      const data = await res.json() as { org?: { id: string }; error?: string; warning?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to create organisation');
        return;
      }
      // Show warning if invite failed but still navigate
      if (data.warning) alert(`⚠️ ${data.warning}`);
      router.push(`/admin/orgs/${data.org!.id}`);
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-zinc-400 hover:text-zinc-100 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-violet-400" />
          <h1 className="text-lg font-bold text-zinc-100">New Organisation</h1>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">

        {/* Org name */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400">Organisation Name</label>
          <input
            type="text"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="Acme Corp"
            required
            className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
          />
        </div>

        {/* Slug */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400">
            Slug
            <span className="ml-1.5 text-zinc-400 font-normal">(auto-generated, must be unique)</span>
          </label>
          <input
            type="text"
            value={slug}
            onChange={e => { setSlug(e.target.value); setSlugEdited(true); }}
            placeholder="acme-corp"
            required
            pattern="[a-z0-9-]+"
            title="Lowercase letters, numbers and hyphens only"
            className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm font-mono"
          />
          <p className="text-xs text-zinc-400">Lowercase letters, numbers and hyphens only</p>
        </div>

        {/* Max members */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400">Max Members</label>
          <input
            type="number"
            min={1}
            max={500}
            value={maxMembers}
            onChange={e => setMaxMembers(Number(e.target.value))}
            className="w-24 h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
          />
          <p className="text-xs text-zinc-400">Maximum number of members allowed in this org</p>
        </div>

        {/* Admin email */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400">
            Org Admin Email
            <span className="ml-1.5 text-zinc-400 font-normal">(receives invite email)</span>
          </label>
          <input
            type="email"
            value={adminEmail}
            onChange={e => setAdminEmail(e.target.value)}
            placeholder="admin@acme.com"
            required
            className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
          />
          <p className="text-xs text-zinc-400">
            A Clerk invitation email will be sent. They click the link, set a password, and become the Org Admin.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
            {submitting ? 'Creating…' : 'Create Organisation'}
          </Button>
          <Link href="/admin">
            <Button type="button" variant="secondary">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
