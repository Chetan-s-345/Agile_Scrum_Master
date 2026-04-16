"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/next-shims/link";
import { RefreshCw } from "lucide-react";

type VelocityPoint = {
  sprintId: string;
  sprint: string;
  status: string;
  startDate: string;
  endDate: string;
  planned: number;
  velocity: number;
  completionPct: number | null;
};

type ReportItem = {
  id: string;
  name: string;
  date: string;
  type: string;
};

type ReportsResp = {
  velocityHistory?: VelocityPoint[];
  reports?: ReportItem[];
  error?: string;
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

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportsResp | null>(null);

  const velocityHistory = useMemo(() => (Array.isArray(data?.velocityHistory) ? data!.velocityHistory! : []), [data]);
  const reports = useMemo(() => (Array.isArray(data?.reports) ? data!.reports! : []), [data]);

  const avgVelocity = useMemo(() => {
    if (!velocityHistory.length) return 0;
    const sum = velocityHistory.reduce((acc, p) => acc + Number(p.velocity || 0), 0);
    return Math.round((sum / velocityHistory.length) * 100) / 100;
  }, [velocityHistory]);

  const avgCompletion = useMemo(() => {
    const vals = velocityHistory.map((p) => p.completionPct).filter((v): v is number => typeof v === "number");
    if (!vals.length) return null;
    const sum = vals.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / vals.length) * 10) / 10;
  }, [velocityHistory]);

  const lastSprint = useMemo(() => (velocityHistory.length ? velocityHistory[velocityHistory.length - 1] : null), [velocityHistory]);

  async function load() {
    setLoading(true);
    setError(null);
    const resp = await fetchJson<ReportsResp>("/api/reports");
    if (!resp.ok) {
      setData(null);
      setError(String(resp.data?.error || `Failed to load reports (${resp.status})`));
      setLoading(false);
      return;
    }
    setData(resp.data);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Reports</h1>
            <p className="text-slate-600 dark:text-slate-300">Sprint history, velocity, and completion snapshots.</p>
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

        {loading ? <div className="text-slate-600 dark:text-slate-300">Loading…</div> : null}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Avg Velocity</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{avgVelocity}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Across {velocityHistory.length} sprints</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Completion Rate</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{avgCompletion === null ? "—" : `${avgCompletion}%`}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Planned vs completed points</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Latest Sprint</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{lastSprint?.sprint || "—"}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{lastSprint ? `${lastSprint.velocity}/${lastSprint.planned} points` : ""}</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Recent Reports</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{reports.length}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Last 10 sprints</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Velocity history</h2>
            {velocityHistory.length ? (
              <div className="overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Sprint</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Planned</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Done</th>
                      <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {velocityHistory.map((p) => (
                      <tr key={p.sprintId} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">{p.sprint}</div>
                          <div className="text-xs text-slate-500">{p.status}</div>
                        </td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{p.planned}</td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{p.velocity}</td>
                        <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{p.completionPct === null ? "—" : `${p.completionPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No active/completed sprints yet.</div>
            )}
          </div>

          {/* Recent Reports */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Recent Reports</h2>
            <div className="space-y-2">
              {reports.length ? (
                reports.map((report) => (
                  <Link
                    key={report.id}
                    href={`/reports/${encodeURIComponent(report.id)}`}
                    className="block p-3 bg-slate-50 dark:bg-black/30 rounded-lg hover:bg-slate-100 dark:hover:bg-black/40 transition border border-slate-200 dark:border-zinc-800"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white text-sm">{report.name}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{String(report.date).slice(0, 10)} • {report.type}</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 underline">Open</span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No reports available.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

