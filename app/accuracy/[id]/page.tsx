'use client';

/**
 * /accuracy/[id]  — Test-suite accuracy report for a session.
 *
 * On mount, POSTs to /api/sessions/[id]/accuracy to run the LLM-powered
 * coverage analysis, then renders a full breakdown:
 *
 *  • Large overall score at the top
 *  • Three dimension cards: Documentation %, Site Discovery %, Test Alignment %
 *  • Feature-by-feature coverage table (doc section → covered/uncovered)
 *  • Test alignment table (which tests map to which features)
 *  • Page coverage list
 *  • Optional Figma frames section
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileText,
  Globe,
  Layers,
  Code2,
  RefreshCw,
} from 'lucide-react';
import type { AccuracyReport, FeatureCoverage, SitePageCoverage, TestAlignmentItem, FigmaFrameCoverage } from '@/app/api/sessions/[id]/accuracy/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const fill = circ * (score / 100);
  const color =
    score >= 80 ? '#34d399'
    : score >= 50 ? '#a78bfa'
    : '#f87171';

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={size / 2} cy={size / 2} r={r}
        strokeWidth={8} stroke="#27272a" fill="none"
      />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        strokeWidth={8} stroke={color} fill="none"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
    </svg>
  );
}

function ScoreCard({
  icon, label, score, covered, total, hasData,
}: {
  icon: React.ReactNode;
  label: string;
  score: number;
  covered: number;
  total: number;
  hasData: boolean;
}) {
  const color =
    !hasData ? 'text-zinc-600'
    : score >= 80 ? 'text-emerald-400'
    : score >= 50 ? 'text-violet-400'
    : 'text-red-400';

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col items-center gap-3">
      <div className="text-zinc-500">{icon}</div>
      <p className="text-xs text-zinc-500 text-center">{label}</p>
      {hasData ? (
        <>
          <span className={`text-3xl font-bold tabular-nums ${color}`}>{score}%</span>
          <p className="text-xs text-zinc-600">{covered} / {total} covered</p>
        </>
      ) : (
        <span className="text-sm text-zinc-600">—</span>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs text-zinc-500 uppercase tracking-widest mb-3">{children}</h2>
  );
}

// ── Feature coverage table ────────────────────────────────────────────────────

function FeatureTable({ features }: { features: FeatureCoverage[] }) {
  return (
    <div className="space-y-2">
      {features.map((f, i) => (
        <div
          key={i}
          className={`rounded-lg border px-4 py-3 ${
            f.covered
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-zinc-800 bg-zinc-900'
          }`}
        >
          <div className="flex items-start gap-3">
            {f.covered
              ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              : <XCircle className="h-4 w-4 text-zinc-600 shrink-0 mt-0.5" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">{f.name}</p>
              {f.items.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {f.items.map((item, j) => (
                    <li key={j} className="text-xs text-zinc-500">· {item}</li>
                  ))}
                </ul>
              )}
              {f.covered && f.tests.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {f.tests.map((t, j) => (
                    <span
                      key={j}
                      className="text-[10px] font-mono bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {f.testFile && (
                <p className="mt-1.5 text-[10px] text-zinc-600 font-mono">{f.testFile}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page coverage list ────────────────────────────────────────────────────────

function PageList({ pages }: { pages: SitePageCoverage[] }) {
  return (
    <div className="space-y-1.5">
      {pages.map((p, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
            p.covered
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-zinc-800 bg-zinc-900'
          }`}
        >
          {p.covered
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            : <XCircle className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-300 truncate">{p.title}</p>
            <p className="text-[10px] text-zinc-600 font-mono truncate">{p.url}</p>
          </div>
          {p.testFile && (
            <span className="text-[10px] font-mono text-zinc-500 shrink-0">{p.testFile}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Test alignment list ───────────────────────────────────────────────────────

function AlignmentList({ items }: { items: TestAlignmentItem[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((t, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
            t.alignedTo
              ? 'border-violet-500/20 bg-violet-500/5'
              : 'border-zinc-800 bg-zinc-900'
          }`}
        >
          {t.alignedTo
            ? <CheckCircle2 className="h-3.5 w-3.5 text-violet-400 shrink-0" />
            : <XCircle className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <p className="text-xs text-zinc-300 truncate">{t.name}</p>
            <p className="text-[10px] text-zinc-600 font-mono truncate">{t.file}</p>
          </div>
          {t.alignedTo && (
            <span className="text-[10px] text-violet-400 shrink-0 text-right max-w-[160px] truncate">
              {t.alignedTo}
            </span>
          )}
          {!t.alignedTo && (
            <span className="text-[10px] text-zinc-600 shrink-0">undocumented</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Figma frames list ─────────────────────────────────────────────────────────

function FigmaList({ frames }: { frames: FigmaFrameCoverage[] }) {
  return (
    <div className="space-y-1.5">
      {frames.map((f, i) => (
        <div
          key={i}
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
            f.covered
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-zinc-800 bg-zinc-900'
          }`}
        >
          {f.covered
            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            : <XCircle className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          }
          <p className="text-xs text-zinc-300 flex-1 truncate">{f.frameName}</p>
          <a
            href={f.compareUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-zinc-500 hover:text-violet-400 transition font-mono truncate max-w-[160px] shrink-0"
          >
            {f.compareUrl}
          </a>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccuracyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const runAnalysis = () => {
    setLoading(true);
    setError('');
    setReport(null);

    fetch(`/api/sessions/${id}/accuracy`, { method: 'POST' })
      .then(r => {
        if (!r.ok) return r.json().then(d => Promise.reject(d.error ?? `Error ${r.status}`));
        return r.json() as Promise<AccuracyReport>;
      })
      .then(data => setReport(data))
      .catch((e: unknown) => setError(typeof e === 'string' ? e : 'Analysis failed.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (id) runAnalysis(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Overall score colour ──────────────────────────────────────────────────

  const scoreColor =
    !report ? 'text-zinc-400'
    : report.overallScore >= 80 ? 'text-emerald-400'
    : report.overallScore >= 50 ? 'text-violet-400'
    : 'text-red-400';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950">

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-5 py-3 flex items-center gap-4 shrink-0">
        <button
          onClick={() => router.push(`/session/${id}`)}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">
            Accuracy Report
          </p>
          {report?.sessionUrl && (
            <p className="text-xs text-zinc-500 truncate">{report.sessionUrl}</p>
          )}
        </div>

        {/* Re-run button */}
        {!loading && (
          <button
            onClick={runAnalysis}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-analyse
          </button>
        )}

        <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium shrink-0">
          Coverage
        </span>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-10">

          {/* ── Loading ─────────────────────────────────────────────────────── */}
          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-24">
              <Loader2 className="h-8 w-8 text-violet-400 animate-spin" />
              <p className="text-sm text-zinc-400">Running coverage analysis…</p>
              <p className="text-xs text-zinc-600 text-center max-w-xs">
                The LLM is mapping your tests to documented features. This takes 10–20 seconds.
              </p>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────────────── */}
          {!loading && error && (
            <div className="flex flex-col items-center gap-4 py-16">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-300">{error}</p>
              <button
                onClick={runAnalysis}
                className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition"
              >
                Try again
              </button>
            </div>
          )}

          {/* ── Report ──────────────────────────────────────────────────────── */}
          {!loading && report && (
            <>
              {/* Overall score hero */}
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="relative">
                  <ScoreRing score={report.overallScore} size={140} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-bold tabular-nums ${scoreColor}`}>
                      {report.overallScore}
                    </span>
                    <span className="text-xs text-zinc-500 mt-0.5">overall</span>
                  </div>
                </div>
                <p className="text-sm text-zinc-400 text-center max-w-sm">
                  {report.overallScore >= 80
                    ? 'Excellent coverage — your test suite closely matches the documented product.'
                    : report.overallScore >= 50
                    ? 'Moderate coverage — some documented features are missing test cases.'
                    : 'Low coverage — many documented features lack test coverage.'}
                </p>
                <p className="text-[10px] text-zinc-700 font-mono">
                  analysed {new Date(report.generatedAt).toLocaleString()}
                </p>
              </div>

              {/* ── Dimension cards ──────────────────────────────────────────── */}
              <div className={`grid gap-4 ${report.figma ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
                <ScoreCard
                  icon={<FileText className="h-5 w-5" />}
                  label="Documentation Coverage"
                  score={report.doc.score}
                  covered={report.doc.covered}
                  total={report.doc.total}
                  hasData={report.doc.hasDoc && report.doc.total > 0}
                />
                <ScoreCard
                  icon={<Globe className="h-5 w-5" />}
                  label="Site Discovery Coverage"
                  score={report.site.score}
                  covered={report.site.covered}
                  total={report.site.total}
                  hasData={report.site.hasMap && report.site.total > 0}
                />
                <ScoreCard
                  icon={<Code2 className="h-5 w-5" />}
                  label="Test Alignment"
                  score={report.tests.alignmentScore}
                  covered={report.tests.aligned}
                  total={report.tests.total}
                  hasData={report.tests.total > 0}
                />
                {report.figma && (
                  <ScoreCard
                    icon={<Layers className="h-5 w-5" />}
                    label="Figma Frame Coverage"
                    score={report.figma.score}
                    covered={report.figma.covered}
                    total={report.figma.total}
                    hasData={report.figma.total > 0}
                  />
                )}
              </div>

              {/* ── LLM analysis warning (fallback to heuristics) ────────────── */}
              {report.llmError && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    LLM analysis failed ({report.llmError.slice(0, 120)}). Coverage was computed using keyword matching — accuracy may be lower.
                  </p>
                </div>
              )}

              {/* ── No doc / no sitemap warnings ─────────────────────────────── */}
              {!report.doc.hasDoc && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    No product documentation was uploaded for this session. Upload a doc on the session page to enable documentation coverage analysis.
                  </p>
                </div>
              )}
              {!report.site.hasMap && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    No site map found. Run the Explore phase to discover pages and enable site coverage analysis.
                  </p>
                </div>
              )}

              {/* ── Documentation feature coverage ───────────────────────────── */}
              {report.doc.hasDoc && report.doc.features.length > 0 && (
                <section>
                  <SectionHeader>
                    Documentation Coverage — {report.doc.covered}/{report.doc.total} features
                  </SectionHeader>
                  <FeatureTable features={report.doc.features} />
                </section>
              )}

              {/* ── Site page coverage ───────────────────────────────────────── */}
              {report.site.hasMap && report.site.pages.length > 0 && (
                <section>
                  <SectionHeader>
                    Site Discovery Coverage — {report.site.covered}/{report.site.total} pages
                  </SectionHeader>
                  <PageList pages={report.site.pages} />
                </section>
              )}

              {/* ── Test alignment ───────────────────────────────────────────── */}
              {report.tests.items.length > 0 && (
                <section>
                  <SectionHeader>
                    Test Alignment — {report.tests.aligned}/{report.tests.total} tests aligned to docs
                  </SectionHeader>
                  <AlignmentList items={report.tests.items} />
                </section>
              )}

              {/* ── Figma frames ─────────────────────────────────────────────── */}
              {report.figma && report.figma.frames.length > 0 && (
                <section>
                  <SectionHeader>
                    Figma Frame Coverage — {report.figma.covered}/{report.figma.total} frames
                  </SectionHeader>
                  <FigmaList frames={report.figma.frames} />
                </section>
              )}

              {/* ── No tests yet ─────────────────────────────────────────────── */}
              {report.tests.total === 0 && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Code2 className="h-8 w-8 text-zinc-700" />
                  <p className="text-sm text-zinc-500">No test files found yet.</p>
                  <p className="text-xs text-zinc-600 max-w-xs">
                    Run the Generate phase on the session page to create tests, then re-analyse.
                  </p>
                  <button
                    onClick={() => router.push(`/session/${id}`)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition mt-1"
                  >
                    ← Go to session
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
