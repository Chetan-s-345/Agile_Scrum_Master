"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Filter, RefreshCw } from "lucide-react";
import Link from "next/link";

type SprintListItem = {
  id: string;
  projectId: string;
  name: string;
  startDate?: string;
  endDate?: string;
  plannedPoints?: number;
  completedPoints?: number;
  velocity?: number;
  riskScore?: number;
  completionPct?: number;
  daysRemaining?: number;
};

type BoardTask = {
  id: string;
  title: string;
  storyPoints: number;
  priority?: string;
  techTags?: string[];
  aiRiskScore?: number;
  assignee?: { id: string; name?: string; avatar?: string } | null;
};

type Board = {
  todo: BoardTask[];
  in_progress: BoardTask[];
  in_review: BoardTask[];
  blocked: BoardTask[];
  done: BoardTask[];
};

type TaskFilterPreset = {
  id: string;
  name: string;
  query: string;
  priority: "all" | "high" | "medium" | "low";
  assignee: "all" | "assigned" | "unassigned";
  riskOnly: boolean;
};

const TASK_FILTER_PRESETS_KEY = "asm.taskBoard.filterPresets.v1";

export default function TaskBoardPage() {
  const [sprints, setSprints] = useState<SprintListItem[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");
  const [board, setBoard] = useState<Board>({ todo: [], in_progress: [], in_review: [], blocked: [], done: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskStoryPoints, setNewTaskStoryPoints] = useState<number | "">("");
  const [creatingTask, setCreatingTask] = useState(false);

  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [riskOnly, setRiskOnly] = useState(false);
  const [savedFilters, setSavedFilters] = useState<TaskFilterPreset[]>([]);
  const [newFilterName, setNewFilterName] = useState("");

  const columns = [
    { key: 'todo', title: 'To Do', color: 'bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800' },
    { key: 'in_progress', title: 'In Progress', color: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30', wipLimit: 5 },
    { key: 'in_review', title: 'In Review', color: 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/30', wipLimit: 3 },
    { key: 'blocked', title: 'Blocked', color: 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30', wipLimit: 2 },
    { key: 'done', title: 'Done', color: 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30' },
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200';
      case 'medium':
        return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
      default:
        return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
    }
  };

  const sprintLabel = useMemo(() => {
    const s = sprints.find((x) => String(x.id) === String(selectedSprintId));
    return s ? s.name : "";
  }, [sprints, selectedSprintId]);

  const totalTasks = useMemo(() => Object.values(board).flat().length, [board]);
  const inProgressCount = useMemo(() => board.in_progress.length, [board.in_progress.length]);
  const completedCount = useMemo(() => board.done.length, [board.done.length]);
  const completionPct = useMemo(() => {
    if (!totalTasks) return 0;
    return Math.round((completedCount / totalTasks) * 100);
  }, [completedCount, totalTasks]);

  const filteredBoard = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (task: BoardTask) => {
      if (priorityFilter !== "all" && String(task.priority || "").toLowerCase() !== priorityFilter) return false;

      if (assigneeFilter === "assigned" && !task.assignee?.id) return false;
      if (assigneeFilter === "unassigned" && task.assignee?.id) return false;

      if (riskOnly && !task.aiRiskScore) return false;

      if (!q) return true;
      const hay = [task.title, task.assignee?.name || "", ...(task.techTags || [])].join(" ").toLowerCase();
      return hay.includes(q);
    };

    return {
      todo: board.todo.filter(matches),
      in_progress: board.in_progress.filter(matches),
      in_review: board.in_review.filter(matches),
      blocked: board.blocked.filter(matches),
      done: board.done.filter(matches),
    };
  }, [assigneeFilter, board, priorityFilter, query, riskOnly]);

  const filteredTotalTasks = useMemo(() => Object.values(filteredBoard).flat().length, [filteredBoard]);

  function applyPreset(preset: TaskFilterPreset) {
    setQuery(preset.query);
    setPriorityFilter(preset.priority);
    setAssigneeFilter(preset.assignee);
    setRiskOnly(Boolean(preset.riskOnly));
  }

  function saveCurrentPreset() {
    const name = newFilterName.trim();
    if (!name) return;
    const next: TaskFilterPreset = {
      id: crypto.randomUUID(),
      name,
      query,
      priority: priorityFilter,
      assignee: assigneeFilter,
      riskOnly,
    };
    setSavedFilters((prev) => {
      const updated = [next, ...prev].slice(0, 10);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TASK_FILTER_PRESETS_KEY, JSON.stringify(updated));
      }
      return updated;
    });
    setNewFilterName("");
  }

  function deletePreset(id: string) {
    setSavedFilters((prev) => {
      const updated = prev.filter((x) => x.id !== id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(TASK_FILTER_PRESETS_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }

  const loadSprints = useCallback(async () => {
    setError(null);
    setLoading(true);
    setShowCreateTask(false);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskStoryPoints("");
    try {
      const respActive = await fetch(`/api/sprints?${new URLSearchParams({ status: "active" }).toString()}`, { cache: "no-store" });
      const dataActive = await respActive.json().catch(() => null);
      if (!respActive.ok) throw new Error(String(dataActive?.error || "Failed to load sprints"));

      let items = Array.isArray(dataActive?.items) ? (dataActive.items as SprintListItem[]) : [];
      if (!items.length) {
        const respPlanning = await fetch(`/api/sprints?${new URLSearchParams({ status: "planning" }).toString()}`, { cache: "no-store" });
        const dataPlanning = await respPlanning.json().catch(() => null);
        if (respPlanning.ok) items = Array.isArray(dataPlanning?.items) ? (dataPlanning.items as SprintListItem[]) : [];
      }

      setSprints(items);
      if (!selectedSprintId && items.length) setSelectedSprintId(String(items[0].id));
    } catch (e) {
      setSprints([]);
      setSelectedSprintId("");
      setError(e instanceof Error ? e.message : "Failed to load sprints");
    } finally {
      setLoading(false);
    }
  }, [selectedSprintId]);

  const loadBoard = useCallback(async (sprintId: string) => {
    setError(null);
    setLoading(true);
    setShowCreateTask(false);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskStoryPoints("");
    try {
      const resp = await fetch(`/api/tasks/board/${encodeURIComponent(sprintId)}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to load board"));
      setBoard({
        todo: Array.isArray(data?.todo) ? (data.todo as BoardTask[]) : [],
        in_progress: Array.isArray(data?.in_progress) ? (data.in_progress as BoardTask[]) : [],
        in_review: Array.isArray(data?.in_review) ? (data.in_review as BoardTask[]) : [],
        blocked: Array.isArray(data?.blocked) ? (data.blocked as BoardTask[]) : [],
        done: Array.isArray(data?.done) ? (data.done as BoardTask[]) : [],
      });
    } catch (e) {
      setBoard({ todo: [], in_progress: [], in_review: [], blocked: [], done: [] });
      setError(e instanceof Error ? e.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  async function createTask() {
    if (!selectedSprintId) return;
    setError(null);
    setCreatingTask(true);
    try {
      const sprint = sprints.find((s) => String(s.id) === String(selectedSprintId));
      const projectId = sprint?.projectId;
      if (!projectId) throw new Error("Missing projectId for selected sprint");

      const storyPoints = newTaskStoryPoints === "" ? 0 : Number(newTaskStoryPoints);
      const resp = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          sprintId: selectedSprintId,
          title: newTaskTitle,
          description: newTaskDescription || undefined,
          storyPoints,
        }),
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to create task"));

      await loadBoard(selectedSprintId);
      setShowCreateTask(false);
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskStoryPoints("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setCreatingTask(false);
    }
  }

  async function updateTaskStatus(taskId: string, status: keyof Board) {
    setError(null);
    setUpdatingTaskId(taskId);
    try {
      const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Status update failed"));
      if (selectedSprintId) await loadBoard(selectedSprintId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function archiveTask(taskId: string) {
    if (!confirm("Archive this task?")) return;
    setError(null);
    setUpdatingTaskId(taskId);
    try {
      const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to archive task"));
      if (selectedSprintId) await loadBoard(selectedSprintId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive task");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function deleteTaskPermanent(taskId: string) {
    if (!confirm("Delete this task permanently? This cannot be undone.")) return;
    setError(null);
    setUpdatingTaskId(taskId);
    try {
      const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}?hard=true`, {
        method: "DELETE",
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to delete task"));
      if (selectedSprintId) await loadBoard(selectedSprintId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete task");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  const TaskCard = ({ task }: { task: BoardTask }) => (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-sm border border-slate-200 dark:border-zinc-800 mb-3 hover:shadow-md transition">
      <div className="flex items-start justify-between mb-2 gap-2">
        <h4 className="font-medium text-slate-900 dark:text-white text-sm flex-1">{task.title}</h4>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getPriorityColor(String(task.priority || 'medium'))}`}>
          {String(task.priority || 'medium')}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-600 dark:text-slate-400">#{String(task.id).slice(0, 8)}</span>
        <span className="font-bold text-blue-600 dark:text-blue-400">{Number(task.storyPoints || 0)}pt</span>
      </div>
      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-zinc-800 flex flex-col items-stretch gap-2">
        <p className="text-xs text-slate-600 dark:text-slate-400 flex-1">
          {task.assignee?.name ? `👤 ${task.assignee.name}` : "Unassigned"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="flex-1 min-w-24 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 text-xs"
            value={""}
            onChange={(e) => {
              const next = e.target.value as keyof Board;
              if (!next) return;
              void updateTaskStatus(String(task.id), next);
              e.currentTarget.value = "";
            }}
            disabled={updatingTaskId === task.id}
          >
            <option value="">Move…</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
          <button
            type="button"
            onClick={() => void archiveTask(String(task.id))}
            className="px-2 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs hover:bg-amber-50 dark:hover:bg-amber-950"
            disabled={updatingTaskId === task.id}
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => void deleteTaskPermanent(String(task.id))}
            className="px-2 py-1 rounded border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-xs hover:bg-red-50 dark:hover:bg-red-950"
            disabled={updatingTaskId === task.id}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    void loadSprints();
  }, [loadSprints]);

  useEffect(() => {
    if (selectedSprintId) void loadBoard(selectedSprintId);
  }, [selectedSprintId, loadBoard]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TASK_FILTER_PRESETS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TaskFilterPreset[];
      if (Array.isArray(parsed)) setSavedFilters(parsed);
    } catch {
      setSavedFilters([]);
    }
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Task Board</h1>
            <p className="text-slate-600 dark:text-slate-300">Sprint Planning & Task Tracking</p>
          </div>
          <button
            onClick={() => setShowCreateTask((v) => !v)}
            title={!selectedSprintId ? "Create/select a sprint first" : ""}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={!selectedSprintId || loading}
          >
            <Plus className="w-5 h-5" />
            {showCreateTask ? "Cancel" : "New Task"}
          </button>
        </div>

        {/* Sprint Picker */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Sprint</label>
            <select
              className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
              value={selectedSprintId}
              onChange={(e) => setSelectedSprintId(e.target.value)}
              disabled={loading || !sprints.length}
            >
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!sprints.length && (
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                <p>No active/planning sprints found.</p>
                <p className="mt-1">
                  Create one in{" "}
                  <Link href="/sprint_plan" className="text-blue-600 dark:text-blue-400 underline">
                    Sprint Planner
                  </Link>
                  {" "}then come back to add tasks.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-slate-200 dark:border-zinc-800 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Selected</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{sprintLabel || "—"}</p>
            </div>
            <button
              onClick={() => void loadSprints()}
              className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              disabled={loading}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Filter Bar */}
        <div className="mb-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Quick filters</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <input
              className="md:col-span-2 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, assignee, tags"
            />
            <select
              className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as "all" | "high" | "medium" | "low")}
            >
              <option value="all">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as "all" | "assigned" | "unassigned")}
            >
              <option value="all">Any assignee</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded border border-slate-200 dark:border-zinc-800 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} />
              Risk only
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              placeholder="Save current filter as..."
              className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800"
            />
            <button
              type="button"
              onClick={saveCurrentPreset}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded font-semibold text-sm disabled:opacity-60"
              disabled={!newFilterName.trim()}
            >
              Save filter
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPriorityFilter("all");
                setAssigneeFilter("all");
                setRiskOnly(false);
              }}
              className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded border border-slate-200 dark:border-zinc-800 text-sm"
            >
              Clear filters
            </button>
          </div>

          {savedFilters.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {savedFilters.map((preset) => (
                <div key={preset.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-zinc-800 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(preset.id)}
                    className="text-xs text-red-700 dark:text-red-300 px-1"
                    aria-label={`Delete ${preset.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {showCreateTask && (
          <div className="mb-6 bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Create Task</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Title</label>
                <input
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Implement login"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Story points</label>
                <input
                  type="number"
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newTaskStoryPoints}
                  onChange={(e) => setNewTaskStoryPoints(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="0"
                  min={0}
                  step={1}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Description (optional)</label>
                <textarea
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newTaskDescription}
                  onChange={(e) => setNewTaskDescription(e.target.value)}
                  placeholder="Acceptance criteria…"
                  rows={3}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => void createTask()}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-60"
                disabled={!selectedSprintId || !newTaskTitle || creatingTask}
              >
                {creatingTask ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => setShowCreateTask(false)}
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                disabled={creatingTask}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Kanban Board */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {columns.map((column) => {
            const columnKey = column.key as keyof Board;
            const columnItems = filteredBoard[columnKey];
            const rawColumnCount = board[columnKey].length;
            const limitExceeded = Boolean(column.wipLimit && rawColumnCount > column.wipLimit);

            return (
            <div key={column.key} className={`${column.color} rounded-lg p-4 min-h-96`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-white">{column.title}</h2>
                <span className="bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-white text-xs font-bold px-2 py-1 rounded">
                  {columnItems.length}
                </span>
              </div>
              {limitExceeded ? (
                <div className="mb-3 rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
                  WIP limit exceeded ({rawColumnCount}/{column.wipLimit})
                </div>
              ) : null}
              <div>
                {columnItems.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
              <button
                onClick={() => setShowCreateTask(true)}
                title={!selectedSprintId ? "Create/select a sprint first" : ""}
                className="w-full mt-4 py-2 border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-white hover:dark:bg-slate-700 transition text-sm font-medium disabled:cursor-not-allowed"
                disabled={!selectedSprintId || loading}
              >
                + Add Task
              </button>
            </div>
          );})}
        </div>

        {/* Sprint Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Total Tasks</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {totalTasks}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Filtered: {filteredTotalTasks}</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">In Progress</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {inProgressCount}
            </p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Completed</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {completedCount}
            </p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Completion</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {completionPct}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
