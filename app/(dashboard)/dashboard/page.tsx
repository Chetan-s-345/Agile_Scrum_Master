"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertCircle, TrendingUp, Users, CheckCircle, Clock } from 'lucide-react';
import { getMe } from "@/lib/org-member-auth";

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

type SprintDetails = {
  sprint: any;
  tasks?: Record<string, any[]>;
  developerCapacity?: Array<{
    full_name?: string;
    max_sprint_capacity?: number;
    current_sprint_load?: number;
    utilization_pct?: number;
    burnout_risk_flag?: boolean;
  }>;
  activeDelayAlerts?: Array<{
    id: string;
    severity?: string;
    title?: string;
    message?: string;
  }>;
};

type SprintRisk = {
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations?: string[];
};

type ProjectListItem = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
};

function daysBetweenInclusive(startIso?: string, endIso?: string) {
  if (!startIso || !endIso) return 0;
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const ms = Math.max(0, end - start);
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSprint, setActiveSprint] = useState<SprintListItem | null>(null);
  const [velocityData, setVelocityData] = useState<Array<{ label: string; velocity: number; required: number }>>([]);
  const [burndownData, setBurndownData] = useState<Array<{ day: string; remaining: number; ideal?: number }>>([]);
  const [teamCapacity, setTeamCapacity] = useState<Array<{ name: string; capacity: number; used: number }>>([]);
  const [risk, setRisk] = useState<SprintRisk | null>(null);
  const [delayAlerts, setDelayAlerts] = useState<Array<{ severity: string; title: string; message: string }>>([]);
  const [taskCounts, setTaskCounts] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectActionId, setProjectActionId] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await getMe();
      if (cancelled) return;
      const hasOrg = Boolean(Array.isArray(me?.memberships) && me!.memberships!.length);
      if (me?.user && !hasOrg) {
        router.replace('/org');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const loadSprintList = async (status?: string) => {
          const qs = status ? `?${new URLSearchParams({ status }).toString()}` : "";
          const resp = await fetch(`/api/sprints${qs}`, { cache: "no-store" });
          const data = await resp.json().catch(() => null);
          if (!resp.ok) throw new Error(String(data?.error || "Failed to load sprints"));
          return (Array.isArray(data?.items) ? (data.items as SprintListItem[]) : []) as SprintListItem[];
        };

        const active = await loadSprintList("active");
        const planning = active.length ? [] : await loadSprintList("planning");
        const selected = (active[0] || planning[0] || null) as SprintListItem | null;
        if (cancelled) return;
        setActiveSprint(selected);

        // Velocity trend: use most recent sprints (any status) if available.
        let all: SprintListItem[] = [];
        try {
          all = await loadSprintList();
        } catch {
          all = selected ? [selected] : [];
        }
        const recent = all.slice(0, 4).reverse();
        const vel = recent.map((s, idx) => {
          const days = daysBetweenInclusive(String(s.startDate || ""), String(s.endDate || "")) || 1;
          const planned = Number(s.plannedPoints || 0);
          return {
            label: `S${recent.length - idx}`,
            velocity: Number(s.velocity || 0),
            required: Math.round((planned / days) * 100) / 100,
          };
        });
        if (!cancelled) setVelocityData(vel);

        if (!selected?.id) {
          if (!cancelled) {
            setBurndownData([]);
            setTeamCapacity([]);
            setRisk(null);
            setDelayAlerts([]);
            setTaskCounts({ total: 0, done: 0 });
          }
          return;
        }

        const [burndownResp, riskResp, detailsResp] = await Promise.all([
          fetch(`/api/sprints/${encodeURIComponent(selected.id)}/burndown`, { cache: "no-store" }),
          fetch(`/api/sprints/${encodeURIComponent(selected.id)}/risk`, { cache: "no-store" }),
          fetch(`/api/sprints/${encodeURIComponent(selected.id)}`, { cache: "no-store" }),
        ]);

        const burndownJson = await burndownResp.json().catch(() => null);
        const riskJson = await riskResp.json().catch(() => null);
        const detailsJson = (await detailsResp.json().catch(() => null)) as SprintDetails | null;

        if (!cancelled) {
          if (burndownResp.ok && Array.isArray(burndownJson)) {
            setBurndownData(
              burndownJson.map((r: any) => ({
                day: `Day ${Number(r.day)}`,
                remaining: Number(r.actualRemaining || 0),
                ideal: Number(r.idealRemaining || 0),
              }))
            );
          } else {
            setBurndownData([]);
          }

          if (riskResp.ok && riskJson) {
            setRisk({
              riskScore: Number(riskJson.riskScore || 0),
              riskLevel: String(riskJson.riskLevel || "low") as SprintRisk["riskLevel"],
              recommendations: Array.isArray(riskJson.recommendations) ? riskJson.recommendations : [],
            });
          } else {
            setRisk(null);
          }

          const caps = Array.isArray(detailsJson?.developerCapacity) ? detailsJson!.developerCapacity! : [];
          setTeamCapacity(
            caps.slice(0, 8).map((d) => ({
              name: String(d.full_name || "Developer"),
              capacity: Number(d.max_sprint_capacity || 0),
              used: Number(d.current_sprint_load || 0),
            }))
          );

          const grouped = detailsJson?.tasks || {};
          const total = Object.values(grouped).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
          const done = Array.isArray((grouped as any).done) ? (grouped as any).done.length : 0;
          setTaskCounts({ total, done });

          const alerts = Array.isArray(detailsJson?.activeDelayAlerts) ? detailsJson!.activeDelayAlerts! : [];
          setDelayAlerts(
            alerts.slice(0, 3).map((a) => ({
              severity: String(a.severity || "info"),
              title: String(a.title || "Alert"),
              message: String(a.message || ""),
            }))
          );
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadProjects() {
    const resp = await fetch("/api/projects", { cache: "no-store" });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error(String(data?.error || "Failed to load projects"));
    setProjects(Array.isArray(data?.items) ? (data.items as ProjectListItem[]) : []);
  }

  async function archiveProject(projectId: string) {
    if (!confirm("Archive this project?")) return;
    setError(null);
    setProjectActionId(projectId);
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to archive project"));
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive project");
    } finally {
      setProjectActionId(null);
    }
  }

  async function deleteProject(projectId: string) {
    if (!confirm("Delete this project permanently? This cannot be undone.")) return;
    setError(null);
    setProjectActionId(projectId);
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to delete project"));
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    } finally {
      setProjectActionId(null);
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
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to create project"));
      await loadProjects();
      setShowCreateProject(false);
      setNewProjectName("");
      setNewProjectDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  }

  useEffect(() => {
    void loadProjects().catch(() => {
      // keep dashboard usable even if projects load fails
    });
  }, []);

  const capacityPct = useMemo(() => {
    if (!teamCapacity.length) return 0;
    const totals = teamCapacity.reduce(
      (acc, d) => {
        acc.capacity += Number(d.capacity || 0);
        acc.used += Number(d.used || 0);
        return acc;
      },
      { capacity: 0, used: 0 }
    );
    if (!totals.capacity) return 0;
    return Math.round((totals.used / totals.capacity) * 100);
  }, [teamCapacity]);

  const progressPct = useMemo(() => {
    if (activeSprint?.completionPct != null) return Math.round(Number(activeSprint.completionPct || 0));
    if (!taskCounts.total) return 0;
    return Math.round((taskCounts.done / taskCounts.total) * 100);
  }, [activeSprint?.completionPct, taskCounts.done, taskCounts.total]);

  const statsCards = [
    {
      title: 'Sprint Progress',
      value: loading ? '—' : `${progressPct}%`,
      icon: TrendingUp,
      color: 'bg-blue-500'
    },
    {
      title: 'Completed Tasks',
      value: loading ? '—' : String(taskCounts.done),
      icon: CheckCircle,
      color: 'bg-green-500'
    },
    {
      title: 'Team Capacity',
      value: loading ? '—' : `${capacityPct}%`,
      icon: Users,
      color: 'bg-purple-500'
    },
    {
      title: 'Days Remaining',
      value: loading ? '—' : `${Number(activeSprint?.daysRemaining || 0)}d`,
      icon: Clock,
      color: 'bg-orange-500'
    }
  ];

  const marketingCards = [
    {
      title: "Features",
      description: "Explore agile capabilities and automation tools.",
      href: "/dashboard/features",
    },
    {
      title: "Pricing",
      description: "Compare plans for teams of every size.",
      href: "/dashboard/pricing",
    },
    {
      title: "Solution",
      description: "See how the platform fits your workflow.",
      href: "/dashboard/solution",
    },
    {
      title: "About",
      description: "Learn our mission, story, and values.",
      href: "/dashboard/about",
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Dashboard</h1>
          <p className="text-slate-600 dark:text-slate-400">Active Sprint Overview & Team Metrics</p>
          {activeSprint?.name && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Current sprint: <span className="font-medium text-slate-900 dark:text-white">{activeSprint.name}</span></p>
          )}
          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </div>

        {/* Learn More */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {marketingCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {card.title}
                </h3>
                <span className="text-sm text-blue-600 dark:text-blue-400 group-hover:underline">
                  Open
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {card.description}
              </p>
            </Link>
          ))}
        </div>

        <div className="mb-8 bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Projects</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCreateProject((v) => !v)}
                className="text-sm px-3 py-1 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800"
                disabled={Boolean(projectActionId) || creatingProject}
              >
                {showCreateProject ? "Cancel" : "Create Project"}
              </button>
              <button
                onClick={() => void loadProjects()}
                className="text-sm px-3 py-1 rounded border border-slate-200 dark:border-zinc-700 hover:bg-slate-50 dark:hover:bg-zinc-800"
                disabled={Boolean(projectActionId) || creatingProject}
              >
                Refresh
              </button>
            </div>
          </div>

          {showCreateProject ? (
            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name"
                className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
              <input
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="Description (optional)"
                className="rounded border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
              />
              <button
                onClick={() => void createProject()}
                disabled={!newProjectName.trim() || creatingProject}
                className="rounded bg-blue-600 text-white px-3 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
              >
                {creatingProject ? "Creating..." : "Create"}
              </button>
            </div>
          ) : null}

          {!projects.length ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No projects found.</p>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded border border-slate-200 dark:border-zinc-800">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">{p.name}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{p.slug || "-"} • {String(p.status || "active")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void archiveProject(p.id)}
                      disabled={projectActionId === p.id}
                      className="text-xs px-3 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950 disabled:opacity-60"
                    >
                      Archive
                    </button>
                    <button
                      onClick={() => void deleteProject(p.id)}
                      disabled={projectActionId === p.id}
                      className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statsCards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <div key={idx} className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800 hover:shadow-lg transition">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-slate-600 dark:text-slate-300 font-medium">{card.title}</h3>
                  <div className={`${card.color} p-2 rounded-lg`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{card.value}</p>
              </div>
            );
          })}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Velocity Trend */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Velocity Trend</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={velocityData}>
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line type="monotone" dataKey="velocity" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="required" stroke="#f97316" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Burndown Chart */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Sprint Burndown</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={burndownData}>
                <XAxis dataKey="day" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line type="monotone" dataKey="remaining" stroke="#ef4444" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Team Capacity & Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Team Capacity Bar */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Team Capacity Utilization</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={teamCapacity}>
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Bar dataKey="capacity" fill="#cbd5e1" />
                <Bar dataKey="used" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Active Alerts */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Active Alerts
            </h2>
            <div className="space-y-3">
              {delayAlerts.length > 0 ? (
                delayAlerts.map((a, idx) => {
                  const sev = a.severity.toLowerCase();
                  const box =
                    sev === "critical" || sev === "high"
                      ? "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
                      : sev === "warning" || sev === "medium"
                        ? "bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800"
                        : "bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800";
                  const title = a.title || "Alert";
                  return (
                    <div key={idx} className={`${box} rounded p-3`}>
                      <p className="font-medium text-slate-900 dark:text-slate-100 text-sm">{title}</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300">{a.message}</p>
                    </div>
                  );
                })
              ) : (
                <>
                  {risk && (risk.riskLevel === "high" || risk.riskLevel === "critical") && (
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-3">
                      <p className="font-medium text-red-900 dark:text-red-200 text-sm">{risk.riskLevel === "critical" ? "Critical" : "Warning"}: Sprint at Risk</p>
                      <p className="text-xs text-red-700 dark:text-red-300">Risk score: {Math.round(risk.riskScore)} / 100</p>
                    </div>
                  )}
                  {teamCapacity.some((c) => c.capacity > 0 && (c.used / c.capacity) * 100 >= 90) && (
                    <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                      <p className="font-medium text-yellow-900 dark:text-yellow-200 text-sm">Warning: Capacity High</p>
                      <p className="text-xs text-yellow-700 dark:text-yellow-300">One or more developers are ≥ 90% utilized</p>
                    </div>
                  )}
                  {activeSprint && (
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3">
                      <p className="font-medium text-blue-900 dark:text-blue-200 text-sm">Info: Sprint Timeline</p>
                      <p className="text-xs text-blue-700 dark:text-blue-300">{Number(activeSprint.daysRemaining || 0)} days remaining</p>
                    </div>
                  )}
                  {!risk && !activeSprint && (
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3">
                      <p className="font-medium text-blue-900 dark:text-blue-200 text-sm">No active sprint</p>
                      <p className="text-xs text-blue-700 dark:text-blue-300">Create a sprint to see live metrics.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
