"use client";

import { useEffect, useMemo, useState } from "react";
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

  const columns = [
    { key: 'todo', title: 'To Do', color: 'bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800' },
    { key: 'in_progress', title: 'In Progress', color: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30' },
    { key: 'in_review', title: 'In Review', color: 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/30' },
    { key: 'blocked', title: 'Blocked', color: 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30' },
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

  async function loadSprints() {
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
  }

  async function loadBoard(sprintId: string) {
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
  }

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
      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-600 dark:text-slate-400 flex-1">
          {task.assignee?.name ? `👤 ${task.assignee.name}` : "Unassigned"}
        </p>
        <select
          className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-2 py-1 rounded border border-slate-200 dark:border-zinc-800 text-xs"
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
      </div>
    </div>
  );

  useEffect(() => {
    void loadSprints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedSprintId) void loadBoard(selectedSprintId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSprintId]);

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
        <div className="mb-6 flex gap-2">
          <button className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
            <Filter className="w-4 h-4" />
            Filter
          </button>
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
          {columns.map((column) => (
            <div key={column.key} className={`${column.color} rounded-lg p-4 min-h-96`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-white">{column.title}</h2>
                <span className="bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-white text-xs font-bold px-2 py-1 rounded">
                  {board[column.key as keyof Board].length}
                </span>
              </div>
              <div>
                {board[column.key as keyof Board].map((task) => (
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
          ))}
        </div>

        {/* Sprint Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Total Tasks</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {totalTasks}
            </p>
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
