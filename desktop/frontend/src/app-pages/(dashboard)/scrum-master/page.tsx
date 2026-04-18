"use client";

import { useEffect, useMemo, useState } from "react";

type AgendaItem = {
  id: string;
  title?: string;
  type?: string;
  scheduledAt?: string;
};

type Impediment = {
  id: string;
  taskTitle?: string;
  blockerDescription?: string;
  raisedBy?: string;
  daysBlocked?: number;
  resolved?: boolean;
};

type SprintHealth = {
  compositeScore?: number;
  velocityScore?: number;
  completionScore?: number;
  sentimentScore?: number;
  velocity?: number;
  completionPct?: number;
  teamSentiment?: string;
  updatedAt?: string;
  recentAgentActivity?: AgentResult[];
};

type AgentResult = {
  id?: string;
  action?: string;
  summary?: string;
  status?: string;
  createdAt?: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asDate(value: unknown): string {
  const text = asText(value);
  if (!text) return "-";
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) return text;
  return new Date(time).toLocaleString();
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

export default function ScrumMasterPage() {
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [impediments, setImpediments] = useState<Impediment[]>([]);
  const [sprintHealth, setSprintHealth] = useState<SprintHealth | null>(null);
  const [activity, setActivity] = useState<AgentResult[]>([]);

  const composite = Number(sprintHealth?.compositeScore || 0);
  const meterWidth = `${Math.max(0, Math.min(100, composite))}%`;

  const orderedActivity = useMemo(() => {
    return [...activity].sort(
      (a, b) => new Date(asText(b.createdAt) || 0).getTime() - new Date(asText(a.createdAt) || 0).getTime()
    );
  }, [activity]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [agendaData, impedimentData, healthData] = await Promise.all([
        invokeDesktop<AgendaItem[]>("scrumMaster:getAgenda"),
        invokeDesktop<Impediment[]>("scrumMaster:getImpediments"),
        invokeDesktop<SprintHealth>("scrumMaster:getSprintHealth")
      ]);

      setAgenda(Array.isArray(agendaData) ? agendaData : []);
      setImpediments(Array.isArray(impedimentData) ? impedimentData : []);
      setSprintHealth(healthData || null);
      setActivity(Array.isArray(healthData?.recentAgentActivity) ? healthData.recentAgentActivity : []);
    } catch (err) {
      setAgenda([]);
      setImpediments([]);
      setSprintHealth(null);
      setActivity([]);
      setError(err instanceof Error ? err.message : "Failed to load scrum master data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function resolveImpediment(impedimentId: string) {
    setBusyAction(impedimentId);
    setError(null);
    try {
      await invokeDesktop<Impediment>("scrumMaster:resolveImpediment", { impedimentId });
      setImpediments((prev) => prev.filter((item) => item.id !== impedimentId));
      setNotice("Impediment resolved");
      window.setTimeout(() => setNotice(null), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve impediment");
    } finally {
      setBusyAction(null);
    }
  }

  async function runAction(action: "run_daily_analysis" | "detect_blockers" | "generate_standup_summary") {
    setBusyAction(action);
    setError(null);
    try {
      const result = await invokeDesktop<AgentResult>("scrumMaster:runAgentAction", { action });
      setActivity((prev) => [result, ...prev].slice(0, 20));
      setNotice(asText(result.summary) || "Action completed");
      window.setTimeout(() => setNotice(null), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run action");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="jira-page-content min-h-screen p-5 md:p-7">
      <div className="mx-auto max-w-[1280px] space-y-4">
        <div className="text-lg font-semibold">Scrum Master Control Center</div>

        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
        ) : null}

        {notice ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">{notice}</div>
        ) : null}

        {loading ? <div className="text-sm text-[var(--text-secondary)]">Loading...</div> : null}

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Today&apos;s Agenda</div>
          {agenda.length ? (
            <div className="space-y-2 text-sm">
              {agenda.map((item) => (
                <div key={item.id} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                  <div className="font-semibold">{asText(item.title) || "Agenda item"}</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {asText(item.type) || "event"} · {asDate(item.scheduledAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">No agenda items scheduled.</div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Active Impediments</div>
          {impediments.length ? (
            <div className="space-y-2 text-sm">
              {impediments.map((item) => (
                <div key={item.id} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                  <div className="font-semibold">{asText(item.taskTitle) || "Task"}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{asText(item.blockerDescription) || "No description"}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    Raised by: {asText(item.raisedBy) || "Unknown"} · Days blocked: {Number(item.daysBlocked || 0)}
                  </div>
                  <button
                    type="button"
                    onClick={() => void resolveImpediment(item.id)}
                    disabled={busyAction === item.id}
                    className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    {busyAction === item.id ? "Resolving..." : "Resolve"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">No active impediments.</div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Sprint Health Meter</div>
          <div className="mb-2 h-3 w-full overflow-hidden rounded bg-[var(--bg-surface)]">
            <div className="h-full bg-emerald-500" style={{ width: meterWidth }} />
          </div>
          <div className="grid gap-2 text-xs text-[var(--text-secondary)] md:grid-cols-4">
            <div>Composite: {Number(sprintHealth?.compositeScore || 0)}</div>
            <div>Velocity: {Number(sprintHealth?.velocityScore || sprintHealth?.velocity || 0)}</div>
            <div>Completion: {Number(sprintHealth?.completionScore || sprintHealth?.completionPct || 0)}%</div>
            <div>Sentiment: {asText(sprintHealth?.teamSentiment) || "unknown"}</div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">AI Agent Shortcuts</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void runAction("run_daily_analysis")}
              disabled={busyAction === "run_daily_analysis"}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {busyAction === "run_daily_analysis" ? "Running..." : "Run Daily Analysis"}
            </button>
            <button
              type="button"
              onClick={() => void runAction("detect_blockers")}
              disabled={busyAction === "detect_blockers"}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {busyAction === "detect_blockers" ? "Running..." : "Detect Blockers"}
            </button>
            <button
              type="button"
              onClick={() => void runAction("generate_standup_summary")}
              disabled={busyAction === "generate_standup_summary"}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {busyAction === "generate_standup_summary" ? "Running..." : "Generate Standup Summary"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Recent AI Agent Activity</div>
          {orderedActivity.length ? (
            <div className="space-y-2 text-sm">
              {orderedActivity.map((entry, idx) => (
                <div key={`${asText(entry.id)}-${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                  <div className="font-semibold">{asText(entry.action) || "action"}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{asText(entry.summary) || "No summary"}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{asDate(entry.createdAt)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">No recent AI activity.</div>
          )}
        </section>
      </div>
    </div>
  );
}
