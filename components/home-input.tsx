'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HomeInput() {
  const [url, setUrl] = useState('');
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

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto px-4 sm:px-0">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            autoFocus
            className="w-full h-12 pl-10 pr-4 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
          />
        </div>
        <Button type="submit" size="lg" disabled={loading || !url.trim()} className="w-full sm:w-auto shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {loading ? 'Opening…' : 'Configure →'}
        </Button>
      </div>
    </form>
  );
}
