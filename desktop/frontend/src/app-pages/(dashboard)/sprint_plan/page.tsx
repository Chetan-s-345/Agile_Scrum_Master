"use client";

import { useEffect, useMemo, useState } from "react";
import { Users, Check, RefreshCw, Plus, Archive, Trash2 } from 'lucide-react';
import { BlockLoadingOverlay } from "@/components/block-loading-overlay";

type ProjectListItem = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  memberCount?: number;
  completedSprints?: number;
  techStack?: string[];
  activeSprint?: { id: string; name: string; sprintNumber?: number; startDate?: string; endDate?: string } | null;
};

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

type PlannedTask = {
  id: string;
  sprint_id: string;
  project_id: string;
  title: string;
  story_points: number;
  tech_tags: string[];
  priority: string;
};

type TeamBreakdownItem = {
  developerId: string;
  name: string;
  availabilityStatus: string;
  maxCapacity: number;
  currentLoad: number;
  availableCapacity: number;
};

type PlanResult = {
  sprintId: string;
  selectedTasks: PlannedTask[];
  totalPoints: number;
  capacityUsed: number;
  teamBreakdown: TeamBreakdownItem[];
};

export default function SprintPlannerPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [planningSprints, setPlanningSprints] = useState<SprintListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newSprintName, setNewSprintName] = useState("");
  const [newSprintGoal, setNewSprintGoal] = useState("");
  const [newSprintStartDate, setNewSprintStartDate] = useState("");
  const [newSprintEndDate, setNewSprintEndDate] = useState("");
  const [creatingSprint, setCreatingSprint] = useState(false);
  const [actingOnSprint, setActingOnSprint] = useState(false);

  const capacityUsedPct = useMemo(() => {
    const v = Number(planResult?.capacityUsed ?? 0);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
  }, [planResult?.capacityUsed]);

  const getRiskColor = (capacityUsed: number) => {
    if (capacityUsed < 80) return 'text-green-600 dark:text-green-400';
    if (capacityUsed < 95) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  async function loadProjects() {
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch("/api/projects", { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to load projects"));

      const items = Array.isArray(data?.items) ? (data.items as ProjectListItem[]) : [];
      setProjects(items);
      if (!selectedProjectId && items.length) {
        setSelectedProjectId(String(items[0].id));
      }
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
      if (!resp.ok) throw new Error(String(data?.error || "Failed to load sprints"));

      const items = Array.isArray(data?.items) ? (data.items as SprintListItem[]) : [];
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

  async function runPlanner() {
    if (!selectedProjectId || !selectedSprintId) return;
    setError(null);
    setPlanning(true);
    try {
      const resp = await fetch(`/api/sprints/${encodeURIComponent(selectedSprintId)}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId }),
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Sprint planning failed"));
      setPlanResult(data as PlanResult);
    } catch (e) {
      setPlanResult(null);
      setError(e instanceof Error ? e.message : "Sprint planning failed");
    } finally {
      setPlanning(false);
    }
  }

  async function createSprint() {
    if (!selectedProjectId) return;
    setError(null);
    setCreatingSprint(true);
    try {
      const resp = await fetch("/api/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          name: newSprintName,
          goal: newSprintGoal || undefined,
          startDate: newSprintStartDate,
          endDate: newSprintEndDate,
        }),
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to create sprint"));

      const createdSprintId = String(data?.sprint?.id || "");
      await loadPlanningSprints(selectedProjectId);
      if (createdSprintId) setSelectedSprintId(createdSprintId);

      setShowCreateSprint(false);
      setNewSprintName("");
      setNewSprintGoal("");
      setNewSprintStartDate("");
      setNewSprintEndDate("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create sprint");
    } finally {
      setCreatingSprint(false);
    }
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    setError(null);
    setCreatingProject(true);
    try {
      const resp = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjectName.trim(),
          description: newProjectDescription.trim() || undefined,
        }),
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to create project"));

      const createdProjectId = String(data?.project?.id || "");
      await loadProjects();
      if (createdProjectId) setSelectedProjectId(createdProjectId);

      setShowCreateProject(false);
      setNewProjectName("");
      setNewProjectDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  }

  async function archiveSelectedSprint() {
    if (!selectedSprintId) return;
    const yes = window.confirm("Archive this sprint? It will be removed from planning view.");
    if (!yes) return;

    setError(null);
    setActingOnSprint(true);
    try {
      const resp = await fetch(`/api/sprints/${encodeURIComponent(selectedSprintId)}/archive`, {
        method: "PATCH",
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to archive sprint"));

      setPlanResult(null);
      await loadPlanningSprints(selectedProjectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive sprint");
    } finally {
      setActingOnSprint(false);
    }
  }

  async function deleteSelectedSprint() {
    if (!selectedSprintId) return;
    const yes = window.confirm("Delete this sprint? This action cannot be undone.");
    if (!yes) return;

    setError(null);
    setActingOnSprint(true);
    try {
      const resp = await fetch(`/api/sprints/${encodeURIComponent(selectedSprintId)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to delete sprint"));

      setPlanResult(null);
      await loadPlanningSprints(selectedProjectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete sprint");
    } finally {
      setActingOnSprint(false);
    }
  }

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPlanResult(null);
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

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <BlockLoadingOverlay active={loading || planning || creatingProject || creatingSprint || actingOnSprint} label="Loading sprint planner..." fullScreen={true} delayMs={420} />
      <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Sprint Planner</h1>
          <p className="text-slate-600 dark:text-slate-300">Plan next sprint from backlog with AI assistance</p>
        </div>

        {/* Controls */}
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Project</label>
            <select
              className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              disabled={loading || planning}
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
            <button
              onClick={() => setShowCreateProject((v) => !v)}
              className="w-full mt-3 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              disabled={loading || planning || creatingProject}
            >
              <Plus className="w-4 h-4" />
              {showCreateProject ? "Cancel" : "Create Project"}
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Planning Sprint</label>
            <select
              className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
              value={selectedSprintId}
              onChange={(e) => setSelectedSprintId(e.target.value)}
              disabled={loading || planning || !planningSprints.length}
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

            <button
              onClick={() => setShowCreateSprint((v) => !v)}
              className="w-full mt-3 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              disabled={!selectedProjectId || planning || loading}
            >
              <Plus className="w-4 h-4" />
              {showCreateSprint ? "Cancel" : "Create Sprint"}
            </button>
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-4 flex flex-col justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Selected</p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {selectedProject?.name || "—"} / {selectedSprint?.name || "—"}
              </p>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => void loadProjects()}
                className="flex-1 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                disabled={loading || planning}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={() => void runPlanner()}
                className="flex-1 bg-[var(--bg-card)] border border-[var(--border-strong)] text-[var(--text-primary)] font-semibold px-4 py-2 rounded-lg transition flex items-center justify-center gap-2 hover:bg-[var(--bg-hover)] disabled:opacity-60"
                disabled={!selectedProjectId || !selectedSprintId || planning || actingOnSprint}
              >
                <Check className="w-4 h-4" />
                {planning ? "Planning…" : "Run Planner"}
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => void archiveSelectedSprint()}
                className="flex-1 bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-strong)] px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--bg-hover)] transition disabled:opacity-60"
                disabled={!selectedSprintId || loading || planning || actingOnSprint}
              >
                <Archive className="w-4 h-4" />
                Archive Sprint
              </button>
              <button
                onClick={() => void deleteSelectedSprint()}
                className="flex-1 bg-[var(--bg-card)] text-[var(--accent-red)] border border-[var(--accent-red)]/40 px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--bg-hover)] transition disabled:opacity-60"
                disabled={!selectedSprintId || loading || planning || actingOnSprint}
              >
                <Trash2 className="w-4 h-4" />
                Delete Sprint
              </button>
            </div>
          </div>
        </div>

        {showCreateProject && (
          <div className="mb-6 bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Create Project</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Name</label>
                <input
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="New Project"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Description (optional)</label>
                <input
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Customer onboarding and workflow automation"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => void createProject()}
                className="bg-[var(--bg-card)] border border-[var(--border-strong)] text-[var(--text-primary)] font-semibold px-4 py-2 rounded-lg transition hover:bg-[var(--bg-hover)] disabled:opacity-60"
                disabled={!newProjectName.trim() || creatingProject}
              >
                {creatingProject ? "Creating…" : "Create Project"}
              </button>
              <button
                onClick={() => setShowCreateProject(false)}
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                disabled={creatingProject}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showCreateSprint && (
          <div className="mb-6 bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Create Planning Sprint</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Name</label>
                <input
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newSprintName}
                  onChange={(e) => setNewSprintName(e.target.value)}
                  placeholder="Sprint 1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Goal (optional)</label>
                <input
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newSprintGoal}
                  onChange={(e) => setNewSprintGoal(e.target.value)}
                  placeholder="Ship MVP task board"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Start date</label>
                <input
                  type="date"
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newSprintStartDate}
                  onChange={(e) => setNewSprintStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">End date</label>
                <input
                  type="date"
                  className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={newSprintEndDate}
                  onChange={(e) => setNewSprintEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => void createSprint()}
                className="bg-[var(--bg-card)] border border-[var(--border-strong)] text-[var(--text-primary)] font-semibold px-4 py-2 rounded-lg transition hover:bg-[var(--bg-hover)] disabled:opacity-60"
                disabled={!selectedProjectId || !newSprintName || !newSprintStartDate || !newSprintEndDate || creatingSprint}
              >
                {creatingSprint ? "Creating…" : "Create"}
              </button>
              <button
                onClick={() => setShowCreateSprint(false)}
                className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                disabled={creatingSprint}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}
        
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Planning Sprints</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{planningSprints.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Planned Tasks</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{planResult?.selectedTasks?.length || 0}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Points</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{planResult?.totalPoints || 0}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs text-slate-500 dark:text-slate-400">Capacity Usage</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{Math.round(capacityUsedPct)}%</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Planned Items */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Planned Tasks</h2>
              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-800/40">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                  <span>Planner Overview</span>
                  <span>{planResult?.selectedTasks?.length || 0} tasks • {planResult?.totalPoints || 0} pts</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-zinc-700">
                  <div className="h-full bg-[var(--accent-blue)]" style={{ width: `${capacityUsedPct}%` }} />
                </div>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {!planResult?.selectedTasks?.length ? (
                  <div className="p-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg">
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      Run the planner to generate tasks from backlog items marked as <b>ready</b>.
                    </p>
                  </div>
                ) : (
                  planResult.selectedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:shadow-md transition"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{task.title}</h3>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            task.priority === "high"
                              ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                              : task.priority === "medium"
                                ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200"
                                : "bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200"
                          }`}
                        >
                          {task.priority}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600 dark:text-slate-400">ID: #{task.id.slice(0, 8)}</span>
                        <span className="font-bold text-lg text-[var(--accent-blue)]">{Number(task.story_points || 0)} pts</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-zinc-800">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {planResult
                    ? `Planned ${planResult.selectedTasks.length} tasks for ${planResult.totalPoints} points.`
                    : "Select a project and planning sprint to begin."}
                </p>
              </div>
            </div>
          </div>

          {/* Team Capacity */}
          <div className="space-y-6">
            {/* Risk Score Card */}
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Sprint Risk Score</h3>
              <div className={`text-4xl font-bold mb-2 ${getRiskColor(capacityUsedPct)}`}>
                {Math.round(capacityUsedPct)}%
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 mb-3">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${capacityUsedPct}%` }}></div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">Capacity used by planned tasks</p>
            </div>

            {/* Team Capacity Bars */}
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5" />
                Team Capacity
              </h3>
              <div className="space-y-4">
                {Array.isArray(planResult?.teamBreakdown) && planResult!.teamBreakdown!.length ? (
                  planResult!.teamBreakdown!.map((dev) => {
                    const max = Math.max(1, Number(dev.maxCapacity || 0));
                    const used = Math.max(0, Math.min(max, Number(dev.currentLoad || 0)));
                    const pct = Math.max(0, Math.min(100, (used / max) * 100));
                    return (
                      <div key={dev.developerId}>
                        <div className="flex justify-between mb-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{dev.name}</span>
                          <span className="text-sm text-slate-600 dark:text-slate-400">{used}/{max}</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                          <div className="bg-[var(--accent-blue)] h-2 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-400">Run the planner to see capacity breakdown.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

