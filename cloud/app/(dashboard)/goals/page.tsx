"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type GoalStatus = "planned" | "in_progress" | "completed";
type Priority = "high" | "medium" | "low";

type Goal = {
  id: string;
  title: string;
  description?: string | null;
  status: GoalStatus;
  priority: Priority;
  quarter?: string | null;
  category?: string | null;
  dueDate?: string | null;
  progress: number;
  projectId?: string | null;
  projectName?: string | null;
  keyResults?: string[];
  activityLog?: Array<{ at?: string; action?: string; by?: string | null; detail?: string }>;
  assignees?: Array<{ id: string; name?: string; email?: string }>;
  sprints?: Array<{ id: string; name?: string }>;
  repos?: Array<{ id?: string; name?: string; fullName?: string }>;
  taskProgress?: { total: number; completed: number };
};

type Member = { id: string; fullName?: string; email?: string; role?: string };
type Project = { id: string; name: string };
type Sprint = { id: string; name: string; projectId?: string };
type Repo = { id?: number | string; name?: string | null; fullName?: string | null; language?: string | null; private?: boolean };

type CreateGoalState = {
  title: string;
  description: string;
  priority: Priority;
  quarter: string;
  category: string;
  dueDate: string;
  assigneeIds: string[];
  projectId: string;
  sprintIds: string[];
  selectedRepoFullNames: string[];
  status: GoalStatus;
};

function qFromDate(date = new Date()): string {
  const month = date.getMonth() + 1;
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function priorityDot(priority: Priority): string {
  if (priority === "high") return "bg-red-500";
  if (priority === "medium") return "bg-amber-400";
  return "bg-emerald-500";
}

function toPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 animate-pulse">
          <div className="h-5 w-3/4 rounded bg-[var(--bg-hover)]" />
          <div className="mt-3 h-4 w-full rounded bg-[var(--bg-hover)]" />
          <div className="mt-2 h-4 w-2/3 rounded bg-[var(--bg-hover)]" />
          <div className="mt-4 h-2 w-full rounded bg-[var(--bg-hover)]" />
          <div className="mt-4 h-6 w-1/3 rounded bg-[var(--bg-hover)]" />
        </div>
      ))}
    </div>
  );
}

export default function GoalsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);

  const [tab, setTab] = useState<"all" | "mine" | "team" | "quarter">("all");
  const [sortBy, setSortBy] = useState<"due" | "priority" | "progress">("due");

  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [newGoal, setNewGoal] = useState<CreateGoalState>({
    title: "",
    description: "",
    priority: "medium",
    quarter: qFromDate(),
    category: "Feature",
    dueDate: "",
    assigneeIds: [],
    projectId: "",
    sprintIds: [],
    selectedRepoFullNames: [],
    status: "planned",
  });

  const [drawerGoalId, setDrawerGoalId] = useState<string | null>(null);
  const drawerGoal = useMemo(() => goals.find((g) => g.id === drawerGoalId) || null, [goals, drawerGoalId]);
  const [krInput, setKrInput] = useState("");
  const [dragGoalId, setDragGoalId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const goalsQs = tab === "mine" ? "?mine=true" : tab === "quarter" ? `?quarter=${encodeURIComponent(qFromDate())}` : "";

    const [gResp, mResp, pResp, sResp, rResp, gsResp] = await Promise.all([
      fetchJson<{ items?: Goal[] }>(`/api/goals${goalsQs}`),
      fetchJson<{ members?: Member[] }>("/api/org/members?page=1&limit=200"),
      fetchJson<{ items?: Project[] }>("/api/projects"),
      fetchJson<{ items?: Sprint[] }>("/api/sprints"),
      fetchJson<Repo[]>("/api/integrations/github/repos?all=1"),
      fetchJson<{ connected?: boolean }>("/api/integrations/github/status"),
    ]);

    if (!gResp.ok) {
      setError(asText((gResp.data as { error?: string } | null)?.error) || `Failed to load goals (${gResp.status})`);
      setGoals([]);
    } else {
      setGoals(Array.isArray(gResp.data?.items) ? gResp.data!.items : []);
    }

    setMembers(Array.isArray(mResp.data?.members) ? mResp.data!.members : []);
    setProjects(Array.isArray(pResp.data?.items) ? pResp.data!.items : []);
    setSprints(Array.isArray(sResp.data?.items) ? sResp.data!.items : []);
    setRepos(Array.isArray(rResp.data) ? rResp.data : []);
    setGithubConnected(Boolean(gsResp.data?.connected));

    setLoading(false);
  }, [tab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadAll]);

  const filtered = useMemo(() => {
    let items = [...goals];
    if (tab === "team") {
      items = items.filter((g) => (g.assignees || []).length > 1);
    }
    if (sortBy === "due") {
      items.sort((a, b) => new Date(a.dueDate || "2999-12-31").getTime() - new Date(b.dueDate || "2999-12-31").getTime());
    }
    if (sortBy === "progress") {
      items.sort((a, b) => toPercent(b.progress) - toPercent(a.progress));
    }
    if (sortBy === "priority") {
      const rank: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
      items.sort((a, b) => rank[b.priority] - rank[a.priority]);
    }
    return items;
  }, [goals, sortBy, tab]);

  const columns = useMemo(() => {
    return {
      planned: filtered.filter((g) => g.status === "planned"),
      in_progress: filtered.filter((g) => g.status === "in_progress"),
      completed: filtered.filter((g) => g.status === "completed"),
    };
  }, [filtered]);

  const stats = useMemo(() => {
    const total = goals.length;
    const onTrack = goals.filter((g) => toPercent(g.progress) >= 50 && g.status !== "completed").length;
    const atRisk = goals.filter((g) => toPercent(g.progress) < 50 && g.status !== "completed").length;
    const completed = goals.filter((g) => g.status === "completed").length;
    return { total, onTrack, atRisk, completed };
  }, [goals]);

  function resetNewGoal(status: GoalStatus = "planned") {
    setNewGoal({
      title: "",
      description: "",
      priority: "medium",
      quarter: qFromDate(),
      category: "Feature",
      dueDate: "",
      assigneeIds: [],
      projectId: "",
      sprintIds: [],
      selectedRepoFullNames: [],
      status,
    });
  }

  async function createGoal() {
    if (!newGoal.title.trim()) {
      setError("Title is required");
      return;
    }

    setSaving(true);
    setError(null);

    const selectedRepos = repos
      .filter((r) => newGoal.selectedRepoFullNames.includes(String(r.fullName || "")))
      .map((r) => ({
        fullName: String(r.fullName || ""),
        name: String(r.name || ""),
        language: String(r.language || "") || undefined,
        private: Boolean(r.private),
      }));

    const payload = {
      title: newGoal.title.trim(),
      description: newGoal.description.trim() || undefined,
      status: newGoal.status,
      priority: newGoal.priority,
      quarter: newGoal.quarter,
      category: newGoal.category,
      dueDate: newGoal.dueDate || undefined,
      projectId: newGoal.projectId || undefined,
      assigneeIds: newGoal.assigneeIds,
      sprintIds: newGoal.sprintIds,
      repos: selectedRepos,
      keyResults: [],
    };

    const resp = await fetchJson<{ goal?: Goal; error?: string }>("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!resp.ok) {
      setError(asText(resp.data?.error) || `Create failed (${resp.status})`);
      return;
    }

    setNewGoalOpen(false);
    resetNewGoal();
    await loadAll();
  }

  async function moveGoal(goalId: string, status: GoalStatus) {
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, status } : g)));
    const resp = await fetchJson<{ item?: Goal; error?: string }>(`/api/goals/${encodeURIComponent(goalId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!resp.ok) {
      setError(asText(resp.data?.error) || `Status update failed (${resp.status})`);
      await loadAll();
    }
  }

  async function updateDrawerGoal(patch: Record<string, unknown>) {
    if (!drawerGoalId) return;
    const resp = await fetchJson<{ item?: Goal; error?: string }>(`/api/goals/${encodeURIComponent(drawerGoalId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) {
      setError(asText(resp.data?.error) || `Update failed (${resp.status})`);
      return;
    }
    await loadAll();
  }

  async function addKr() {
    if (!drawerGoal || !krInput.trim()) return;
    const next = [...(drawerGoal.keyResults || []), krInput.trim()];
    setKrInput("");
    await updateDrawerGoal({ keyResults: next });
  }

  async function removeKr(index: number) {
    if (!drawerGoal) return;
    const next = (drawerGoal.keyResults || []).filter((_, i) => i !== index);
    await updateDrawerGoal({ keyResults: next });
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] px-4 py-6 text-[var(--text-primary)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Goals</h1>
            <TabButton active={tab === "all"} onClick={() => setTab("all")} label="All" />
            <TabButton active={tab === "mine"} onClick={() => setTab("mine")} label="My goals" />
            <TabButton active={tab === "team"} onClick={() => setTab("team")} label="Team" />
            <TabButton active={tab === "quarter"} onClick={() => setTab("quarter")} label="This quarter" />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as "due" | "priority" | "progress")}
              className="rounded-lg border border-[var(--border-strong)] bg-[var(--bg-hover)] px-3 py-2 text-sm"
            >
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="progress">Sort: Progress</option>
            </select>
            <button
              type="button"
              onClick={() => {
                resetNewGoal("planned");
                setNewGoalOpen(true);
              }}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)]"
            >
              + New goal
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total goals" value={stats.total} detail={`across ${Math.max(1, sprints.length)} sprints`} />
          <StatCard label="On track" value={stats.onTrack} detail={`${goals.length ? Math.round((stats.onTrack / goals.length) * 100) : 0}% of goals`} accent="text-emerald-400" />
          <StatCard label="At risk" value={stats.atRisk} detail="needs attention" accent="text-amber-400" />
          <StatCard label="Completed" value={stats.completed} detail="this quarter" />
        </div>

        {error ? <div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {loading ? (
            <div className="lg:col-span-3">
              <SkeletonCards />
            </div>
          ) : (
            <>
              <GoalColumn
                title="PLANNED"
                count={columns.planned.length}
                status="planned"
                goals={columns.planned}
                onCardClick={setDrawerGoalId}
                onDropGoal={moveGoal}
                onDragStart={setDragGoalId}
                dragGoalId={dragGoalId}
                onAdd={() => {
                  resetNewGoal("planned");
                  setNewGoalOpen(true);
                }}
              />
              <GoalColumn
                title="IN PROGRESS"
                count={columns.in_progress.length}
                status="in_progress"
                goals={columns.in_progress}
                onCardClick={setDrawerGoalId}
                onDropGoal={moveGoal}
                onDragStart={setDragGoalId}
                dragGoalId={dragGoalId}
                onAdd={() => {
                  resetNewGoal("in_progress");
                  setNewGoalOpen(true);
                }}
              />
              <GoalColumn
                title="COMPLETED"
                count={columns.completed.length}
                status="completed"
                goals={columns.completed}
                onCardClick={setDrawerGoalId}
                onDropGoal={moveGoal}
                onDragStart={setDragGoalId}
                dragGoalId={dragGoalId}
                onAdd={() => {
                  resetNewGoal("completed");
                  setNewGoalOpen(true);
                }}
              />
            </>
          )}
        </div>
      </div>

      {newGoalOpen ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-6 sm:items-center">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <div className="mb-4 text-lg font-semibold">New Goal</div>
            <div className="grid max-h-[calc(92vh-130px)] grid-cols-1 gap-3 overflow-y-auto overflow-x-hidden pr-1 md:grid-cols-2">
              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Title *</div>
                <input value={newGoal.title} onChange={(e) => setNewGoal((p) => ({ ...p, title: e.target.value }))} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm" />
              </label>
              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Description</div>
                <textarea value={newGoal.description} onChange={(e) => setNewGoal((p) => ({ ...p, description: e.target.value }))} rows={3} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm" />
              </label>
              <label>
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Priority</div>
                <select value={newGoal.priority} onChange={(e) => setNewGoal((p) => ({ ...p, priority: e.target.value as Priority }))} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Quarter</div>
                <select value={newGoal.quarter} onChange={(e) => setNewGoal((p) => ({ ...p, quarter: e.target.value }))} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm">
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="Q4">Q4</option>
                </select>
              </label>
              <label>
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Category</div>
                <select value={newGoal.category} onChange={(e) => setNewGoal((p) => ({ ...p, category: e.target.value }))} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm">
                  <option value="Infra">Infra</option>
                  <option value="Feature">Feature</option>
                  <option value="Growth">Growth</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label>
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Due date</div>
                <input type="date" value={newGoal.dueDate} onChange={(e) => setNewGoal((p) => ({ ...p, dueDate: e.target.value }))} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm" />
              </label>
              <label>
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Project</div>
                <select value={newGoal.projectId} onChange={(e) => setNewGoal((p) => ({ ...p, projectId: e.target.value }))} className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm">
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Assign team members</div>
                <div className="max-h-28 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] p-2">
                  {members.map((member) => {
                    const checked = newGoal.assigneeIds.includes(member.id);
                    return (
                      <label key={member.id} className="flex items-center gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setNewGoal((prev) => ({
                              ...prev,
                              assigneeIds: e.target.checked
                                ? [...prev.assigneeIds, member.id]
                                : prev.assigneeIds.filter((id) => id !== member.id),
                            }));
                          }}
                        />
                        <span>{member.fullName || member.email || member.id}</span>
                      </label>
                    );
                  })}
                </div>
              </label>

              <label className="md:col-span-2">
                <div className="mb-1 text-xs text-[var(--text-secondary)]">Link sprints</div>
                <div className="max-h-28 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] p-2">
                  {sprints
                    .filter((s) => !newGoal.projectId || String(s.projectId || "") === String(newGoal.projectId))
                    .map((sprint) => {
                      const checked = newGoal.sprintIds.includes(sprint.id);
                      return (
                        <label key={sprint.id} className="flex items-center gap-2 py-1 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setNewGoal((prev) => ({
                                ...prev,
                                sprintIds: e.target.checked
                                  ? [...prev.sprintIds, sprint.id]
                                  : prev.sprintIds.filter((id) => id !== sprint.id),
                              }));
                            }}
                          />
                          <span>{sprint.name}</span>
                        </label>
                      );
                    })}
                </div>
              </label>

              {githubConnected ? (
                <label className="md:col-span-2">
                  <div className="mb-1 text-xs text-[var(--text-secondary)]">Link GitHub repos</div>
                  <div className="max-h-28 overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] p-2">
                    {repos.map((repo) => {
                      const fullName = String(repo.fullName || "");
                      const checked = newGoal.selectedRepoFullNames.includes(fullName);
                      return (
                        <label key={fullName} className="flex items-center gap-2 py-1 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setNewGoal((prev) => ({
                                ...prev,
                                selectedRepoFullNames: e.target.checked
                                  ? [...prev.selectedRepoFullNames, fullName]
                                  : prev.selectedRepoFullNames.filter((v) => v !== fullName),
                              }));
                            }}
                          />
                          <span>{fullName || repo.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </label>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => setNewGoalOpen(false)}>
                Cancel
              </button>
              <button className="rounded-md border border-[var(--text-primary)] bg-[var(--text-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-inverse)]" onClick={() => void createGoal()} disabled={saving}>
                {saving ? "Creating..." : "Create goal"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {drawerGoal ? (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md border-l border-[var(--border)] bg-[var(--bg-modal)] p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{drawerGoal.title}</h2>
            <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setDrawerGoalId(null)}>
              Close
            </button>
          </div>

          <div className="mt-4 space-y-4 overflow-auto pb-8">
            <section>
              <div className="mb-1 text-xs text-[var(--text-secondary)]">Description</div>
              <textarea
                value={drawerGoal.description || ""}
                onChange={(e) => {
                  setGoals((prev) => prev.map((g) => (g.id === drawerGoal.id ? { ...g, description: e.target.value } : g)));
                }}
                onBlur={(e) => void updateDrawerGoal({ description: e.target.value })}
                rows={4}
                className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm"
              />
            </section>

            <section>
              <div className="mb-1 text-xs text-[var(--text-secondary)]">Progress</div>
              {(drawerGoal.sprints || []).length ? (
                <div className="text-xs text-[var(--text-secondary)]">
                  Auto-calculated from linked sprint tasks: {drawerGoal.taskProgress?.completed || 0}/{drawerGoal.taskProgress?.total || 0}
                </div>
              ) : (
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={toPercent(drawerGoal.progress)}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setGoals((prev) => prev.map((g) => (g.id === drawerGoal.id ? { ...g, progress: next } : g)));
                  }}
                  onMouseUp={(e) => void updateDrawerGoal({ progress: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
              )}
            </section>

            <section>
              <div className="mb-1 text-xs text-[var(--text-secondary)]">Key results</div>
              <div className="space-y-2">
                {(drawerGoal.keyResults || []).map((kr, idx) => (
                  <div key={`${kr}-${idx}`} className="flex items-center justify-between rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-sm">
                    <span>{kr}</span>
                    <button className="text-xs text-red-400" onClick={() => void removeKr(idx)}>
                      Remove
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input value={krInput} onChange={(e) => setKrInput(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-sm" placeholder="Add key result" />
                  <button onClick={() => void addKr()} className="rounded border border-[var(--border)] px-2 py-1 text-xs">
                    Add
                  </button>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-1 text-xs text-[var(--text-secondary)]">Linked sprints</div>
              <div className="space-y-1 text-sm">
                {(drawerGoal.sprints || []).length ? (drawerGoal.sprints || []).map((s) => <div key={s.id}>{s.name || s.id}</div>) : <div className="text-[var(--text-secondary)]">No linked sprints</div>}
              </div>
            </section>

            <section>
              <div className="mb-1 text-xs text-[var(--text-secondary)]">Linked repos</div>
              <div className="space-y-1 text-sm">
                {(drawerGoal.repos || []).length ? (drawerGoal.repos || []).map((r, i) => <div key={`${r.id || r.fullName}-${i}`}>{r.fullName || r.name}</div>) : <div className="text-[var(--text-secondary)]">No linked repos</div>}
              </div>
            </section>

            <section>
              <div className="mb-1 text-xs text-[var(--text-secondary)]">Activity log</div>
              <div className="space-y-2">
                {(drawerGoal.activityLog || []).slice(0, 8).map((a, i) => (
                  <div key={`${a.at || i}`} className="rounded border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                    <div>{a.detail || a.action || "Update"}</div>
                    <div className="text-[var(--text-secondary)]">{a.at ? new Date(a.at).toLocaleString() : ""}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm ${active ? "border-[var(--text-primary)] bg-[var(--bg-hover)]" : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"}`}
    >
      {label}
    </button>
  );
}

function StatCard({ label, value, detail, accent }: { label: string; value: number; detail: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${accent || ""}`}>{value}</div>
      <div className="text-xs text-[var(--text-secondary)]">{detail}</div>
    </div>
  );
}

function GoalColumn({
  title,
  count,
  status,
  goals,
  onCardClick,
  onDropGoal,
  onDragStart,
  dragGoalId,
  onAdd,
}: {
  title: string;
  count: number;
  status: GoalStatus;
  goals: Goal[];
  onCardClick: (goalId: string) => void;
  onDropGoal: (goalId: string, nextStatus: GoalStatus) => Promise<void>;
  onDragStart: (goalId: string | null) => void;
  dragGoalId: string | null;
  onAdd: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => {
        if (dragGoalId) void onDropGoal(dragGoalId, status);
        onDragStart(null);
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">{title}</div>
        <div className="text-xs text-[var(--text-secondary)]">{count}</div>
      </div>

      <div className="space-y-3">
        {goals.map((goal) => (
          <button
            key={goal.id}
            draggable
            onDragStart={() => onDragStart(goal.id)}
            onClick={() => onCardClick(goal.id)}
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-input)] p-3 text-left hover:bg-[var(--bg-hover)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="line-clamp-2 text-lg font-medium leading-tight text-[var(--text-primary)]">{goal.title}</div>
              <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${priorityDot(goal.priority)}`} />
            </div>
            <div className="mt-2 line-clamp-2 text-sm text-[var(--text-secondary)]">{goal.description || "No description"}</div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>Progress</span>
                <span>{toPercent(goal.progress)}%</span>
              </div>
              <div className="h-1.5 w-full rounded bg-[var(--bg-hover)]">
                <div className="h-1.5 rounded bg-[var(--goal-progress-fill)]" style={{ width: `${toPercent(goal.progress)}%` }} />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs">
              <div className="rounded-full border border-[var(--border)] bg-[var(--bg-hover)] px-2 py-0.5 text-[var(--text-secondary)]">{goal.quarter || goal.category || "Goal"}</div>
              <div className="text-[var(--text-secondary)]">{goal.dueDate ? new Date(goal.dueDate).toLocaleDateString() : "No due date"}</div>
            </div>

            <div className="mt-3 flex items-center gap-1">
              <AssigneeDots assignees={goal.assignees || []} />
            </div>
          </button>
        ))}

        <button onClick={onAdd} className="w-full rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-card)]">
          + Add goal
        </button>
      </div>
    </div>
  );
}

function AssigneeDots({ assignees }: { assignees: Array<{ id: string; name?: string; email?: string }> }) {
  const visible = assignees.slice(0, 3);
  const overflow = assignees.length - visible.length;
  return (
    <>
      {visible.map((a) => {
        const raw = a.name || a.email || "NA";
        const initials = raw
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map((v) => v[0]?.toUpperCase() || "")
          .join("") || "NA";
        return (
          <span key={a.id} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--goal-avatar-bg)] text-[10px] font-semibold text-[var(--text-inverse)]">
            {initials}
          </span>
        );
      })}
      {overflow > 0 ? <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--goal-avatar-overflow-bg)] text-[10px] font-semibold text-[var(--text-inverse)]">+{overflow}</span> : null}
    </>
  );
}

