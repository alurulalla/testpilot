'use client';

/**
 * FeatureCanvas — embeddable ReactFlow canvas
 *
 * Renders feature groups from product documentation as a pannable board.
 * Each group shows:
 *   • Bullet-point use cases extracted from the doc  (blue BookOpen cards, read-only)
 *   • User / AI-added flows matched to the feature   (violet User cards, deletable)
 *   • An "+ Add use case" dashed button at the end
 *
 * IMPORTANT: all interactive elements inside ReactFlow nodes carry the
 * `nopan nodrag` CSS classes so ReactFlow doesn't swallow their clicks.
 *
 * Refresh pattern: node components call the API directly then fire a
 * custom DOM event (`testpilot:canvas-refresh`). The parent listens and
 * re-fetches flows — avoids stale-closure issues with callbacks in data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  BookOpen,
  Loader2,
  Plus,
  Settings2,
  User,
  Wand2,
  X,
} from 'lucide-react';
import type { UserFlow } from '@/types/session';

// ── Refresh bus ───────────────────────────────────────────────────────────────
const REFRESH_EVT = 'testpilot:canvas-refresh';
export function triggerCanvasRefresh() {
  if (typeof document !== 'undefined')
    document.dispatchEvent(new CustomEvent(REFRESH_EVT));
}

// ── Palette ───────────────────────────────────────────────────────────────────
const PALETTE = [
  { border: '#c4b5fd', bg: '#f5f3ff', text: '#7c3aed' },
  { border: '#93c5fd', bg: '#eff6ff', text: '#2563eb' },
  { border: '#6ee7b7', bg: '#ecfdf5', text: '#059669' },
  { border: '#fcd34d', bg: '#fffbeb', text: '#b45309' },
  { border: '#f9a8d4', bg: '#fdf2f8', text: '#be185d' },
  { border: '#67e8f9', bg: '#ecfeff', text: '#0e7490' },
  { border: '#fdba74', bg: '#fff7ed', text: '#c2410c' },
  { border: '#fca5a5', bg: '#fff1f2', text: '#be123c' },
];

// ── Layout constants ──────────────────────────────────────────────────────────
const APP_W       = 152;
const APP_H       = 96;
const CARD_W      = 178;
const CARD_H      = 72;
const ADD_W       = 116;
const H_GAP       = 20;
const V_GAP       = 52;
const GRP_PAD_X   = 26;
const GRP_PAD_TOP = 50;
const GRP_PAD_BOT = 22;
const GRP_X       = 248;

// ── Doc parser ────────────────────────────────────────────────────────────────
interface Feature { name: string; items: string[] }

function parseFeaturesFromDoc(content: string): Feature[] {
  const sections: Feature[] = [];
  let cur: Feature | null = null;
  const SKIP = /^(Overview|Homepage Sections?|Sections?|Features?|Summary|Table of Contents|Introduction)/i;
  const STOP = /^#{1,4}\s+(Typical\s+User\s+Journey|Best Practices?|Summary|User Flows? to Test)/i;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.match(STOP))  { if (cur) sections.push(cur); cur = null; continue; }
    const hm = line.match(/^#{2,4}\s+(?:\d+[.)]\s+)?(.+)/);
    if (hm) {
      const name = hm[1].trim();
      if (!name.match(SKIP)) { if (cur) sections.push(cur); cur = { name, items: [] }; }
      continue;
    }
    const bm = line.match(/^[-*•]\s+(.+)/);
    if (bm && cur) cur.items.push(bm[1].trim());
  }
  if (cur) sections.push(cur);
  return sections;
}

function matchFlowToFeature(flow: UserFlow, features: Feature[]): string | null {
  const hay = `${flow.title} ${flow.description}`.toLowerCase();
  for (const f of features) {
    const words = f.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => hay.includes(w))) return f.name;
    if (f.items.some(it => hay.includes(it.toLowerCase().slice(0, 18)))) return f.name;
  }
  return null;
}

// ── Node: Application ─────────────────────────────────────────────────────────
function AppNode({ data }: NodeProps) {
  const { featureCount } = data as { featureCount: number };
  return (
    <div style={{ width: APP_W, borderColor: '#4ade80' }}
      className="rounded-2xl border-2 bg-white shadow-md px-4 py-4 flex flex-col items-center gap-2.5 select-none">
      <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
        <Settings2 className="h-5 w-5 text-emerald-500" />
      </div>
      <div className="text-center">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Application</p>
        <p className="text-xs font-semibold text-gray-700 mt-0.5">
          {featureCount} feature{featureCount !== 1 ? 's' : ''}
        </p>
      </div>
      <Handle type="source" position={Position.Right}
        style={{ background: '#9ca3af', width: 8, height: 8, border: '2px solid #fff' }} />
    </div>
  );
}

// ── Node: Feature group background ────────────────────────────────────────────
function GroupNode({ data }: NodeProps) {
  const { label, colorIdx, w, h } = data as { label: string; colorIdx: number; w: number; h: number };
  const c = PALETTE[colorIdx % PALETTE.length];
  return (
    <div style={{
      width: w, height: h,
      border: `1.5px dashed ${c.border}`,
      backgroundColor: c.bg,
      borderRadius: 14,
      position: 'relative',
      pointerEvents: 'none',
    }}>
      <span style={{ color: c.text, background: c.bg }}
        className="absolute -top-[12px] left-4 text-[11px] font-bold px-2 py-px rounded-sm select-none">
        {label}
      </span>
    </div>
  );
}

// ── Node: Use-case card ───────────────────────────────────────────────────────
// source='doc'  → blue BookOpen, read-only
// source='user' → violet User, has delete button
function UseCaseNode({ data }: NodeProps) {
  const { title, featureName, source, flowId, sessionId } = data as {
    title: string; featureName: string;
    source: 'doc' | 'user'; flowId?: string; sessionId: string;
  };

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!flowId) return;
    await fetch(`/api/sessions/${sessionId}/flows/${flowId}`, { method: 'DELETE' }).catch(() => null);
    triggerCanvasRefresh();
  }

  return (
    <div style={{ width: CARD_W }}
      className="group relative bg-white rounded-xl border border-gray-200 shadow-sm p-3 hover:shadow-md transition-shadow select-none">
      <Handle type="target" position={Position.Left}
        style={{ background: '#d1d5db', width: 8, height: 8, border: '2px solid #fff' }} />

      <div className="flex items-start gap-2.5">
        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          source === 'doc' ? 'bg-blue-50' : 'bg-violet-100'}`}>
          {source === 'doc'
            ? <BookOpen className="h-3.5 w-3.5 text-blue-400" />
            : <User     className="h-3.5 w-3.5 text-violet-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-gray-800 leading-snug line-clamp-2">{title}</p>
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">{featureName}</p>
        </div>
      </div>

      {source === 'user' && flowId && (
        /* nopan nodrag: prevent ReactFlow from stealing the click */
        <button onMouseDown={handleDelete}
          className="nopan nodrag absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-gray-100 border border-gray-200 items-center justify-center hidden group-hover:flex hover:bg-red-400 hover:border-red-300 transition-colors z-50"
          title="Remove use case">
          <X className="h-2.5 w-2.5 text-gray-500" />
        </button>
      )}

      <Handle type="source" position={Position.Right}
        style={{ background: '#d1d5db', width: 8, height: 8, border: '2px solid #fff' }} />
    </div>
  );
}

// ── Node: Add-use-case button ─────────────────────────────────────────────────
function AddUseCaseNode({ data }: NodeProps) {
  const { featureName, sessionId } = data as { featureName: string; sessionId: string };
  const [showForm, setShowForm] = useState(false);
  const [title,    setTitle]    = useState('');
  const [saving,   setSaving]   = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/sessions/${sessionId}/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:       title.trim(),
        description: `Use case for ${featureName}`,
        steps:       [],
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setTitle('');
      setShowForm(false);
      triggerCanvasRefresh();
    }
  }

  if (showForm) {
    return (
      /* nopan nodrag on the wrapper so ReactFlow ignores all events here */
      <div style={{ width: 210 }}
        className="nopan nodrag bg-white border-2 border-violet-300 rounded-xl shadow-lg p-3 space-y-2">
        <Handle type="target" position={Position.Left}
          style={{ background: '#c4b5fd', width: 8, height: 8, border: '2px solid #fff' }} />
        <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide truncate">
          Add · {featureName}
        </p>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.stopPropagation(); void save(); }
            if (e.key === 'Escape') { e.stopPropagation(); setShowForm(false); setTitle(''); }
          }}
          placeholder="Describe the use case…"
          className="nopan nodrag w-full text-[11px] border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-violet-400 bg-gray-50"
        />
        <div className="flex gap-1.5">
          <button
            className="nopan nodrag text-[10px] text-gray-400 hover:text-gray-600 transition px-2 py-1"
            onMouseDown={() => { setShowForm(false); setTitle(''); }}>
            Cancel
          </button>
          <button
            disabled={saving || !title.trim()}
            className="nopan nodrag flex-1 text-[10px] font-semibold bg-violet-600 text-white rounded-lg py-1.5 hover:bg-violet-500 disabled:opacity-40 transition"
            onMouseDown={() => void save()}>
            {saving ? 'Saving…' : 'Add Use Case'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: ADD_W }} className="nopan nodrag">
      <Handle type="target" position={Position.Left}
        style={{ background: '#e5e7eb', width: 8, height: 8, border: '2px solid #fff' }} />
      <button
        style={{ width: ADD_W, height: CARD_H }}
        className="nopan nodrag flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-300 bg-white hover:border-violet-400 hover:bg-violet-50 transition-colors w-full cursor-pointer"
        onMouseDown={e => { e.stopPropagation(); setShowForm(true); }}>
        <Plus className="h-4 w-4 text-gray-400" />
        <span className="text-[10px] text-gray-400 font-medium">Add use case</span>
      </button>
    </div>
  );
}

// ── Node type registry ────────────────────────────────────────────────────────
const nodeTypes: NodeTypes = {
  appNode:        AppNode,
  groupNode:      GroupNode,
  useCaseNode:    UseCaseNode,
  addUseCaseNode: AddUseCaseNode,
};

// ── Edge styles ───────────────────────────────────────────────────────────────
const EDGE_STY = { stroke: '#d1d5db', strokeWidth: 1.5 };
const EDGE_MKR = { type: MarkerType.ArrowClosed, color: '#d1d5db', width: 14, height: 14 };
const DASH_STY = { stroke: '#e2e8f0', strokeWidth: 1.5, strokeDasharray: '6 4' };
const DASH_MKR = { type: MarkerType.ArrowClosed, color: '#e2e8f0', width: 12, height: 12 };

// ── Layout builder ────────────────────────────────────────────────────────────
interface GroupDef { feature: Feature; colorIdx: number; flows: UserFlow[] }

function buildLayout(groups: GroupDef[], sessionId: string): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  if (groups.length === 0) return { nodes, edges };

  const dims = groups.map(({ feature, flows }) => {
    const total = feature.items.length + flows.length;
    const w = GRP_PAD_X + total * (CARD_W + H_GAP) + ADD_W + GRP_PAD_X;
    return { w: Math.max(w, GRP_PAD_X * 2 + ADD_W + 40), h: GRP_PAD_TOP + CARD_H + GRP_PAD_BOT };
  });

  const totalH = dims.reduce((s, d) => s + d.h, 0) + (groups.length - 1) * V_GAP;

  // Application node
  nodes.push({
    id: 'app', type: 'appNode',
    position: { x: 0, y: Math.max(0, totalH / 2 - APP_H / 2) },
    data: { featureCount: groups.length },
    draggable: false, selectable: false, deletable: false,
  });

  let y = 0;
  groups.forEach(({ feature, colorIdx, flows }, gi) => {
    const { w: gw, h: gh } = dims[gi];
    const gid = `grp-${gi}`;

    // Group background
    nodes.push({
      id: gid, type: 'groupNode',
      position: { x: GRP_X, y },
      data: { label: feature.name, colorIdx, w: gw, h: gh },
      style: { width: gw, height: gh, zIndex: -20 },
      draggable: false, selectable: false, deletable: false,
    });

    const docCount = feature.items.length;

    // Doc use-case cards
    feature.items.forEach((item, ki) => {
      const nid = `doc-${gi}-${ki}`;
      nodes.push({
        id: nid, type: 'useCaseNode',
        position: { x: GRP_X + GRP_PAD_X + ki * (CARD_W + H_GAP), y: y + GRP_PAD_TOP },
        data: { title: item, featureName: feature.name, source: 'doc', sessionId },
        draggable: false, selectable: false, deletable: false,
      });
      if (ki > 0)
        edges.push({ id: `e-doc-${gi}-${ki}`, source: `doc-${gi}-${ki - 1}`, target: nid,
          type: 'smoothstep', style: EDGE_STY, markerEnd: EDGE_MKR });
    });

    // User/AI flow cards
    flows.forEach((flow, fi) => {
      const nid  = `flow-${flow.id}`;
      const slot = docCount + fi;
      nodes.push({
        id: nid, type: 'useCaseNode',
        position: { x: GRP_X + GRP_PAD_X + slot * (CARD_W + H_GAP), y: y + GRP_PAD_TOP },
        data: { title: flow.title, featureName: feature.name, source: 'user', flowId: flow.id, sessionId },
        draggable: false, selectable: false, deletable: false,
      });
      const prevId = fi === 0
        ? (docCount > 0 ? `doc-${gi}-${docCount - 1}` : null)
        : `flow-${flows[fi - 1].id}`;
      if (prevId)
        edges.push({ id: `e-flow-${flow.id}`, source: prevId, target: nid,
          type: 'smoothstep', style: EDGE_STY, markerEnd: EDGE_MKR });
    });

    // Add-use-case button
    const totalCards = docCount + flows.length;
    const addId = `add-${gi}`;
    nodes.push({
      id: addId, type: 'addUseCaseNode',
      position: { x: GRP_X + GRP_PAD_X + totalCards * (CARD_W + H_GAP), y: y + GRP_PAD_TOP },
      data: { featureName: feature.name, sessionId },
      draggable: false, selectable: false, deletable: false,
    });

    const lastCardId = totalCards > 0
      ? (flows.length > 0 ? `flow-${flows[flows.length - 1].id}` : `doc-${gi}-${docCount - 1}`)
      : null;
    if (lastCardId)
      edges.push({ id: `e-add-${gi}`, source: lastCardId, target: addId,
        type: 'smoothstep', style: DASH_STY, markerEnd: DASH_MKR });

    // App → first card
    const firstId = docCount > 0 ? `doc-${gi}-0`
      : flows.length > 0 ? `flow-${flows[0].id}` : addId;
    edges.push({ id: `e-app-${gi}`, source: 'app', target: firstId,
      type: 'smoothstep', style: EDGE_STY, markerEnd: EDGE_MKR });

    y += gh + V_GAP;
  });

  return { nodes, edges };
}

// ── Public component ──────────────────────────────────────────────────────────

export interface FeatureCanvasProps {
  sessionId: string;
  /** Optionally show the "Extract Flows from Doc" button in a toolbar */
  showToolbar?: boolean;
}

export function FeatureCanvas({ sessionId, showToolbar = false }: FeatureCanvasProps) {
  const [docContent,  setDocContent]  = useState<string | null>(null);
  const [docLoaded,   setDocLoaded]   = useState(false);   // true once initial fetch complete
  const [userFlows,   setUserFlows]   = useState<UserFlow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [pageError,   setPageError]   = useState('');
  const [extracting,  setExtracting]  = useState(false);
  const [extractMsg,  setExtractMsg]  = useState('');

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const fetchFlows = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/flows`).catch(() => null);
    if (res?.ok) {
      const d = await res.json() as { flows?: UserFlow[] };
      setUserFlows(d.flows ?? []);
    }
  }, [sessionId]);

  // Initial load
  useEffect(() => {
    Promise.all([
      fetch(`/api/sessions/${sessionId}/context`).then(r => r.json()) as Promise<{ content?: string }>,
      fetch(`/api/sessions/${sessionId}/flows`).then(r => r.json())    as Promise<{ flows?: UserFlow[] }>,
    ])
      .then(([ctx, fl]) => {
        if (ctx.content) setDocContent(ctx.content);
        setDocLoaded(true);
        setUserFlows(fl.flows ?? []);
      })
      .catch(() => setPageError('Failed to load canvas data.'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // DOM event → re-fetch flows
  useEffect(() => {
    const handler = () => { void fetchFlows(); };
    document.addEventListener(REFRESH_EVT, handler);
    return () => document.removeEventListener(REFRESH_EVT, handler);
  }, [fetchFlows]);

  // Derived
  const features = useMemo(() => docContent ? parseFeaturesFromDoc(docContent) : [], [docContent]);

  const flowsByFeature = useMemo(() => {
    const map: Record<string, UserFlow[]> = {};
    for (const flow of userFlows) {
      const key = matchFlowToFeature(flow, features) ?? '__other';
      (map[key] ??= []).push(flow);
    }
    return map;
  }, [userFlows, features]);

  const groups: GroupDef[] = useMemo(() => {
    const list = features.map((f, i) => ({ feature: f, colorIdx: i, flows: flowsByFeature[f.name] ?? [] }));
    const other = flowsByFeature['__other'] ?? [];
    if (other.length > 0)
      list.push({ feature: { name: 'Other Flows', items: [] }, colorIdx: 7, flows: other });
    return list;
  }, [features, flowsByFeature]);

  // Rebuild graph
  useEffect(() => {
    if (loading) return;
    const { nodes: n, edges: e } = buildLayout(groups, sessionId);
    setNodes(n);
    setEdges(e);
  }, [loading, groups, sessionId, setNodes, setEdges]);

  async function handleExtract() {
    setExtracting(true); setExtractMsg('');
    const res = await fetch(`/api/sessions/${sessionId}/flows/extract`, { method: 'POST' }).catch(() => null);
    if (!res?.ok) {
      const e = await res?.json().catch(() => ({})) as { error?: string };
      setExtractMsg(e.error ?? 'Extraction failed');
    } else {
      await fetchFlows();
    }
    setExtracting(false);
  }

  if (loading) return (
    <div className="flex items-center justify-center bg-white"
         style={{ flex: '1 1 0', minHeight: 0 }}>
      <Loader2 className="h-6 w-6 text-gray-300 animate-spin" />
    </div>
  );

  if (pageError) return (
    <div className="flex flex-col items-center justify-center gap-3 bg-white text-center px-4"
         style={{ flex: '1 1 0', minHeight: 0 }}>
      <AlertCircle className="h-7 w-7 text-gray-300" />
      <p className="text-gray-500 text-sm">{pageError}</p>
    </div>
  );

  if (groups.length === 0) {
    const hasDoc = docLoaded && docContent != null;
    return (
      <div className="flex flex-col items-center justify-center gap-4 bg-white text-center px-6"
           style={{ flex: '1 1 0', minHeight: 0 }}>
        <div className="h-14 w-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center">
          <Settings2 className="h-7 w-7 text-gray-300" />
        </div>
        <div>
          {hasDoc ? (
            <>
              <p className="text-sm font-semibold text-gray-600 mb-1">No feature groups found</p>
              <p className="text-xs text-gray-400 max-w-xs">
                The canvas uses <code className="bg-gray-100 px-1 rounded">##</code> and{' '}
                <code className="bg-gray-100 px-1 rounded">###</code> headings in your documentation
                as feature groups. Make sure your doc has those headings.
              </p>
              {showToolbar && (
                <p className="text-xs text-violet-500 mt-2">
                  You can also click <strong>Extract Flows from Doc</strong> above to pull flows automatically.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-600 mb-1">No documentation loaded</p>
              <p className="text-xs text-gray-400 max-w-xs">
                Upload a product documentation file (.md or .txt) in the session panel, then re-open this canvas.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      {/* Optional toolbar */}
      {showToolbar && (
        <div className="shrink-0 border-b border-gray-100 px-4 py-2 flex items-center gap-3 bg-white">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-gray-400 flex-1">
            <span className="flex items-center gap-1">
              <span className="h-3.5 w-3.5 rounded-full bg-blue-50 border border-blue-200 inline-flex items-center justify-center">
                <BookOpen className="h-2 w-2 text-blue-400" />
              </span>
              From docs
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3.5 w-3.5 rounded-full bg-violet-100 border border-violet-200 inline-flex items-center justify-center">
                <User className="h-2 w-2 text-violet-400" />
              </span>
              User-added
            </span>
          </div>
          {extractMsg && <p className="text-[11px] text-red-500">{extractMsg}</p>}
          <button
            type="button" disabled={extracting} onClick={() => void handleExtract()}
            className="flex items-center gap-1.5 text-xs text-violet-600 border border-violet-200 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-1.5 transition disabled:opacity-40 shrink-0">
            <Wand2 className="h-3.5 w-3.5" />
            {extracting ? 'Extracting…' : 'Extract Flows from Doc'}
          </button>
        </div>
      )}

      {/* Canvas — flex-1 min-h-0 gives ReactFlow a resolved pixel height */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView fitViewOptions={{ padding: 0.1, maxZoom: 1.1 }}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
          /* onNodeClick must be present (even no-op) — ReactFlow sets pointer-events:none
             on node wrappers when isSelectable && isDraggable && onClick are all falsy,
             which would swallow clicks on buttons inside nodes. */
          onNodeClick={() => {}}
          panOnScroll panOnDrag
          zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#e2e8f0" />
          <Controls showInteractive={false}
            className="!shadow-none !border !border-gray-200 !rounded-xl overflow-hidden" />
        </ReactFlow>
      </div>
    </div>
  );
}
