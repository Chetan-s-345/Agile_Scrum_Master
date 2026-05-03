"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw, Sparkles } from "lucide-react";

type ReportItem = {
  id: string;
  sprint?: string;
  name?: string;
  date?: string;
  type?: string;
  riskScore?: number;
  riskLevel?: string;
};

type SkillAudit = {
  sprint_health?: { section_score?: number; section_status?: string };
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
    hiring_or_training_recommendation?: string;
    ai_summary?: string | null;
    ai_skill_focus?: Array<{ skill?: string; reason?: string; target_developers?: string[]; recommended_actions?: string[] }>;
    ai_bench_actions?: Array<{ developer?: string; current_load?: number; focus?: string; next_steps?: string[] }>;
    ai_notes?: string[];
  };
};

function tone(level: string) {
  const value = String(level || "").toLowerCase();
  if (value === "critical") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200";
  if (value === "high") return "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200";
  if (value === "medium") return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const resp = await fetch(url, { cache: "no-store" });
    const data = await resp.json().catch(() => null);
    return { ok: resp.ok, status: resp.status, data: data as T | null };
  } catch {
    return { ok: false, status: 503, data: null };
  }
}

export default function SkillGapPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [audit, setAudit] = useState<SkillAudit | null>(null);

  const selectedReport = useMemo(() => reports.find((item) => item.id === selectedReportId) || null, [reports, selectedReportId]);
  const developerAudit = audit?.developer_audit || null;
  const recommendations = audit?.recommendations || null;

  async function loadData(targetReportId?: string) {
    setRefreshing(true);
    setError(null);

    const reportsResp = await fetchJson<{ reports?: ReportItem[]; recentReports?: ReportItem[]; items?: ReportItem[] }>("/api/reports");
    if (!reportsResp.ok) {
      setError(`Failed to load reports (${reportsResp.status})`);
      setReports([]);
      setAudit(null);
      setRefreshing(false);
      setLoading(false);
      return;
    }

    const reportList = Array.isArray(reportsResp.data?.reports)
      ? reportsResp.data?.reports || []
      : Array.isArray(reportsResp.data?.recentReports)
        ? reportsResp.data?.recentReports || []
        : Array.isArray(reportsResp.data?.items)
          ? reportsResp.data?.items || []
          : [];

    setReports(reportList);
    const nextReportId = String(targetReportId || reportList[0]?.id || "").trim();
    setSelectedReportId(nextReportId);

    if (!nextReportId) {
      setAudit(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const auditResp = await fetchJson<SkillAudit>(`/api/reports/${encodeURIComponent(nextReportId)}/audit`);
    if (!auditResp.ok) {
      setError(String((auditResp.data as { error?: string } | null)?.error || `Failed to load audit (${auditResp.status})`));
      setAudit(null);
    } else {
      setAudit(auditResp.data);
    }

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.06),_transparent_35%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Skill Gap Audit</h1>
            <p className="text-slate-600 dark:text-slate-300">
              Focuses on missing skills, underutilised developers, and concrete upskilling actions for the next sprint.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadData(selectedReportId)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <Link
              href={selectedReportId ? `/reports/${encodeURIComponent(selectedReportId)}` : "/reports"}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-white px-3 py-2 text-sm font-semibold text-white dark:text-black"
            >
              Open report <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3 justify-between">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Audit source</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">
                {selectedReport?.sprint || selectedReport?.name || "Latest sprint"}
              </div>
            </div>
            <select
              value={selectedReportId}
              onChange={(e) => void loadData(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.sprint || report.name || report.id} {report.riskLevel ? `(${report.riskLevel})` : ""}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 text-sm text-slate-600 dark:text-slate-300">Loading skill audit...</div>
          ) : (
            <div className="mt-6 grid gap-6">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                  <div className="text-xs text-slate-500">Developer audit</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{developerAudit?.section_score ?? 0}</div>
                  <div className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${tone(developerAudit?.section_status || "low")}`}>
                    {developerAudit?.section_status || "Needs attention"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                  <div className="text-xs text-slate-500">Skill gaps</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{developerAudit?.skill_gap?.length ?? 0}</div>
                  <div className="mt-2 text-xs text-slate-500">Skills missing from current team coverage</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                  <div className="text-xs text-slate-500">Bench developers</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{developerAudit?.underutilised_developers?.length ?? 0}</div>
                  <div className="mt-2 text-xs text-slate-500">Low-load people to upskill or assign stretch work</div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                  <div className="text-xs text-slate-500">Task mismatches</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{developerAudit?.task_mismatch?.length ?? 0}</div>
                  <div className="mt-2 text-xs text-slate-500">Work assigned outside the current skill matrix</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-black/20 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <Sparkles className="h-4 w-4" /> Groq recommendation
                </div>
                <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                  {recommendations?.ai_summary || recommendations?.hiring_or_training_recommendation || "No AI summary available yet."}
                </p>
                {recommendations?.top_3_immediate_actions?.length ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {recommendations.top_3_immediate_actions.map((item, idx) => (
                      <div key={`${idx}-${item}`} className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-slate-700 dark:text-slate-200">
                        {item}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Skills to build on</div>
                  {developerAudit?.skill_gap?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {developerAudit.skill_gap.map((skill) => (
                        <span key={skill} className="rounded-full bg-slate-100 dark:bg-black/30 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-200">
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600 dark:text-slate-300">No current skill gaps. Focus on cross-training and bus-factor reduction.</div>
                  )}

                  <div className="mt-5 space-y-3">
                    {(recommendations?.ai_skill_focus || []).length ? (
                      recommendations?.ai_skill_focus?.map((item, idx) => (
                        <div key={`skill-focus-${idx}-${String(item.skill || item.reason || "entry")}`} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                          <div className="font-semibold text-slate-900 dark:text-white">{item.skill || "Skill focus"}</div>
                          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.reason || "No rationale provided."}</div>
                          {Array.isArray(item.target_developers) && item.target_developers.length ? (
                            <div className="mt-2 text-xs text-slate-500">Target: {item.target_developers.join(", ")}</div>
                          ) : null}
                        </div>
                      ))
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Bench / low-load developers</div>
                  {developerAudit?.underutilised_developers?.length ? (
                    <div className="space-y-3">
                      {developerAudit.underutilised_developers.map((dev) => (
                        <div key={String(dev.developer_id || dev.name)} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{dev.name || "Developer"}</div>
                            <div className="text-xs text-slate-500">{dev.assigned_story_points ?? 0} points / {dev.capacity ?? 0} capacity</div>
                          </div>
                          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            Good candidate for stretch work, pairing, or upskilling against the current backlog.
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600 dark:text-slate-300">No underutilised developers detected in this sprint.</div>
                  )}

                  <div className="mt-5 space-y-3">
                    {(recommendations?.ai_bench_actions || []).length ? (
                      recommendations?.ai_bench_actions?.map((item, idx) => (
                        <div key={`bench-action-${idx}-${String(item.developer || item.focus || "entry")}`} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 bg-slate-50 dark:bg-black/20">
                          <div className="font-semibold text-slate-900 dark:text-white">{item.developer || "Developer"}</div>
                          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.focus || "No focus provided."}</div>
                          <div className="mt-2 text-xs text-slate-500">Current load: {item.current_load ?? 0}</div>
                        </div>
                      ))
                    ) : null}
                  </div>
                </div>
              </div>

              {developerAudit?.recommended_upskilling?.length ? (
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Recommended upskilling</div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {developerAudit.recommended_upskilling.map((item) => (
                      <div key={`${item.developer_id}-${item.skill_area}`} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{item.name}</div>
                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Focus skill: {item.skill_area}</div>
                        {Array.isArray(item.related_backlog_items) && item.related_backlog_items.length ? (
                          <div className="mt-2 text-xs text-slate-500">Relevant backlog: {item.related_backlog_items.join(", ")}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {developerAudit?.task_mismatch?.length ? (
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Task mismatch hotspots</div>
                  <div className="space-y-3">
                    {developerAudit.task_mismatch.map((item) => (
                      <div key={item.task_id || item.title} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{item.title || "Task"}</div>
                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Assigned to {item.developer_name || "Unknown"}</div>
                        <div className="mt-2 text-xs text-slate-500">Required: {(item.required_skills || []).join(", ") || "n/a"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {recommendations?.ai_notes?.length ? (
                <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">Notes</div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {recommendations.ai_notes.map((note) => (
                      <div key={note} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-4 text-sm text-slate-700 dark:text-slate-200">
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {refreshing ? (
                <div className="text-sm text-slate-600 dark:text-slate-300">Refreshing audit data...</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" />
          Underutilised developers are the best place to apply the skill audit. Prioritize stretch work and paired delivery for them before adding new hires.
        </div>
      </div>
    </div>
  );
}
