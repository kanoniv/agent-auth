import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { RotateCw, Move } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, scoreFill, safeGetItem, safeSetItem } from '@/lib/utils';
import type { AgentRecord, Delegation, GraphNode, GraphEdge } from '@/lib/types';

interface TrustGraphProps {
  agents: AgentRecord[];
  delegations: Delegation[];
  selectedId: string | null;
  onSelect: (name: string) => void;
  onDoubleClick?: (name: string) => void;
  fullscreen?: boolean;
}

const NODE_W = 150;
const NODE_H = 64;

function buildGraph(agents: AgentRecord[], delegations: Delegation[]) {
  if (agents.length === 0) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] };

  const cx = 400;
  const cy = 350;
  const spread = Math.max(200, agents.length * 30);

  // Golden angle spiral for initial placement - avoids overlap from the start
  const nodes: GraphNode[] = agents.map((a, i) => ({
    id: a.name,
    name: a.name,
    status: a.status,
    score: a.reputation?.composite_score ?? 50,
    x: cx + Math.cos(i * 2.39996322) * (spread * 0.4 + i * 18),
    y: cy + Math.sin(i * 2.39996322) * (spread * 0.35 + i * 14),
    vx: 0,
    vy: 0,
  }));

  const edges: GraphEdge[] = delegations
    .filter(d => !d.revoked_at)
    .map(d => ({ from: d.grantor_name, to: d.agent_name, scopes: d.scopes }))
    .filter(e => nodes.some(n => n.id === e.from) && nodes.some(n => n.id === e.to));

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Force simulation: 300 iterations with strong repulsion
  for (let iter = 0; iter < 300; iter++) {
    const alpha = 0.4 * Math.pow(1 - iter / 300, 1.5);
    if (alpha < 0.001) break;

    // Repulsion - much stronger, accounts for node dimensions
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Minimum separation = diagonal of node rect
        const minDist = Math.sqrt(NODE_W * NODE_W + NODE_H * NODE_H) + 30;
        // Strong repulsion that flattens out beyond 3x node size
        const strength = dist < minDist
          ? (minDist - dist) * 2.0 * alpha  // hard push when overlapping
          : (15000 / (dist * dist)) * alpha; // coulomb beyond that
        const fx = (dx / dist) * strength;
        const fy = (dy / dist) * strength;
        nodes[i].x -= fx;
        nodes[i].y -= fy;
        nodes[j].x += fx;
        nodes[j].y += fy;
      }
    }

    // Attraction along edges - weaker, longer rest length
    for (const edge of edges) {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const restLength = 220;
      const force = (dist - restLength) * 0.02 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      from.x += fx;
      from.y += fy;
      to.x -= fx;
      to.y -= fy;
    }

    // Gentle center gravity
    const gcx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const gcy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
    for (const node of nodes) {
      node.x += (cx - gcx) * 0.03 * alpha;
      node.y += (cy - gcy) * 0.03 * alpha;
    }
  }

  return { nodes, edges };
}

export const TrustGraph: React.FC<TrustGraphProps> = ({
  agents, delegations, selectedId, onSelect, onDoubleClick, fullscreen,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panDragging, setPanDragging] = useState(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Drag hint - show once, then persist dismissal in localStorage
  const HINT_KEY = 'trust-graph-hint-seen';
  const [showHint, setShowHint] = useState(() => !safeGetItem(HINT_KEY));

  useEffect(() => {
    if (!showHint) return;
    const timer = setTimeout(() => {
      setShowHint(false);
      safeSetItem(HINT_KEY, '1');
    }, 4000);
    return () => clearTimeout(timer);
  }, [showHint]);

  const dismissHint = useCallback(() => {
    if (showHint) {
      setShowHint(false);
      safeSetItem(HINT_KEY, '1');
    }
  }, [showHint]);

  // Node positions as state so dragging is reactive.
  // Only run the simulation once on mount (or when agent list changes structurally).
  // Poll refreshes that return the same agent names do NOT reset positions.
  const initial = useMemo(() => buildGraph(agents, delegations), [agents, delegations]);
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const prevAgentKeysRef = useRef<string>('');

  useEffect(() => {
    // Build a stable key from sorted agent names - only reset layout when agents are added/removed
    const agentKeys = agents.map(a => a.name).sort().join(',');
    if (agentKeys === prevAgentKeysRef.current) return; // same set of agents, keep positions
    prevAgentKeysRef.current = agentKeys;

    const m = new Map<string, { x: number; y: number }>();
    for (const n of initial.nodes) {
      // Preserve existing position if this node was already placed by the user
      const existing = nodePositions.get(n.id);
      m.set(n.id, existing ?? { x: n.x, y: n.y });
    }
    setNodePositions(m);
  }, [initial, agents]);

  const edges = initial.edges;
  const nodes = initial.nodes.map(n => {
    const pos = nodePositions.get(n.id);
    return pos ? { ...n, x: pos.x, y: pos.y } : n;
  });
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Node dragging
  const [dragNode, setDragNode] = useState<string | null>(null);
  const dragNodeStart = useRef({ mx: 0, my: 0, nx: 0, ny: 0 });

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const pos = nodePositions.get(nodeId);
    if (!pos) return;
    setDragNode(nodeId);
    dismissHint();
    const svgPt = svgPoint(e.clientX, e.clientY);
    dragNodeStart.current = { mx: svgPt.x, my: svgPt.y, nx: pos.x, ny: pos.y };
  }, [nodePositions, svgPoint, dismissHint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragNode) {
      const svgPt = svgPoint(e.clientX, e.clientY);
      const dx = svgPt.x - dragNodeStart.current.mx;
      const dy = svgPt.y - dragNodeStart.current.my;
      setNodePositions(prev => {
        const next = new Map(prev);
        next.set(dragNode, {
          x: dragNodeStart.current.nx + dx,
          y: dragNodeStart.current.ny + dy,
        });
        return next;
      });
    } else if (panDragging) {
      setPan({
        x: panStart.current.px + (e.clientX - panStart.current.x) / zoom,
        y: panStart.current.py + (e.clientY - panStart.current.y) / zoom,
      });
    }
  }, [dragNode, panDragging, zoom, svgPoint]);

  const handleMouseUp = useCallback(() => {
    if (dragNode) {
      setDragNode(null);
    }
    setPanDragging(false);
  }, [dragNode]);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || dragNode) return;
    setPanDragging(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }, [pan, dragNode]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(3, Math.max(0.3, z * delta)));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // Reset node positions to simulation output
    const m = new Map<string, { x: number; y: number }>();
    for (const n of initial.nodes) m.set(n.id, { x: n.x, y: n.y });
    setNodePositions(m);
  }, [initial]);

  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-600 text-xs">
        No agents registered yet
      </div>
    );
  }

  return (
    <div className={cn('relative', fullscreen ? 'w-full h-full' : 'w-full')}>
      {/* Controls */}
      <div className="absolute top-3 right-3 z-10 flex gap-1">
        <button onClick={resetView}
          className="p-1.5 rounded-lg bg-[#12121a] border border-white/[.07] text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Reset layout">
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <svg
        ref={svgRef}
        role="img"
        aria-label="Trust relationship graph"
        className={cn(
          'w-full',
          fullscreen ? 'h-full' : 'h-[400px]',
          dragNode ? 'cursor-grabbing' : panDragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        viewBox={`${-pan.x} ${-pan.y} ${800 / zoom} ${700 / zoom}`}
        onWheel={handleWheel}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#C5A572" fillOpacity={0.5} />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((e, i) => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          // Use cubic bezier that works for any direction
          const cpOffset = Math.min(80, Math.abs(y2 - y1) * 0.4 + 30);
          return (
            <g key={`edge-${i}`}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${y1 + cpOffset}, ${x2} ${y2 - cpOffset}, ${x2} ${y2}`}
                fill="none" stroke="#C5A572" strokeWidth={1.5} strokeOpacity={0.35}
                markerEnd="url(#arrow)"
              />
              {e.scopes.length > 0 && (
                <text x={midX} y={midY - 6} textAnchor="middle"
                  className="fill-zinc-600 text-[8px]" pointerEvents="none">
                  {e.scopes.slice(0, 3).join(', ')}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const isSelected = selectedId === node.id;
          const isDragging = dragNode === node.id;
          const agent = agents.find(a => a.name === node.id);
          const caps = agent?.capabilities ?? [];
          return (
            <g
              key={node.id}
              role="button"
              aria-label={`Agent node: ${node.name}, score ${Math.round(node.score)}`}
              className={isDragging ? 'cursor-grabbing' : 'cursor-grab'}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={(e) => { e.stopPropagation(); if (!isDragging) onSelect(node.id); }}
              onDoubleClick={() => onDoubleClick?.(node.id)}
            >
              <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={8}
                fill={isSelected ? '#1a1a2e' : '#111118'}
                stroke={isSelected ? '#C5A572' : isDragging ? '#C5A572' : '#27272a'}
                strokeWidth={isSelected || isDragging ? 1.5 : 1}
              />
              <circle cx={node.x + 14} cy={node.y + 18} r={3.5}
                fill={node.status === 'online' ? '#34d399' : node.status === 'idle' ? '#fbbf24' : '#52525b'}
              />
              <text x={node.x + 26} y={node.y + 22} className="fill-zinc-200 text-[12px] font-medium"
                pointerEvents="none">
                {node.name.length > 14 ? node.name.slice(0, 14) + '..' : node.name}
              </text>
              <rect x={node.x + 12} y={node.y + 36} width={NODE_W - 55} height={5} rx={2.5} fill="#27272a" />
              <rect x={node.x + 12} y={node.y + 36}
                width={Math.max(0, (NODE_W - 55) * (node.score / 100))} height={5} rx={2.5}
                fill={scoreFill(node.score)}
              />
              <text x={node.x + NODE_W - 32} y={node.y + 42}
                className={cn('text-[11px] font-bold',
                  node.score >= 80 ? 'fill-emerald-400' : node.score >= 60 ? 'fill-amber-400' : 'fill-orange-400'
                )} pointerEvents="none">
                {Math.round(node.score)}
              </text>
              <text x={node.x + 12} y={node.y + 56} className="fill-zinc-600 text-[9px]"
                pointerEvents="none">
                {caps.length > 0 ? caps.slice(0, 3).join(', ') : 'no capabilities'}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Drag hint - shown once, dismissed after 4s or on first drag */}
      <AnimatePresence>
        {showHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-white/[.06] backdrop-blur-sm text-zinc-400 text-[10px] rounded-full px-3 py-1.5 pointer-events-none"
          >
            <Move className="w-3 h-3" />
            Drag nodes to rearrange
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
