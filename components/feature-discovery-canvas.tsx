'use client';

/**
 * FeatureDiscoveryCanvas
 *
 * Renders a Miro-style canvas board from uploaded product documentation.
 *
 * Layout (top → bottom):
 *  1. Dot-grid canvas background (dark, signature board feel)
 *  2. Document header card  — title + overview
 *  3. User Flow lane        — numbered nodes connected by arrows (scrolls horizontally)
 *  4. Features grid         — colored sticky-note cards for each section
 *  5. Best-practices strip  — pill tags
 */

import { useMemo } from 'react';
import { BookOpen, CheckCircle2, ArrowRight } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DocSection {
  name: string;
  items: string[];
}

interface ParsedDoc {
  title: string;
  overview: string;
  sections: DocSection[];
  userJourney: string[];
  bestPractices: string[];
}

// ── Sticky-note colour palette ────────────────────────────────────────────────

const PALETTE = [
  { strip: 'bg-violet-500',  card: 'bg-violet-500/10 border-violet-500/30', head: 'text-violet-300', dot: 'bg-violet-400' },
  { strip: 'bg-sky-500',     card: 'bg-sky-500/10    border-sky-500/30',    head: 'text-sky-300',    dot: 'bg-sky-400'    },
  { strip: 'bg-emerald-500', card: 'bg-emerald-500/10 border-emerald-500/30',head: 'text-emerald-300',dot: 'bg-emerald-400'},
  { strip: 'bg-amber-500',   card: 'bg-amber-500/10  border-amber-500/30',  head: 'text-amber-300',  dot: 'bg-amber-400'  },
  { strip: 'bg-rose-500',    card: 'bg-rose-500/10   border-rose-500/30',   head: 'text-rose-300',   dot: 'bg-rose-400'   },
  { strip: 'bg-cyan-500',    card: 'bg-cyan-500/10   border-cyan-500/30',   head: 'text-cyan-300',   dot: 'bg-cyan-400'   },
  { strip: 'bg-orange-500',  card: 'bg-orange-500/10 border-orange-500/30', head: 'text-orange-300', dot: 'bg-orange-400' },
  { strip: 'bg-pink-500',    card: 'bg-pink-500/10   border-pink-500/30',   head: 'text-pink-300',   dot: 'bg-pink-400'   },
  { strip: 'bg-teal-500',    card: 'bg-teal-500/10   border-teal-500/30',   head: 'text-teal-300',   dot: 'bg-teal-400'   },
  { strip: 'bg-indigo-500',  card: 'bg-indigo-500/10 border-indigo-500/30', head: 'text-indigo-300', dot: 'bg-indigo-400' },
];

// Node colours for journey steps (cycling)
const NODE_COLORS = [
  { ring: 'border-violet-400',  bg: 'bg-violet-500/20',  num: 'text-violet-300', text: 'text-violet-100' },
  { ring: 'border-sky-400',     bg: 'bg-sky-500/20',     num: 'text-sky-300',    text: 'text-sky-100'    },
  { ring: 'border-emerald-400', bg: 'bg-emerald-500/20', num: 'text-emerald-300',text: 'text-emerald-100'},
  { ring: 'border-amber-400',   bg: 'bg-amber-500/20',   num: 'text-amber-300',  text: 'text-amber-100'  },
  { ring: 'border-rose-400',    bg: 'bg-rose-500/20',    num: 'text-rose-300',   text: 'text-rose-100'   },
];

// ── Parser ────────────────────────────────────────────────────────────────────

function parseDoc(content: string): ParsedDoc {
  const lines = content.split('\n');
  let title = '', overview = '';
  const sections: DocSection[] = [];
  const userJourney: string[] = [];
  const bestPractices: string[] = [];

  type Mode = 'none' | 'overview' | 'feature' | 'journey' | 'best';
  let mode: Mode = 'none';
  let cur: DocSection | null = null;

  function flush() {
    if (cur && cur.items.length > 0) { sections.push(cur); cur = null; }
  }

  const SKIP    = /^(Overview|Homepage Sections?|Sections?|Features?|Summary|Table of Contents|Introduction)/i;
  const JOURNEY = /^#{1,4}\s+(Typical\s+)?User\s+Journey/i;
  const BEST    = /^#{1,4}\s+Best\s+Practices?/i;
  const SUMMARY = /^#{1,4}\s+(Summary|Introduction|Table of Contents)/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('# ') && !title)   { title = line.slice(2).trim(); continue; }
    if (line.match(/^#{1,4}\s+Overview/i)) { flush(); mode = 'overview'; continue; }
    if (line.match(JOURNEY))               { flush(); mode = 'journey';  continue; }
    if (line.match(BEST))                  { flush(); mode = 'best';     continue; }
    if (line.match(SUMMARY))               { flush(); mode = 'none';     continue; }

    const hMatch = line.match(/^#{2,4}\s+(?:\d+[.)]\s+)?(.+)/);
    if (hMatch) {
      const name = hMatch[1].trim();
      if (!name.match(SKIP)) { flush(); cur = { name, items: [] }; mode = 'feature'; }
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)/);
    if (bullet) {
      const item = bullet[1].trim();
      if (mode === 'feature' && cur) cur.items.push(item);
      if (mode === 'best')           bestPractices.push(item);
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)/);
    if (numbered) {
      const item = numbered[1].trim();
      if (mode === 'journey') userJourney.push(item);
      if (mode === 'best')    bestPractices.push(item);
      continue;
    }

    if (mode === 'overview' && !line.startsWith('#')) {
      overview = overview ? `${overview} ${line}` : line;
    }
  }
  flush();
  return { title, overview, sections, userJourney, bestPractices };
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** A single step node in the user flow */
function FlowNode({ step, index, total }: { step: string; index: number; total: number }) {
  const c = NODE_COLORS[index % NODE_COLORS.length];
  const isLast = index === total - 1;

  return (
    <div className="flex items-center gap-0 shrink-0">
      {/* Node card */}
      <div className={`relative rounded-xl border-2 ${c.ring} ${c.bg} px-4 py-3 w-36 flex flex-col items-center gap-1.5 shadow-lg`}>
        {/* Step number badge */}
        <div className={`absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-zinc-900 border-2 ${c.ring} flex items-center justify-center`}>
          <span className={`text-[10px] font-bold tabular-nums ${c.num}`}>{index + 1}</span>
        </div>
        {/* Step label */}
        <p className={`text-[11px] font-medium text-center leading-snug mt-1 ${c.text}`}>
          {step}
        </p>
      </div>

      {/* Connector arrow (not after last) */}
      {!isLast && (
        <div className="flex items-center shrink-0 mx-1">
          <div className="w-6 h-px bg-zinc-600" />
          <ArrowRight className="h-3.5 w-3.5 text-zinc-400 -ml-0.5" />
        </div>
      )}
    </div>
  );
}

/** A sticky-note card for a feature section */
function StickyCard({ section, colorIdx }: { section: DocSection; colorIdx: number }) {
  const c = PALETTE[colorIdx % PALETTE.length];
  const visible = section.items.slice(0, 5);
  const extra   = section.items.length - visible.length;

  return (
    <div className={`rounded-xl border overflow-hidden shadow-md ${c.card}`}>
      {/* Coloured top strip */}
      <div className={`h-1.5 w-full ${c.strip}`} />
      <div className="p-3.5 space-y-2">
        <p className={`text-xs font-semibold leading-snug ${c.head}`}>{section.name}</p>
        {visible.length > 0 && (
          <ul className="space-y-1">
            {visible.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${c.dot}`} />
                <span className="text-[11px] text-zinc-300 leading-snug">{item}</span>
              </li>
            ))}
            {extra > 0 && (
              <li className="text-[10px] text-zinc-400 pl-3">+{extra} more</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Canvas section label ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-px flex-1 bg-zinc-700/60" />
      <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-medium px-2">
        {children}
      </span>
      <div className="h-px flex-1 bg-zinc-700/60" />
    </div>
  );
}

// ── Main canvas component ─────────────────────────────────────────────────────

export interface FeatureDiscoveryCanvasProps {
  docContent: string;
}

export function FeatureDiscoveryCanvas({ docContent }: FeatureDiscoveryCanvasProps) {
  const parsed = useMemo(() => parseDoc(docContent), [docContent]);

  const hasContent =
    parsed.sections.length > 0 ||
    parsed.userJourney.length > 0 ||
    parsed.bestPractices.length > 0;

  if (!hasContent) {
    return (
      <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/50 p-6 text-center space-y-2">
        <BookOpen className="h-5 w-5 text-zinc-400 mx-auto" />
        <p className="text-xs text-zinc-400">
          No structured sections detected. The document will still be used during test generation.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-zinc-700/40 overflow-hidden"
      style={{
        background: `radial-gradient(circle, rgba(63,63,70,0.45) 1px, transparent 1px),
                     linear-gradient(to bottom, #111113, #0e0e10)`,
        backgroundSize: '22px 22px, 100% 100%',
      }}
    >
      <div className="p-5 space-y-6">

        {/* ── Header card ─────────────────────────────────────────────── */}
        {(parsed.title || parsed.overview) && (
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/70 backdrop-blur px-4 py-3 shadow-lg flex items-start gap-3">
            <BookOpen className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              {parsed.title && (
                <p className="text-sm font-semibold text-zinc-100 leading-snug">{parsed.title}</p>
              )}
              {parsed.overview && (
                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{parsed.overview}</p>
              )}
            </div>
          </div>
        )}

        {/* ── User Flow lane ───────────────────────────────────────────── */}
        {parsed.userJourney.length > 0 && (
          <div>
            <SectionLabel>User Flow</SectionLabel>
            {/* Horizontally scrollable flow strip */}
            <div className="overflow-x-auto pb-2">
              <div className="flex items-center gap-0 pt-4 min-w-max px-1">
                {/* START terminal */}
                <div className="flex items-center gap-1 shrink-0 mr-2">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.4)]" />
                  <span className="text-[10px] text-emerald-400 font-mono uppercase tracking-wider">start</span>
                </div>
                <div className="w-4 h-px bg-zinc-600 shrink-0 mx-1" />

                {/* Steps */}
                {parsed.userJourney.map((step, i) => (
                  <FlowNode key={i} step={step} index={i} total={parsed.userJourney.length} />
                ))}

                {/* END terminal */}
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <div className="w-4 h-px bg-zinc-600 shrink-0" />
                  <div className="w-3 h-3 rounded-full bg-zinc-600 border-2 border-zinc-500" />
                  <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-wider">end</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Features grid ────────────────────────────────────────────── */}
        {parsed.sections.length > 0 && (
          <div>
            <SectionLabel>{parsed.sections.length} Feature{parsed.sections.length !== 1 ? 's' : ''} Detected</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {parsed.sections.map((sec, i) => (
                <StickyCard key={sec.name} section={sec} colorIdx={i} />
              ))}
            </div>
          </div>
        )}

        {/* ── Best practices ───────────────────────────────────────────── */}
        {parsed.bestPractices.length > 0 && (
          <div>
            <SectionLabel>Best Practices</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {parsed.bestPractices.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-full bg-zinc-800/80 border border-zinc-700/50 px-3 py-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                  <span className="text-[11px] text-zinc-300">{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
