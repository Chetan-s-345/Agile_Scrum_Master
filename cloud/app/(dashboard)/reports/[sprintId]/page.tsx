"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, FileDown, RefreshCw } from "lucide-react";
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

type SprintReportResp = {
  sprint?: {
    id: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
    plannedPoints: number;
    completedPoints: number;
    completionPct: number | null;
  };
  burndown?: Array<{
    day: number;
    date: string | null;
    idealRemaining: number;
    actualRemaining: number;
    delayRiskScore: number;
    velocityGapPct: number;
  }>;
  risk?: {
    riskScore: number;
    riskLevel: string;
    velocityGapPct: number;
    blockedCount: number;
    recommendations: string[];
  };
  alerts?: Array<{
    id: string;
    severity: string;
    title: string;
    message: string;
    suggestion: string | null;
    acknowledged: boolean;
    createdAt: string;
  }>;
  tasks?: {
    byStatus: Array<{ status: string; count: number; storyPoints: number }>;
    blockedCount: number;
  };
  contributors?: Array<{
    name: string;
    storyPointsAssigned: number;
    storyPointsCompleted: number;
    tasksCompleted: number;
    overCapacity: boolean;
  }>;
  burnout?: Array<{
    name: string;
    storyPointsAssigned: number;
    maxCapacity: number;
    overloadPct: number;
    overCapacity: boolean;
  }>;
  meetings?: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    decisions: string | null;
    risks: string | null;
    actionItems: Array<{ id?: string; title?: string; status?: string }>;
    scheduledStart: string;
  }>;
  descriptions?: {
    overview?: string;
    burndown?: string;
    risk?: string;
    burnout?: string;
  };
  error?: string;
};

function riskTone(level: string) {
  const v = String(level || "").toLowerCase();
  if (v === "critical") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
  if (v === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200";
  if (v === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
}

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

export default function SprintReportPage() {
  const params = useParams<{ sprintId: string }>();
  const sprintId = params?.sprintId;
  const hasId = useMemo(() => typeof sprintId === "string" && sprintId.length > 0, [sprintId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SprintReportResp | null>(null);

  const sprint = useMemo(() => data?.sprint || null, [data]);
  const burndown = useMemo(() => (Array.isArray(data?.burndown) ? data!.burndown! : []), [data]);
  const risk = useMemo(() => data?.risk || null, [data]);
  const tasksByStatus = useMemo(() => (Array.isArray(data?.tasks?.byStatus) ? data!.tasks!.byStatus : []), [data]);
  const alerts = useMemo(() => (Array.isArray(data?.alerts) ? data!.alerts! : []), [data]);
  const burnout = useMemo(() => (Array.isArray(data?.burnout) ? data!.burnout! : []), [data]);
  const contributors = useMemo(() => (Array.isArray(data?.contributors) ? data!.contributors! : []), [data]);
  const meetings = useMemo(() => (Array.isArray(data?.meetings) ? data!.meetings! : []), [data]);

  async function loadReport() {
    if (!hasId) return;

    const resp = await fetchJson<SprintReportResp>(`/api/reports/${encodeURIComponent(sprintId)}`);
    if (!resp.ok) {
      setError(String(resp.data?.error || `Failed to load sprint report (${resp.status})`));
      setData(null);
      setLoading(false);
      return;
    }

    setData(resp.data);
    setLoading(false);
  }

  function exportCsv() {
    if (!hasId) return;
    window.location.href = `/api/reports/${encodeURIComponent(sprintId)}/export`;
  }

  function exportPdf() {
    window.print();
  }

  useEffect(() => {
    if (!hasId) return;
    let cancelled = false;

    (async () => {
      const resp = await fetchJson<SprintReportResp>(`/api/reports/${encodeURIComponent(sprintId)}`);
      if (cancelled) return;

      if (!resp.ok) {
        setError(String(resp.data?.error || `Failed to load sprint report (${resp.status})`));
        setData(null);
        setLoading(false);
        return;
      }

      setData(resp.data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [hasId, sprintId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Sprint Report</h1>
            <p className="text-slate-600 dark:text-slate-300">Sprint ID: {sprintId}</p>
            <p className="text-xs text-slate-500 mt-1">{data?.descriptions?.overview || "Comprehensive sprint delivery and health report for Scrum Master decisions."}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                void loadReport();
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white"
            >
              <FileDown className="h-4 w-4" /> CSV
            </button>
            <button
              onClick={exportPdf}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-white px-3 py-2 text-sm font-semibold text-white dark:text-black"
            >
              <Download className="h-4 w-4" /> PDF
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-slate-500">Sprint</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">{sprint?.name || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Status</div>
                  <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold mt-1 ${riskTone(risk?.riskLevel || "low")}`}>
                    {String(sprint?.status || "unknown")}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Completion</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">
                    {typeof sprint?.completionPct === "number" ? `${sprint.completionPct}%` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Points</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">{sprint?.completedPoints || 0}/{sprint?.plannedPoints || 0}</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burndown</div>
                  <div className="text-xs text-slate-500">{data?.descriptions?.burndown || "Ideal vs actual remaining points over sprint days."}</div>
                </div>
              </div>
              {burndown.length ? (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={burndown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="idealRemaining" name="Ideal Remaining" stroke="#64748b" strokeWidth={2} />
                      <Line type="monotone" dataKey="actualRemaining" name="Actual Remaining" stroke="#b91c1c" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No burndown snapshots available for this sprint.</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sprint Risk</div>
              <div className="text-xs text-slate-500 mt-1">{data?.descriptions?.risk || "Risk score from delay likelihood, blockers, and velocity gap."}</div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-slate-500">Risk Score</div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{risk?.riskScore ?? 0}</div>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-slate-500">Risk Level</div>
                  <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold mt-1 ${riskTone(risk?.riskLevel || "low")}`}>
                    {risk?.riskLevel || "low"}
                  </span>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-slate-500">Velocity Gap</div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{risk?.velocityGapPct ?? 0}%</div>
                </div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                  <div className="text-xs text-slate-500">Blocked Tasks</div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">{risk?.blockedCount ?? 0}</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Recommendations</div>
                {risk?.recommendations?.length ? (
                  <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                    {risk.recommendations.map((item, idx) => (
                      <li key={`${idx}-${item}`}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No urgent recommendations.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Task Status Distribution</div>
                {tasksByStatus.length ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tasksByStatus}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="status" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#0f172a" name="Tasks" />
                        <Bar dataKey="storyPoints" fill="#0369a1" name="Story Points" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No task distribution data available.</div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Burnout Snapshot</div>
                <div className="text-xs text-slate-500 mb-4">{data?.descriptions?.burnout || "Shows contributors above healthy sprint capacity."}</div>
                {burnout.length ? (
                  <div className="overflow-auto rounded-md border border-slate-200 dark:border-zinc-800">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-black/40">
                        <tr>
                          <th className="text-left px-3 py-2">Developer</th>
                          <th className="text-right px-3 py-2">Assigned</th>
                          <th className="text-right px-3 py-2">Capacity</th>
                          <th className="text-right px-3 py-2">Overload</th>
                        </tr>
                      </thead>
                      <tbody>
                        {burnout.map((row) => (
                          <tr key={`${row.name}-${row.maxCapacity}`} className="border-t border-slate-200 dark:border-zinc-800">
                            <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{row.name}</td>
                            <td className="px-3 py-2 text-right">{row.storyPointsAssigned}</td>
                            <td className="px-3 py-2 text-right">{row.maxCapacity}</td>
                            <td className="px-3 py-2 text-right">
                              <span className={row.overCapacity ? "text-red-700 dark:text-red-300 font-semibold" : "text-emerald-700 dark:text-emerald-300 font-semibold"}>
                                {row.overloadPct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No burnout data for this sprint.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Top Contributors</div>
                {contributors.length ? (
                  <div className="overflow-auto rounded-md border border-slate-200 dark:border-zinc-800">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-black/40">
                        <tr>
                          <th className="text-left px-3 py-2">Developer</th>
                          <th className="text-right px-3 py-2">Completed Points</th>
                          <th className="text-right px-3 py-2">Tasks Done</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contributors.map((row) => (
                          <tr key={`${row.name}-${row.tasksCompleted}`} className="border-t border-slate-200 dark:border-zinc-800">
                            <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{row.name}</td>
                            <td className="px-3 py-2 text-right">{row.storyPointsCompleted}</td>
                            <td className="px-3 py-2 text-right">{row.tasksCompleted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No contributor data available.</div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Recent Alerts</div>
                {alerts.length ? (
                  <div className="space-y-2 max-h-72 overflow-auto">
                    {alerts.slice(0, 8).map((row) => (
                      <div key={row.id} className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900 dark:text-white text-sm">{row.title}</div>
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${riskTone(row.severity)}`}>{row.severity}</span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{row.message}</div>
                        {row.suggestion ? <div className="text-xs text-slate-500 mt-1">Suggestion: {row.suggestion}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No alerts recorded for this sprint.</div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Meeting Insights Feeding This Report</div>
              {meetings.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {meetings.slice(0, 6).map((meeting) => (
                    <div key={meeting.id} className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-black/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-slate-900 dark:text-white text-sm">{meeting.title}</div>
                        <span className="text-xs text-slate-500 capitalize">{meeting.type}</span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 mt-2 line-clamp-4">{meeting.summary || "No AI summary available."}</div>
                      {meeting.risks ? <div className="text-xs text-red-700 dark:text-red-300 mt-2">Risks: {meeting.risks}</div> : null}
                      {Array.isArray(meeting.actionItems) && meeting.actionItems.length ? (
                        <div className="text-xs text-slate-600 dark:text-slate-300 mt-2">Actions: {meeting.actionItems.length}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No meeting insights linked to this sprint yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
