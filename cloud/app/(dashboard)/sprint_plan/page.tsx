"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Plus, Archive, Trash2 } from 'lucide-react';
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
  id?: string;
  title: string;
  description?: string;
  story_points?: number;
  storyPoints?: number;
  tech_tags?: string[];
  priority?: string;
};

type PlanResult = {
  sprintId: string;
  projectId?: string;
  sprintName?: string;
  warning?: string | null;
  createdTasks: PlannedTask[];
  assignmentResults?: Array<{
    taskId?: string;
    developerId?: string | null;
    ok?: boolean;
  }>;
  githubIssueResults?: Array<{
    taskId?: string;
    ok?: boolean;
    issue?: { htmlUrl?: string; number?: number };
  }>;
};

type DeveloperListItem = {
  id: string;
  fullName?: string;
  name?: string;
};

export default function SprintPlannerPage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [planningSprints, setPlanningSprints] = useState<SprintListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [sprintDescription, setSprintDescription] = useState("");
  const [developers, setDevelopers] = useState<DeveloperListItem[]>([]);
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

  const developerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of developers) {
      map.set(String(d.id), String(d.fullName || d.name || "Developer"));
    }
    return map;
  }, [developers]);

  const assignedByTaskId = useMemo(() => {
    const map = new Map<string, string>();
    const rows = Array.isArray(planResult?.assignmentResults) ? planResult.assignmentResults : [];
    for (const row of rows) {
      const taskId = String(row?.taskId || "");
      const developerId = String(row?.developerId || "");
      if (!taskId || !developerId || row?.ok === false) continue;
      map.set(taskId, developerId);
    }
    return map;
  }, [planResult]);

  const blockingAction = planning || creatingProject || creatingSprint || actingOnSprint;

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
      if (data?.requiresOrgSetup) {
        setError(String(data?.upstreamError || "Tenant database is not ready yet. Create or provision the org database, then refresh."));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  async function loadDevelopers() {
    try {
      const resp = await fetch("/api/developers", { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) return;
      const items = Array.isArray(data?.items) ? (data.items as DeveloperListItem[]) : [];
      setDevelopers(items);
    } catch {
      setDevelopers([]);
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
      if (data?.requiresOrgSetup) {
        setError(String(data?.upstreamError || "Tenant database is not ready yet. Create or provision the org database, then refresh."));
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
    if (!sprintDescription.trim()) {
      setError("Sprint description is required to generate AI tasks.");
      return;
    }
    setError(null);
    setPlanning(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    try {
      const resp = await fetch(`/api/sprints/${encodeURIComponent(selectedSprintId)}/agentic-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          projectDetails: sprintDescription.trim(),
          minTickets: 8,
          maxTickets: 8,
          mirrorToGithub: true,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Sprint planning failed"));
      setPlanResult(data as PlanResult);
    } catch (e) {
      setPlanResult(null);
      const message = e instanceof Error ? e.message : "Sprint planning failed";
      setError(/abort/i.test(message) ? "Planner timed out. Please retry with a shorter sprint description." : message);
    } finally {
      clearTimeout(timeoutId);
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
    void loadDevelopers();
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
      <BlockLoadingOverlay active={blockingAction} label="Loading sprint planner..." fullScreen={true} delayMs={420} />
      <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Sprint Planner</h1>
          <p className="text-slate-600 dark:text-slate-300">Plan next sprint from backlog with AI assistance</p>
          {loading && (
            <p className="mt-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-300">
              Loading projects and planning sprints...
            </p>
          )}
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
                disabled={!selectedProjectId || !selectedSprintId || !sprintDescription.trim() || planning || actingOnSprint}
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

        <div className="mb-6 bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Sprint Description</label>
          <textarea
            className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 min-h-[120px]"
            value={sprintDescription}
            onChange={(e) => setSprintDescription(e.target.value)}
            placeholder="Describe sprint goals, scope, constraints, and required outcomes. The planner will generate and auto-assign at least 8 tasks and mirror them to GitHub issues."
            disabled={planning || loading}
          />
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            Keep this focused for better AI output quality and lower token usage.
          </p>
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

        {!!planResult?.warning && (
          <div className="mb-6 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-800 dark:text-amber-200">{planResult.warning}</p>
          </div>
        )}
        
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Planned Tasks</h2>
          <div className="space-y-3 max-h-[560px] overflow-y-auto">
            {!planResult?.createdTasks?.length ? (
              <div className="p-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  Add sprint description and click <b>Run Planner</b> to generate at least 8 AI tasks, assign them to developers, and mirror them to GitHub.
                </p>
              </div>
            ) : (
              planResult.createdTasks.map((task, idx) => {
                const taskId = String(task.id || "");
                const points = Number(task.story_points ?? task.storyPoints ?? 0);
                const priority = String(task.priority || "medium").toLowerCase();
                const developerId = assignedByTaskId.get(taskId) || "";
                const assigneeName = developerId ? (developerNameById.get(developerId) || `Developer ${developerId.slice(0, 8)}`) : "Unassigned";
                const githubMirror = (planResult.githubIssueResults || []).find((x) => String(x?.taskId || "") === taskId);
                return (
                  <div
                    key={taskId || `${task.title}-${idx}`}
                    className="p-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:shadow-md transition"
                  >
                    <div className="flex items-start justify-between mb-2 gap-3">
                      <h3 className="font-semibold text-slate-900 dark:text-white">{task.title}</h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          priority === "critical" || priority === "high"
                            ? "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200"
                            : priority === "medium"
                              ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200"
                              : "bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200"
                        }`}
                      >
                        {priority}
                      </span>
                    </div>
                    {!!task.description && <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{task.description}</p>}
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-[var(--accent-blue)]">{Number.isFinite(points) ? Math.max(0, Math.round(points)) : 0} pts</span>
                      <span>Assignee: {assigneeName}</span>
                      <span>
                        GitHub: {githubMirror?.ok ? "Mirrored" : "Pending"}
                        {githubMirror?.issue?.htmlUrl && (
                          <a href={githubMirror.issue.htmlUrl} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 dark:text-blue-400 underline">
                            issue #{githubMirror.issue.number || ""}
                          </a>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-zinc-800">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {planResult
                ? `Generated ${planResult.createdTasks.length} tasks for sprint ${planResult.sprintName || selectedSprint?.name || ""}.`
                : "Select a project and planning sprint, add sprint description, then run planner."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
