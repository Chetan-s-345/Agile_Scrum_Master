"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  sprint: string;
  date: string;
  type: string;
  planned: number;
  completed: number;
  completionPct: number | null;
  blockedCount: number;
  burnoutRiskCount: number;
  riskScore: number;
  riskLevel: string;
  alerts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
};

type BurnoutTrendPoint = {
  sprintId: string;
  sprint: string;
  atRiskCount: number;
  avgOverloadPct: number;
};

type BlockerTrendPoint = {
  sprintId: string;
  sprint: string;
  blockedCount: number;
};

type RiskTrendPoint = {
  sprintId: string;
  sprint: string;
  riskScore: number;
  riskLevel: string;
};

type ReportsSummary = {
  avgVelocity: number;
  avgCompletionPct: number | null;
  activeOrRecentSprint: string | null;
  openBurnoutFlags: number;
  unresolvedAlerts: number;
};

type ReportsResp = {
  summary?: ReportsSummary;
  velocityHistory?: VelocityPoint[];
  burnoutTrend?: BurnoutTrendPoint[];
  blockerTrend?: BlockerTrendPoint[];
  riskTrend?: RiskTrendPoint[];
  reports?: ReportItem[];
  descriptions?: {
    velocity?: string;
    burnout?: string;
    blockers?: string;
    risk?: string;
  };
  error?: string;
};

function riskBadgeTone(level: string) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "critical") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
  if (normalized === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200";
  if (normalized === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const resp = await fetch(url, { cache: "no-store" });
    const text = await resp.text().catch(() => "");
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 503, data: null };
  }
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportsResp | null>(null);

  const summary = useMemo(() => data?.summary || null, [data]);
  const velocityHistory = useMemo(() => (Array.isArray(data?.velocityHistory) ? data!.velocityHistory! : []), [data]);
  const burnoutTrend = useMemo(() => (Array.isArray(data?.burnoutTrend) ? data!.burnoutTrend! : []), [data]);
  const blockerTrend = useMemo(() => (Array.isArray(data?.blockerTrend) ? data!.blockerTrend! : []), [data]);
  const riskTrend = useMemo(() => (Array.isArray(data?.riskTrend) ? data!.riskTrend! : []), [data]);
  const reports = useMemo(() => (Array.isArray(data?.reports) ? data!.reports! : []), [data]);
  const descriptions = useMemo(() => data?.descriptions || {}, [data]);

  const avgVelocity = useMemo(() => {
    if (summary) return Number(summary.avgVelocity || 0);
    if (!velocityHistory.length) return 0;
    const sum = velocityHistory.reduce((acc, p) => acc + Number(p.velocity || 0), 0);
    return Math.round((sum / velocityHistory.length) * 100) / 100;
  }, [velocityHistory, summary]);

  const avgCompletion = useMemo(() => {
    if (summary && typeof summary.avgCompletionPct === "number") return summary.avgCompletionPct;
    const vals = velocityHistory.map((p) => p.completionPct).filter((v): v is number => typeof v === "number");
    if (!vals.length) return null;
    const sum = vals.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / vals.length) * 10) / 10;
  }, [velocityHistory, summary]);

  const lastSprint = useMemo(() => (velocityHistory.length ? velocityHistory[velocityHistory.length - 1] : null), [velocityHistory]);

  const latestRisk = useMemo(() => (riskTrend.length ? riskTrend[riskTrend.length - 1] : null), [riskTrend]);

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

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
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
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{summary?.activeOrRecentSprint || lastSprint?.sprint || "—"}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{lastSprint ? `${lastSprint.velocity}/${lastSprint.planned} points` : ""}</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Recent Reports</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{reports.length}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Last 10 sprints</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Open Burnout Flags</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{summary?.openBurnoutFlags ?? 0}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Team members at sustained overload</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Unresolved Alerts</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{summary?.unresolvedAlerts ?? 0}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Monitoring alerts pending review</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Current Risk Level</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">{latestRisk?.riskScore ?? 0}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 capitalize">{latestRisk?.riskLevel || "low"}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 mb-8">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">What This Report Covers</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Use this page to review sprint delivery quality, identify burnout risk, track blockers, and spot delay escalation patterns for Scrum Master interventions.
          </p>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-black/20">
              <div className="font-semibold text-slate-900 dark:text-white">Velocity</div>
              <div className="text-slate-600 dark:text-slate-300">{descriptions.velocity || "Sprint throughput and planned versus completed points."}</div>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-black/20">
              <div className="font-semibold text-slate-900 dark:text-white">Burnout</div>
              <div className="text-slate-600 dark:text-slate-300">{descriptions.burnout || "Over-capacity trend and contributor health signals."}</div>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-black/20">
              <div className="font-semibold text-slate-900 dark:text-white">Blockers</div>
              <div className="text-slate-600 dark:text-slate-300">{descriptions.blockers || "Dependency and workflow blockers by sprint."}</div>
            </div>
            <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-black/20">
              <div className="font-semibold text-slate-900 dark:text-white">Risk</div>
              <div className="text-slate-600 dark:text-slate-300">{descriptions.risk || "Delay risk score and escalation level from sprint snapshots."}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Velocity Trend</h2>
            {velocityHistory.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={velocityHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sprint" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="planned" stroke="#64748b" strokeWidth={2} name="Planned" />
                    <Line type="monotone" dataKey="velocity" stroke="#0f172a" strokeWidth={2} name="Completed" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No active/completed sprints yet.</div>
            )}
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Risk and Blocker Trend</h2>
            {riskTrend.length || blockerTrend.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={riskTrend.map((point, idx) => ({ ...point, blockedCount: blockerTrend[idx]?.blockedCount || 0 }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sprint" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Line yAxisId="left" type="monotone" dataKey="riskScore" stroke="#b91c1c" strokeWidth={2} name="Risk Score" />
                    <Line yAxisId="right" type="monotone" dataKey="blockedCount" stroke="#1d4ed8" strokeWidth={2} name="Blocked Tasks" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No risk or blocker history available.</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Burnout Exposure by Sprint</h2>
            {burnoutTrend.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={burnoutTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sprint" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="atRiskCount" fill="#dc2626" name="At-Risk Contributors" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No burnout trend data available.</div>
            )}
          </div>

          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Delivery Completion Trend</h2>
            {velocityHistory.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={velocityHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sprint" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="completionPct" stroke="#0369a1" strokeWidth={2} name="Completion %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No completion trend available.</div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Recent Sprint Reports</h2>
          {reports.length ? (
            <div className="overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-black/40">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Sprint</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Completion</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Blocked</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Burnout</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Alerts</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Risk</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id} className="border-t border-slate-200 dark:border-zinc-800">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{report.sprint}</div>
                        <div className="text-xs text-slate-500">{String(report.date).slice(0, 10)} • {report.type}</div>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">
                        {report.completionPct === null ? "—" : `${report.completionPct}%`}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{report.blockedCount}</td>
                      <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{report.burnoutRiskCount}</td>
                      <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-200">{report.alerts.total}</td>
                      <td className="px-3 py-3 text-right">
                        <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${riskBadgeTone(report.riskLevel)}`}>
                          {report.riskLevel} ({report.riskScore})
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/reports/${encodeURIComponent(report.id)}`}
                          className="inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-600 dark:text-slate-300">No reports available.</div>
          )}
        </div>
      </div>
    </div>
  );
}
