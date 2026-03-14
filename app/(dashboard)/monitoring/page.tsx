"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

type Sprint = { id: string; name: string; status: string };

type Velocity = { currentVelocity: number; requiredVelocity: number; gapPct: number; onTrack: boolean; daysRemaining: number };

type AlertsResp = { items: Array<{ id: string; severity: string; title: string; message: string; createdAt: string; acknowledged: boolean }> };

type BurnoutResp = { items: Array<{ developerId: string; name: string; consecutiveOverSprints: number; avgOverloadPct: number; alertLevel: string }> };

type CapacityResp = { items: Array<Record<string, unknown>>; totals?: Record<string, unknown> };

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

  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [alerts, setAlerts] = useState<AlertsResp | null>(null);
  const [burnout, setBurnout] = useState<BurnoutResp | null>(null);
  const [capacity, setCapacity] = useState<CapacityResp | null>(null);

  const activeSprintId = useMemo(() => activeSprint?.id || null, [activeSprint]);

  async function load() {
    setLoading(true);
    setError(null);

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
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Alerts (raw)</div>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
              {JSON.stringify(alerts, null, 2)}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burnout (raw)</div>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
              {JSON.stringify(burnout, null, 2)}
            </pre>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 lg:col-span-2">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Team capacity (raw)</div>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
              {JSON.stringify(capacity, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
