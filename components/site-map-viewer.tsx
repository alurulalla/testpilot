import { SiteMap } from '@/types/session';
import { Globe, Link } from 'lucide-react';

interface SiteMapViewerProps {
  siteMap: SiteMap;
}

export function SiteMapViewer({ siteMap }: SiteMapViewerProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <Globe className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs font-mono text-zinc-400">
          {siteMap.total_pages} pages discovered
        </span>
      </div>
      <div className="divide-y divide-zinc-800 max-h-60 overflow-y-auto">
        {siteMap.pages.map((page, i) => (
          <div key={i} className="flex items-center gap-2 px-4 py-2 hover:bg-zinc-800/50">
            <Link className="h-3 w-3 text-zinc-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-zinc-300 truncate">{page.url}</p>
              {page.title && (
                <p className="text-xs text-zinc-600 truncate">{page.title}</p>
              )}
            </div>
            {page.status_code && page.status_code !== 200 && (
              <span className="ml-auto shrink-0 text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                {page.status_code}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
