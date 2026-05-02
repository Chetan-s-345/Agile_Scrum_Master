"use client";

import type { NexusAnalysisResult } from "@/types/git-nexus";
import { Badge, Card } from "@/components/ui/themed";
import { useState, useEffect, useRef } from "react";
import KnowledgeGraph3D from "@/components/git-nexus-function-graph";
import { mapSymbolInventoryToGraph } from "@/lib/graph-mapper";

type GraphNodeKind = "repo" | "module" | "framework" | "task" | "developer" | "risk" | "file" | "function";

type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  detail: string;
  x: number;
  y: number;
  tone: string;
};

type GraphEdge = { from: string; to: string; tone: string };

function toneForPriority(priority: string): string {
  if (priority === "critical") return "#fb7185";
  if (priority === "high") return "#f59e0b";
  if (priority === "medium") return "#60a5fa";
  return "#34d399";
}

function leafName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
}

function uniqueNormalizedPaths(paths: string[]): string[] {
  const normalized = paths.map(normalizePath).filter((path): path is string => path.length > 0);
  return Array.from(new Set(normalized));
}

function parentFolder(path: string): string | null {
  const normalized = normalizePath(path);
  if (!normalized) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}

function folderName(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return "root";
  return leafName(normalized);
}

function buildFolderGraph(result: NexusAnalysisResult | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!result) return { nodes: [], edges: [] };

  const projectStructure = result.project_structure || {};
  const nodes: GraphNode[] = [
    { id: "repo", kind: "repo", label: "Repository", detail: result.repo_meta.url, x: 50, y: 10, tone: "#8b5cf6" },
  ];
  const edges: GraphEdge[] = [];

  const folderSet = new Set<string>();
  const seedFolders = [
    ...(projectStructure.all_dirs || []),
    ...(projectStructure.key_dirs || []),
    ...(projectStructure.root_files || []).map((path) => parentFolder(path)).filter((path): path is string => Boolean(path)),
    ...(projectStructure.package_files || []).map((path) => parentFolder(path)).filter((path): path is string => Boolean(path)),
    ...(result.symbol_inventory?.top_files || []).map((entry) => parentFolder(entry.file)).filter((path): path is string => Boolean(path)),
  ];

  seedFolders.map(normalizePath).filter(Boolean).forEach((path) => {
    folderSet.add(path);
    const parts = path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      folderSet.add(parts.slice(0, index).join("/"));
    }
  });

  if (folderSet.size === 0) {
    nodes.push({ id: "folder-none", kind: "module", label: "No folders detected", detail: "Run analysis to populate the project map", x: 50, y: 56, tone: "#94a3b8" });
    edges.push({ from: "repo", to: "folder-none", tone: "#94a3b8" });
    return { nodes, edges };
  }

  const folderPaths = Array.from(folderSet).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const folderIndex = new Map<string, number>();
  folderPaths.forEach((path, index) => folderIndex.set(path, index));

  const roots = folderPaths.filter((path) => !path.includes("/"));
  const depthMap = new Map<string, number>();
  const siblingMap = new Map<number, string[]>();

  folderPaths.forEach((path) => {
    const depth = path.split("/").filter(Boolean).length;
    depthMap.set(path, depth);
    if (!siblingMap.has(depth)) siblingMap.set(depth, []);
    siblingMap.get(depth)!.push(path);
  });

  folderPaths.forEach((path) => {
    const depth = depthMap.get(path) || 1;
    const siblings = siblingMap.get(depth) || [];
    const siblingIndex = siblings.indexOf(path);
    const depthStep = 14;
    const x = clamp(12 + depth * depthStep, 10, 90);
    const yBand = siblings.length > 1 ? siblingIndex / (siblings.length - 1 || 1) : 0.5;
    const y = clamp(16 + yBand * 72, 8, 92);
    const parent = parentFolder(path);
    const parentId = parent ? `folder-${folderIndex.get(parent) ?? 0}` : "repo";

    nodes.push({
      id: `folder-${folderIndex.get(path)}`,
      kind: "module",
      label: folderName(path),
      detail: path,
      x,
      y,
      tone: depth <= 1 ? "#38bdf8" : "#60a5fa",
    });
    edges.push({ from: parentId, to: `folder-${folderIndex.get(path)}`, tone: "rgba(148,163,184,0.8)" });
  });

  if (roots.length > 0) {
    nodes.push({ id: "root-summary", kind: "framework", label: `${roots.length} top-level folders`, detail: roots.join(", "), x: 50, y: 92, tone: "#a78bfa" });
    edges.push({ from: "repo", to: "root-summary", tone: "#a78bfa" });
  }

  return { nodes, edges };
}

function buildProjectGraph(result: NexusAnalysisResult | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!result) return { nodes: [], edges: [] };

  const projectStructure = result.project_structure || {};
  const folderGraph = buildFolderGraph(result);
  const nodes: GraphNode[] = [...folderGraph.nodes];
  const edges: GraphEdge[] = [...folderGraph.edges];

  const typeLabel = projectStructure.project_type || result.repo_meta.primary_language || "Project";
  nodes.push({ id: "type", kind: "module", label: "Project Type", detail: typeLabel, x: 8, y: 10, tone: "#f59e0b" });
  nodes.push({ id: "coverage", kind: "framework", label: "Structure Coverage", detail: `${(projectStructure.all_dirs || []).length || (projectStructure.key_dirs || []).length} folders`, x: 8, y: 22, tone: "#a78bfa" });
  edges.push({ from: "repo", to: "type", tone: "#f59e0b" });
  edges.push({ from: "repo", to: "coverage", tone: "#a78bfa" });

  if (projectStructure.is_monorepo) {
    nodes.push({ id: "monorepo", kind: "framework", label: "Monorepo", detail: "multi-package workspace", x: 8, y: 34, tone: "#a78bfa" });
    edges.push({ from: "repo", to: "monorepo", tone: "#a78bfa" });
  }

  return { nodes, edges };
}

function buildActivityGraph(result: NexusAnalysisResult | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!result) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = [{ id: "repo", kind: "repo", label: "Activity", detail: `${result.repo_meta.total_commits_analyzed} commits`, x: 50, y: 18, tone: "#8b5cf6" }];
  const edges: GraphEdge[] = [];
  const devIds = new Map<string, string>();

  result.developer_insights.slice(0, 3).forEach((dev, index) => {
    const id = `dev-${index}`;
    devIds.set(dev.email || dev.name || id, id);
    nodes.push({ id, kind: "developer", label: dev.name || dev.email || "Developer", detail: `${dev.commits} commits`, x: 78, y: 32 + index * 18, tone: "#38bdf8" });
    edges.push({ from: "repo", to: id, tone: "#475569" });
  });

  result.suggested_tasks.slice(0, 4).forEach((task, index) => {
    const id = `task-${index}`;
    nodes.push({ id, kind: "task", label: task.title, detail: `${task.story_points} pts`, x: 22, y: 32 + index * 14, tone: toneForPriority(task.priority) });
    edges.push({ from: "repo", to: id, tone: "#334155" });

    const assigneeId = devIds.get(task.suggested_assignee_email || "");
    if (assigneeId) edges.push({ from: id, to: assigneeId, tone: "#64748b" });
  });

  result.risk_signals.slice(0, 3).forEach((risk, index) => {
    const id = `risk-${index}`;
    nodes.push({ id, kind: "risk", label: risk.type.replace(/_/g, " "), detail: risk.severity, x: 50 + index * 12 - 12, y: 74, tone: risk.severity === "high" ? "#f43f5e" : risk.severity === "medium" ? "#f59e0b" : "#60a5fa" });
    edges.push({ from: "repo", to: id, tone: "#475569" });
  });

  return { nodes, edges };
}

function buildTreeGraph(result: NexusAnalysisResult | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!result) return { nodes: [], edges: [] };

  const nodes: GraphNode[] = [{ id: "root", kind: "repo", label: "Repo", detail: result.repo_meta.url, x: 6, y: 6, tone: "#8b5cf6" }];
  const edges: GraphEdge[] = [];

  // Gather file paths from project structure and symbol inventory
  const projectStructure = result.project_structure || {};
  const rawFilePaths = [
    ...(projectStructure.root_files || []),
    ...(projectStructure.package_files || []),
    ...(result.symbol_inventory?.top_files || []).map((entry) => entry.file),
  ].map(normalizePath).filter(Boolean);
  const filePaths = new Set<string>(uniqueNormalizedPaths(rawFilePaths));

  // Build directory tree map
  const tree = new Map<string, Set<string>>();
  function addPath(p: string) {
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length; i++) {
      const parent = cur || "/";
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      if (!tree.has(parent)) tree.set(parent, new Set());
      tree.get(parent)!.add(cur);
    }
  }

  Array.from(filePaths).forEach((p) => addPath(p));

  // Flatten tree into nodes with simple depth-based layout
  const visited = new Set<string>();
  const levels: string[][] = [];

  function enqueue(node: string, depth: number) {
    if (!levels[depth]) levels[depth] = [];
    if (!visited.has(node)) {
      visited.add(node);
      levels[depth].push(node);
      const children = tree.get(node) ? Array.from(tree.get(node)!) : [];
      children.forEach((c) => enqueue(c, depth + 1));
    }
  }

  enqueue("/", 0);

  // place nodes
  levels.forEach((levelNodes, depth) => {
    const step = 92 / Math.max(1, levelNodes.length);
    levelNodes.forEach((nodeName, idx) => {
      const id = `tree-${btoa(nodeName).replace(/=/g, "")}`;
      const isFile = nodeName.includes(".");
      const label = isFile ? leafName(nodeName) : nodeName === "/" ? "root" : leafName(nodeName);
      const x = clamp(6 + depth * 18, 6, 92);
      const y = clamp(6 + idx * step, 6, 94);
      nodes.push({ id, kind: isFile ? "file" : "module", label, detail: nodeName, x, y, tone: isFile ? "#22c55e" : "#38bdf8" });
    });
  });

  // edges from parent to child
  tree.forEach((children, parent) => {
    const parentId = parent === "/" ? "root" : `tree-${btoa(parent).replace(/=/g, "")}`;
    children.forEach((child) => {
      const childId = `tree-${btoa(child).replace(/=/g, "")}`;
      if (parent === "/") edges.push({ from: "root", to: childId, tone: "#94a3b8" });
      else edges.push({ from: parentId, to: childId, tone: "#94a3b8" });
    });
  });

  return { nodes, edges };
}

export function GitNexusGraph({ result }: { result: NexusAnalysisResult | null }) {
  const [selectedView, setSelectedView] = useState<"project" | "activity" | "function" | "tree">("project");
  const [showAllFunctions, setShowAllFunctions] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Wheel to zoom (Ctrl/Cmd + wheel)
  useEffect(() => {
    function handleWheel(e: WheelEvent) {
      if (!containerRef.current) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale((s) => clamp(s * delta, 0.2, 4));
      }
    }
    const el = containerRef.current;
    el?.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el?.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Drag to pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onDown(e: MouseEvent) {
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      el!.style.cursor = 'grabbing';
    }
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    }
    function onUp() {
      dragging.current = false;
      el!.style.cursor = 'grab';
    }
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
  

  useEffect(() => {
    // manage escape key and allow early cleanup
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAllFunctions(false);
    }
    if (showAllFunctions) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAllFunctions]);

  // Focus trap + return-focus for the functions modal
  useEffect(() => {
    if (!showAllFunctions) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const triggerEl = triggerRef.current;
    const modal = document.getElementById("gnx-fn-modal");
    const focusableSelector = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusable = modal ? Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    const first = focusable[0] ?? modal;
    first?.focus?.();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowAllFunctions(false);
        return;
      }
      if (e.key !== "Tab") return;
      if (!focusable.length) {
        e.preventDefault();
        return;
      }
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        // move backward
        const next = idx <= 0 ? focusable[focusable.length - 1] : focusable[idx - 1];
        e.preventDefault();
        next.focus();
      } else {
        const next = idx === -1 || idx === focusable.length - 1 ? focusable[0] : focusable[idx + 1];
        e.preventDefault();
        next.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // return focus to trigger if available, otherwise previous active
      try {
        (triggerEl || prevActive)?.focus?.();
      } catch {}
    };
  }, [showAllFunctions]);
  if (!result) {
    return (
      <Card className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Project map</h3>
          <p className="text-sm text-[var(--text-secondary)]">Run an analysis to populate the project structure and activity graph.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
          The project graph will connect modules, root files, frameworks, tasks, developers, and risks once analysis completes.
        </div>
      </Card>
    );
  }

  const projectStructure = result.project_structure || {};
  const summaryItems = [
    { label: "Repository", value: result.repo_meta.url || "Unknown" },
    { label: "Branch", value: result.repo_meta.branch || "Unknown" },
    { label: "Language", value: result.repo_meta.primary_language || "Unknown" },
    { label: "Commits", value: `${result.repo_meta.total_commits_analyzed} analyzed` },
    { label: "Window", value: `${result.repo_meta.analysis_window_days} days` },
    { label: "Project type", value: projectStructure.project_type || "Unknown" },
    { label: "Directories", value: `${(projectStructure.key_dirs || []).length} detected` },
    { label: "Root files", value: `${((projectStructure.root_files || []).length + (projectStructure.package_files || []).length)} detected` },
    { label: "Frameworks", value: `${(projectStructure.frameworks || []).length} detected` },
    {
      label: "Functions",
      value: result.symbol_inventory?.totals?.function
        ? `${result.symbol_inventory.totals.function} detected`
        : "Not detected",
    },
  ];

  const transformStyle = { transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: '0 0' } as const;
  // Precompute graphs
  const projectGraph = buildProjectGraph(result);
  const activityGraph = buildActivityGraph(result);
  const treeGraph = buildTreeGraph(result);
  const visibleStructureDirs = uniqueNormalizedPaths(projectStructure.key_dirs || []).slice(0, 8);

  function renderGraphArea() {
    const isFunctionView = selectedView === "function";
    const isProjectView = selectedView === "project";

    // For function view, use the new 3D graph component
    if (isFunctionView && result?.symbol_inventory) {
      const { nodes, edges } = mapSymbolInventoryToGraph(result.symbol_inventory);
      return (
        <div className="relative h-[520px] overflow-hidden rounded-3xl border border-[var(--border)]">
          <KnowledgeGraph3D
            nodes={nodes}
            edges={edges}
            title={`${result.repo_meta.url.split("/").pop() || "Repository"} - Function Graph`}
          />
        </div>
      );
    }

    // For other views, use the old 2D SVG rendering
    const graph = selectedView === "project" ? projectGraph : selectedView === "activity" ? activityGraph : treeGraph;

    return (
      <div
        ref={containerRef}
        className={`relative h-[520px] overflow-hidden rounded-3xl border border-[var(--border)] cursor-grab ${isFunctionView ? 'bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.22),_transparent_28%),radial-gradient(circle_at_center,_rgba(59,130,246,0.12),_transparent_55%),linear-gradient(180deg,_rgba(6,10,18,0.98),_rgba(11,14,24,1))]' : 'bg-[radial-gradient(circle_at_top,_rgba(91,140,255,0.22),_transparent_40%),linear-gradient(180deg,_rgba(9,12,18,0.98),_rgba(14,17,24,1))]'}`}
      >
        {isFunctionView ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-80" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <ellipse cx="50" cy="50" rx="30" ry="21" fill="none" stroke="rgba(96,165,250,0.18)" strokeWidth="0.5" />
            <ellipse cx="50" cy="50" rx="41" ry="29" fill="none" stroke="rgba(96,165,250,0.12)" strokeWidth="0.5" strokeDasharray="1.3 1.6" />
            <path d="M20,50 C32,28 68,28 80,50 C68,72 32,72 20,50 Z" fill="none" stroke="rgba(125,211,252,0.12)" strokeWidth="0.45" />
            <path d="M50,20 C61,32 61,68 50,80 C39,68 39,32 50,20 Z" fill="none" stroke="rgba(125,211,252,0.12)" strokeWidth="0.45" />
          </svg>
        ) : null}
        <div style={transformStyle} className="absolute inset-0">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {graph.edges.map((edge, index) => {
              const from = graph.nodes.find((n) => n.id === edge.from);
              const to = graph.nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.tone} strokeWidth="0.6" strokeLinecap="round" opacity="0.75" />;
            })}
          </svg>

          {graph.nodes.map((node) => (
            <div
              key={node.id}
              className={`absolute max-w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 shadow-lg backdrop-blur ${node.kind === 'function' ? 'max-w-[32%]' : ''}`}
              style={{ left: `${node.x}%`, top: `${node.y}%`, boxShadow: `0 0 0 1px ${node.tone}22, 0 16px 40px rgba(0,0,0,0.35)` }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.tone }} />
                <span className="truncate text-xs font-semibold text-white">{node.label}</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-300">{node.detail}</p>
            </div>
          ))}
        </div>

        {/* zoom controls */}
        <div className="absolute right-3 bottom-3 z-20 flex flex-col gap-2">
          <button onClick={() => setScale((s) => clamp(s * 1.2, 0.2, 4))} className="h-9 w-9 rounded-md border bg-[var(--bg-surface)] text-[var(--text-secondary)]">+</button>
          <button onClick={() => setScale((s) => clamp(s / 1.2, 0.2, 4))} className="h-9 w-9 rounded-md border bg-[var(--bg-surface)] text-[var(--text-secondary)]">−</button>
          <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} className="h-9 w-9 rounded-md border bg-[var(--bg-surface)] text-[var(--text-secondary)]">Fit</button>
        </div>

        {isProjectView ? (
          <div className="absolute left-3 top-3 z-20 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]/90 px-3 py-2 text-sm shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-4">
              <div className="font-semibold text-[var(--text-primary)]">Structure</div>
              <div className="text-xs text-[var(--text-secondary)]">{visibleStructureDirs.length} dirs</div>
            </div>
            <div className="mt-2 flex max-w-[28rem] flex-wrap gap-2">
              {visibleStructureDirs.map((dir) => (
                <span key={dir} className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                  {leafName(dir)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Project map</h3>
            <p className="text-sm text-[var(--text-secondary)]">Root files, directories, and frameworks pulled from the repository structure.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedView("project")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedView === "project" ? "border-[var(--border-focus)] bg-[var(--bg-surface)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"}`}
            >
              Project map
            </button>
            <button
              type="button"
              onClick={() => setSelectedView("activity")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedView === "activity" ? "border-[var(--border-focus)] bg-[var(--bg-surface)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"}`}
            >
              Activity graph
            </button>
            <button
              type="button"
              onClick={() => setSelectedView("function")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedView === "function" ? "border-[var(--border-focus)] bg-[var(--bg-surface)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"}`}
            >
              Function graph
            </button>
            <button
              type="button"
              onClick={() => setSelectedView("tree")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedView === "tree" ? "border-[var(--border-focus)] bg-[var(--bg-surface)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"}`}
            >
              Tree view
            </button>
            <Badge color="blue">{result.repo_meta.primary_language}</Badge>
          </div>
        </div>

        {renderGraphArea()}
        </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {summaryItems.map((item) => (
          <div key={item.label} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
            <p className="mt-2 break-words text-sm font-medium text-[var(--text-primary)]">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Directories</p>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {(projectStructure.key_dirs || []).length ? (
              (projectStructure.key_dirs || []).map((dir) => (
                <div key={dir} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{leafName(dir)}</div>
                  <div className="break-all text-xs text-[var(--text-secondary)]">{dir}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-[var(--text-secondary)]">No directories detected.</div>
            )}
          </div>
        </div>
        

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Files, frameworks, and workspaces</p>
          <div className="mt-3 space-y-4">
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">Root files</div>
              <div className="mt-2 max-h-28 space-y-2 overflow-y-auto pr-1 text-xs text-[var(--text-secondary)]">
                {[...(projectStructure.root_files || []), ...(projectStructure.package_files || [])].length ? (
                  [...(projectStructure.root_files || []), ...(projectStructure.package_files || [])].map((file) => (
                    <div key={file} className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 break-all">{file}</div>
                  ))
                ) : (
                  <div>No root or package files detected.</div>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">Frameworks</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(projectStructure.frameworks || []).length ? (
                  (projectStructure.frameworks || []).map((framework) => (
                    <span key={framework} className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                      {framework}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[var(--text-secondary)]">No frameworks detected.</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">Workspaces</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(projectStructure.workspaces || []).length ? (
                  (projectStructure.workspaces || []).map((workspace) => (
                    <span key={workspace} className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                      {workspace}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-[var(--text-secondary)]">No workspaces detected.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Related tasks</p>
          <div className="mt-2 space-y-2">
            {result.suggested_tasks.slice(0, 3).map((task) => (
              <div key={task.title} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">{task.title}</p>
                <p className="text-xs text-[var(--text-secondary)]">{task.priority} priority · {task.story_points} pts</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Developers</p>
          <div className="mt-2 space-y-2">
            {result.developer_insights.slice(0, 3).map((dev) => (
              <div key={dev.email} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">{dev.name || dev.email}</p>
                <p className="text-xs text-[var(--text-secondary)]">{dev.commits} commits · {dev.primary_tech.slice(0, 2).join(", ") || "general"}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Risks</p>
          <div className="mt-2 space-y-2">
            {result.risk_signals.slice(0, 3).map((risk, index) => (
              <div key={`${risk.type}-${index}`} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">{risk.type.replace(/_/g, " ")}</p>
                <p className="text-xs text-[var(--text-secondary)]">{risk.severity} · {risk.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}