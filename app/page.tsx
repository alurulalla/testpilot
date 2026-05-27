import Link from "next/link";
import { Zap, Globe, Code2, Play, Wrench, ArrowRight } from "lucide-react";
import { listSessions } from "@/lib/session-store";
import { HomeInput } from "@/components/home-input";

export const dynamic = "force-dynamic";

const features = [
  {
    icon: Globe,
    title: "Feature Discovery",
    desc: "Crawls every page and maps forms, buttons, and user flows.",
  },
  {
    icon: Code2,
    title: "Test Generation",
    desc: "Generates a full Playwright test suite from the site map.",
  },
  {
    icon: Play,
    title: "Test Execution",
    desc: "Runs tests and captures screenshots, logs, and trace files.",
  },
  {
    icon: Wrench,
    title: "Self-Healing",
    desc: "Automatically fixes failing tests and reruns until all pass.",
  },
];

function statusColor(status: string) {
  if (status === "complete") return "text-emerald-400";
  if (status === "failed") return "text-red-400";
  if (["exploring", "generating", "running", "fixing"].includes(status))
    return "text-violet-400";
  return "text-zinc-500";
}

export default function Home() {
  const sessions = listSessions().slice(0, 5);

  return (
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3">
        <Zap className="h-5 w-5 text-violet-400" />
        <span className="font-semibold text-sm">TestPilot</span>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs mb-6">
          <Zap className="h-3 w-3" /> AI-powered E2E Testing
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-zinc-50 mb-4 tracking-tight">
          Give it a URL.
          <br />
          Wake up with tests.
        </h1>
        <p className="text-zinc-400 max-w-md mb-10 text-base">
          TestPilot explores your web app, generates a full Playwright suite,
          runs it, and self-heals failures — all automatically.
        </p>

        <HomeInput />

        {/* Feature grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-16 max-w-3xl w-full">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="text-left rounded-xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <Icon className="h-5 w-5 text-violet-400 mb-2" />
              <h3 className="text-sm font-medium text-zinc-100 mb-1">
                {title}
              </h3>
              <p className="text-xs text-zinc-500">{desc}</p>
            </div>
          ))}
        </div>

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <div className="mt-12 w-full max-w-2xl text-left">
            <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">
              Recent Sessions
            </h2>
            <div className="space-y-2">
              {sessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/session/${s.id}`}
                  className="flex items-center justify-between px-4 py-3 rounded-lg border border-zinc-800 bg-zinc-900 hover:border-zinc-700 transition-colors group"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100 truncate">{s.url}</p>
                    <p
                      className={`text-xs mt-0.5 capitalize ${statusColor(s.status)}`}
                    >
                      {s.status}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-600 group-hover:text-zinc-300 shrink-0 ml-3 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
