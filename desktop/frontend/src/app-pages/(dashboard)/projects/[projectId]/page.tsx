"use client";

import Link from "@/next-shims/link";
import { useParams } from "@/next-shims/navigation";
import { useEffect, useMemo, useState } from "react";

type Project = {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  status?: string;
  owner?: string;
  startDate?: string | null;
  endDate?: string | null;
  linkedRepos?: string[];
  github_repo?: string | null;
  jira_project_key?: string | null;
  tech_stack?: string[];
  stats?: { totalTasks?: number; openTasks?: number; completedTasks?: number };
  activityFeed?: Array<{ id: string; message: string; timestamp: string }>;
};

type ProjectMember = {
  memberId: string;
  fullName?: string;
  email?: string;
  role?: string;
};

type Sprint = {
  id: string;
  name: string;
  status?: string;
  startDate?: string;
  endDate?: string;
};

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }
  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(text(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }
  return response as T;
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = text(params?.projectId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "sprints" | "members" | "settings">("overview");
  const [newMember, setNewMember] = useState({ userId: "", role: "member" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!projectId) {
        setError("Missing project id");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [projectData, sprintData, memberData] = await Promise.all([
          invokeDesktop<Project>("projects:getById", { projectId }),
          invokeDesktop<Sprint[]>("projects:getSprints", { projectId }),
          invokeDesktop<ProjectMember[]>("projects:getMembers", { projectId })
        ]);

        if (cancelled) return;
        setProject(projectData || null);
        setSprints(Array.isArray(sprintData) ? sprintData : []);
        setMembers(Array.isArray(memberData) ? memberData : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load project");
        setProject(null);
        setSprints([]);
        setMembers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const tech = useMemo(() => (Array.isArray(project?.tech_stack) ? project.tech_stack : []), [project]);

  async function onAddMember() {
    setSaving(true);
    setError(null);
    try {
      const created = await invokeDesktop<ProjectMember>("projects:addMember", {
        projectId,
        userId: newMember.userId,
        role: newMember.role
      });
      setMembers((prev) => {
        const idx = prev.findIndex((item) => item.memberId === created.memberId);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = created;
          return copy;
        }
        return [...prev, created];
      });
      setNewMember({ userId: "", role: "member" });
      setNotice("Member added");
      window.setTimeout(() => setNotice(null), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setSaving(false);
    }
  }

  async function onUpdateProject(changes: Partial<Project>) {
    setSaving(true);
    setError(null);
    try {
      const updated = await invokeDesktop<Project>("projects:update", { projectId, changes });
      setProject(updated);
      setNotice("Project updated");
      window.setTimeout(() => setNotice(null), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setSaving(false);
    }
  }

  async function onArchiveProject() {
    setSaving(true);
    setError(null);
    try {
      await invokeDesktop<{ success: boolean }>("projects:archive", { projectId });
      setProject((prev) => (prev ? { ...prev, status: "archived" } : prev));
      setNotice("Project archived");
      window.setTimeout(() => setNotice(null), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{project?.name || "Project"}</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {project?.description || "Project overview and linked integrations."}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/backlog" className="rounded-lg border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white">
              Backlog
            </Link>
            <Link href="/sprint_plan" className="rounded-lg bg-slate-900 dark:bg-white px-3 py-2 text-sm font-semibold text-white dark:text-black">
              Sprint Plan
            </Link>
          </div>
        </div>

        {loading ? <div className="text-sm text-slate-600 dark:text-slate-300">Loading project...</div> : null}
        {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {notice ? <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

        {!loading && !error && project ? (
          <>
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("overview")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${activeTab === "overview" ? "bg-slate-900 text-white dark:bg-white dark:text-black" : "border border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-white"}`}
                >
                  Overview
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("sprints")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${activeTab === "sprints" ? "bg-slate-900 text-white dark:bg-white dark:text-black" : "border border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-white"}`}
                >
                  Sprints
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("members")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${activeTab === "members" ? "bg-slate-900 text-white dark:bg-white dark:text-black" : "border border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-white"}`}
                >
                  Members
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${activeTab === "settings" ? "bg-slate-900 text-white dark:bg-white dark:text-black" : "border border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-white"}`}
                >
                  Settings
                </button>
              </div>
            </div>

            {activeTab === "overview" ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-xs text-slate-500">Status</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.status || "active"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-xs text-slate-500">Owner</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.owner || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-xs text-slate-500">Dates</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                      {project.startDate || "—"} to {project.endDate || "Present"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-xs text-slate-500">GitHub Repo</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.github_repo || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-xs text-slate-500">Jira Key</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.jira_project_key || "—"}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                    <div className="text-xs text-slate-500">Stats</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                      {Number(project.stats?.totalTasks || 0)} total / {Number(project.stats?.openTasks || 0)} open / {Number(project.stats?.completedTasks || 0)} completed
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Tech Stack</div>
                  {tech.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tech.map((item) => (
                        <span key={item} className="rounded-full border border-slate-300 dark:border-zinc-700 px-2 py-1 text-xs text-slate-700 dark:text-slate-200">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No tech stack configured.</div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Activity Feed</div>
                  {Array.isArray(project.activityFeed) && project.activityFeed.length ? (
                    <div className="mt-3 space-y-2">
                      {project.activityFeed.map((item) => (
                        <div key={item.id} className="rounded border border-slate-200 dark:border-zinc-800 px-3 py-2">
                          <div className="text-sm text-slate-900 dark:text-white">{item.message}</div>
                          <div className="text-xs text-slate-500">{item.timestamp}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No recent activity.</div>
                  )}
                </div>
              </>
            ) : null}

            {activeTab === "sprints" ? (
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Sprints</div>
                {sprints.length ? (
                  <div className="mt-3 space-y-2">
                    {sprints.map((sprint) => (
                      <div key={sprint.id} className="rounded border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{sprint.name}</div>
                        <div className="text-xs text-slate-600 dark:text-slate-300">
                          {sprint.status || "planning"} · {sprint.startDate || "—"} to {sprint.endDate || "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No sprints found.</div>
                )}
              </div>
            ) : null}

            {activeTab === "members" ? (
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Members</div>
                {members.length ? (
                  <div className="mt-3 space-y-2">
                    {members.map((member) => (
                      <div key={member.memberId} className="flex items-center justify-between rounded border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div>
                          <div className="text-sm font-medium text-slate-900 dark:text-white">{member.fullName || member.email || "Member"}</div>
                          <div className="text-xs text-slate-500">{member.email || ""}</div>
                        </div>
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{member.role || "member"}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No members found.</div>
                )}

                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    value={newMember.userId}
                    onChange={(e) => setNewMember((prev) => ({ ...prev, userId: e.target.value }))}
                    placeholder="User ID"
                    className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  />
                  <select
                    value={newMember.role}
                    onChange={(e) => setNewMember((prev) => ({ ...prev, role: e.target.value }))}
                    className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                  >
                    <option value="member">member</option>
                    <option value="scrum_master">scrum_master</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void onAddMember()}
                    disabled={saving || !newMember.userId.trim()}
                    className="rounded-lg bg-slate-900 dark:bg-white px-3 py-2 text-sm font-semibold text-white dark:text-black disabled:opacity-60"
                  >
                    Add Member
                  </button>
                </div>
              </div>
            ) : null}

            {activeTab === "settings" ? (
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Edit Project</div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      defaultValue={project.name || ""}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== project.name) {
                          void onUpdateProject({ name: value });
                        }
                      }}
                      className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                      placeholder="Project name"
                    />
                    <select
                      defaultValue={project.status || "active"}
                      onChange={(e) => void onUpdateProject({ status: e.target.value })}
                      className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                    >
                      <option value="planning">planning</option>
                      <option value="active">active</option>
                      <option value="completed">completed</option>
                      <option value="archived">archived</option>
                    </select>
                    <textarea
                      defaultValue={project.description || ""}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value !== (project.description || "")) {
                          void onUpdateProject({ description: value });
                        }
                      }}
                      className="md:col-span-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                      rows={3}
                      placeholder="Description"
                    />
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-red-700 dark:text-red-300">Danger Zone</div>
                  <button
                    type="button"
                    onClick={() => void onArchiveProject()}
                    disabled={saving}
                    className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60"
                  >
                    Archive Project
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
