'use client';

import { Logo } from "@/components/logo";

/** Rendered by Next.js when the Dashboard Server Component throws (e.g. DB error). */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <Logo height={32} />
      </header>
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center gap-4">
        <p className="text-zinc-400 text-sm max-w-sm">
          {error.message ?? "Something went wrong loading the dashboard."}
        </p>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="text-sm px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition-colors"
          >
            Try again
          </button>
          <a
            href="/sign-in"
            className="text-sm px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-300 transition-colors"
          >
            Sign in again
          </a>
        </div>
      </section>
    </main>
  );
}
