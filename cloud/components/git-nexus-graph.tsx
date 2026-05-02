"use client";

import type { NexusAnalysisResult } from "@/types/git-nexus";
import { Badge, Card } from "@/components/ui/themed";
import { useState, useEffect, useRef } from "react";

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

function buildProjectGraph(result: NexusAnalysisResult | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!result) return { nodes: [], edges: [] };

  const projectStructure = result.project_structure || {};
  const nodes: GraphNode[] = [{ id: "repo", kind: "repo", label: "Repository", detail: result.repo_meta.url, x: 50, y: 10, tone: "#8b5cf6" }];
  const edges: GraphEdge[] = [];

  const typeLabel = projectStructure.project_type || result.repo_meta.primary_language || "Project";
  nodes.push({ id: "type", kind: "module", label: "Project Type", detail: typeLabel, x: 50, y: 22, tone: "#f59e0b" });
  edges.push({ from: "repo", to: "type", tone: "#f59e0b" });

  if (projectStructure.is_monorepo) {
    nodes.push({ id: "monorepo", kind: "framework", label: "Monorepo", detail: "multi-package workspace", x: 50, y: 32, tone: "#a78bfa" });
    edges.push({ from: "repo", to: "monorepo", tone: "#a78bfa" });
  }

  // Distribute directories across the graph
  const dirs = (projectStructure.key_dirs || []).filter(Boolean);
  const visibleDirs = dirs.slice(0, 24);
  const dirColumns = clamp(Math.ceil(visibleDirs.length / 4), 4, 6);
  const dirRows = Math.max(1, Math.ceil(visibleDirs.length / dirColumns));
  visibleDirs.forEach((dir, index) => {
    const id = `dir-${index}`;
    const col = index % dirColumns;
    const row = Math.floor(index / dirColumns);
    const x = dirColumns === 1 ? 26 : 10 + (col / (dirColumns - 1)) * 34;
    const y = dirRows === 1 ? 52 : 36 + (row / (dirRows - 1)) * 42;
    nodes.push({ id, kind: "module", label: leafName(dir), detail: dir, x, y, tone: "#38bdf8" });
    edges.push({ from: "repo", to: id, tone: "#38bdf8" });
  });

  if (dirs.length > visibleDirs.length) {
    const extraId = "dir-extra";
    nodes.push({ id: extraId, kind: "module", label: `+${dirs.length - visibleDirs.length} more`, detail: "additional directories", x: 27, y: 84, tone: "#0ea5e9" });
    edges.push({ from: "repo", to: extraId, tone: "#0ea5e9" });
  }

  return { nodes, edges };
}

  function buildFunctionGraph(result: NexusAnalysisResult | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
    if (!result) return { nodes: [], edges: [] };

    const nodes: GraphNode[] = [
      { id: "repo", kind: "repo", label: "Functions", detail: result.repo_meta.url, x: 50, y: 12, tone: "#8b5cf6" },
    ];
    const edges: GraphEdge[] = [];

    const symbol = result.symbol_inventory;
    const files = (symbol?.top_files || []).filter((entry) => (entry.functions?.length || 0) > 0);
    const functionsFlat: { name: string; file: string }[] = [];
    files.forEach((entry) => {
      (entry.functions || []).forEach((fn) => functionsFlat.push({ name: fn, file: entry.file }));
    });

    const total = functionsFlat.length;
    if (total === 0) {
      nodes.push({ id: "fn-none", kind: "function", label: "No functions detected", detail: "", x: 50, y: 60, tone: "#94a3b8" });
      edges.push({ from: "repo", to: "fn-none", tone: "#94a3b8" });
      return { nodes, edges };
    }

    const cols = clamp(Math.ceil(Math.sqrt(total)), 6, 60);
    const rows = Math.max(1, Math.ceil(total / cols));

    functionsFlat.forEach((fn, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = clamp(8 + (col / Math.max(1, cols - 1)) * 84, 8, 92);
      const y = clamp(18 + (row / Math.max(1, rows - 1)) * 74, 18, 92);
      const id = `fn-${idx}`;
      nodes.push({ id, kind: "function", label: fn.name, detail: fn.file, x, y, tone: "#22c55e" });
      edges.push({ from: "repo", to: id, tone: "#22c55e" });
    });

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
  const filePaths = new Set<string>();
  (projectStructure.root_files || []).forEach((f: string) => filePaths.add(f));
  (projectStructure.package_files || []).forEach((f: string) => filePaths.add(f));
  (result.symbol_inventory?.top_files || []).forEach((entry) => filePaths.add(entry.file));

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
  const totalDepth = Math.max(1, levels.length);
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
  const projectGraph = buildProjectGraph(result);
  const activityGraph = buildActivityGraph(result);
  const functionGraph = buildFunctionGraph(result);
  const treeGraph = buildTreeGraph(result);

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
        (triggerRef?.current || prevActive)?.focus?.();
      } catch (_) {}
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

        {selectedView === "project" ? (
          <div className="relative h-[520px] overflow-hidden rounded-3xl border border-[var(--border)] bg-[radial-gradient(circle_at_top,_rgba(91,140,255,0.22),_transparent_40%),linear-gradient(180deg,_rgba(9,12,18,0.98),_rgba(14,17,24,1))]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {projectGraph.edges.map((edge, index) => {
                const from = projectGraph.nodes.find((node) => node.id === edge.from);
                const to = projectGraph.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.tone} strokeWidth="0.7" strokeLinecap="round" opacity="0.75" />;
              })}
            </svg>

            {projectGraph.nodes.map((node) => (
              <div
                key={node.id}
                className="absolute max-w-[24%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950/82 px-3 py-2 shadow-lg backdrop-blur"
                style={{ left: `${node.x}%`, top: `${node.y}%`, boxShadow: `0 0 0 1px ${node.tone}22, 0 16px 40px rgba(0, 0, 0, 0.35)` }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.tone }} />
                  <span className="truncate text-xs font-semibold text-white">{node.label}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-300">{node.detail}</p>
              </div>
            ))}
          </div>
        ) : selectedView === "activity" ? (
          <div className="relative h-[500px] overflow-hidden rounded-3xl border border-[var(--border)] bg-[radial-gradient(circle_at_top,_rgba(91,140,255,0.24),_transparent_40%),linear-gradient(180deg,_rgba(9,12,18,0.98),_rgba(14,17,24,1))]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {activityGraph.edges.map((edge, index) => {
                const from = activityGraph.nodes.find((node) => node.id === edge.from);
                const to = activityGraph.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.tone} strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />;
              })}
            </svg>

            {activityGraph.nodes.map((node) => (
              <div
                key={node.id}
                className="absolute max-w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 shadow-lg backdrop-blur"
                style={{ left: `${node.x}%`, top: `${node.y}%`, boxShadow: `0 0 0 1px ${node.tone}22, 0 16px 40px rgba(0, 0, 0, 0.35)` }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.tone }} />
                  <span className="truncate text-xs font-semibold text-white">{node.label}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-300">{node.detail}</p>
              </div>
            ))}
          </div>
        ) : selectedView === "tree" ? (
          <div className="relative h-[500px] overflow-hidden rounded-3xl border border-[var(--border)] bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.06),_transparent_40%),linear-gradient(180deg,_rgba(9,12,18,0.98),_rgba(14,17,24,1))]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {treeGraph.edges.map((edge, index) => {
                const from = treeGraph.nodes.find((node) => node.id === edge.from);
                const to = treeGraph.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.tone} strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />;
              })}
            </svg>

            {treeGraph.nodes.map((node) => (
              <div
                key={node.id}
                className="absolute max-w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/6 bg-slate-900/70 px-3 py-2 shadow-lg backdrop-blur"
                style={{ left: `${node.x}%`, top: `${node.y}%`, boxShadow: `0 0 0 1px ${node.tone}22, 0 12px 30px rgba(0,0,0,0.35)` }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.tone }} />
                  <span className="truncate text-xs font-semibold text-white">{node.label}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-300">{node.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="relative h-[500px] overflow-hidden rounded-3xl border border-[var(--border)] bg-[radial-gradient(circle_at_top,_rgba(91,140,255,0.24),_transparent_40%),linear-gradient(180deg,_rgba(9,12,18,0.98),_rgba(14,17,24,1))]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {functionGraph.edges.map((edge, index) => {
                const from = functionGraph.nodes.find((node) => node.id === edge.from);
                const to = functionGraph.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.tone} strokeWidth="0.6" strokeLinecap="round" opacity="0.72" />;
              })}
            </svg>

            {functionGraph.nodes.map((node) => (
              <div
                ref={
                  node.id === "fn-extra"
                    ? (el) => {
                        try {
                          triggerRef.current = el as HTMLElement;
                        } catch (_) {}
                      }
                    : undefined
                }
                key={node.id}
                role={node.id === "fn-extra" ? "button" : undefined}
                tabIndex={node.id === "fn-extra" ? 0 : undefined}
                onKeyDown={
                  node.id === "fn-extra"
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") setShowAllFunctions(true);
                      }
                    : undefined
                }
                onClick={node.id === "fn-extra" ? () => setShowAllFunctions(true) : undefined}
                className={`absolute max-w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 shadow-lg backdrop-blur ${
                  node.id === "fn-extra" ? "cursor-pointer ring-2 ring-offset-1 ring-indigo-400/20" : ""
                }`}
                style={{ left: `${node.x}%`, top: `${node.y}%`, boxShadow: `0 0 0 1px ${node.tone}22, 0 16px 40px rgba(0, 0, 0, 0.35)` }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: node.tone }} />
                  <span className="truncate text-xs font-semibold text-white">{node.label}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-300">{node.detail}</p>
              </div>
            ))}

            {showAllFunctions && result?.symbol_inventory?.top_files ? (
              <div id="gnx-fn-modal" role="dialog" aria-modal="true" aria-labelledby="gnx-fn-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
                <div className="max-h-[80vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 id="gnx-fn-modal-title" className="text-lg font-semibold text-white">All files with functions</h3>
                      <p className="text-sm text-slate-300">Showing {result.symbol_inventory.top_files.length} files detected with functions.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowAllFunctions(false)}
                        className="rounded bg-white/10 px-3 py-1 text-sm text-white"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {result.symbol_inventory.top_files.map((entry) => (
                      <div key={entry.file} className="rounded-lg border border-white/5 bg-slate-900/60 p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-white break-all">{entry.file}</div>
                          <div className="text-xs text-slate-300">{(entry.functions || []).length} functions</div>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {(entry.functions || []).map((fn) => (
                            <div key={fn} className="rounded px-2 py-1 text-sm text-slate-200">{fn}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
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