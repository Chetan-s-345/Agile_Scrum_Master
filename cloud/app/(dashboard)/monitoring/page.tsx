"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

type Sprint = { id: string; name: string; status: string };

type Velocity = { currentVelocity: number; requiredVelocity: number; gapPct: number; onTrack: boolean; daysRemaining: number };

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
  name: string;
  role?: string | null;
  maxSprintCapacity: number;
  currentSprintLoad: number;
  remainingCapacity: number;
  utilizationPct: number;
  meritScore: number;
  burnoutRiskFlag: boolean;
};

type CapacityResp = { items: CapacityItem[]; totals?: { maxSprintCapacity: number; currentSprintLoad: number; overallUtilizationPct: number } };

type SprintsResp = { items?: Sprint[]; error?: string };

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
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [alerts, setAlerts] = useState<AlertsResp | null>(null);
  const [burnout, setBurnout] = useState<BurnoutResp | null>(null);
  const [capacity, setCapacity] = useState<CapacityResp | null>(null);

  const [ackLoadingId, setAckLoadingId] = useState<string | null>(null);
  const [moveOnAck, setMoveOnAck] = useState<Record<string, boolean>>({});

  const activeSprintId = useMemo(() => activeSprint?.id || null, [activeSprint]);

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);

    const sprintsResp = await fetchJson<SprintsResp>("/api/sprints?status=active");
    const sprint = Array.isArray(sprintsResp.data?.items) ? sprintsResp.data!.items[0] || null : null;
    setActiveSprint(sprint);

    const [burnoutResp, capacityResp] = await Promise.all([
      fetchJson<BurnoutResp>("/api/monitoring/burnout"),
      fetchJson<CapacityResp>("/api/monitoring/capacity"),
    ]);

    setBurnout(burnoutResp.ok ? burnoutResp.data : null);
    setCapacity(capacityResp.ok ? capacityResp.data : null);

    if (sprint?.id) {
      const [vResp, aResp] = await Promise.all([
        fetchJson<Velocity>(`/api/monitoring/sprint/${encodeURIComponent(sprint.id)}/velocity`),
        fetchJson<AlertsResp>(`/api/monitoring/sprint/${encodeURIComponent(sprint.id)}/alerts?acknowledged=false`),
      ]);

      setVelocity(vResp.ok ? vResp.data : null);
      setAlerts(aResp.ok ? aResp.data : null);
    } else {
      setVelocity(null);
      setAlerts(null);
    }

    if (!sprintsResp.ok) {
      setError(sprintsResp.data?.error || `Failed to load active sprint (${sprintsResp.status})`);
    }

    setLoading(false);
  }

  async function acknowledge(alert: AlertItem) {
    setError(null);
    setNotice(null);
    setAckLoadingId(alert.id);
    try {
      const confirmMove = Boolean(moveOnAck[alert.id]);
      const resp = await fetch(`/api/monitoring/alerts/${encodeURIComponent(alert.id)}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmMove,
          actionTaken: confirmMove ? "Moved to next sprint" : "Acknowledged",
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || `Failed to acknowledge (${resp.status})`));

      const moved = Boolean(data?.moved);
      setNotice(moved ? "Alert acknowledged and task moved to next sprint." : "Alert acknowledged.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge alert");
    } finally {
      setAckLoadingId(null);
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
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Active sprint</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{activeSprint?.name || "None"}</div>
              {activeSprintId ? <div className="mt-1 text-xs text-slate-500">{activeSprintId}</div> : null}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Velocity</div>
              {velocity ? (
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                  Current: <span className="font-semibold">{velocity.currentVelocity}</span>
                  <br />
                  Required: <span className="font-semibold">{velocity.requiredVelocity}</span>
                  <br />
                  Status: <span className="font-semibold">{velocity.onTrack ? "On track" : "Behind"}</span>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">Unavailable</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Active alerts</div>
              <div className="mt-2 text-slate-900 dark:text-white font-bold">{alerts?.items?.length || 0}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">(unacknowledged)</div>
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Active alerts</div>
              <div className="text-xs text-slate-500">Unacknowledged</div>
            </div>

            {alerts?.items?.length ? (
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
                    {alerts.items.map((a) => {
                      const canMove = String(a.suggestionAction || "") === "move_to_next_sprint" && Boolean(a.targetTaskId);
                      const busy = ackLoadingId === a.id;
                      return (
                        <tr key={a.id} className="border-t border-slate-200 dark:border-zinc-800">
                          <td className="px-3 py-3 align-top">
                            <span className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {a.severity}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-semibold text-slate-900 dark:text-white">{a.title}</div>
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{a.message}</div>
                            {a.suggestion ? <div className="mt-2 text-xs text-slate-700 dark:text-slate-200">Suggestion: {a.suggestion}</div> : null}
                            {canMove ? (
                              <label className="mt-2 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                                <input
                                  type="checkbox"
                                  checked={Boolean(moveOnAck[a.id])}
                                  onChange={(e) => setMoveOnAck((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                                  className="h-4 w-4"
                                />
                                Move task to next planning sprint
                              </label>
                            ) : null}
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
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Capacity</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Load</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Remaining</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Util</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capacity.items.map((c) => (
                      <tr key={c.name} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3 text-slate-900 dark:text-white font-semibold">
                          {c.name}
                          {c.burnoutRiskFlag ? <span className="ml-2 text-xs text-red-700 dark:text-red-300">risk</span> : null}
                        </td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{c.role || "—"}</td>
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
        </div>
      </div>
    </div>
  );
}
