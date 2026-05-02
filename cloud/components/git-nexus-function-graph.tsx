"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface KGNode {
  id: string;
  label: string;
  file?: string;
  type?: "service" | "controller" | "route" | "component" | "agent" | "util" | "default";
  connections?: string[];
}

export interface KGEdge {
  source: string;
  target: string;
}

interface KGProps {
  nodes?: KGNode[];
  edges?: KGEdge[];
  title?: string;
}

// No demo data; use backend-provided nodes and edges

// ── Color palette per type ─────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  service:    "#00d4ff",
  controller: "#ff6b35",
  route:      "#a855f7",
  component:  "#22c55e",
  agent:      "#f59e0b",
  util:       "#ec4899",
  default:    "#94a3b8",
};

// ── Math helpers ───────────────────────────────────────────────────────────────
const GLOBE_RADIUS = 280;

function fibonacciSphere(count: number) {
  const pts: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }
  return pts;
}

function rotatePoint(
  x: number, y: number, z: number,
  rx: number, ry: number
): [number, number, number] {
  // Rotate around Y axis
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  // Rotate around X axis
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y2 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  return [x1, y2, z2];
}

function project(
  x: number, y: number, z: number,
  cx: number, cy: number, scale: number
): { sx: number; sy: number; depth: number } {
  const fov = 900;
  const depth = fov / (fov + z);
  return { sx: cx + x * depth * scale, sy: cy + y * depth * scale, depth };
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function KnowledgeGraph3D({
  nodes = [],
  edges = [],
  title = "Function Graph",
}: KGProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    rotX: 0.3,
    rotY: 0,
    autoRotate: true,
    dragging: false,
    lastX: 0,
    lastY: 0,
    zoom: 1,
    hovered: null as string | null,
    selected: null as string | null,
    positions: [] as [number, number, number][],
    animFrame: 0,
  });
  const drawRef = useRef<() => void>(() => {});
  const [selected, setSelected] = useState<KGNode | null>(null);
  const [hovered, setHovered]   = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [nodeCount] = useState(nodes.length);

  // Build positions once
  useEffect(() => {
    stateRef.current.positions = fibonacciSphere(nodes.length).map(
      ([x, y, z]) => [x * GLOBE_RADIUS, y * GLOBE_RADIUS, z * GLOBE_RADIUS]
    );
  }, [nodes.length]);

  // ── Draw loop ──────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;

    ctx.clearRect(0, 0, W, H);

    // background
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
    bg.addColorStop(0, "#0d1117");
    bg.addColorStop(1, "#020408");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // subtle grid dots
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let gx = 0; gx < W; gx += 40)
      for (let gy = 0; gy < H; gy += 40) {
        ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
      }

    if (nodes.length === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "14px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("No nodes to display", cx, cy);
      return;
    }

    const { rotX, rotY, zoom: z } = s;

    // Project all nodes
    const projected = nodes.map((node, i) => {
      const [px, py, pz] = s.positions[i] || [0, 0, 0];
      const [rx, ry, rz] = rotatePoint(px, py, pz, rotX, rotY);
      const { sx, sy, depth } = project(rx, ry, rz, cx, cy, z);
      return { node, sx, sy, depth, rz };
    });

    // Sort back-to-front
    projected.sort((a, b) => a.rz - b.rz);

    // Build lookup for projected positions
    const posMap: Record<string, { sx: number; sy: number; depth: number }> = {};
    projected.forEach(p => { posMap[p.node.id] = { sx: p.sx, sy: p.sy, depth: p.depth }; });

    // Draw edges
    const drawnEdges = new Set<string>();
    edges.forEach(edge => {
      const key = [edge.source, edge.target].sort().join("|");
      if (drawnEdges.has(key)) return;
      drawnEdges.add(key);
      const a = posMap[edge.source], b = posMap[edge.target];
      if (!a || !b) return;
      const isHighlighted =
        s.selected === edge.source || s.selected === edge.target ||
        s.hovered  === edge.source || s.hovered  === edge.target;
      const avgDepth = (a.depth + b.depth) / 2;
      const alpha = isHighlighted ? 0.7 : avgDepth * 0.25;
      const srcNode = nodes.find(n => n.id === edge.source);
      const color = TYPE_COLORS[srcNode?.type || "default"];
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.strokeStyle = isHighlighted
        ? `rgba(255,255,255,${alpha})`
        : `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
      ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
      ctx.stroke();
    });

    // Draw nodes
    projected.forEach(({ node, sx, sy, depth }) => {
      const color = TYPE_COLORS[node.type || "default"];
      const isHov = s.hovered === node.id;
      const isSel = s.selected === node.id;
      const r = (isSel ? 9 : isHov ? 7 : 5) * depth * z;

      // Glow
      if (isHov || isSel) {
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
        glow.addColorStop(0, `${color}66`);
        glow.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(sx, sy, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(sx - r * 0.3, sy - r * 0.3, 0, sx, sy, r);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.3, color);
      grad.addColorStop(1, `${color}44`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = isHov || isSel ? "#ffffff" : `${color}88`;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.stroke();

      // Label
      if (depth > 0.85 || isHov || isSel) {
        const fontSize = Math.max(9, Math.min(13, 11 * depth * z));
        ctx.font = `${isSel ? 600 : 400} ${fontSize}px 'JetBrains Mono', 'Fira Code', monospace`;
        ctx.textAlign = "center";
        const labelAlpha = isHov || isSel ? 1 : Math.min(1, (depth - 0.85) * 6);
        ctx.fillStyle = `rgba(255,255,255,${labelAlpha})`;
        ctx.fillText(node.label, sx, sy - r - 4);
        if (isHov || isSel) {
          ctx.font = `10px 'JetBrains Mono', monospace`;
          ctx.fillStyle = "rgba(150,220,255,0.8)";
          const file = node.file || "";
          const short = file.length > 40 ? "…" + file.slice(-40) : file;
          ctx.fillText(short, sx, sy + r + 14);
        }
      }
    });

    // Globe wireframe (subtle)
    ctx.save();
    ctx.globalAlpha = 0.06;
    for (let lat = -75; lat <= 75; lat += 30) {
      const ry = Math.cos((lat * Math.PI) / 180) * GLOBE_RADIUS * z;
      const rz = Math.sin((lat * Math.PI) / 180) * GLOBE_RADIUS * z;
      ctx.beginPath();
      for (let lon = 0; lon <= 360; lon += 3) {
        const angle = (lon * Math.PI) / 180;
        const [rx2, ry2, rz2] = rotatePoint(
          Math.cos(angle) * ry, rz, Math.sin(angle) * ry, rotX, rotY
        );
        const { sx: wx, sy: wy } = project(rx2, ry2, rz2, cx, cy, 1);
        if (lon === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.strokeStyle = "#4488ff";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    ctx.restore();

    if (s.autoRotate && !s.dragging) {
      s.rotY += 0.003;
    }
  }, [nodes, edges]);

  // Update the draw ref whenever the draw function changes
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // Animation loop that schedules frames recursively
  useEffect(() => {
    const s = stateRef.current;
    const animate = () => {
      drawRef.current();
      s.animFrame = requestAnimationFrame(animate);
    };
    s.animFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(s.animFrame);
  }, []);

  // ── Resize ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ── Mouse events ───────────────────────────────────────────────────────────
  const getHovered = useCallback((mx: number, my: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    let closest: string | null = null, minDist = 20;
    nodes.forEach((node, i) => {
      const [px, py, pz] = s.positions[i] || [0, 0, 0];
      const [rx, ry, rz] = rotatePoint(px, py, pz, s.rotX, s.rotY);
      const { sx, sy } = project(rx, ry, rz, cx, cy, s.zoom);
      const dist = Math.hypot(mx - sx, my - sy);
      if (dist < minDist) { minDist = dist; closest = node.id; }
    });
    return closest;
  }, [nodes]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const s = stateRef.current;
    if (s.dragging) {
      s.rotY += (mx - s.lastX) * 0.005;
      s.rotX += (my - s.lastY) * 0.005;
      s.lastX = mx; s.lastY = my;
    } else {
      const h = getHovered(mx, my);
      s.hovered = h;
      setHovered(h);
      canvas.style.cursor = h ? "pointer" : "grab";
    }
  }, [getHovered]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    s.dragging = true;
    s.autoRotate = false;
    setAutoRotate(false);
    s.lastX = e.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0);
    s.lastY = e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0);
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    s.dragging = false;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    // Click detection (minimal drag)
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const dx = mx - s.lastX, dy = my - s.lastY;
    if (Math.hypot(dx, dy) < 5) {
      const h = getHovered(mx, my);
      if (h) {
        s.selected = s.selected === h ? null : h;
        setSelected(s.selected ? nodes.find(n => n.id === s.selected) || null : null);
      }
    }
  }, [getHovered, nodes]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const s = stateRef.current;
    s.zoom = Math.max(0.4, Math.min(3, s.zoom - e.deltaY * 0.001));
    setZoom(s.zoom);
  }, []);

  // Touch support
  const lastTouchRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const s = stateRef.current;
      s.dragging = true; s.autoRotate = false; setAutoRotate(false);
      s.lastX = e.touches[0].clientX; s.lastY = e.touches[0].clientY;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0 };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchRef.current = { x: 0, y: 0, dist: Math.hypot(dx, dy) };
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const s = stateRef.current;
    if (e.touches.length === 1 && s.dragging && lastTouchRef.current) {
      const dx = e.touches[0].clientX - s.lastX;
      const dy = e.touches[0].clientY - s.lastY;
      s.rotY += dx * 0.005; s.rotX += dy * 0.005;
      s.lastX = e.touches[0].clientX; s.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2 && lastTouchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      s.zoom = Math.max(0.4, Math.min(3, s.zoom * (dist / lastTouchRef.current.dist)));
      lastTouchRef.current.dist = dist;
      setZoom(s.zoom);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    stateRef.current.dragging = false;
    lastTouchRef.current = null;
  }, []);

  const toggleAutoRotate = () => {
    stateRef.current.autoRotate = !autoRotate;
    setAutoRotate(!autoRotate);
  };

  const resetView = () => {
    const s = stateRef.current;
    s.rotX = 0.3; s.rotY = 0; s.zoom = 1; s.selected = null;
    setZoom(1); setSelected(null);
  };

  const zoomIn  = () => { const s = stateRef.current; s.zoom = Math.min(3, s.zoom + 0.15); setZoom(s.zoom); };
  const zoomOut = () => { const s = stateRef.current; s.zoom = Math.max(0.4, s.zoom - 0.15); setZoom(s.zoom); };

  const typeCounts = nodes.reduce((acc, n) => {
    const t = n.type || "default";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "#020408",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        padding: "16px 24px",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.9), transparent)",
        zIndex: 10, display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ color: "#00d4ff", fontSize: 11, letterSpacing: 4, textTransform: "uppercase", marginBottom: 2 }}>
            AI Reference
          </div>
          <div style={{ color: "#ffffff", fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>
            {title}
          </div>
          <div style={{ color: "#64748b", fontSize: 10, marginTop: 2 }}>
            {nodeCount} nodes · {edges.length} edges · drag to rotate · scroll to zoom
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={zoomOut}   style={btnStyle}>−</button>
          <div style={{ color: "#94a3b8", fontSize: 11, minWidth: 40, textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </div>
          <button onClick={zoomIn}    style={btnStyle}>+</button>
          <button onClick={toggleAutoRotate} style={{
            ...btnStyle,
            background: autoRotate ? "rgba(0,212,255,0.2)" : "rgba(255,255,255,0.05)",
            borderColor: autoRotate ? "#00d4ff" : "rgba(255,255,255,0.1)",
            color: autoRotate ? "#00d4ff" : "#94a3b8",
          }}>
            {autoRotate ? "⏸" : "▶"} Auto
          </button>
          <button onClick={resetView} style={btnStyle}>↺ Reset</button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", cursor: "grab", display: "block" }}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { stateRef.current.dragging = false; stateRef.current.hovered = null; setHovered(null); }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: 24, left: 24,
        background: "rgba(0,0,0,0.75)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12, padding: "12px 16px",
        backdropFilter: "blur(10px)",
        zIndex: 10,
      }}>
        <div style={{ color: "#64748b", fontSize: 9, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>
          Node Types
        </div>
        {Object.entries(TYPE_COLORS).filter(([t]) => t !== "default").map(([type, color]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
            <span style={{ color: "#94a3b8", fontSize: 10, textTransform: "capitalize" }}>{type}</span>
            <span style={{ color: "#475569", fontSize: 10, marginLeft: "auto", paddingLeft: 12 }}>
              {typeCounts[type] || 0}
            </span>
          </div>
        ))}
      </div>

      {/* Selected node detail */}
      {selected && (
        <div style={{
          position: "absolute", bottom: 24, right: 24,
          background: "rgba(0,0,0,0.85)",
          border: `1px solid ${TYPE_COLORS[selected.type || "default"]}44`,
          borderRadius: 12, padding: "16px 20px",
          backdropFilter: "blur(10px)",
          zIndex: 10, maxWidth: 340,
          boxShadow: `0 0 30px ${TYPE_COLORS[selected.type || "default"]}22`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ color: TYPE_COLORS[selected.type || "default"], fontSize: 9, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
                {selected.type || "node"}
              </div>
              <div style={{ color: "#ffffff", fontSize: 15, fontWeight: 700 }}>{selected.label}</div>
            </div>
            <button onClick={() => { stateRef.current.selected = null; setSelected(null); }}
              style={{ ...btnStyle, padding: "2px 8px", fontSize: 14, marginLeft: 12 }}>✕</button>
          </div>
          {selected.file && (
            <div style={{
              background: "rgba(255,255,255,0.04)", borderRadius: 6,
              padding: "8px 10px", marginBottom: 10,
              color: "#94a3b8", fontSize: 9, wordBreak: "break-all", lineHeight: 1.6,
            }}>
              📄 {selected.file}
            </div>
          )}
          {selected.connections && selected.connections.length > 0 && (
            <div>
              <div style={{ color: "#475569", fontSize: 9, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
                Connections ({selected.connections.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {selected.connections.map(c => {
                  const cn = nodes.find(n => n.id === c);
                  return (
                    <span key={c} style={{
                      background: `${TYPE_COLORS[cn?.type || "default"]}22`,
                      border: `1px solid ${TYPE_COLORS[cn?.type || "default"]}44`,
                      color: TYPE_COLORS[cn?.type || "default"],
                      borderRadius: 4, padding: "2px 7px", fontSize: 9,
                      cursor: "pointer",
                    }}
                      onClick={() => {
                        if (cn) { stateRef.current.selected = cn.id; setSelected(cn); }
                      }}
                    >{cn?.label || c}</span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hovered mini tooltip */}
      {hovered && !selected && (() => {
        const n = nodes.find(x => x.id === hovered);
        if (!n) return null;
        return (
          <div style={{
            position: "absolute", bottom: 24, right: 24,
            background: "rgba(0,0,0,0.8)",
            border: `1px solid ${TYPE_COLORS[n.type || "default"]}33`,
            borderRadius: 8, padding: "10px 14px",
            zIndex: 10, maxWidth: 280, pointerEvents: "none",
          }}>
            <div style={{ color: TYPE_COLORS[n.type || "default"], fontSize: 9, letterSpacing: 2, textTransform: "uppercase", marginBottom: 3 }}>
              {n.type}
            </div>
            <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{n.label}</div>
            {n.file && <div style={{ color: "#64748b", fontSize: 9, wordBreak: "break-all" }}>{n.file}</div>}
          </div>
        );
      })()}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  color: "#94a3b8",
  cursor: "pointer",
  padding: "6px 12px",
  fontSize: 12,
  fontFamily: "inherit",
  transition: "all 0.15s",
};