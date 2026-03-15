"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Check, RefreshCw } from "lucide-react";

type ProjectListItem = {
  id: string;
  name: string;
};

type SprintListItem = {
  id: string;
  projectId: string;
  name: string;
};

type DeveloperListItem = {
  id: string;
  fullName?: string;
  name?: string;
};

type AgenticBuildResult = {
  sprintId: string;
  projectId: string;
  sprintName: string;
  createdTasks: Array<Record<string, unknown>>;
  assignmentResults: Array<Record<string, unknown>>;
  agentic?: {
    sprintGoal?: string | null;
    summary?: unknown;
    risks?: unknown[];
  };
};

function asString(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}

function asNumber(x: unknown): number | null {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  if (!x || typeof x !== "object") return null;
  return x as Record<string, unknown>;
}

function getProp(obj: unknown, key: string): unknown {
  const rec = asRecord(obj);
  return rec ? rec[key] : undefined;
}

function summarizeJson(x: unknown): string {
  if (x == null) return "";
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export default function AgenticScrumMasterPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [planningSprints, setPlanningSprints] = useState<SprintListItem[]>([]);
  const [developers, setDevelopers] = useState<DeveloperListItem[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");
  const [projectDetails, setProjectDetails] = useState<string>("");
  const [maxTickets, setMaxTickets] = useState<number>(12);

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgenticBuildResult | null>(null);

  const developerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of developers) {
      m.set(String(d.id), String(d.fullName || d.name || "Developer"));
    }
    return m;
  }, [developers]);

  async function loadProjects() {
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch("/api/projects", { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(asString(getProp(data, "error") || "Failed to load projects"));

      const rawItems = getProp(data, "items");
      const items = Array.isArray(rawItems) ? (rawItems as ProjectListItem[]) : [];
      setProjects(items);
      if (!selectedProjectId && items.length) setSelectedProjectId(String(items[0].id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  async function loadPlanningSprints(projectId: string) {
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ projectId, status: "planning" });
      const resp = await fetch(`/api/sprints?${qs.toString()}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(asString(getProp(data, "error") || "Failed to load sprints"));

      const rawItems = getProp(data, "items");
      const items = Array.isArray(rawItems) ? (rawItems as SprintListItem[]) : [];
      setPlanningSprints(items);
      if (!selectedSprintId || !items.some((s) => String(s.id) === String(selectedSprintId))) {
        setSelectedSprintId(items.length ? String(items[0].id) : "");
      }
    } catch (e) {
      setPlanningSprints([]);
      setSelectedSprintId("");
      setError(e instanceof Error ? e.message : "Failed to load sprints");
    } finally {
      setLoading(false);
    }
  }

  async function loadDevelopers() {
    try {
      const resp = await fetch("/api/developers", { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) return;
      const rawItems = getProp(data, "items");
      const items = Array.isArray(rawItems) ? (rawItems as DeveloperListItem[]) : [];
      setDevelopers(items);
    } catch {
      // ignore (page still usable)
    }
  }

  async function runAgentic() {
    if (!selectedProjectId || !selectedSprintId) return;
    const details = projectDetails.trim();
    if (!details) {
      setError("Please enter project details.");
      return;
    }

    setError(null);
    setRunning(true);
    setResult(null);
    try {
      const resp = await fetch(`/api/sprints/${encodeURIComponent(selectedSprintId)}/agentic-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, projectDetails: details, maxTickets }),
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(asString(getProp(data, "error") || "Agentic build failed"));
      setResult(data as AgenticBuildResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agentic build failed");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void loadProjects();
    void loadDevelopers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setResult(null);
    if (selectedProjectId) void loadPlanningSprints(selectedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((p) => String(p.id) === String(selectedProjectId)) || null,
    [projects, selectedProjectId]
  );

  const selectedSprint = useMemo(
    () => planningSprints.find((s) => String(s.id) === String(selectedSprintId)) || null,
    [planningSprints, selectedSprintId]
  );

  const createdCount = result?.createdTasks?.length ?? 0;
  const assignmentCount = result?.assignmentResults?.length ?? 0;

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-3">
            <Bot className="w-8 h-8" />
            Agentic Scrum Master
          </h1>
          <p className="text-slate-600 dark:text-slate-300">
            Provide project details and let AI generate sprint tasks, summarize scope, and assign developers.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Inputs */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Project</label>
                <select
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={loading || running}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!projects.length && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">No projects found.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Planning Sprint</label>
                <select
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={selectedSprintId}
                  onChange={(e) => setSelectedSprintId(e.target.value)}
                  disabled={loading || running || !planningSprints.length}
                >
                  {planningSprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {!planningSprints.length && selectedProjectId && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">No planning sprints for this project.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Max tickets</label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={Number.isFinite(maxTickets) ? maxTickets : 12}
                  onChange={(e) => {
                    const n = asNumber(e.target.value) ?? 12;
                    setMaxTickets(Math.max(3, Math.min(30, Math.round(n))));
                  }}
                  disabled={loading || running}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Project details</label>
              <textarea
                className="w-full min-h-40 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={projectDetails}
                onChange={(e) => setProjectDetails(e.target.value)}
                placeholder="Example: Build Jira integration with OAuth, sync sprints/tasks, add dashboard and alerts..."
                disabled={loading || running}
              />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void loadProjects()}
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-zinc-900 transition"
                disabled={loading || running}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={() => void runAgentic()}
                className="bg-slate-900 dark:bg-white text-white dark:text-black font-semibold px-4 py-2 rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-60"
                disabled={!selectedProjectId || !selectedSprintId || running}
              >
                <Check className="w-4 h-4" />
                {running ? "Running…" : "Run Agentic Scrum Master"}
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Selected</p>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {selectedProject?.name || "—"} / {selectedSprint?.name || "—"}
            </p>

            <div className="mt-5">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Latest run</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {result ? `Created ${createdCount} tasks, applied ${assignmentCount} assignments.` : "No agentic run yet."}
              </p>
              {result?.agentic?.sprintGoal ? (
                <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                  <b>Goal:</b> {result.agentic.sprintGoal}
                </p>
              ) : null}
            </div>

            {result?.agentic?.risks?.length ? (
              <div className="mt-5">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Risks</p>
                <div className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-3">
                  {summarizeJson(result.agentic.risks)}
                </div>
              </div>
            ) : null}

            {result?.agentic?.summary ? (
              <div className="mt-5">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Summary</p>
                <div className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950 p-3">
                  {summarizeJson(result.agentic.summary)}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="mb-6 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        ) : null}

        {/* Output */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Created tasks</h2>
            {!result?.createdTasks?.length ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Run the agent to create sprint tasks.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {result.createdTasks.map((t, idx) => {
                  const title = asString(getProp(t, "title")) || `Task ${idx + 1}`;
                  const points = asString(getProp(t, "story_points") ?? getProp(t, "storyPoints") ?? "");
                  const priority = asString(getProp(t, "priority"));
                  const id = asString(getProp(t, "id"));
                  return (
                    <div
                      key={id || String(idx)}
                      className="p-4 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-lg"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
                        {priority ? (
                          <span className="text-xs px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-slate-200">
                            {priority}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {id ? `ID: ${id.slice(0, 8)}` : null}
                        {points ? ` • ${points} pts` : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Assignments applied</h2>
            {!result?.assignmentResults?.length ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Assignments will appear after tasks are created.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {result.assignmentResults.map((a, idx) => {
                  const ticketId = asString(getProp(a, "ticketId"));
                  const taskId = asString(getProp(a, "taskId"));
                  const developerId = asString(getProp(a, "developerId"));
                  const ok = Boolean(getProp(a, "ok"));
                  const developerName = developerNameById.get(developerId) || (developerId ? `Developer ${developerId.slice(0, 6)}` : "Developer");
                  return (
                    <div
                      key={`${taskId || idx}`}
                      className="p-4 bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-lg"
                    >
                      <p className="text-sm text-slate-900 dark:text-white">
                        <b>{developerName}</b> {ok ? "assigned" : "failed"}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                        {taskId ? `Task: ${taskId.slice(0, 8)}` : null}
                        {ticketId ? ` • Ticket: ${ticketId.slice(0, 8)}` : null}
                        {developerId ? ` • Dev: ${developerId.slice(0, 8)}` : null}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
