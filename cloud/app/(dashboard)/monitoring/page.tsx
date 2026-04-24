"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Sprint = {
  id: string;
  name: string;
  status: string;
  plannedPoints?: number;
  completedPoints?: number;
  velocity?: number;
  riskScore?: number;
};

type Velocity = { currentVelocity: number; requiredVelocity: number; gapPct: number; onTrack: boolean; daysRemaining: number };

type BurndownPoint = {
  day: number;
  idealRemaining: number;
  actualRemaining: number;
  date: string;
};

type BurndownResp = { items: BurndownPoint[]; error?: string };

type RiskResp = {
  riskScore: number;
  riskLevel: string;
  factors?: Array<{ key: string; value: number }>;
  recommendations?: string[];
  error?: string;
};

type AlertItem = {
  id: string;
  severity: string;
  title: string;
  message: string;
  suggestion?: string | null;
  createdAt: string;
  acknowledged: boolean;
  suggestionAction?: string | null;
  targetTaskId?: string | null;
  actionTaken?: string | null;
};

type AlertsResp = { items: AlertItem[]; error?: string };

type BurnoutResp = { items: Array<{ developerId: string; name: string; consecutiveOverSprints: number; avgOverloadPct: number; alertLevel: string }> };

type CapacityItem = {
  developerId?: string;
  name: string;
  role?: string | null;
  availabilityStatus?: string;
  maxSprintCapacity: number;
  currentSprintLoad: number;
  remainingCapacity: number;
  utilizationPct: number;
  meritScore: number;
  burnoutRiskFlag: boolean;
};

type CapacityResp = { items: CapacityItem[]; totals?: { maxSprintCapacity: number; currentSprintLoad: number; overallUtilizationPct: number } };

type SprintsResp = { items?: Sprint[]; error?: string };

type DeveloperActivitySummary = {
  totalEvents: number;
  commitCount: number;
  pullRequestCount: number;
  reviewCount: number;
  issueCount: number;
  pushCount: number;
  additions: number;
  deletions: number;
  activeDays: number;
  lastEventAt: string | null;
};

type DeveloperActivityEvent = {
  id: string;
  eventType: string;
  repoName: string | null;
  developerId: string | null;
  developerName: string;
  taskId: string | null;
  taskTitle: string | null;
  sprintId: string | null;
  commitSha: string | null;
  pullRequestNumber: number | null;
  branchName: string | null;
  additions: number;
  deletions: number;
  eventAt: string;
};

type DeveloperActivityByDeveloper = {
  developerId: string | null;
  developerName: string;
  totalEvents: number;
  commitCount: number;
  pullRequestCount: number;
  reviewCount: number;
  additions: number;
  deletions: number;
  lastEventAt: string | null;
};

type DeveloperActivityResp = {
  summary: DeveloperActivitySummary;
  events: DeveloperActivityEvent[];
  byDeveloper: DeveloperActivityByDeveloper[];
};

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

export default function MonitoringPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [alerts, setAlerts] = useState<AlertsResp | null>(null);
  const [burnout, setBurnout] = useState<BurnoutResp | null>(null);
  const [capacity, setCapacity] = useState<CapacityResp | null>(null);
  const [burndown, setBurndown] = useState<BurndownResp | null>(null);
  const [sprintBurndowns, setSprintBurndowns] = useState<Record<string, BurndownResp>>({});
  const [risk, setRisk] = useState<RiskResp | null>(null);
  const [developerFilter, setDeveloperFilter] = useState<string>("all");
  const [developerActivity, setDeveloperActivity] = useState<DeveloperActivityResp | null>(null);

  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "warning" | "info">("all");

  const [ackLoadingId, setAckLoadingId] = useState<string | null>(null);

  const selectedSprint = useMemo(
    () => sprints.find((item) => item.id === selectedSprintId) || null,
    [sprints, selectedSprintId]
  );

  const activeSprintId = useMemo(() => activeSprint?.id || null, [activeSprint]);

  function fallbackBurndownFromSprint(sprint: Sprint): BurndownResp {
    const planned = Math.max(0, Number(sprint.plannedPoints || 0));
    const completed = Math.max(0, Number(sprint.completedPoints || 0));
    const remaining = Math.max(0, planned - completed);

    return {
      items: [
        { day: 1, idealRemaining: planned, actualRemaining: planned, date: "start" },
        { day: 2, idealRemaining: remaining, actualRemaining: remaining, date: "current" },
      ],
    };
  }

  async function loadSelectedSprintData(sprintId: string | null) {
    if (!sprintId) {
      setVelocity(null);
      setAlerts(null);
      setBurndown(null);
      setRisk(null);
      return;
    }

    const [vResp, aResp, bResp, rResp] = await Promise.all([
      fetchJson<Velocity>(`/api/monitoring/sprint/${encodeURIComponent(sprintId)}/velocity`),
      fetchJson<AlertsResp>(`/api/monitoring/sprint/${encodeURIComponent(sprintId)}/alerts?acknowledged=false`),
      fetchJson<BurndownResp>(`/api/sprints/${encodeURIComponent(sprintId)}/burndown`),
      fetchJson<RiskResp>(`/api/sprints/${encodeURIComponent(sprintId)}/risk`),
    ]);

    setVelocity(vResp.ok ? vResp.data : null);
    setAlerts(aResp.ok ? aResp.data : null);
    setBurndown(bResp.ok ? bResp.data : null);
    setRisk(rResp.ok ? rResp.data : null);
  }

  async function loadDeveloperActivity(sprintId: string | null, nextDeveloperFilter?: string) {
    const query = new URLSearchParams();
    if (sprintId) query.set("sprintId", sprintId);

    const filterValue = nextDeveloperFilter ?? developerFilter;
    if (filterValue && filterValue !== "all") {
      query.set("developerId", filterValue);
    }

    const resp = await fetchJson<DeveloperActivityResp>(`/api/monitoring/developer-activity?${query.toString()}`);
    setDeveloperActivity(resp.ok ? resp.data : null);
  }

  const filteredAlerts = useMemo(() => {
    const items = Array.isArray(alerts?.items) ? alerts!.items : [];
    if (severityFilter === "all") return items;
    return items.filter((item) => String(item.severity || "").toLowerCase() === severityFilter);
  }, [alerts, severityFilter]);

  const alertStats = useMemo(() => {
    const stats = { total: 0, critical: 0, warning: 0, info: 0 };
    for (const item of alerts?.items || []) {
      stats.total += 1;
      const level = String(item.severity || "").toLowerCase();
      if (level === "critical") stats.critical += 1;
      else if (level === "warning") stats.warning += 1;
      else stats.info += 1;
    }
    return stats;
  }, [alerts]);

  function riskTone(level: string) {
    const normalized = String(level || "").toLowerCase();
    if (normalized === "critical") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
    if (normalized === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200";
    if (normalized === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
  }

  async function load(preferredSprintId?: string) {
    setLoading(true);
    setError(null);
    setNotice(null);

    const sprintsResp = await fetchJson<SprintsResp>('/api/sprints');
    const sprintItems = Array.isArray(sprintsResp.data?.items) ? sprintsResp.data!.items : [];
    const sprint = sprintItems.find((item) => String(item.status || '').toLowerCase() === 'active') || sprintItems[0] || null;
    setSprints(sprintItems);
    setActiveSprint(sprint);

    const requested = preferredSprintId || selectedSprintId;
    const selected =
      (requested ? sprintItems.find((item) => item.id === requested) : null) ||
      sprint ||
      sprintItems[0] ||
      null;
    setSelectedSprintId(selected?.id || null);

    const [burnoutResp, capacityResp] = await Promise.all([
      fetchJson<BurnoutResp>("/api/monitoring/burnout"),
      fetchJson<CapacityResp>("/api/monitoring/capacity"),
    ]);

    setBurnout(burnoutResp.ok ? burnoutResp.data : null);
    setCapacity(capacityResp.ok ? capacityResp.data : null);

    await Promise.all([
      loadSelectedSprintData(selected?.id || null),
      loadDeveloperActivity(selected?.id || null),
    ]);

    if (sprintItems.length) {
      const entries = await Promise.all(
        sprintItems.map(async (item) => {
          const resp = await fetchJson<BurndownResp>(`/api/sprints/${encodeURIComponent(item.id)}/burndown`);
          const payload = resp.ok ? resp.data || { items: [] } : { items: [] };
          return [item.id, payload.items?.length ? payload : fallbackBurndownFromSprint(item)] as const;
        })
      );
      setSprintBurndowns(Object.fromEntries(entries));
    } else {
      setSprintBurndowns({});
    }

    if (!sprintsResp.ok) {
      setError(sprintsResp.data?.error || `Failed to load sprint data (${sprintsResp.status})`);
    }

    setLoading(false);
  }

  async function acknowledge(alert: AlertItem) {
    setError(null);
    setNotice(null);
    setAckLoadingId(alert.id);
    try {
      const resp = await fetch(`/api/monitoring/alerts/${encodeURIComponent(alert.id)}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionTaken: "Acknowledged by Scrum Master",
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || `Failed to acknowledge (${resp.status})`));
      setNotice("Alert acknowledged.");
      await load(selectedSprintId || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge alert");
    } finally {
      setAckLoadingId(null);
    }
  }

  async function onSprintSwitch(nextSprintId: string) {
    setSelectedSprintId(nextSprintId);
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await Promise.all([
        loadSelectedSprintData(nextSprintId),
        loadDeveloperActivity(nextSprintId),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sprint details");
    } finally {
      setLoading(false);
    }
  }

  async function onDeveloperFilterChange(nextDeveloperId: string) {
    setDeveloperFilter(nextDeveloperId);
    setError(null);
    try {
      await loadDeveloperActivity(selectedSprintId, nextDeveloperId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load developer activity");
    }
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Monitoring</h1>
            <p className="text-slate-600 dark:text-slate-300">Velocity, alerts, and burnout indicators.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedSprintId || ""}
              onChange={(e) => void onSprintSwitch(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white"
              disabled={loading || !sprints.length}
            >
              {sprints.length ? (
                sprints.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.status})
                  </option>
                ))
              ) : (
                <option value="">No sprints</option>
              )}
            </select>
            <button
              onClick={() => void load(selectedSprintId || undefined)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="mb-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div className="text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Selected sprint</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{selectedSprint?.name || "None"}</div>
              {selectedSprintId ? <div className="mt-1 text-xs text-slate-500">{selectedSprintId}</div> : null}
              {activeSprintId && activeSprintId === selectedSprintId ? (
                <div className="mt-2 inline-flex rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                  Active Sprint
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Velocity</div>
              {velocity ? (
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                  Current: <span className="font-semibold">{velocity.currentVelocity}</span>
                  <br />
                  Required: <span className="font-semibold">{velocity.requiredVelocity}</span>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">Unavailable</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Delivery Status</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{velocity?.onTrack ? "On Track" : "Needs Action"}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Gap: {velocity?.gapPct ?? 0}%</div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sprint Risk</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{risk?.riskScore ?? 0}</div>
              <div className="mt-1">
                <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${riskTone(risk?.riskLevel || "low")}`}>
                  {risk?.riskLevel || "low"}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Active alerts</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{alerts?.items?.length || 0}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">(unacknowledged)</div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burnout flags</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{burnout?.items?.length || 0}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Developers at sustained overload</div>
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Burndown Trend</div>
            {burndown?.items?.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={burndown.items}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="idealRemaining" stroke="#64748b" strokeWidth={2} name="Ideal Remaining" />
                    <Line type="monotone" dataKey="actualRemaining" stroke="#b91c1c" strokeWidth={2} name="Actual Remaining" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No burndown snapshots yet for this sprint.</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Capacity Utilization</div>
            {capacity?.items?.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={capacity.items.slice(0, 12)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={70} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="utilizationPct" fill="#0369a1" name="Utilization %" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">Capacity data unavailable.</div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sprint Burndown Overview</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">One burndown graph per sprint is shown below.</div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Total sprints: {sprints.length}</div>
          </div>

          {sprints.length ? (
            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
              {sprints.map((item) => {
                const chart = sprintBurndowns[item.id]?.items || [];
                const isActive = String(item.status || '').toLowerCase() === 'active';
                return (
                  <div key={item.id} className={`rounded-lg border p-4 ${isActive ? 'border-sky-300 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/20' : 'border-slate-200 dark:border-zinc-800 bg-slate-50/40 dark:bg-black/20'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sprint {item.id}</div>
                      </div>
                      <span className="rounded-md border border-slate-200 dark:border-zinc-800 px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">
                        {item.status}
                      </span>
                    </div>

                    <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                      Planned {item.plannedPoints ?? 0} · Completed {item.completedPoints ?? 0} · Velocity {item.velocity ?? 0} · Risk {item.riskScore ?? 0}
                    </div>

                    {chart.length ? (
                      <div className="mt-4 h-52">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chart}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="day" />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey="idealRemaining" stroke="#64748b" strokeWidth={2} name="Ideal Remaining" />
                            <Line type="monotone" dataKey="actualRemaining" stroke="#0f766e" strokeWidth={2} name="Actual Remaining" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">No burndown snapshots yet.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">No sprints found for this organization.</div>
          )}
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Developer Engineering Activity</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Commit, PR, review, push and code churn signals for the selected sprint.</div>
            </div>
            <select
              value={developerFilter}
              onChange={(e) => void onDeveloperFilterChange(e.target.value)}
              className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
              disabled={!capacity?.items?.length}
            >
              <option value="all">All Developers</option>
              {(capacity?.items || [])
                .filter((d) => Boolean(d.developerId))
                .map((d) => (
                  <option key={d.developerId} value={d.developerId}>
                    {d.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-3">
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Events</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.totalEvents ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Commits</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.commitCount ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">PRs</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.pullRequestCount ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Reviews</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.reviewCount ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Issues</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.issueCount ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Pushes</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.pushCount ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Additions</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.additions ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Deletions</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.deletions ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Active Days</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.activeDays ?? 0}</div></div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Last Event</div><div className="font-semibold text-slate-900 dark:text-white">{developerActivity?.summary.lastEventAt ? new Date(developerActivity.summary.lastEventAt).toLocaleDateString() : "-"}</div></div>
          </div>

          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Activity By Developer</div>
              {developerActivity?.byDeveloper?.length ? (
                <div className="overflow-auto rounded-md border border-slate-200 dark:border-zinc-800">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-black/40">
                      <tr>
                        <th className="text-left px-3 py-2">Developer</th>
                        <th className="text-right px-3 py-2">Events</th>
                        <th className="text-right px-3 py-2">Commits</th>
                        <th className="text-right px-3 py-2">PRs</th>
                        <th className="text-right px-3 py-2">Reviews</th>
                      </tr>
                    </thead>
                    <tbody>
                      {developerActivity.byDeveloper.map((row) => (
                        <tr key={`${row.developerId || row.developerName}-${row.totalEvents}`} className="border-t border-slate-200 dark:border-zinc-800">
                          <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{row.developerName}</td>
                          <td className="px-3 py-2 text-right">{row.totalEvents}</td>
                          <td className="px-3 py-2 text-right">{row.commitCount}</td>
                          <td className="px-3 py-2 text-right">{row.pullRequestCount}</td>
                          <td className="px-3 py-2 text-right">{row.reviewCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No developer activity recorded for this sprint.</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Recent Commit and GitHub Events</div>
              {developerActivity?.events?.length ? (
                <div className="space-y-2 max-h-72 overflow-auto">
                  {developerActivity.events.slice(0, 20).map((event) => (
                    <div key={event.id} className="rounded-md border border-slate-200 dark:border-zinc-800 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{event.eventType}</div>
                        <div className="text-xs text-slate-500">{new Date(event.eventAt).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{event.developerName} · {event.repoName || "repo-n/a"} · {event.branchName || "branch-n/a"}</div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {event.commitSha ? `Commit ${event.commitSha.slice(0, 8)}` : ""}
                        {event.pullRequestNumber ? ` PR #${event.pullRequestNumber}` : ""}
                        {event.taskTitle ? ` · ${event.taskTitle}` : ""}
                        {` · +${event.additions} / -${event.deletions}`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No GitHub events available for this filter.</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Active alerts</div>
              <div className="flex items-center gap-2">
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as "all" | "critical" | "warning" | "info")}
                  className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md px-2 py-1 bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200">Critical: {alertStats.critical}</span>
              <span className="rounded-md px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200">Warning: {alertStats.warning}</span>
              <span className="rounded-md px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200">Info: {alertStats.info}</span>
            </div>

            {filteredAlerts.length ? (
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Severity</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Alert</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Created</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAlerts.map((a) => {
                      const busy = ackLoadingId === a.id;
                      return (
                        <tr key={a.id} className="border-t border-slate-200 dark:border-zinc-800">
                          <td className="px-3 py-3 align-top">
                            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${riskTone(a.severity)}`}>
                              {a.severity}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-semibold text-slate-900 dark:text-white">{a.title}</div>
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{a.message}</div>
                            {a.suggestion ? <div className="mt-2 text-xs text-slate-700 dark:text-slate-200">Suggestion: {a.suggestion}</div> : null}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-600 dark:text-slate-300">
                            {new Date(a.createdAt).toLocaleString()}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="flex justify-end">
                              <button
                                onClick={() => acknowledge(a)}
                                disabled={busy}
                                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-200"
                              >
                                Acknowledge
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">No active alerts.</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burnout risk</div>
            {burnout?.items?.length ? (
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Developer</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Over-sprints</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Avg overload</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {burnout.items.map((b) => (
                      <tr key={b.developerId} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3 text-slate-900 dark:text-white font-semibold">{b.name}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{b.consecutiveOverSprints}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{Math.round(b.avgOverloadPct * 10) / 10}%</td>
                        <td className="px-3 py-3">
                          <span className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {b.alertLevel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">No developers currently flagged.</div>
            )}

            {burnout?.items?.length ? (
              <div className="mt-4 rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-black/20">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Scrum Master Action Guidance</div>
                <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                  Rebalance assignments from repeated overload contributors, prioritize blocker removal for affected members, and enforce WIP limits for this sprint.
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 lg:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Team capacity</div>
              {capacity?.totals ? (
                <div className="text-xs text-slate-500">
                  Overall utilization: {capacity.totals.overallUtilizationPct}% ({capacity.totals.currentSprintLoad}/{capacity.totals.maxSprintCapacity})
                </div>
              ) : null}
            </div>

            {capacity?.items?.length ? (
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Developer</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Role</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Status</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Capacity</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Load</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Remaining</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Util</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capacity.items.map((c) => (
                      <tr key={c.developerId || c.name} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3 text-slate-900 dark:text-white font-semibold">
                          <Link
                            href={`/monitoring/developers/${encodeURIComponent(c.developerId || c.name)}`}
                            className="hover:underline"
                          >
                            {c.name}
                          </Link>
                          {c.burnoutRiskFlag ? <span className="ml-2 text-xs text-red-700 dark:text-red-300">risk</span> : null}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{c.role || "—"}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200 capitalize">{c.availabilityStatus || "available"}</td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{c.maxSprintCapacity}</td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{c.currentSprintLoad}</td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{c.remainingCapacity}</td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{Math.round(c.utilizationPct * 10) / 10}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">Capacity data unavailable.</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 lg:col-span-2">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Risk Analysis and Recommendations</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-500">Risk factors</div>
                {risk?.factors?.length ? (
                  <div className="mt-2 space-y-2">
                    {risk.factors.map((factor) => (
                      <div key={factor.key} className="rounded-md border border-slate-200 dark:border-zinc-800 p-2">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{factor.key}</div>
                        <div className="text-sm text-slate-900 dark:text-white">{factor.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No factor breakdown available.</div>
                )}
              </div>
              <div>
                <div className="text-xs text-slate-500">Recommendations</div>
                {risk?.recommendations?.length ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                    {risk.recommendations.map((item, idx) => (
                      <li key={`${idx}-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No risk recommendations available yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
