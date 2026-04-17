"use client";

import { useParams } from "@/next-shims/navigation";
import { useEffect, useMemo, useState } from "react";

type SprintStats = {
  totalTasks?: number;
  completedTasks?: number;
  carriedOverTasks?: number;
  addedMidSprintTasks?: number;
  plannedPoints?: number;
  completedPoints?: number;
};

type Burndown = {
  dates?: string[];
  ideal?: number[];
  actual?: number[];
};

type TeamPerformanceItem = {
  developer?: string;
  tasksCompleted?: number;
  storyPoints?: number;
  prCount?: number;
};

type BlockerRisk = {
  id: string;
  title?: string;
  resolutionNotes?: string;
};

type SprintReport = {
  sprintId: string;
  sprintName?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
  status?: string;
  currentUserRole?: string;
  stats?: SprintStats;
  burndown?: Burndown;
  teamPerformance?: TeamPerformanceItem[];
  blockersAndRisks?: BlockerRisk[];
  retrospectiveNotes?: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(asText(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

export default function SprintReportPage() {
  const params = useParams<{ sprintId: string }>();
  const sprintId = asText(params?.sprintId).trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<SprintReport | null>(null);
  const [retroNotes, setRetroNotes] = useState("");

  const canEditRetro = useMemo(() => {
    const role = asText(report?.currentUserRole).toLowerCase();
    return role === "admin" || role === "scrum_master" || !role;
  }, [report]);

  async function loadReport() {
    if (!sprintId) {
      setError("Missing sprint id");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await invokeDesktop<SprintReport>("reports:getBySprintId", { sprintId });
      setReport(data || null);
      setRetroNotes(asText(data?.retrospectiveNotes));
    } catch (err) {
      setReport(null);
      setRetroNotes("");
      setError(err instanceof Error ? err.message : "Failed to load sprint report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
  }, [sprintId]);

  async function onSaveRetroNotes() {
    if (!sprintId) return;
    setSaving(true);
    setError(null);
    try {
      await invokeDesktop<{ success: boolean }>("reports:updateRetroNotes", { sprintId, notes: retroNotes });
      setReport((prev) => (prev ? { ...prev, retrospectiveNotes: retroNotes } : prev));
      setNotice("Retrospective notes saved");
      window.setTimeout(() => setNotice(null), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save retrospective notes");
    } finally {
      setSaving(false);
    }
  }

  async function onExportPdf() {
    if (!sprintId) return;
    setExporting(true);
    setError(null);
    try {
      const result = await invokeDesktop<{ filePath: string }>("reports:exportPDF", { sprintId });
      setNotice(`Report exported: ${asText(result?.filePath)}`);
      window.setTimeout(() => setNotice(null), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export report");
    } finally {
      setExporting(false);
    }
  }

  async function onShareReport() {
    try {
      const shareUrl = `${window.location.origin}/reports/${encodeURIComponent(sprintId)}`;
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Share link copied");
      window.setTimeout(() => setNotice(null), 1600);
    } catch {
      setError("Failed to copy share link");
    }
  }

  const stats = report?.stats || {};
  const burndown = report?.burndown || {};
  const teamPerformance = asList<TeamPerformanceItem>(report?.teamPerformance);
  const blockersAndRisks = asList<BlockerRisk>(report?.blockersAndRisks);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{asText(report?.sprintName) || "Sprint Report"}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {asText(report?.startDate) || "-"} to {asText(report?.endDate) || "-"} · {asText(report?.status) || "unknown"}
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">Goal: {asText(report?.goal) || "-"}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onShareReport()}
              className="rounded-lg border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white"
            >
              Share Report
            </button>
            <button
              type="button"
              onClick={() => void onExportPdf()}
              disabled={exporting}
              className="rounded-lg bg-slate-900 dark:bg-white px-3 py-2 text-sm font-semibold text-white dark:text-black disabled:opacity-60"
            >
              {exporting ? "Exporting..." : "Export PDF"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            {notice}
          </div>
        ) : null}

        {loading ? <div className="text-slate-600 dark:text-slate-300">Loading...</div> : null}

        {!loading && report ? (
          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Sprint Stats</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <div>Total tasks: {Number(stats.totalTasks || 0)}</div>
                <div>Completed: {Number(stats.completedTasks || 0)}</div>
                <div>Carried over: {Number(stats.carriedOverTasks || 0)}</div>
                <div>Added mid-sprint: {Number(stats.addedMidSprintTasks || 0)}</div>
                <div>Planned points: {Number(stats.plannedPoints || 0)}</div>
                <div>Completed points: {Number(stats.completedPoints || 0)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Burndown</div>
              <pre className="mt-3 max-h-[240px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
                {JSON.stringify(burndown, null, 2)}
              </pre>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Team Performance</div>
              <div className="overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2">Developer</th>
                      <th className="text-right px-3 py-2">Tasks</th>
                      <th className="text-right px-3 py-2">Story Points</th>
                      <th className="text-right px-3 py-2">PRs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamPerformance.length ? (
                      teamPerformance.map((row, idx) => (
                        <tr key={`${asText(row.developer)}-${idx}`} className="border-t border-slate-200 dark:border-zinc-800">
                          <td className="px-3 py-2">{asText(row.developer) || "-"}</td>
                          <td className="px-3 py-2 text-right">{Number(row.tasksCompleted || 0)}</td>
                          <td className="px-3 py-2 text-right">{Number(row.storyPoints || 0)}</td>
                          <td className="px-3 py-2 text-right">{Number(row.prCount || 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-600 dark:text-slate-300">No team performance data.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Blockers and Risks</div>
              {blockersAndRisks.length ? (
                <div className="space-y-2">
                  {blockersAndRisks.map((item) => (
                    <div key={item.id} className="rounded border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div className="font-medium text-slate-900 dark:text-white">{asText(item.title) || "Risk"}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">{asText(item.resolutionNotes) || "No resolution notes."}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-600 dark:text-slate-300">No blockers or risks recorded.</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Retrospective Notes</div>
              <textarea
                value={retroNotes}
                onChange={(event) => setRetroNotes(event.target.value)}
                rows={5}
                disabled={!canEditRetro}
                className="w-full rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void onSaveRetroNotes()}
                  disabled={!canEditRetro || saving}
                  className="rounded-lg border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save Notes"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
