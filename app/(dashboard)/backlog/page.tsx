"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

type Project = {
  id: string;
  name: string;
  key?: string;
};

type BacklogItem = {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  type?: string | null;
  priority?: string | null;
  status?: string | null;
  storyPoints?: number | null;
  aiEstimatedPoints?: number | null;
  businessValue?: number;
  techTags?: string[];
  jiraIssueKey?: string | null;
  epicTitle?: string | null;
  sprintName?: string | null;
};

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export default function BacklogPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const statuses = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.status) values.add(String(item.status));
    }
    return ["all", ...Array.from(values).sort()];
  }, [items]);

  const types = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.type) values.add(String(item.type));
    }
    return ["all", ...Array.from(values).sort()];
  }, [items]);

  const priorities = useMemo(() => {
    const values = new Set<string>();
    for (const item of items) {
      if (item.priority) values.add(String(item.priority));
    }
    return ["all", ...Array.from(values).sort((a, b) => (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99))];
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && String(item.status || "") !== statusFilter) return false;
      if (typeFilter !== "all" && String(item.type || "") !== typeFilter) return false;
      if (priorityFilter !== "all" && String(item.priority || "") !== priorityFilter) return false;

      if (!q) return true;
      const hay = [
        item.title,
        item.description || "",
        item.jiraIssueKey || "",
        item.epicTitle || "",
        ...(item.techTags || []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, statusFilter, typeFilter, priorityFilter]);

  const totals = useMemo(() => {
    return {
      all: items.length,
      ready: items.filter((i) => i.status === "ready").length,
      inSprint: items.filter((i) => i.status === "in_sprint").length,
      storyPoints: items.reduce((sum, i) => sum + Number(i.storyPoints || i.aiEstimatedPoints || 0), 0),
    };
  }, [items]);

  const loadProjects = useCallback(async () => {
    setError(null);
    const resp = await fetch("/api/projects", { cache: "no-store" });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      setProjects([]);
      setProjectId("");
      setError(String(data?.error || "Failed to load projects"));
      return;
    }

    const next = Array.isArray(data?.items) ? (data.items as Project[]) : [];
    setProjects(next);
    if (!projectId && next.length) setProjectId(String(next[0].id));
  }, [projectId]);

  const loadBacklog = useCallback(async (pid: string) => {
    if (!pid) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(pid)}/backlog`, { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to load backlog"));
      setItems(Array.isArray(data?.items) ? (data.items as BacklogItem[]) : []);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Failed to load backlog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (projectId) void loadBacklog(projectId);
  }, [loadBacklog, projectId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Backlog</h1>
            <p className="text-slate-600 dark:text-slate-300">Jira-style backlog with filters for grooming and sprint planning.</p>
          </div>
          <button
            onClick={() => {
              void loadProjects();
              if (projectId) void loadBacklog(projectId);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white"
            disabled={loading}
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Project</label>
            <select
              className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, Jira key, tags..."
              className="md:col-span-2 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  Status: {s}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    Type: {t}
                  </option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    Priority: {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <Metric title="Items" value={totals.all} />
          <Metric title="Ready" value={totals.ready} />
          <Metric title="In Sprint" value={totals.inSprint} />
          <Metric title="Points" value={totals.storyPoints} />
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-slate-600 dark:text-slate-300">Loading backlog...</div>
          ) : filtered.length ? (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-black/30">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Issue</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Type</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Priority</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Status</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Points</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Epic</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Sprint</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const points = item.storyPoints ?? item.aiEstimatedPoints ?? 0;
                    return (
                      <tr key={item.id} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{item.title}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {item.jiraIssueKey || item.id.slice(0, 8)}
                            {item.techTags?.length ? ` • ${item.techTags.join(", ")}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{item.type || "story"}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{item.priority || "medium"}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{item.status || "backlog"}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-800 dark:text-slate-100">{points}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{item.epicTitle || "-"}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{item.sprintName || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-sm text-slate-600 dark:text-slate-300">No backlog items match the current filters.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="text-xs text-slate-600 dark:text-slate-400">{title}</div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</div>
    </div>
  );
}
