"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Users, Wand2 } from "lucide-react";

type Sprint = { id: string; name: string; status: string };

type SprintsResp = { items?: Sprint[]; error?: string };

type Task = {
  id: string;
  title: string;
  status: string;
  storyPoints: number;
  techTags?: string[];
  assignee?: { id: string; name?: string | null; avatarUrl?: string | null } | null;
};

type TasksResp = { items?: Task[]; error?: string };

type Suggestion = {
  developer: string;
  developerId: string;
  meritScore: number;
  techMatchPct: number;
  currentLoad: number;
  available: boolean;
  score: number;
};

type SuggestResp = { items?: Suggestion[]; error?: string };

type AssignOk = {
  error?: string;
  assigned: boolean;
  developer?: { id: string; name: string };
  reason?: string;
  suggestion?: string;
};

type AssignBulkOk = {
  results?: Array<{ taskId: string; assigned: boolean; developer?: { id: string; name: string } | null; reason?: string | null; suggestion?: string | null }>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }>
{
  const resp = await fetch(url, { cache: "no-store", ...init });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

export default function AssignmentEnginePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");

  const [tasks, setTasks] = useState<Task[]>([]);

  const [suggestForTaskId, setSuggestForTaskId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [suggestLoadingTaskId, setSuggestLoadingTaskId] = useState<string | null>(null);

  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  const selectedSprint = useMemo(() => sprints.find((s) => String(s.id) === String(selectedSprintId)) || null, [sprints, selectedSprintId]);

  const unassignedTasks = useMemo(() => tasks.filter((t) => !t.assignee?.id), [tasks]);

  async function loadSprints(): Promise<string> {
    const activeResp = await fetchJson<SprintsResp>(`/api/sprints?${new URLSearchParams({ status: "active" }).toString()}`);
    let items = Array.isArray(activeResp.data?.items) ? activeResp.data!.items! : [];
    if (!items.length) {
      const planningResp = await fetchJson<SprintsResp>(`/api/sprints?${new URLSearchParams({ status: "planning" }).toString()}`);
      items = Array.isArray(planningResp.data?.items) ? planningResp.data!.items! : [];
    }
    setSprints(items);
    const nextSelected = selectedSprintId || (items.length ? String(items[0].id) : "");
    if (nextSelected !== selectedSprintId) setSelectedSprintId(nextSelected);
    return nextSelected;
  }

  async function loadTasks(sprintId: string) {
    if (!sprintId) {
      setTasks([]);
      return;
    }
    const resp = await fetchJson<TasksResp>(`/api/tasks?${new URLSearchParams({ sprintId }).toString()}`);
    if (!resp.ok) {
      throw new Error(String(resp.data?.error || `Failed to load tasks (${resp.status})`));
    }
    const items = Array.isArray(resp.data?.items) ? (resp.data!.items as Task[]) : [];
    setTasks(items);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const sprintId = await loadSprints();
      if (sprintId) await loadTasks(String(sprintId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sprints");
    } finally {
      setLoading(false);
    }
  }

  async function refreshTasks() {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await loadTasks(String(selectedSprintId || ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggest(taskId: string) {
    setError(null);
    setNotice(null);
    setSuggestForTaskId(taskId);
    setSuggestLoadingTaskId(taskId);
    try {
      const resp = await fetchJson<SuggestResp>(`/api/assignment/suggest/${encodeURIComponent(taskId)}`);
      if (!resp.ok) throw new Error(String(resp.data?.error || `Failed to load suggestions (${resp.status})`));
      setSuggestions((prev) => ({ ...prev, [taskId]: Array.isArray(resp.data?.items) ? (resp.data!.items as Suggestion[]) : [] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
    } finally {
      setSuggestLoadingTaskId(null);
    }
  }

  async function handleAssign(task: Task) {
    setError(null);
    setNotice(null);
    setAssigningTaskId(task.id);
    try {
      const body = {
        taskId: task.id,
        sprintId: String(selectedSprintId),
        techTags: Array.isArray(task.techTags) ? task.techTags : [],
        storyPoints: Number(task.storyPoints || 0),
      };
      const resp = await fetchJson<AssignOk>("/api/assignment/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const msg = String(resp.data?.error || resp.data?.suggestion || resp.data?.reason || `Assignment failed (${resp.status})`);
        throw new Error(msg);
      }

      if (resp.data?.assigned) {
        setNotice(`Assigned to ${resp.data.developer?.name || "developer"}.`);
      } else {
        setNotice(String(resp.data?.suggestion || resp.data?.reason || "Not assigned."));
      }
      await refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setAssigningTaskId(null);
    }
  }

  async function handleReassign(task: Task) {
    setError(null);
    setNotice(null);
    setAssigningTaskId(task.id);
    try {
      const resp = await fetchJson<AssignOk>("/api/assignment/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, reason: "Reassign requested from Assignment" }),
      });
      if (!resp.ok) {
        const msg = String(resp.data?.error || resp.data?.suggestion || resp.data?.reason || `Reassign failed (${resp.status})`);
        throw new Error(msg);
      }

      if (resp.data?.assigned) {
        setNotice(`Reassigned to ${resp.data.developer?.name || "developer"}.`);
      } else {
        setNotice(String(resp.data?.suggestion || resp.data?.reason || "Not reassigned."));
      }
      await refreshTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reassign failed");
    } finally {
      setAssigningTaskId(null);
    }
  }

  async function handleBulkAssign() {
    if (!unassignedTasks.length) return;
    setError(null);
    setNotice(null);
    setBulkAssigning(true);
    try {
      const body = {
        tasks: unassignedTasks.map((t) => ({
          taskId: t.id,
          sprintId: String(selectedSprintId),
          techTags: Array.isArray(t.techTags) ? t.techTags : [],
          storyPoints: Number(t.storyPoints || 0),
        })),
      };
      const resp = await fetchJson<AssignBulkOk>("/api/assignment/assign-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`Bulk assignment failed (${resp.status})`);

      const results = Array.isArray(resp.data?.results) ? resp.data!.results! : [];
      const assignedCount = results.filter((r) => r.assigned).length;
      const failedCount = results.length - assignedCount;
      setNotice(`Bulk assignment complete: ${assignedCount} assigned, ${failedCount} not assigned.`);
      await refreshTasks();
    } catch (e) {
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
                                <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">Loading suggestions…</div>
                              ) : rowSuggestions.length ? (
                                <div className="mt-2 space-y-2">
                                  {rowSuggestions.slice(0, 5).map((s) => (
                                    <div key={s.developerId} className="flex items-center justify-between gap-3 text-xs">
                                      <div className="min-w-0">
                                        <div className="truncate font-semibold text-slate-900 dark:text-white">{s.developer}</div>
                                        <div className="text-slate-600 dark:text-slate-300">Merit {s.meritScore} • Tech {s.techMatchPct}% • Load {s.currentLoad}</div>
                                      </div>
                                      <div className="shrink-0 rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 font-semibold text-slate-800 dark:text-slate-200">
                                        {Math.round(s.score)}
                                      </div>
                                    </div>
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
                              onClick={() => handleSuggest(t.id)}
                              disabled={isSuggesting || loading}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                            >
                              <Wand2 className="w-4 h-4" /> Suggest
                            </button>
                            {!t.assignee?.id ? (
                              <button
                                onClick={() => handleAssign(t)}
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

