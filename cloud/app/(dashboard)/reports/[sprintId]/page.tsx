"use client";

import Link from "next/link";
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
  github?: {
    summary?: {
      commits: number;
      pushes: number;
      pullRequests: number;
      reviews: number;
      issues: number;
      contributors: number;
      repositories: number;
      additions: number;
      deletions: number;
      lastEventAt: string | null;
    };
    byDeveloper?: Array<{
      developer: string;
      totalEvents: number;
      commits: number;
      pullRequests: number;
      additions: number;
      deletions: number;
    }>;
    recentEvents?: Array<{
      id: string;
      type: string;
      repo: string | null;
      developer: string;
      commitSha: string | null;
      prNumber: number | null;
      branch: string | null;
      additions: number;
      deletions: number;
      eventAt: string;
    }>;
  };
  error?: string;
};

type TopContributorRow =
  | {
      source: "github";
      name: string;
      events: number;
      commits: number;
      pullRequests: number;
      additions: number;
      deletions: number;
    }
  | {
      source: "sprint";
      name: string;
      storyPointsCompleted: number;
      tasksCompleted: number;
    };

type SprintAuditResp = {
  developer_audit?: {
    section_score?: number;
    section_status?: string;
    skill_gap?: string[];
    overloaded_developers?: Array<{ developer_id?: string; name?: string; assigned_story_points?: number }>;
    underutilised_developers?: Array<{ developer_id?: string; name?: string; assigned_story_points?: number; capacity?: number }>;
    task_mismatch?: Array<{ task_id?: string; title?: string; developer_name?: string; required_skills?: string[] }>;
    recommended_upskilling?: Array<{ developer_id?: string; name?: string; skill_area?: string; related_backlog_items?: string[] }>;
  };
  recommendations?: {
    section_score?: number;
    section_status?: string;
    top_3_immediate_actions?: string[];
    top_3_process_improvements?: string[];
    hiring_or_training_recommendation?: string;
    executive_summary?: string;
    ai_summary?: string | null;
    ai_skill_focus?: Array<{ skill?: string; reason?: string; target_developers?: string[]; recommended_actions?: string[] }>;
    ai_bench_actions?: Array<{ developer?: string; current_load?: number; focus?: string; next_steps?: string[] }>;
    ai_notes?: string[];
  };
};

function riskTone(level: string) {
  const v = String(level || "").toLowerCase();
  if (v === "critical") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
  if (v === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200";
  if (v === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
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

export default function SprintReportPage() {
  const params = useParams<{ sprintId: string }>();
  const sprintId = params?.sprintId;
  const hasId = useMemo(() => typeof sprintId === "string" && sprintId.length > 0, [sprintId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SprintReportResp | null>(null);
  const [audit, setAudit] = useState<SprintAuditResp | null>(null);

  const sprint = useMemo(() => data?.sprint || null, [data]);
  const burndown = useMemo(() => (Array.isArray(data?.burndown) ? data!.burndown! : []), [data]);
  const risk = useMemo(() => data?.risk || null, [data]);
  const tasksByStatus = useMemo(() => (Array.isArray(data?.tasks?.byStatus) ? data!.tasks!.byStatus : []), [data]);
  const alerts = useMemo(() => (Array.isArray(data?.alerts) ? data!.alerts! : []), [data]);
  const burnout = useMemo(() => (Array.isArray(data?.burnout) ? data!.burnout! : []), [data]);
  const contributors = useMemo(() => (Array.isArray(data?.contributors) ? data!.contributors! : []), [data]);
  const meetings = useMemo(() => (Array.isArray(data?.meetings) ? data!.meetings! : []), [data]);
  const githubSummary = useMemo(() => data?.github?.summary || null, [data]);
  const githubByDeveloper = useMemo(() => (Array.isArray(data?.github?.byDeveloper) ? data!.github!.byDeveloper! : []), [data]);
  const githubEvents = useMemo(() => (Array.isArray(data?.github?.recentEvents) ? data!.github!.recentEvents! : []), [data]);
  const topContributors = useMemo<TopContributorRow[]>(() => {
    if (githubByDeveloper.length) {
      return githubByDeveloper.map((row) => ({
        source: "github",
        name: row.developer,
        events: row.totalEvents,
        commits: row.commits,
        pullRequests: row.pullRequests,
        additions: row.additions,
        deletions: row.deletions,
      }));
    }

    return contributors.map((row) => ({
      source: "sprint",
      name: row.name,
      storyPointsCompleted: row.storyPointsCompleted,
      tasksCompleted: row.tasksCompleted,
    }));
  }, [contributors, githubByDeveloper]);

  async function loadReport() {
    if (!hasId) return;

    const [reportResp, auditResp] = await Promise.all([
      fetchJson<SprintReportResp>(`/api/reports/${encodeURIComponent(sprintId)}`),
      fetchJson<SprintAuditResp>(`/api/reports/${encodeURIComponent(sprintId)}/audit`),
    ]);

    if (!reportResp.ok) {
      setError(String(reportResp.data?.error || `Failed to load sprint report (${reportResp.status})`));
      setData(null);
      setAudit(null);
      setLoading(false);
      return;
    }

    setData(reportResp.data);
    setAudit(auditResp.ok ? auditResp.data : null);
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
      const [reportResp, auditResp] = await Promise.all([
        fetchJson<SprintReportResp>(`/api/reports/${encodeURIComponent(sprintId)}`),
        fetchJson<SprintAuditResp>(`/api/reports/${encodeURIComponent(sprintId)}/audit`),
      ]);
      if (cancelled) return;

      if (!reportResp.ok) {
        setError(String(reportResp.data?.error || `Failed to load sprint report (${reportResp.status})`));
        setData(null);
        setAudit(null);
        setLoading(false);
        return;
      }

      setData(reportResp.data);
      setAudit(auditResp.ok ? auditResp.data : null);
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

            {audit ? (
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Skill & workload audit</div>
                    <div className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                      {audit.recommendations?.ai_summary || audit.recommendations?.executive_summary || "No AI summary available yet."}
                    </div>
                  </div>
                  <Link
                    href="/skill-gap"
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white"
                  >
                    Open skill audit
                  </Link>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs text-slate-500">Skill gaps</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{audit.developer_audit?.skill_gap?.length ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs text-slate-500">Bench developers</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{audit.developer_audit?.underutilised_developers?.length ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs text-slate-500">Task mismatches</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{audit.developer_audit?.task_mismatch?.length ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                    <div className="text-xs text-slate-500">Audit score</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{audit.developer_audit?.section_score ?? 0}</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-4">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Immediate actions</div>
                    {audit.recommendations?.top_3_immediate_actions?.length ? (
                      <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                        {audit.recommendations.top_3_immediate_actions.map((item, idx) => (
                          <div key={`${idx}-${item}`} className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                            {item}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-600 dark:text-slate-300">No AI recommendations available.</div>
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 dark:border-zinc-800 p-4">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Bench developer focus</div>
                    {audit.developer_audit?.underutilised_developers?.length ? (
                      <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                        {audit.developer_audit.underutilised_developers.map((dev) => (
                          <div key={String(dev.developer_id || dev.name)} className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                            <div className="font-semibold text-slate-900 dark:text-white">{dev.name}</div>
                            <div className="text-xs text-slate-500">{dev.assigned_story_points ?? 0} points / {dev.capacity ?? 0} capacity</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-600 dark:text-slate-300">No underutilised developers detected.</div>
                    )}
                  </div>
                </div>

                {audit.developer_audit?.skill_gap?.length ? (
                  <div className="mt-5 rounded-md border border-slate-200 dark:border-zinc-800 p-4">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Skill gaps to close</div>
                    <div className="flex flex-wrap gap-2">
                      {audit.developer_audit.skill_gap.map((skill) => (
                        <span key={skill} className="rounded-full bg-slate-100 dark:bg-black/30 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-200">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burndown</div>
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

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">GitHub Delivery Activity</div>
              <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-3">
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Commits</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.commits ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Pushes</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.pushes ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">PRs</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.pullRequests ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Reviews</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.reviews ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Issues</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.issues ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Contributors</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.contributors ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Repos</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.repositories ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Additions</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.additions ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Deletions</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.deletions ?? 0}</div></div>
                <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2"><div className="text-xs text-slate-500">Last Event</div><div className="font-semibold text-slate-900 dark:text-white">{githubSummary?.lastEventAt ? new Date(githubSummary.lastEventAt).toLocaleDateString() : "-"}</div></div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">GitHub Contribution by Developer</div>
                {githubByDeveloper.length ? (
                  <div className="overflow-auto rounded-md border border-slate-200 dark:border-zinc-800">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-black/40">
                        <tr>
                          <th className="text-left px-3 py-2">Developer</th>
                          <th className="text-right px-3 py-2">Events</th>
                          <th className="text-right px-3 py-2">Commits</th>
                          <th className="text-right px-3 py-2">PRs</th>
                          <th className="text-right px-3 py-2">Code Churn</th>
                        </tr>
                      </thead>
                      <tbody>
                        {githubByDeveloper.map((row) => (
                          <tr key={`${row.developer}-${row.totalEvents}`} className="border-t border-slate-200 dark:border-zinc-800">
                            <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{row.developer}</td>
                            <td className="px-3 py-2 text-right">{row.totalEvents}</td>
                            <td className="px-3 py-2 text-right">{row.commits}</td>
                            <td className="px-3 py-2 text-right">{row.pullRequests}</td>
                            <td className="px-3 py-2 text-right">+{row.additions}/-{row.deletions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No GitHub contributor activity linked to this sprint.</div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Recent GitHub Events</div>
                {githubEvents.length ? (
                  <div className="space-y-2 max-h-80 overflow-auto">
                    {githubEvents.map((event) => (
                      <div key={event.id} className="rounded-md border border-slate-200 dark:border-zinc-800 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{event.type}</div>
                          <div className="text-xs text-slate-500">{new Date(event.eventAt).toLocaleString()}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {event.developer} · {event.repo || "repo-n/a"} · {event.branch || "branch-n/a"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {event.commitSha ? `Commit ${event.commitSha.slice(0, 8)}` : ""}
                          {event.prNumber ? ` PR #${event.prNumber}` : ""}
                          {` +${event.additions} / -${event.deletions}`}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">No GitHub events recorded for this sprint.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Top Contributors</div>
                {topContributors.length ? (
                  <div className="overflow-auto rounded-md border border-slate-200 dark:border-zinc-800">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-black/40">
                        <tr>
                          <th className="text-left px-3 py-2">Developer</th>
                          {topContributors[0]?.source === "github" ? (
                            <>
                              <th className="text-right px-3 py-2">Events</th>
                              <th className="text-right px-3 py-2">Commits</th>
                              <th className="text-right px-3 py-2">PRs</th>
                              <th className="text-right px-3 py-2">Code Churn</th>
                            </>
                          ) : (
                            <>
                              <th className="text-right px-3 py-2">Completed Points</th>
                              <th className="text-right px-3 py-2">Tasks Done</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {topContributors.map((row) =>
                          row.source === "github" ? (
                            <tr key={`${row.name}-${row.events}`} className="border-t border-slate-200 dark:border-zinc-800">
                              <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{row.name}</td>
                              <td className="px-3 py-2 text-right">{row.events}</td>
                              <td className="px-3 py-2 text-right">{row.commits}</td>
                              <td className="px-3 py-2 text-right">{row.pullRequests}</td>
                              <td className="px-3 py-2 text-right">+{row.additions}/-{row.deletions}</td>
                            </tr>
                          ) : (
                            <tr key={`${row.name}-${row.tasksCompleted}`} className="border-t border-slate-200 dark:border-zinc-800">
                              <td className="px-3 py-2 text-slate-900 dark:text-white font-medium">{row.name}</td>
                              <td className="px-3 py-2 text-right">{row.storyPointsCompleted}</td>
                              <td className="px-3 py-2 text-right">{row.tasksCompleted}</td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    No GitHub contributor activity linked to this sprint yet. Make sure sprint tasks are associated with GitHub push or PR events.
                  </div>
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
