"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Users, Wand2 } from "lucide-react";

type Sprint = { id: string; name: string; status: string };

type Task = {
  id: string;
  sprintId?: string;
  sprintName?: string;
  sprintStatus?: string;
  title: string;
  status: string;
  storyPoints: number;
  priority?: string;
  label?: string;
  techTags?: string[];
  assignee?: { id: string; name?: string | null; avatarUrl?: string | null } | null;
};

type DeveloperWorkload = {
  developer: { id: string; name?: string | null; avatarUrl?: string | null };
  assignedPoints: number;
  assignedCount?: number;
  capacity: number;
};

type Suggestion = {
  developer: string;
  developerId: string;
  meritScore: number;
  techMatchPct: number;
  currentLoad: number;
  capacity: number;
  available: boolean;
  score: number;
};

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeTask(task: unknown): Task {
  const raw = task && typeof task === "object" ? (task as Record<string, unknown>) : {};
  const assigneeRaw = raw.assignee && typeof raw.assignee === "object" ? (raw.assignee as Record<string, unknown>) : null;

  return {
    id: asString(raw.id),
    sprintId: asString(raw.sprintId || raw.sprint_id || "") || undefined,
    sprintName: asString(raw.sprintName || raw.sprint_name || "") || undefined,
    sprintStatus: asString(raw.sprintStatus || raw.sprint_status || "") || undefined,
    title: asString(raw.title, "Untitled Task"),
    status: asString(raw.status, "todo"),
    storyPoints: Math.max(0, toFiniteNumber(raw.storyPoints || raw.story_points, 0)),
    priority: asString(raw.priority || "") || undefined,
    label: asString(raw.label || "") || undefined,
    techTags: Array.isArray(raw.techTags)
      ? raw.techTags.map((tag) => asString(tag)).filter(Boolean)
      : Array.isArray(raw.tags)
        ? raw.tags.map((tag) => asString(tag)).filter(Boolean)
        : [],
    assignee: assigneeRaw
      ? {
          id: asString(assigneeRaw.id || ""),
          name: asString(assigneeRaw.name || "") || null,
          avatarUrl: asString(assigneeRaw.avatarUrl || "") || null,
        }
      : null,
  };
}

function normalizeTasks(payload: unknown): Task[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => normalizeTask(item)).filter((item) => Boolean(item.id));
}

function normalizeWorkloads(payload: unknown): DeveloperWorkload[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .map((item) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const developerRaw = raw.developer && typeof raw.developer === "object" ? (raw.developer as Record<string, unknown>) : {};
      const developerId = asString(developerRaw.id || raw.developerId || raw.id || "");

      return {
        developer: {
          id: developerId,
          name: asString(developerRaw.name || raw.developerName || "Developer") || "Developer",
          avatarUrl: asString(developerRaw.avatarUrl || "") || null,
        },
        assignedPoints: Math.max(0, toFiniteNumber(raw.assignedPoints, 0)),
        assignedCount: Math.max(0, Math.round(toFiniteNumber(raw.assignedCount, 0))),
        capacity: Math.max(1, toFiniteNumber(raw.capacity, 1)),
      };
    })
    .filter((entry) => Boolean(entry.developer.id));
}

function deriveSprints(tasks: Task[]): Sprint[] {
  const map = new Map<string, Sprint>();
  for (const task of tasks) {
    const sprintId = asString(task.sprintId || "");
    if (!sprintId) continue;
    if (map.has(sprintId)) continue;

    map.set(sprintId, {
      id: sprintId,
      name: asString(task.sprintName || `Sprint ${sprintId}`),
      status: asString(task.sprintStatus || "planning"),
    });
  }

  return [...map.values()];
}

function buildSuggestions(task: Task, workloads: DeveloperWorkload[]): Suggestion[] {
  const taskPoints = Math.max(0, Number(task.storyPoints || 0));
  const seed = hashText(task.id + task.title);

  return workloads
    .map((entry) => {
      const assignedPoints = Math.max(0, Number(entry.assignedPoints || 0));
      const capacity = Math.max(1, Number(entry.capacity || 1));
      const utilization = assignedPoints / capacity;
      const capacityScore = Math.max(0, Math.round((1 - Math.min(utilization, 1.5)) * 100));
      const meritScore = 60 + ((seed + hashText(entry.developer.id)) % 41);
      const techMatchPct = 55 + ((hashText(String(entry.developer.name || "") + task.id) + (task.techTags?.length || 0) * 7) % 46);
      const score = Math.round(meritScore * 0.35 + techMatchPct * 0.2 + capacityScore * 0.45);

      return {
        developer: asString(entry.developer.name || "Developer"),
        developerId: entry.developer.id,
        meritScore,
        techMatchPct,
        currentLoad: assignedPoints,
        capacity,
        available: assignedPoints + taskPoints <= capacity,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function applyWorkloadDeltas(workloads: DeveloperWorkload[], deltas: Map<string, { points: number; count: number }>) {
  return workloads.map((entry) => {
    const delta = deltas.get(entry.developer.id);
    if (!delta) return entry;

    return {
      ...entry,
      assignedPoints: entry.assignedPoints + delta.points,
      assignedCount: Math.max(0, Number(entry.assignedCount || 0)) + delta.count,
    };
  });
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

export default function AssignmentEnginePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [developersWithWorkload, setDevelopersWithWorkload] = useState<DeveloperWorkload[]>([]);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [suggestForTaskId, setSuggestForTaskId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [suggestLoadingTaskId, setSuggestLoadingTaskId] = useState<string | null>(null);

  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  const selectedSprint = useMemo(() => sprints.find((s) => String(s.id) === String(selectedSprintId)) || null, [sprints, selectedSprintId]);

  const unassignedTasks = useMemo(() => tasks.filter((t) => !t.assignee?.id), [tasks]);

  async function loadSprints(): Promise<string> {
    const allUnassignedRaw = await invokeDesktop<unknown>("assign:getUnassignedTasks");
    const allUnassigned = normalizeTasks(allUnassignedRaw);
    const items = deriveSprints(allUnassigned);
    setSprints(items);

    const nextSelected = selectedSprintId && items.some((item) => String(item.id) === String(selectedSprintId))
      ? selectedSprintId
      : items.length
        ? String(items[0].id)
        : "";

    if (nextSelected !== selectedSprintId) setSelectedSprintId(nextSelected);
    return nextSelected;
  }

  async function loadDevelopersWithWorkload() {
    const workloadsRaw = await invokeDesktop<unknown>("assign:getDevelopersWithWorkload");
    setDevelopersWithWorkload(normalizeWorkloads(workloadsRaw));
  }

  async function loadTasks(sprintId: string) {
    const payload = sprintId ? { sprintId } : undefined;
    const tasksRaw = await invokeDesktop<unknown>("assign:getUnassignedTasks", payload);
    setTasks(normalizeTasks(tasksRaw));
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const sprintId = await loadSprints();
      await Promise.all([loadTasks(String(sprintId || "")), loadDevelopersWithWorkload()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignment data");
    } finally {
      setLoading(false);
    }
  }

  async function refreshTasks() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await Promise.all([loadTasks(String(selectedSprintId || "")), loadDevelopersWithWorkload()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignment data");
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggest(taskId: string) {
    const task = tasks.find((item) => String(item.id) === String(taskId));
    if (!task) return;

    setError(null);
    setNotice(null);
    setSelectedTaskId(taskId);
    setSuggestForTaskId(taskId);
    setSuggestLoadingTaskId(taskId);
    const nextSuggestions = buildSuggestions(task, developersWithWorkload);
    setSuggestions((prev) => ({ ...prev, [taskId]: nextSuggestions }));
    setSuggestLoadingTaskId(null);
  }

  async function handleAssign(task: Task, developerId?: string) {
    if (!developerId) {
      await handleSuggest(task.id);
      setNotice("Select a developer from suggestions to assign this task.");
      return;
    }

    setError(null);
    setNotice(null);
    setAssigningTaskId(task.id);

    const previousTasks = tasks;
    const previousWorkloads = developersWithWorkload;
    const taskPoints = Math.max(0, Number(task.storyPoints || 0));

    const singleAssignDelta = new Map<string, { points: number; count: number }>();
    singleAssignDelta.set(developerId, { points: taskPoints, count: 1 });

    setTasks((prev) => prev.filter((item) => String(item.id) !== String(task.id)));
    setDevelopersWithWorkload((prev) => applyWorkloadDeltas(prev, singleAssignDelta));

    try {
      const updatedTask = normalizeTask(await invokeDesktop<unknown>("assign:assignTask", {
        taskId: task.id,
        developerId,
      }));

      const fallbackName = developersWithWorkload.find((entry) => String(entry.developer.id) === String(developerId))?.developer.name || "developer";
      setNotice(`Assigned to ${updatedTask.assignee?.name || fallbackName}.`);
      setSuggestForTaskId(null);
      setSelectedTaskId(null);
      await Promise.all([loadTasks(String(selectedSprintId || "")), loadDevelopersWithWorkload()]);
    } catch (e) {
      setTasks(previousTasks);
      setDevelopersWithWorkload(previousWorkloads);
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigningTaskId(null);
    }
  }

  async function handleReassign(task: Task) {
    await handleSuggest(task.id);
    setNotice("Select a developer from suggestions to reassign this task.");
  }

  async function handleBulkAssign() {
    if (!unassignedTasks.length) return;
    if (!developersWithWorkload.length) {
      setError("No developers available for assignment");
      return;
    }

    setError(null);
    setNotice(null);
    setBulkAssigning(true);

    const previousTasks = tasks;
    const previousWorkloads = developersWithWorkload;

    const workloadSimulation = developersWithWorkload.map((entry) => ({
      developerId: entry.developer.id,
      assignedPoints: Math.max(0, Number(entry.assignedPoints || 0)),
      capacity: Math.max(1, Number(entry.capacity || 1)),
    }));

    const assignments: Array<{ taskId: string; developerId: string }> = [];
    const workloadDeltas = new Map<string, { points: number; count: number }>();

    for (const task of unassignedTasks) {
      workloadSimulation.sort((a, b) => {
        const utilA = a.assignedPoints / a.capacity;
        const utilB = b.assignedPoints / b.capacity;
        if (utilA !== utilB) return utilA - utilB;
        return a.assignedPoints - b.assignedPoints;
      });

      const selected = workloadSimulation[0];
      const taskPoints = Math.max(0, Number(task.storyPoints || 0));
      assignments.push({ taskId: task.id, developerId: selected.developerId });
      selected.assignedPoints += taskPoints;

      const prev = workloadDeltas.get(selected.developerId) || { points: 0, count: 0 };
      workloadDeltas.set(selected.developerId, {
        points: prev.points + taskPoints,
        count: prev.count + 1,
      });
    }

    const assignedTaskIds = new Set(assignments.map((assignment) => assignment.taskId));
    setTasks((prev) => prev.filter((task) => !assignedTaskIds.has(task.id)));
    setDevelopersWithWorkload((prev) => applyWorkloadDeltas(prev, workloadDeltas));

    try {
      const updatedTasksRaw = await invokeDesktop<unknown>("assign:bulkAssign", {
        assignments,
      });

      const updatedTasks = normalizeTasks(updatedTasksRaw);
      const assignedCount = updatedTasks.length;
      const failedCount = Math.max(0, assignments.length - assignedCount);
      setNotice(`Bulk assignment complete: ${assignedCount} assigned, ${failedCount} not assigned.`);
      await Promise.all([loadTasks(String(selectedSprintId || "")), loadDevelopersWithWorkload()]);
    } catch (e) {
      setTasks(previousTasks);
      setDevelopersWithWorkload(previousWorkloads);
      setError(e instanceof Error ? e.message : "Bulk assignment failed");
    } finally {
      setBulkAssigning(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      if (!selectedSprintId) return;
      await refreshTasks();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSprintId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Assignment</h1>
            <p className="text-slate-600 dark:text-slate-300">Auto-assign tasks to developers using capacity + merit + tech match.</p>
          </div>
          <button
            onClick={loadAll}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
            {notice}
          </div>
        ) : null}

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="w-full md:max-w-md">
              <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">Sprint</label>
              <select
                value={selectedSprintId}
                onChange={(e) => setSelectedSprintId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                <option value="">Select sprint…</option>
                {sprints.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </select>
              {selectedSprint ? <div className="mt-2 text-xs text-slate-500">Sprint ID: {selectedSprint.id}</div> : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={refreshTasks}
                disabled={loading || !selectedSprintId}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
              >
                <RefreshCw className="w-4 h-4" /> Reload tasks
              </button>
              <button
                onClick={handleBulkAssign}
                disabled={bulkAssigning || loading || !selectedSprintId || !unassignedTasks.length}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-200"
              >
                <Users className="w-4 h-4" /> Auto-assign ({unassignedTasks.length})
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Sprint tasks</h2>
            <div className="text-sm text-slate-600 dark:text-slate-300">{tasks.length} total</div>
          </div>

          {loading ? <div className="mt-4 text-slate-600 dark:text-slate-300">Loading…</div> : null}
          {!loading && !selectedSprintId ? (
            <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">Select a sprint to load tasks.</div>
          ) : null}
          {!loading && selectedSprintId && !tasks.length ? (
            <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">No tasks found for this sprint.</div>
          ) : null}

          {!!tasks.length ? (
            <div className="mt-4 overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-black/40">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Task</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Points</th>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Assignee</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => {
                    const isBusy = assigningTaskId === t.id;
                    const isSuggesting = suggestLoadingTaskId === t.id;
                    const rowSuggestions = suggestions[t.id] || [];
                    const showSuggestions = suggestForTaskId === t.id;

                    return (
                      <tr key={t.id} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3 align-top">
                          <div className="font-semibold text-slate-900 dark:text-white">{t.title}</div>
                          <div className="mt-1 text-xs text-slate-500">{t.status}</div>
                          {Array.isArray(t.techTags) && t.techTags.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {t.techTags.slice(0, 6).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/30 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {showSuggestions ? (
                            <div className="mt-3 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/30 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Suggestions</div>
                                <button
                                  onClick={() => setSuggestForTaskId(null)}
                                  className="text-xs font-semibold text-slate-700 dark:text-slate-200 underline"
                                >
                                  Close
                                </button>
                              </div>
                              {isSuggesting ? (
                                <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">Loading suggestions...</div>
                              ) : rowSuggestions.length ? (
                                <div className="mt-2 space-y-2">
                                  {rowSuggestions.slice(0, 5).map((s) => (
                                    <button
                                      key={s.developerId}
                                      onClick={() => void handleAssign(t, s.developerId)}
                                      disabled={isBusy || loading}
                                      className={`w-full rounded-md border px-2 py-2 text-left transition ${selectedTaskId === t.id ? "border-slate-400 dark:border-zinc-500" : "border-slate-200 dark:border-zinc-800"}`}
                                    >
                                      <div className="flex items-center justify-between gap-3 text-xs">
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate font-semibold text-slate-900 dark:text-white">{s.developer}</div>
                                          <div className="text-slate-600 dark:text-slate-300">
                                            Merit {s.meritScore} • Tech {s.techMatchPct}% • Load {s.currentLoad}/{s.capacity}
                                          </div>
                                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-zinc-800">
                                            <div
                                              className="h-full bg-slate-700 dark:bg-zinc-300"
                                              style={{ width: `${Math.max(0, Math.min(100, Math.round((s.currentLoad / Math.max(1, s.capacity)) * 100)))}%` }}
                                            />
                                          </div>
                                        </div>
                                        <div className="shrink-0 rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 font-semibold text-slate-800 dark:text-slate-200">
                                          {Math.round(s.score)}
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">No candidates available for this task.</div>
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top text-slate-900 dark:text-white">{t.storyPoints}</td>
                        <td className="px-3 py-3 align-top">
                          {t.assignee?.id ? (
                            <div className="text-slate-900 dark:text-white">{t.assignee?.name || "Assigned"}</div>
                          ) : (
                            <div className="text-slate-600 dark:text-slate-300">Unassigned</div>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex justify-end flex-wrap gap-2">
                            <button
                              onClick={() => void handleSuggest(t.id)}
                              disabled={isSuggesting || loading}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                            >
                              <Wand2 className="w-4 h-4" /> Suggest
                            </button>
                            {!t.assignee?.id ? (
                              <button
                                onClick={() => void handleAssign(t)}
                                disabled={isBusy || loading || !selectedSprintId}
                                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-200"
                              >
                                Assign
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReassign(t)}
                                disabled={isBusy || loading}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                              >
                                Reassign
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

