'use client';

/**
 * /canvas/preview  — Feature canvas for a doc loaded on the prepare page
 * (before a session exists). Reads doc content from sessionStorage.
 */

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';

// Re-use the same parser and layout from the session canvas page
// (copy-shared to avoid cross-page imports from app/ routes)

interface DocSection { name: string; items: string[] }
interface ParsedDoc {
  title: string; overview: string;
  sections: DocSection[]; userJourney: string[]; bestPractices: string[];
}

function parseDoc(content: string): ParsedDoc {
  const lines = content.split('\n');
  let title = '', overview = '';
  const sections: DocSection[] = [], userJourney: string[] = [], bestPractices: string[] = [];
  type Mode = 'none' | 'overview' | 'feature' | 'journey' | 'best';
  let mode: Mode = 'none', cur: DocSection | null = null;
  const flush = () => { if (cur && cur.items.length) { sections.push(cur); cur = null; } };
  const SKIP    = /^(Overview|Homepage Sections?|Sections?|Features?|Summary|Table of Contents|Introduction)/i;
  const JOURNEY = /^#{1,4}\s+(Typical\s+)?User\s+Journey/i;
  const BEST    = /^#{1,4}\s+Best\s+Practices?/i;
  const SUMMARY = /^#{1,4}\s+(Summary|Introduction|Table of Contents)/i;
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('# ') && !title)   { title = line.slice(2).trim(); continue; }
    if (line.match(/^#{1,4}\s+Overview/i)) { flush(); mode = 'overview'; continue; }
    if (line.match(JOURNEY))               { flush(); mode = 'journey';  continue; }
    if (line.match(BEST))                  { flush(); mode = 'best';     continue; }
    if (line.match(SUMMARY))               { flush(); mode = 'none';     continue; }
    const hm = line.match(/^#{2,4}\s+(?:\d+[.)]\s+)?(.+)/);
    if (hm) { const n = hm[1].trim(); if (!n.match(SKIP)) { flush(); cur = { name: n, items: [] }; mode = 'feature'; } continue; }
    const bm = line.match(/^[-*•]\s+(.+)/);
    if (bm) { const v = bm[1].trim(); if (mode === 'feature' && cur) cur.items.push(v); if (mode === 'best') bestPractices.push(v); continue; }
    const nm = line.match(/^\d+[.)]\s+(.+)/);
    if (nm) { const v = nm[1].trim(); if (mode === 'journey') userJourney.push(v); if (mode === 'best') bestPractices.push(v); continue; }
    if (mode === 'overview' && !line.startsWith('#')) overview = overview ? `${overview} ${line}` : line;
  }
  flush();
  return { title, overview, sections, userJourney, bestPractices };
}

// Layout constants (identical to /canvas/[id])
const CW=1100, MIND_CX=550, MIND_CY=320, SEC_R=195, ITEM_R=320, JRN_Y=710, TOTAL_H=840;
const JRN_NODE_W=130, JRN_NODE_H=52, JRN_GAP=50;

interface MNode { id: string; x: number; y: number; label: string; type: 'root'|'section'|'item' }
interface MEdge { id: string; x1: number; y1: number; x2: number; y2: number; type: 'root-sec'|'sec-item' }

function buildLayout(p: ParsedDoc): { nodes: MNode[]; edges: MEdge[] } {
  const nodes: MNode[] = [], edges: MEdge[] = [];
  nodes.push({ id:'root', x:MIND_CX, y:MIND_CY, label:p.title||'Features', type:'root' });
  const N = p.sections.length; if (!N) return { nodes, edges };
  p.sections.forEach((sec,si) => {
    const sA = (2*Math.PI*si/N)-Math.PI/2;
    const sx=MIND_CX+SEC_R*Math.cos(sA), sy=MIND_CY+SEC_R*Math.sin(sA);
    nodes.push({ id:`s${si}`, x:sx, y:sy, label:sec.name, type:'section' });
    edges.push({ id:`e-root-s${si}`, x1:MIND_CX, y1:MIND_CY, x2:sx, y2:sy, type:'root-sec' });
    const M=sec.items.length; if (!M) return;
    const span=(2*Math.PI/N)*0.55;
    sec.items.forEach((item,ii) => {
      const iA = M===1 ? sA : sA+(ii-(M-1)/2)*span/(M-1);
      const ir=ITEM_R+(ii%2===1?18:0);
      const ix=MIND_CX+ir*Math.cos(iA), iy=MIND_CY+ir*Math.sin(iA);
      nodes.push({ id:`s${si}i${ii}`, x:ix, y:iy, label:item, type:'item' });
      edges.push({ id:`e-s${si}-i${ii}`, x1:sx, y1:sy, x2:ix, y2:iy, type:'sec-item' });
    });
  });
  return { nodes, edges };
}

function bezierPath(x1:number,y1:number,x2:number,y2:number,type:MEdge['type']) {
  const mx=(x1+x2)/2, my=(y1+y2)/2;
  const dx=mx-MIND_CX, dy=my-MIND_CY, pull=type==='root-sec'?0.35:0.2;
  return `M ${x1} ${y1} Q ${mx+dx*pull} ${my+dy*pull} ${x2} ${y2}`;
}

function tr(s:string,n:number){ return s.length>n?s.slice(0,n-1)+'…':s; }

function journeyLayout(steps:string[]) {
  const total=steps.length*JRN_NODE_W+(steps.length-1)*JRN_GAP;
  const sx=Math.max((CW-total)/2,30);
  return steps.map((s,i)=>({ x:sx+i*(JRN_NODE_W+JRN_GAP)+JRN_NODE_W/2, y:JRN_Y, label:s }));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CanvasPreviewPage() {
  const router = useRouter();
  const [docContent, setDocContent] = useState<string|null>(null);
  const [docFileName, setDocFileName] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = sessionStorage.getItem('canvasPreviewDoc');
    const name   = sessionStorage.getItem('canvasPreviewFileName') ?? '';
    if (stored) { setDocContent(stored); setDocFileName(name); }
  }, []);

  const parsed = useMemo(() => docContent ? parseDoc(docContent) : null, [docContent]);
  const { nodes, edges } = useMemo(() => parsed ? buildLayout(parsed) : { nodes:[], edges:[] }, [parsed]);
  const jrnNodes = useMemo(() => parsed?.userJourney.length ? journeyLayout(parsed.userJourney) : [], [parsed]);

  if (!mounted) return (
    <div className="flex-1 flex items-center justify-center min-h-screen bg-zinc-950">
      <Loader2 className="h-6 w-6 text-zinc-500 animate-spin" />
    </div>
  );

  if (!docContent || !parsed) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-screen bg-zinc-950 text-center px-4">
      <p className="text-zinc-400 text-sm">No documentation found. Please upload a document first.</p>
      <button onClick={() => router.back()} className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 transition">
        ← Go back
      </button>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-5 py-3 flex items-center gap-4 shrink-0">
        <button onClick={() => router.back()} className="text-zinc-500 hover:text-zinc-200 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">{parsed.title || 'Feature Canvas'}</p>
          {docFileName && <p className="text-xs text-zinc-500 truncate">{docFileName}</p>}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium shrink-0">Preview</span>
      </header>

      {/* Canvas (identical render to /canvas/[id]) */}
      <div className="flex-1 overflow-auto">
        <div className="min-h-full flex items-start justify-center p-6">
          <CanvasBoard parsed={parsed} nodes={nodes} edges={edges} jrnNodes={jrnNodes} />
        </div>
      </div>
    </div>
  );
}

// Extracted so we can share the render logic between [id] and preview pages
function CanvasBoard({
  parsed, nodes, edges, jrnNodes,
}: {
  parsed: ParsedDoc;
  nodes: MNode[];
  edges: MEdge[];
  jrnNodes: { x:number; y:number; label:string }[];
}) {
  return (
    <div
      className="relative rounded-2xl border border-zinc-800 overflow-hidden shrink-0"
      style={{
        width: CW, height: TOTAL_H,
        background: `radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(135deg,#0c0c0e 0%,#0e0e11 100%)`,
        backgroundSize: '24px 24px, 100% 100%',
      }}
    >
      <svg width={CW} height={TOTAL_H} className="absolute inset-0" style={{ pointerEvents:'none' }}>
        <defs>
          <radialGradient id="cg2" cx="50%" cy={`${(MIND_CY/TOTAL_H)*100}%`} r="25%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <ellipse cx={MIND_CX} cy={MIND_CY} rx={260} ry={240} fill="url(#cg2)" />
        {edges.map(e=>(
          <path key={e.id} d={bezierPath(e.x1,e.y1,e.x2,e.y2,e.type)}
            stroke={e.type==='root-sec'?'#52525b':'#3f3f46'}
            strokeWidth={e.type==='root-sec'?1.5:1} fill="none" strokeLinecap="round"/>
        ))}
        {jrnNodes.length > 0 && <>
          <line x1={30} y1={JRN_Y-55} x2={CW-30} y2={JRN_Y-55} stroke="#27272a" strokeWidth="1" strokeDasharray="6 4"/>
          <text x={30} y={JRN_Y-42} fontSize="9" fill="#52525b" fontFamily="monospace" letterSpacing="2">USER FLOW</text>
          {jrnNodes.map((n,i)=>{
            if (i===jrnNodes.length-1) return null;
            const nx=jrnNodes[i+1];
            const x1=n.x+JRN_NODE_W/2, x2=nx.x-JRN_NODE_W/2;
            return <g key={`jc${i}`}>
              <line x1={x1} y1={n.y} x2={x2-6} y2={n.y} stroke="#3f3f46" strokeWidth="1.5"/>
              <polygon points={`${x2-6},${n.y-4} ${x2},${n.y} ${x2-6},${n.y+4}`} fill="#3f3f46"/>
            </g>;
          })}
          <circle cx={jrnNodes[0].x-JRN_NODE_W/2-16} cy={JRN_Y} r={5} fill="#52525b"/>
          <circle cx={jrnNodes[jrnNodes.length-1].x+JRN_NODE_W/2+16} cy={JRN_Y} r={5} fill="none" stroke="#3f3f46" strokeWidth="1.5"/>
        </>}
        {parsed.bestPractices.length > 0 &&
          <text x={30} y={TOTAL_H-52} fontSize="9" fill="#52525b" fontFamily="monospace" letterSpacing="2">BEST PRACTICES</text>
        }
      </svg>

      {/* Mind-map nodes */}
      {nodes.map(n => n.type==='root' ? (
        <div key={n.id} className="absolute flex items-center justify-center select-none"
             style={{left:n.x,top:n.y,transform:'translate(-50%,-50%)'}}>
          <div className="rounded-xl border-2 border-zinc-300 bg-zinc-950 px-4 py-2.5 shadow-[0_0_24px_4px_rgba(255,255,255,0.06)] min-w-[120px] max-w-[200px]">
            <p className="text-sm font-bold text-zinc-100 leading-snug text-center">{tr(n.label,30)}</p>
          </div>
        </div>
      ) : n.type==='section' ? (
        <div key={n.id} className="absolute flex items-center justify-center select-none"
             style={{left:n.x,top:n.y,transform:'translate(-50%,-50%)'}}>
          <div className="rounded-lg border border-zinc-500 bg-zinc-900 px-3 py-1.5 shadow-md min-w-[90px] max-w-[150px]">
            <p className="text-xs font-semibold text-zinc-200 leading-snug text-center">{tr(n.label,22)}</p>
          </div>
        </div>
      ) : (
        <div key={n.id} className="absolute flex items-center justify-center select-none"
             style={{left:n.x,top:n.y,transform:'translate(-50%,-50%)'}}>
          <div className="rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 max-w-[120px]">
            <p className="text-[11px] text-zinc-400 leading-snug text-center">{tr(n.label,20)}</p>
          </div>
        </div>
      ))}

      {/* Journey nodes */}
      {jrnNodes.map((n,i)=>(
        <div key={`jn${i}`} className="absolute select-none"
             style={{left:n.x-JRN_NODE_W/2,top:n.y-JRN_NODE_H/2,width:JRN_NODE_W,height:JRN_NODE_H}}>
          <div className="w-full h-full rounded-lg border border-zinc-600 bg-zinc-900 flex flex-col items-center justify-center gap-0.5 px-2 shadow-md">
            <span className="text-[9px] text-zinc-600 font-mono">step {i+1}</span>
            <span className="text-[11px] text-zinc-300 font-medium text-center leading-tight">{tr(n.label,18)}</span>
          </div>
        </div>
      ))}

      {/* Best practices */}
      {parsed.bestPractices.length > 0 && (
        <div className="absolute flex flex-wrap gap-2" style={{left:30,top:TOTAL_H-42,right:30}}>
          {parsed.bestPractices.map((p,i)=>(
            <span key={i} className="text-[10px] text-zinc-500 border border-zinc-700 rounded-full px-2.5 py-0.5 bg-zinc-900/60">{p}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Export for reuse (canvas/[id] imports this)
export { parseDoc, buildLayout, bezierPath, journeyLayout, CanvasBoard };
export type { MNode, MEdge };
