import Link from "next/link";
import { Globe, Code2, Play, Wrench, ArrowRight, Zap, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/logo";

// Authenticated users are redirected to /dashboard by middleware before this
// page ever renders, so no auth check is needed here.
export const dynamic = "force-static"; // safe to cache — no user-specific content

const features = [
  {
    icon: Globe,
    title: "Feature Discovery",
    desc: "Crawls every page and maps forms, buttons, and user flows automatically.",
  },
  {
    icon: Code2,
    title: "Test Generation",
    desc: "Generates a full Playwright test suite from the site map using AI.",
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

const bullets = [
  "No test code to write — AI generates the full suite",
  "Works on any web app, authenticated or not",
  "Figma design verification built in",
  "Multi-tenant — one account per team",
];

export default function Home() {
  return (
    <main className="flex-1 flex flex-col">
      {/* Nav */}
      <header className="border-b border-zinc-800/60 px-6 py-4 flex items-center gap-4">
        <Logo height={30} />
        <div className="flex-1" />
        <Link
          href="/sign-in"
          className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors px-3 py-1.5 rounded-lg hover:bg-zinc-800"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white px-4 py-1.5 rounded-lg transition-colors"
        >
          Get Started
        </Link>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs mb-6">
          <Zap className="h-3 w-3" /> AI-powered End-to-End Testing
        </div>

        <h1 className="text-4xl sm:text-6xl font-bold text-zinc-50 mb-5 tracking-tight max-w-3xl leading-tight">
          Give it a URL.
          <br />
          <span className="text-violet-400">Wake up with tests.</span>
        </h1>

        <p className="text-zinc-400 max-w-lg mb-10 text-lg leading-relaxed">
          TestPilot explores your web app, generates a full Playwright suite,
          runs it, and self-heals failures — completely automatically.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-16">
          <Link
            href="/sign-up"
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-violet-900/30"
          >
            Get Started Free <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/sign-in"
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-zinc-100 font-medium text-sm transition-colors"
          >
            Sign In
          </Link>
        </div>

        {/* Bullet points */}
        <ul className="flex flex-col sm:flex-row gap-4 sm:gap-8 mb-20 text-sm text-zinc-400">
          {bullets.map(b => (
            <li key={b} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-violet-400 shrink-0" />
              {b}
            </li>
          ))}
        </ul>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl w-full">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="text-left rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-zinc-700 transition-colors"
            >
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
                <Icon className="h-5 w-5 text-violet-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100 mb-1.5">{title}</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/60 px-6 py-4 flex items-center justify-center gap-2 text-xs text-zinc-600">
        <Logo height={14} iconOnly />
        <span>TestPilot · AI-powered E2E testing</span>
      </footer>
    </main>
  );
}
