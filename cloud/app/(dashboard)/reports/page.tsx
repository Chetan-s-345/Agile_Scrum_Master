"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
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
  planned: number;
  velocity: number;
  completionPct: number | null;
};

type ReportItem = {
  id: string;
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
  tasksCreated?: number;
  tasksDone?: number;
  tasksInProgress?: number;
  tasksInReview?: number;
  tasksTodo?: number;
  totalStoryPoints?: number;
  meetings?: number;
  alerts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  github?: {
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
};

type RiskTrendPoint = {
  sprintId: string;
  sprint: string;
  riskScore: number;
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
  riskTrend?: RiskTrendPoint[];
  reports?: ReportItem[];
  error?: string;
};

type SprintItem = {
  id: string;
  name: string;
  status: string;
};

type SprintsResp = {
  items?: SprintItem[];
  error?: string;
};

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

type AuditSection = {
  section_score: number;
  section_status: "Healthy" | "Needs Attention" | "Critical" | string;
  [key: string]: unknown;
};

type SprintAuditResp = {
  audit_generated_at: string;
  sprint_id: string;
  org_id: string;
  sprint_health: AuditSection;
  backlog_audit: AuditSection;
  developer_audit: AuditSection;
  velocity_audit: AuditSection;
  risk_audit: AuditSection;
  process_audit: AuditSection;
  recommendations: AuditSection;
};

type AuditSectionEntry = {
  key: string;
  label: string;
  value: string;
};

function compactList(value: unknown): string[] {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function summarizeAuditObject(value: Record<string, unknown>): string {
  const primaryKeys = ["name", "title", "developer_name", "skill_area", "reason"];
  const primary = primaryKeys.map((key) => value[key]).find((item) => item !== null && item !== undefined && String(item).trim() !== "");
  const details: string[] = [];

  if (typeof value.assigned_story_points === "number") details.push(`${value.assigned_story_points} pts assigned`);
  if (typeof value.capacity === "number") details.push(`${value.capacity} capacity`);
  if (typeof value.current_load === "number") details.push(`load ${value.current_load}`);
  if (typeof value.section_score === "number") details.push(`score ${value.section_score}`);

  const targetDevelopers = compactList(value.target_developers);
  if (targetDevelopers.length) details.push(`target: ${targetDevelopers.join(", ")}`);

  const requiredSkills = compactList(value.required_skills);
  if (requiredSkills.length) details.push(`needs: ${requiredSkills.join(", ")}`);

  const backlogItems = compactList(value.related_backlog_items);
  if (backlogItems.length) details.push(`backlog: ${backlogItems.join(", ")}`);

  const actions = compactList(value.recommended_actions);
  if (actions.length) details.push(`actions: ${actions.join(", ")}`);

  const nextSteps = compactList(value.next_steps);
  if (nextSteps.length) details.push(`next: ${nextSteps.join(", ")}`);

  if (primary && String(primary).trim()) {
    return details.length ? `${String(primary)} · ${details.join(" · ")}` : String(primary);
  }

  const fallback = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && String(entryValue).trim() !== "")
    .slice(0, 3)
    .map(([key, entryValue]) => `${key.replace(/_/g, " ")}: ${Array.isArray(entryValue) ? compactList(entryValue).join(", ") || "None" : String(entryValue)}`);

  return fallback.length ? fallback.join(" · ") : "Details available";
}

function riskBadgeTone(level: string) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "critical") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
  if (normalized === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200";
  if (normalized === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
}

function formatAuditLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    const preview = value.slice(0, 3);
    const primitiveList = preview.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
    if (primitiveList) {
      return preview.map((item) => `- ${String(item)}`).join("\n");
    }
    return preview.map((item) => formatAuditValue(item)).join("\n");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    return summarizeAuditObject(value as Record<string, unknown>);
  }
  return String(value);
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
  const [sprints, setSprints] = useState<SprintItem[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>("");
  const [liveReport, setLiveReport] = useState<SprintReportResp | null>(null);
  const [liveReportLoading, setLiveReportLoading] = useState(false);
  const [liveReportError, setLiveReportError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [selectedAuditSprintId, setSelectedAuditSprintId] = useState<string>("");
  const [audit, setAudit] = useState<SprintAuditResp | null>(null);

  const summary = useMemo(() => data?.summary || null, [data]);
  const velocityHistory = useMemo(() => (Array.isArray(data?.velocityHistory) ? data.velocityHistory : []), [data]);
  const riskTrend = useMemo(() => (Array.isArray(data?.riskTrend) ? data.riskTrend : []), [data]);
  const reports = useMemo(() => (Array.isArray(data?.reports) ? data.reports : []), [data]);
  const liveSprintOptions = useMemo(() => sprints.filter((item) => Boolean(item.id)), [sprints]);
  const hasReportRows = reports.length > 0;
  const auditOptions = useMemo(
    () => (hasReportRows ? reports.map((report) => ({ id: report.id, label: report.sprint })) : liveSprintOptions.map((item) => ({ id: item.id, label: item.name }))),
    [hasReportRows, liveSprintOptions, reports]
  );

  const auditSections = useMemo(() => {
    if (!audit) return [];
    return [
      { key: "sprint_health", label: "Sprint Health Audit", value: audit.sprint_health },
      { key: "backlog_audit", label: "Backlog Audit", value: audit.backlog_audit },
      { key: "developer_audit", label: "Developer Skill Gap Audit", value: audit.developer_audit },
      { key: "velocity_audit", label: "Velocity and Delivery Trend Audit", value: audit.velocity_audit },
      { key: "risk_audit", label: "Risk and Blocker Audit", value: audit.risk_audit },
      { key: "process_audit", label: "Process Quality Audit", value: audit.process_audit },
      { key: "recommendations", label: "Strategic Recommendations", value: audit.recommendations },
    ];
  }, [audit]);

  const auditDetails = useMemo(() => {
    if (!audit) return [] as Array<{ key: string; label: string; entries: AuditSectionEntry[] }>;

    return auditSections.map((section) => ({
      key: section.key,
      label: section.label,
      entries: Object.entries(section.value || {})
        .filter(([key, value]) => key !== "section_score" && key !== "section_status" && key !== "developers" && typeof value !== "function")
        .map(([key, value]) => ({
          key,
          label: formatAuditLabel(key),
          value: formatAuditValue(value),
        }))
        .filter((entry) => entry.value !== "None"),
    }));
  }, [audit, auditSections]);

  function statusTone(status: string) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "healthy") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
    if (normalized.includes("attention")) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
    return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [reportResp, sprintResp] = await Promise.all([fetchJson<ReportsResp>("/api/reports"), fetchJson<SprintsResp>("/api/sprints")]);

    if (!reportResp.ok) {
      setData(null);
      setError(String(reportResp.data?.error || `Failed to load reports (${reportResp.status})`));
    } else {
      setData(reportResp.data);
    }

    if (sprintResp.ok) {
      const items = Array.isArray(sprintResp.data?.items) ? sprintResp.data.items : [];
      setSprints(items);
      const firstSprintId = items[0]?.id || "";
      if (!selectedSprintId && firstSprintId) {
        setSelectedSprintId(firstSprintId);
      }
      if ((!hasReportRows || !selectedAuditSprintId) && firstSprintId) {
        setSelectedAuditSprintId(firstSprintId);
      }
    }

    setLoading(false);
  }, [selectedSprintId, hasReportRows, selectedAuditSprintId]);

  async function loadLiveReport(sprintId: string) {
    if (!sprintId) return;
    setLiveReportLoading(true);
    setLiveReportError(null);
    const resp = await fetchJson<SprintReportResp>(`/api/reports/${encodeURIComponent(sprintId)}`);
    if (!resp.ok) {
      setLiveReport(null);
      setLiveReportError(String(resp.data?.error || `Failed to load live sprint report (${resp.status})`));
      setLiveReportLoading(false);
      return;
    }
    setLiveReport(resp.data);
    setLiveReportLoading(false);
  }

  async function loadAudit(sprintId: string) {
    if (!sprintId) return;
    setAuditLoading(true);
    setAuditError(null);
    const resp = await fetchJson<SprintAuditResp>(`/api/reports/${encodeURIComponent(sprintId)}/audit`);
    if (!resp.ok) {
      setAudit(null);
      setAuditError(String((resp.data as { error?: string } | null)?.error || `Failed to load sprint audit (${resp.status})`));
      setAuditLoading(false);
      return;
    }
    setAudit(resp.data);
    setAuditLoading(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (hasReportRows) return;
    if (!selectedSprintId && liveSprintOptions.length) {
      setSelectedSprintId(liveSprintOptions[0].id);
      void loadLiveReport(liveSprintOptions[0].id);
      return;
    }
    if (selectedSprintId) {
      void loadLiveReport(selectedSprintId);
    }
  }, [hasReportRows, liveSprintOptions, selectedSprintId]);

  useEffect(() => {
    if (!selectedAuditSprintId && auditOptions.length) {
      setSelectedAuditSprintId(auditOptions[0].id);
      void loadAudit(auditOptions[0].id);
      return;
    }

    if (selectedAuditSprintId) {
      void loadAudit(selectedAuditSprintId);
    }
  }, [auditOptions, selectedAuditSprintId]);

  useEffect(() => {
    if (!reports.length) return;
    if (selectedAuditSprintId) return;
    const first = reports[0]?.id;
    if (!first) return;
    setSelectedAuditSprintId(first);
    void loadAudit(first);
  }, [reports, selectedAuditSprintId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Reports</h1>
            <p className="text-slate-600 dark:text-slate-300">Detailed sprint delivery reports with GitHub, task, and risk analytics.</p>
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

        {loading ? <div className="text-slate-600 dark:text-slate-300">Loading...</div> : null}

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          <div className="rounded-lg p-4 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Avg Velocity</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{summary?.avgVelocity ?? 0}</p>
          </div>
          <div className="rounded-lg p-4 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Avg Completion</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {typeof summary?.avgCompletionPct === "number" ? `${summary.avgCompletionPct}%` : "-"}
            </p>
          </div>
          <div className="rounded-lg p-4 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Latest Sprint</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">{summary?.activeOrRecentSprint || "-"}</p>
          </div>
          <div className="rounded-lg p-4 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Open Burnout Flags</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{summary?.openBurnoutFlags ?? 0}</p>
          </div>
          <div className="rounded-lg p-4 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Unresolved Alerts</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{summary?.unresolvedAlerts ?? 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
          <div className="rounded-lg p-6 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
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
                    <Line type="monotone" dataKey="velocity" stroke="#0f766e" strokeWidth={2} name="Completed" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No sprint history available.</div>
            )}
          </div>

          <div className="rounded-lg p-6 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Risk Trend</h2>
            {riskTrend.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={riskTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="sprint" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="riskScore" stroke="#b91c1c" strokeWidth={2} name="Risk Score" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No risk trend available.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="text-lg font-bold text-slate-900 dark:text-white">Sprint Reports</div>
          <div className="mt-4 space-y-4">
            {reports.length ? (
              reports.map((report) => (
                <div key={report.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4 bg-slate-50/60 dark:bg-black/20">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-slate-900 dark:text-white">{report.sprint}</div>
                      <div className="text-xs text-slate-500">
                        {String(report.date).slice(0, 10)} · {report.type}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${riskBadgeTone(report.riskLevel)}`}>
                        {report.riskLevel} ({report.riskScore})
                      </span>
                      <Link
                        href={`/reports/${encodeURIComponent(report.id)}`}
                        className="inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-black"
                      >
                        Open Full Report
                      </Link>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 text-sm">
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Planned</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.planned}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Completed</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.completed}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Completion</div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {typeof report.completionPct === "number" ? `${report.completionPct}%` : "-"}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Tasks Created</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.tasksCreated ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Done/In Progress</div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {report.tasksDone ?? 0}/{report.tasksInProgress ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Blocked</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.blockedCount}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Burnout Flags</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.burnoutRiskCount}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Meetings</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.meetings ?? 0}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 text-sm">
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Commits</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.github?.commits ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">PRs/Reviews</div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {report.github?.pullRequests ?? 0}/{report.github?.reviews ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Pushes/Issues</div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {report.github?.pushes ?? 0}/{report.github?.issues ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Contributors</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.github?.contributors ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Repositories</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.github?.repositories ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Code Churn</div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        +{report.github?.additions ?? 0} / -{report.github?.deletions ?? 0}
                      </div>
                    </div>
                    <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-xs text-slate-500">Open Alerts</div>
                      <div className="font-semibold text-slate-900 dark:text-white">{report.alerts.total}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  No sprint reports available yet, so showing the latest live sprint instead.
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedSprintId}
                    onChange={(e) => {
                      setSelectedSprintId(e.target.value);
                      void loadLiveReport(e.target.value);
                    }}
                    className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
                    disabled={!liveSprintOptions.length}
                  >
                    {liveSprintOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.status})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void loadLiveReport(selectedSprintId)}
                    disabled={liveReportLoading || !selectedSprintId}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                  >
                    <RefreshCw className="w-3 h-3" /> Load Live Sprint
                  </button>
                </div>

                {liveReportError ? (
                  <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
                    {liveReportError}
                  </div>
                ) : null}

                {liveReportLoading ? (
                  <div className="text-sm text-slate-600 dark:text-slate-300">Loading live sprint data...</div>
                ) : null}

                {liveReport?.sprint ? (
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-black/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900 dark:text-white">{liveReport.sprint.name}</div>
                        <div className="text-xs text-slate-500">
                          {liveReport.sprint.status} · {liveReport.sprint.startDate} to {liveReport.sprint.endDate}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${riskBadgeTone(liveReport.risk?.riskLevel || "low")}`}>
                        {liveReport.risk?.riskLevel || "low"} ({liveReport.risk?.riskScore ?? 0})
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Planned</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{liveReport.sprint.plannedPoints}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Completed</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{liveReport.sprint.completedPoints}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Completion</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {typeof liveReport.sprint.completionPct === "number" ? `${liveReport.sprint.completionPct}%` : "-"}
                        </div>
                      </div>
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Blocked</div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {liveReport.risk?.blockedCount ?? liveReport.tasks?.blockedCount ?? 0}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Commits</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{liveReport.github?.summary?.commits ?? 0}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">PRs</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{liveReport.github?.summary?.pullRequests ?? 0}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Reviews</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{liveReport.github?.summary?.reviews ?? 0}</div>
                      </div>
                      <div className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2">
                        <div className="text-xs text-slate-500">Contributors</div>
                        <div className="font-semibold text-slate-900 dark:text-white">{liveReport.github?.summary?.contributors ?? 0}</div>
                      </div>
                    </div>

                    {liveReport.burndown?.length ? (
                      <div className="mt-4 h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={liveReport.burndown}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="day" />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey="idealRemaining" stroke="#64748b" strokeWidth={2} name="Ideal Remaining" />
                            <Line type="monotone" dataKey="actualRemaining" stroke="#0f766e" strokeWidth={2} name="Actual Remaining" />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : null}

                    {liveReport.github?.recentEvents?.length ? (
                      <div className="mt-4 space-y-2 max-h-64 overflow-auto">
                        {liveReport.github.recentEvents.slice(0, 10).map((event) => (
                          <div key={event.id} className="rounded-md border border-slate-200 dark:border-zinc-800 p-3 bg-white/60 dark:bg-black/20">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">{event.developer}</div>
                              <div className="text-xs text-slate-500">{new Date(event.eventAt).toLocaleString()}</div>
                            </div>
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              {event.type} · {event.repo || "repo-n/a"} · +{event.additions} / -{event.deletions}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">Sprint Audit Report</div>
              <div className="text-xs text-slate-500">Structured audit generated from live sprint, task, backlog, developer, and GitHub data.</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedAuditSprintId}
                onChange={(e) => {
                  setSelectedAuditSprintId(e.target.value);
                  void loadAudit(e.target.value);
                }}
                className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200"
                disabled={!auditOptions.length}
              >
                {auditOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadAudit(selectedAuditSprintId)}
                disabled={auditLoading || !selectedAuditSprintId}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
              >
                <RefreshCw className="w-3 h-3" /> Refresh Audit
              </button>
            </div>
          </div>

          {auditError ? (
            <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
              {auditError}
            </div>
          ) : null}

          {auditLoading ? <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">Generating audit...</div> : null}

          {audit ? (
            <div className="mt-4 space-y-3">
              <div className="text-xs text-slate-500">
                Generated: {new Date(audit.audit_generated_at).toLocaleString()} · Org: {audit.org_id} · Sprint: {audit.sprint_id}
              </div>
              {auditSections.map((section) => (
                <details key={section.key} className="rounded-md border border-slate-200 dark:border-zinc-800" open>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{section.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="rounded px-2 py-0.5 text-xs font-semibold border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-slate-200">
                        Score {section.value.section_score}
                      </span>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusTone(section.value.section_status)}`}>
                        {section.value.section_status}
                      </span>
                    </span>
                  </summary>
                  <div className="border-t border-slate-200 dark:border-zinc-800 p-3">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {(auditDetails.find((item) => item.key === section.key)?.entries || []).map((entry) => (
                        <div key={`${section.key}-${entry.key}`} className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-black/20 px-3 py-2">
                          <div className="text-[11px] uppercase tracking-wide text-slate-500">{entry.label}</div>
                          <div className="mt-1 text-sm font-medium text-slate-900 dark:text-white whitespace-pre-line leading-relaxed">{entry.value}</div>
                        </div>
                      ))}
                      {!(auditDetails.find((item) => item.key === section.key)?.entries.length) ? (
                        <div className="rounded-md border border-dashed border-slate-200 dark:border-zinc-800 px-3 py-4 text-sm text-slate-600 dark:text-slate-300 md:col-span-2 xl:col-span-3">
                          No additional section details available.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
