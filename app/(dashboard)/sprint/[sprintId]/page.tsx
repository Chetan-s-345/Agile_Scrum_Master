"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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

type SprintGetResp = { sprint?: Sprint; error?: string } | (Sprint & { error?: never });

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

function normalizeSprint(data: SprintGetResp | null): Sprint | null {
  if (!data) return null;
  if (typeof data === "object" && data && "sprint" in data) {
    const maybe = (data as { sprint?: Sprint }).sprint;
    return maybe ?? null;
  }
  if (typeof data === "object" && data && "id" in data && "name" in data && "status" in data) {
    return data as Sprint;
  }
  return null;
}

function extractError(data: SprintGetResp | null): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null; text?: string }> {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data, text };
}

export default function SprintDetailPage() {
  const params = useParams<{ sprintId: string }>();
  const sprintId = params?.sprintId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [velocity, setVelocity] = useState<Velocity | null>(null);
  const [alerts, setAlerts] = useState<AlertsResp | null>(null);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [burndown, setBurndown] = useState<BurndownPoint[]>([]);

  const hasId = useMemo(() => typeof sprintId === "string" && sprintId.length > 0, [sprintId]);

  async function load() {
    if (!hasId) return;
    setLoading(true);
    setError(null);

    const [sResp, vResp, aResp, rResp, bResp] = await Promise.all([
      fetchJson<SprintGetResp>(`/api/sprints/${encodeURIComponent(sprintId)}`),
      fetchJson<Velocity>(`/api/monitoring/sprint/${encodeURIComponent(sprintId)}/velocity`),
      fetchJson<AlertsResp>(`/api/monitoring/sprint/${encodeURIComponent(sprintId)}/alerts?acknowledged=false`),
      fetchJson<Risk>(`/api/sprints/${encodeURIComponent(sprintId)}/risk`),
      fetchJson<{ items: BurndownPoint[] }>(`/api/sprints/${encodeURIComponent(sprintId)}/burndown`),
    ]);

    if (!sResp.ok) {
      setSprint(null);
      setError(extractError(sResp.data) || `Failed to load sprint (${sResp.status})`);
      setLoading(false);
      return;
    }

    setSprint(normalizeSprint(sResp.data));

    setVelocity(vResp.ok ? vResp.data : null);
    setAlerts(aResp.ok ? aResp.data : null);
    setRisk(rResp.ok ? rResp.data : null);
    setBurndown(bResp.ok && Array.isArray(bResp.data?.items) ? bResp.data!.items : []);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasId, sprintId]);

  async function startSprint() {
    if (!hasId) return;
    await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/start`, { method: "PATCH" });
    await load();
  }

  async function completeSprint() {
    if (!hasId) return;
    await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/complete`, { method: "PATCH" });
    await load();
  }

  if (!hasId) {
    return <div className="min-h-screen bg-white dark:bg-black px-4 py-8">Missing sprint id.</div>;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{sprint?.name || "Sprint"}</h1>
            <div className="mt-1 text-slate-600 dark:text-slate-300">ID: {sprintId}</div>
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
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm font-semibold"
            >
              Start
            </button>
            <button
              onClick={completeSprint}
              className="rounded-lg bg-green-600 hover:bg-green-700 text-white px-3 py-2 text-sm font-semibold"
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
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burndown (raw)</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Showing first 10 points.</div>
          <pre className="mt-3 max-h-[320px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
            {JSON.stringify(burndown.slice(0, 10), null, 2)}
          </pre>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Risk (raw)</div>
          <pre className="mt-3 max-h-[320px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
            {JSON.stringify(risk, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
