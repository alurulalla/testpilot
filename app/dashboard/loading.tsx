import { Logo } from "@/components/logo";

/** Skeleton shown by Next.js while the Dashboard Server Component is fetching. */
export default function DashboardLoading() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950">
      {/* Nav skeleton */}
      <header className="shrink-0 border-b border-zinc-800 px-6 py-3 flex items-center gap-3">
        <Logo height={28} />
        <div className="flex-1" />
        <div className="h-8 w-28 rounded-lg bg-zinc-800 animate-pulse" />
        <div className="h-8 w-8 rounded-full bg-zinc-800 animate-pulse" />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar skeleton */}
        <aside className="w-56 lg:w-64 shrink-0 border-r border-zinc-800 flex flex-col">
          <div className="px-3 py-2.5 border-b border-zinc-800">
            <div className="h-3 w-16 rounded bg-zinc-800 animate-pulse" />
          </div>
          <div className="flex-1 overflow-hidden py-3 px-2 space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-12 rounded-lg bg-zinc-900 animate-pulse"
                style={{ opacity: 1 - i * 0.1 }}
              />
            ))}
          </div>
        </aside>

        {/* Main content skeleton */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
            {/* Header skeleton */}
            <div className="space-y-2">
              <div className="h-6 w-64 rounded-lg bg-zinc-800 animate-pulse" />
              <div className="h-3 w-40 rounded bg-zinc-800 animate-pulse" />
            </div>
            {/* Stat cards skeleton */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl border border-zinc-800 bg-zinc-900 animate-pulse" />
              ))}
            </div>
            {/* Chart skeletons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="h-40 rounded-xl border border-zinc-800 bg-zinc-900 animate-pulse" />
              <div className="h-40 rounded-xl border border-zinc-800 bg-zinc-900 animate-pulse" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
