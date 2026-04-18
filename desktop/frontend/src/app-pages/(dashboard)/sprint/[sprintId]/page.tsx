"use client";

import Link from "@/next-shims/link";
import { useParams } from "@/next-shims/navigation";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type Sprint = {
  id: string;
  name: string;
  status: string;
  goal?: string | null;
  startDate?: string;
  endDate?: string;
  plannedPoints?: number;
  completedPoints?: number;
};

type SprintTask = {
  id: string;
  title: string;
  status: string;
  assignee?: string;
};

type SprintEvent = {
  id: string;
  type: string;
  title: string;
  scheduledAt?: string;
};

type SprintSummary = {
  sprintId: string;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  plannedPoints: number;
  completedPoints: number;
  velocity: number;
  completionPct: number;
  upcomingEvents?: SprintEvent[];
};

type MemberContribution = {
  memberId: string;
  name: string;
  tasksCompleted: number;
  totalTasks: number;
  pointsCompleted: number;
};

type Velocity = {
  currentVelocity: number;
  requiredVelocity: number;
  gapPct: number;
  onTrack: boolean;
  daysRemaining: number;
};

type AlertsResp = { items: Array<{ id: string; severity: string; title: string; message: string; createdAt: string; acknowledged: boolean }> };

type Risk = Record<string, unknown>;

type BurndownPoint = { day: number; date: string; idealRemaining: number; actualRemaining: number };

type AlertItem = { id: string; severity: string; title: string; message: string; createdAt: string; acknowledged: boolean };

function safe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function fmtDate(value: unknown): string {
  const raw = safe(value);
  if (!raw) return "-";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(asText(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }
  return response as T;
}

export default function SprintDetailPage() {
  const params = useParams<{ sprintId: string }>();
  const sprintId = params?.sprintId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [tasks, setTasks] = useState<SprintTask[]>([]);
  const [events, setEvents] = useState<SprintEvent[]>([]);
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [alerts, setAlerts] = useState<AlertsResp | null>(null);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [burndown, setBurndown] = useState<BurndownPoint[]>([]);
  const [contributions, setContributions] = useState<MemberContribution[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const [nextSprint, nextTasks, nextSummary, nextContributions] = await Promise.all([
        invokeDesktop<Sprint>("sprints:getById", { sprintId }),
        invokeDesktop<SprintTask[]>("sprints:getTasks", { sprintId }),
        invokeDesktop<SprintSummary>("sprints:getSummary", { sprintId }),
        invokeDesktop<MemberContribution[]>("sprints:getContributions", { sprintId }),
      ]);

      const taskRows = Array.isArray(nextTasks) ? nextTasks : [];
      const summary = nextSummary && typeof nextSummary === "object" ? nextSummary : null;
      const eventRows = Array.isArray(summary?.upcomingEvents) ? summary!.upcomingEvents! : [];
      const doneCount = Number(summary?.completedTasks ?? taskRows.filter((task) => {
        const normalized = String(task.status || "").toLowerCase();
        return normalized === "done" || normalized === "completed";
      }).length);
      const totalTaskCount = Math.max(1, Number(summary?.totalTasks || taskRows.length || 1));

      const endDate = new Date(String(nextSprint?.endDate || ""));
      const today = new Date();
      const daysRemaining = Number.isNaN(endDate.getTime())
        ? 0
        : Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      const totalTasks = totalTaskCount;

      const blockedTasks = Number(summary?.blockedTasks ?? taskRows.filter(
        (task) => String(task.status || "").toLowerCase() === "blocked"
      ).length);

      const alertItems: AlertItem[] = [
        ...(blockedTasks > 0
          ? [{
          id: `blocked-${String(nextSprint?.id || sprintId || "unknown")}`,
          severity: "high",
          title: `${blockedTasks} blocked task${blockedTasks === 1 ? "" : "s"}`,
          message: "Sprint contains blocked work that may impact completion.",
          createdAt: new Date().toISOString(),
          acknowledged: false,
        }]
          : []),
        ...eventRows.map((event) => ({
          id: `event-${event.id}`,
          severity: "info",
          title: event.title,
          message: `${event.type} scheduled for ${fmtDate(event.scheduledAt)}`,
          createdAt: String(event.scheduledAt || new Date().toISOString()),
          acknowledged: false,
        })),
      ];

      const spanDays = Math.max(1, Math.min(10, daysRemaining || 7));
      const burndownRows: BurndownPoint[] = Array.from({ length: spanDays }, (_item, index) => {
        const day = index + 1;
        const idealRemaining = Math.max(0, Math.round(totalTasks - (totalTasks / spanDays) * day));
        const actualRemaining = Math.max(0, totalTasks - doneCount - Math.max(0, day - Math.ceil(doneCount / 2)));
        const baseDate = Number.isNaN(endDate.getTime())
          ? new Date(today.getTime() + day * 24 * 60 * 60 * 1000)
          : new Date(endDate.getTime() - (spanDays - day) * 24 * 60 * 60 * 1000);
        return {
          day,
          date: baseDate.toISOString(),
          idealRemaining,
          actualRemaining,
        };
      });

      setSprint(nextSprint || null);
      setTasks(taskRows);
      setEvents(eventRows);
      setContributions(Array.isArray(nextContributions) ? nextContributions : []);
      setVelocity({
        currentVelocity: Number((Number(summary?.velocity ?? ((doneCount / totalTasks) * 10))).toFixed(1)),
        requiredVelocity: Number((((totalTasks - doneCount) / Math.max(daysRemaining, 1))).toFixed(1)),
        gapPct: Number((((totalTasks - doneCount) / totalTasks) * 100).toFixed(1)),
        onTrack: blockedTasks === 0,
        daysRemaining,
      });
      setAlerts({ items: alertItems });
      setRisk({
        totalTasks: Number(summary?.totalTasks ?? taskRows.length),
        completed: doneCount,
        inProgress: taskRows.filter((task) => String(task.status || "").toLowerCase() === "in_progress").length,
        blocked: blockedTasks,
        upcomingEvents: eventRows.length,
        contributors: Array.isArray(nextContributions) ? nextContributions.length : 0,
      });
      setBurndown(burndownRows);
    } catch (err) {
      setSprint(null);
      setTasks([]);
      setEvents([]);
      setVelocity(null);
      setAlerts(null);
      setRisk(null);
      setBurndown([]);
      setContributions([]);
      setError(err instanceof Error ? err.message : "Failed to load sprint");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintId]);

  async function startSprint() {
    const resolvedSprintId = String(sprint?.id || sprintId || "").trim();
    if (!resolvedSprintId) return;
    await invokeDesktop<Sprint>("sprints:update", {
      sprintId: resolvedSprintId,
      changes: { status: "active" },
    });
    await load();
  }

  async function completeSprint() {
    const resolvedSprintId = String(sprint?.id || sprintId || "").trim();
    if (!resolvedSprintId) return;
    await invokeDesktop<Sprint>("sprints:update", {
      sprintId: resolvedSprintId,
      changes: { status: "completed" },
    });
    await load();
  }

  void tasks;
  void events;
  void contributions;

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{sprint?.name || "Sprint"}</h1>
            <div className="mt-1 text-slate-600 dark:text-slate-300">ID: {sprint?.id || sprintId || "-"}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button
              onClick={startSprint}
              className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 text-sm font-semibold"
            >
              Start
            </button>
            <button
              onClick={completeSprint}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-semibold"
            >
              Complete
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Velocity</div>
              {velocity ? (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Current: <span className="font-semibold">{velocity.currentVelocity}</span> pts/day
                  <br />
                  Required: <span className="font-semibold">{velocity.requiredVelocity}</span> pts/day
                  <br />
                  Status: <span className="font-semibold">{velocity.onTrack ? "On track" : "Behind"}</span>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">Unavailable</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Alerts</div>
              <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {alerts?.items?.length ? `${alerts.items.length} active` : "No active alerts"}
              </div>
              {alerts?.items?.length ? (
                <div className="mt-3 space-y-2">
                  {alerts.items.slice(0, 3).map((a) => (
                    <div key={a.id} className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{a.title}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{a.message}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Quick links</div>
              <div className="mt-3 space-y-2">
                <Link
                  className="block rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
                  href={`/tasks`}
                >
                  Task board
                </Link>
                <Link
                  className="block rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
                  href={`/monitoring`}
                >
                  Monitoring
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burndown</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Showing latest {Math.min(burndown.length, 10)} points</div>
          </div>
          {burndown.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-slate-400">
                    <th className="px-2 py-2">Day</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Ideal Remaining</th>
                    <th className="px-2 py-2">Actual Remaining</th>
                    <th className="px-2 py-2">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {burndown.slice(-10).map((point) => {
                    const variance = Number(point.actualRemaining || 0) - Number(point.idealRemaining || 0);
                    const varianceClass = variance > 0 ? "text-red-600 dark:text-red-300" : "text-emerald-600 dark:text-emerald-300";
                    return (
                      <tr key={`${point.day}:${point.date}`} className="border-b border-slate-100 dark:border-zinc-800/60">
                        <td className="px-2 py-2 text-slate-800 dark:text-slate-200">{point.day}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{fmtDate(point.date)}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{point.idealRemaining}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-300">{point.actualRemaining}</td>
                        <td className={`px-2 py-2 font-semibold ${varianceClass}`}>{variance >= 0 ? `+${variance}` : variance}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">No burndown data available.</div>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Risk Summary</div>
          {risk && Object.keys(risk).length ? (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {Object.entries(risk).map(([key, value]) => (
                <div key={key} className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{key}</div>
                  <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">{typeof value === "object" ? JSON.stringify(value) : String(value)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-500 dark:text-slate-400">No risk data available.</div>
          )}
        </div>
      </div>
    </div>
  );
}
