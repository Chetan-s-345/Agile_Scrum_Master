"use client";

import { useParams } from "@/next-shims/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Skill = {
  name: string;
  proficiency: string;
};

type DeveloperProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedDate: string;
  githubHandle: string;
  avatar?: string;
  skills: Skill[];
  canEditProfile?: boolean;
};

type DeveloperStats = {
  tasksCompletedAllTime: number;
  currentSprintTasks: number;
  avgStoryPointsPerSprint: number;
  prMergeRate: number;
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string;
};

type SprintHistory = {
  sprintId: string;
  sprintName: string;
  pointsDelivered: number;
};

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function asString(value: unknown, fallback = ""): string {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(date);
}

function statusClass(status: string): string {
  const normalized = asString(status).toLowerCase();
  if (normalized === "done") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (normalized === "in_progress") return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  if (normalized === "in_review") return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200";
  if (normalized === "blocked") return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  return "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-slate-200";
}

function priorityClass(priority: string): string {
  const normalized = asString(priority).toLowerCase();
  if (normalized === "critical") return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
  if (normalized === "high") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  if (normalized === "medium") return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  return "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-slate-200";
}

function skillClass(proficiency: string): string {
  const normalized = asString(proficiency).toLowerCase();
  if (normalized === "expert") return "border-emerald-300 text-emerald-800 dark:border-emerald-700 dark:text-emerald-200";
  if (normalized === "advanced") return "border-blue-300 text-blue-800 dark:border-blue-700 dark:text-blue-200";
  if (normalized === "intermediate") return "border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200";
  return "border-slate-300 text-slate-700 dark:border-zinc-700 dark:text-slate-200";
}

export default function DeveloperProfilePage() {
  const params = useParams<{ developerId?: string }>();
  const developerId = asString(params?.developerId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [profile, setProfile] = useState<DeveloperProfile | null>(null);
  const [stats, setStats] = useState<DeveloperStats | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<SprintHistory[]>([]);

  const hasId = useMemo(() => Boolean(developerId), [developerId]);

  useEffect(() => {
    if (!hasId) {
      setLoading(false);
      setError("Developer id is missing");
      return;
    }

    let ignore = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [profileResp, statsResp, tasksResp, historyResp] = await Promise.all([
          invokeDesktop<DeveloperProfile>("developers:getById", { developerId }),
          invokeDesktop<DeveloperStats>("developers:getStats", { developerId }),
          invokeDesktop<Task[]>("developers:getCurrentTasks", { developerId }),
          invokeDesktop<SprintHistory[]>("developers:getSprintHistory", { developerId, count: 6 }),
        ]);

        if (ignore) return;

        setProfile(profileResp || null);
        setStats(statsResp || null);
        setTasks(Array.isArray(tasksResp) ? tasksResp : []);
        setHistory(Array.isArray(historyResp) ? historyResp : []);
      } catch (e) {
        if (!ignore) {
          setError(e instanceof Error ? e.message : "Failed to load developer profile");
          setProfile(null);
          setStats(null);
          setTasks([]);
          setHistory([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [developerId, hasId]);

  async function updateProfile() {
    if (!profile || !profile.canEditProfile) return;

    try {
      setSaving(true);
      setNotice(null);
      setError(null);
      const updated = await invokeDesktop<DeveloperProfile>("developers:updateProfile", {
        developerId,
        changes: {
          githubHandle: profile.githubHandle,
          role: profile.role,
        },
      });
      setProfile(updated || profile);
      setNotice("Profile updated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-sm text-slate-600 dark:text-slate-300">
            Loading developer profile...
          </div>
        ) : profile ? (
          <>
            <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-lg font-semibold text-white dark:bg-white dark:text-black">
                    {asString(profile.avatar || profile.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="space-y-1">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{profile.name}</h1>
                    <div className="text-sm text-slate-600 dark:text-slate-300">{profile.email}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                      <span className="rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-1 font-semibold">{profile.role}</span>
                      <span>Joined {formatDate(profile.joinedDate)}</span>
                      <span>GitHub @{profile.githubHandle || "-"}</span>
                    </div>
                  </div>
                </div>

                {profile.canEditProfile ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void updateProfile()}
                    className="rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:hover:bg-slate-200 px-4 py-2 text-sm font-semibold text-white dark:text-black"
                  >
                    {saving ? "Saving..." : "Edit Profile"}
                  </button>
                ) : null}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Tasks completed (all time)" value={asNumber(stats?.tasksCompletedAllTime)} />
              <StatCard label="Current sprint tasks" value={asNumber(stats?.currentSprintTasks)} />
              <StatCard label="Avg story points/sprint" value={asNumber(stats?.avgStoryPointsPerSprint)} />
              <StatCard label="PR merge rate" value={`${asNumber(stats?.prMergeRate)}%`} />
            </section>

            <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Current Tasks</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300">
                      <th className="px-3 py-2 text-left font-semibold">Title</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-left font-semibold">Priority</th>
                      <th className="px-3 py-2 text-left font-semibold">Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.length ? (
                      tasks.map((task) => (
                        <tr key={task.id} className="border-b border-slate-200 dark:border-zinc-800">
                          <td className="px-3 py-2 text-slate-900 dark:text-white">{task.title}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(task.status)}`}>
                              {task.status}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${priorityClass(task.priority)}`}>
                              {task.priority}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{formatDate(task.dueDate)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate-600 dark:text-slate-300">No current tasks.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Sprint History</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Points delivered per sprint (last 6)</p>
              <div className="mt-3 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" />
                    <XAxis dataKey="sprintName" tick={{ fontSize: 11 }} stroke="#71717a" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#71717a" />
                    <Tooltip />
                    <Bar dataKey="pointsDelivered" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Skills</h2>
              {Array.isArray(profile.skills) && profile.skills.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.skills.map((skill) => (
                    <span key={`${skill.name}-${skill.proficiency}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${skillClass(skill.proficiency)}`}>
                      <span>{skill.name}</span>
                      <span className="opacity-80">{skill.proficiency}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">No skills added.</div>
              )}
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-300">
            Developer profile not found.
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}
