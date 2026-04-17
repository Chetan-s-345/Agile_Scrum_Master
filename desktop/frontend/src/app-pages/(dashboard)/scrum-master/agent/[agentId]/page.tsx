"use client";

import Link from "@/next-shims/link";
import { useParams, useRouter, useSearchParams } from "@/next-shims/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockLoadingOverlay } from "@/components/block-loading-overlay";

type AgentConfig = {
  trigger_settings?: Record<string, unknown>;
  autonomy_level?: number;
  constraints?: Record<string, unknown>;
  context_memo?: string;
};

type Agent = {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  running?: boolean;
  lastRunAt?: string;
  config?: AgentConfig;
  stats?: AgentStats;
};

type Message = {
  id?: string;
  role?: string;
  content?: string;
  createdAt?: string;
};

type RunTask = {
  taskId?: string;
  id?: string;
  title?: string;
  url?: string;
  githubIssue?: { issueNumber?: number; url?: string } | null;
};

type RunAssignment = {
  taskId?: string;
  developerName?: string;
};

type RunResult = {
  createdTasks?: RunTask[];
  assignedTasks?: RunAssignment[];
  githubIssues?: Array<{ issueNumber?: number; url?: string }>;
  githubIssueErrors?: Array<{ title?: string; detail?: string }>;
  githubRepo?: string | null;
  monitoringEmail?: {
    attempted?: boolean;
    sent?: boolean;
    recipients?: string[];
    detail?: string;
    error?: string;
  } | null;
};

type Decision = {
  id?: string;
  action_description?: string;
  status?: string;
  confidence?: number;
  created_at?: string;
  data_used?: Record<string, unknown>;
};

type AgentStats = {
  tasksCreated?: number;
  tasksCompleted?: number;
  tasksOpen?: number;
  tasksWithAssignee?: number;
  uniqueDevelopersAssigned?: number;
  createTaskActions?: number;
  assignTaskActions?: number;
  totalActions?: number;
  failedActions?: number;
  totalDecisions?: number;
  executedDecisions?: number;
  failedDecisions?: number;
  ragEnabled?: boolean;
  promptTemplateDefined?: boolean;
  aiServiceConfigured?: boolean;
  inngestConfigured?: boolean;
  inngestEndpoint?: string;
  createdTasks?: Array<{
    id?: string;
    title?: string;
    status?: string;
    priority?: string;
    assignee?: string;
    createdAt?: string;
  }>;
  assignments?: Array<{
    id?: string;
    taskId?: string;
    taskTitle?: string;
    developer?: string;
    createdAt?: string;
  }>;
};

function safe(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function ago(value: string): string {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "now";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(safe(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

export default function ScrumMasterAgentDetailPage() {
  const params = useParams<{ agentId: string }>();
  const router = useRouter();
  const search = useSearchParams();

  const agentId = safe(params?.agentId);
  const projectId = safe(search?.get("projectId"));

  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [config, setConfig] = useState<AgentConfig>({});
  const [conversation, setConversation] = useState<Message[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState<AgentStats>({});
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [runMessage, setRunMessage] = useState("");
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [notificationTargetInput, setNotificationTargetInput] = useState("");
  const [notificationTargets, setNotificationTargets] = useState<string[]>([]);

  const ragEnabled = useMemo(() => Boolean((config.constraints as { ragEnabled?: unknown } | undefined)?.ragEnabled), [config.constraints]);
  const statusOverride = useMemo(
    () => safe((config.constraints as { status?: unknown } | undefined)?.status).toLowerCase(),
    [config.constraints]
  );
  const isAgentActive = statusOverride !== "paused";

  const effectiveCreatedTasks = useMemo(() => {
    const statsRows = Array.isArray(stats.createdTasks) ? stats.createdTasks : [];
    if (statsRows.length) return statsRows;
    const runRows = Array.isArray(lastRun?.createdTasks) ? lastRun.createdTasks : [];
    return runRows.map((row) => ({
      id: safe(row.taskId || row.id),
      title: safe(row.title),
      status: "todo",
      priority: "medium",
      assignee: "unassigned",
      createdAt: "",
    }));
  }, [lastRun?.createdTasks, stats.createdTasks]);

  const effectiveAssignments = useMemo(() => {
    const statsRows = Array.isArray(stats.assignments) ? stats.assignments : [];
    if (statsRows.length) return statsRows;
    const runRows = Array.isArray(lastRun?.assignedTasks) ? lastRun.assignedTasks : [];
    return runRows.map((row, idx) => ({
      id: `${safe(row.taskId)}:${idx}`,
      taskId: safe(row.taskId),
      taskTitle: safe(row.taskId),
      developer: safe(row.developerName),
      createdAt: "",
    }));
  }, [lastRun?.assignedTasks, stats.assignments]);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError("");
    try {
      const [agentData, conversationData, actionLogData] = await Promise.all([
        invokeDesktop<Agent>("agent:getById", { agentId }),
        invokeDesktop<Message[]>("agent:getConversation", { agentId }),
        invokeDesktop<Decision[]>("agent:getActionLog", { agentId })
      ]);

      setAgent(agentData || null);
      const nextConfig = (agentData?.config || {}) as AgentConfig;
      setConfig(nextConfig);
      setPrompt(safe(nextConfig.context_memo || ""));
      const nextTargets = Array.isArray((nextConfig.constraints as { notificationTargets?: unknown } | undefined)?.notificationTargets)
        ? ((nextConfig.constraints as { notificationTargets?: unknown[] }).notificationTargets || [])
            .map((item) => safe(item).toLowerCase())
            .filter((item) => item.includes("@"))
        : [];
      setNotificationTargets([...new Set(nextTargets)]);

      setConversation(Array.isArray(conversationData) ? conversationData : []);
      setDecisions(Array.isArray(actionLogData) ? actionLogData : []);
      setStats((agentData?.stats || {}) as AgentStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent details");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const savePrompt = useCallback(async () => {
    if (!agentId) return;
    setSaving(true);
    setError("");
    try {
      const nextConstraints = {
        ...(config.constraints || {}),
        promptTemplate: prompt,
        ragEnabled,
        notificationTargets,
      };

      await invokeDesktop<Agent>("agent:updateConfig", {
        agentId,
        config: {
          trigger_settings: config.trigger_settings || {},
          autonomy_level: Number(config.autonomy_level || 2),
          constraints: nextConstraints,
          context_memo: prompt
        }
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setSaving(false);
    }
  }, [agentId, config.autonomy_level, config.constraints, config.trigger_settings, load, notificationTargets, prompt, ragEnabled]);

  const runAgentNow = useCallback(async () => {
    if (!agentId) return;
    setRunning(true);
    setRunMessage("");
    setError("");
    try {
      const sent = await invokeDesktop<Message>("agent:sendMessage", {
        agentId,
        content: prompt || "Run a fresh analysis and post actionable updates."
      });
      setRunMessage("Agent run completed.");
      setLastRun({ createdTasks: [], assignedTasks: [], githubIssues: [], githubIssueErrors: [], githubRepo: null, monitoringEmail: null });
      setConversation((prev) => [sent, ...prev]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run agent");
    } finally {
      setRunning(false);
    }
  }, [agentId, load, prompt]);

  const addNotificationTarget = useCallback(() => {
    const candidate = safe(notificationTargetInput).toLowerCase();
    if (!candidate || !candidate.includes("@")) return;
    setNotificationTargets((prev) => [...new Set([...prev, candidate])]);
    setNotificationTargetInput("");
  }, [notificationTargetInput]);

  const removeNotificationTarget = useCallback((target: string) => {
    const key = safe(target).toLowerCase();
    setNotificationTargets((prev) => prev.filter((item) => item !== key));
  }, []);

  const toggleAgentStatus = useCallback(async () => {
    if (!agentId) return;
    setStatusBusy(true);
    setError("");
    try {
      await invokeDesktop<Agent>("agent:toggleRun", {
        agentId,
        running: !isAgentActive
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setStatusBusy(false);
    }
  }, [agentId, isAgentActive, load]);

  const deleteAgent = useCallback(async () => {
    if (!agentId) return;
    if (!confirm("Delete this custom agent from this project?")) return;
    setDeleteBusy(true);
    setError("");
    try {
      const result = await invokeDesktop<{ success?: boolean }>("agent:delete", { agentId });
      if (!result?.success) {
        throw new Error("Failed to delete agent");
      }
      router.push(`/scrum-master${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeleteBusy(false);
    }
  }, [agentId, projectId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="jira-page-content min-h-screen p-5 md:p-7">
      <BlockLoadingOverlay
        active={loading || running || saving || statusBusy || deleteBusy}
        label={loading ? "Loading agent details..." : "Processing agent action..."}
        fullScreen={true}
        delayMs={150}
      />
      <div className="mx-auto max-w-[1100px] space-y-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h1 className="text-xl font-semibold">Agent: {safe(agent?.name) || agentId || "unknown"}</h1>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">Project: {projectId || "n/a"}</div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">
            Type: {safe(agent?.type) || "custom"} | Status: {safe(agent?.status) || "idle"} | Last run: {safe(agent?.lastRunAt) ? ago(safe(agent?.lastRunAt)) : "never"}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
            <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2">AI Service: <span className="font-semibold">{stats.aiServiceConfigured ? "Connected" : "Not configured"}</span></div>
            <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2">Inngest: <span className="font-semibold">{stats.inngestConfigured ? "Connected" : "Not configured"}</span></div>
            <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2">RAG Connected: <span className="font-semibold">{(stats.ragEnabled ?? ragEnabled) ? "Yes" : "No"}</span></div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={statusBusy || loading}
              onClick={() => void toggleAgentStatus()}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {statusBusy ? "Updating..." : isAgentActive ? "Disable Agent" : "Enable Agent"}
            </button>
            <button
              type="button"
              disabled={running || loading}
              onClick={() => void runAgentNow()}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {running ? "Running..." : "Run Agent Now"}
            </button>
            <button
              type="button"
              disabled={deleteBusy || loading}
              onClick={() => void deleteAgent()}
              className="rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 disabled:opacity-60"
            >
              {deleteBusy ? "Deleting..." : "Delete Agent"}
            </button>
          </div>
          {runMessage ? <div className="mt-2 text-xs text-[var(--accent-green)]">{runMessage}</div> : null}
          {Array.isArray(lastRun?.githubIssues) && lastRun.githubIssues.length ? (
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              GitHub issues: {lastRun.githubIssues.map((issue, idx) => (
                <span key={`${safe(issue.url)}:${idx}`} className="mr-2 inline-block">
                  <a href={safe(issue.url)} target="_blank" rel="noreferrer" className="underline">
                    #{safe(issue.issueNumber) || idx + 1}
                  </a>
                </span>
              ))}
              {safe(lastRun.githubRepo) ? <span>repo: {safe(lastRun.githubRepo)}</span> : null}
            </div>
          ) : null}
          {Array.isArray(lastRun?.githubIssueErrors) && lastRun.githubIssueErrors.length ? (
            <div className="mt-2 text-xs text-[var(--accent-red)]">
              GitHub mirror errors: {lastRun.githubIssueErrors.map((x) => safe(x.detail)).filter(Boolean).join(" | ")}
            </div>
          ) : null}
          {lastRun?.monitoringEmail ? (
            <div className={`mt-2 text-xs ${lastRun.monitoringEmail.sent ? "text-[var(--accent-green)]" : "text-[var(--accent-red)]"}`}>
              Monitoring email: {lastRun.monitoringEmail.sent ? "sent" : "not sent"}
              {Array.isArray(lastRun.monitoringEmail.recipients) && lastRun.monitoringEmail.recipients.length
                ? ` to ${lastRun.monitoringEmail.recipients.join(", ")}`
                : ""}
              {safe(lastRun.monitoringEmail.detail || lastRun.monitoringEmail.error)
                ? ` (${safe(lastRun.monitoringEmail.detail || lastRun.monitoringEmail.error)})`
                : ""}
            </div>
          ) : null}
          {error ? <div className="mt-2 text-xs text-[var(--accent-red)]">{error}</div> : null}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-semibold">Conversation</h2>
          <div className="mt-2 space-y-2">
            {conversation.map((msg, idx) => (
              <div key={`${safe(msg.id)}:${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{safe(msg.role) || "message"}</span>
                  <span className="text-[var(--text-secondary)]">{ago(safe(msg.createdAt))}</span>
                </div>
                <div className="mt-1 text-[var(--text-secondary)]">{safe(msg.content)}</div>
              </div>
            ))}
            {!conversation.length ? <div className="text-xs text-[var(--text-secondary)]">No conversation messages yet.</div> : null}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-semibold">Agent Configuration</h2>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Define how this AI agent should reason and act..."
            className="mt-2 h-36 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm"
          />
          <div className="mt-2 text-xs text-[var(--text-secondary)]">Prompt stored: {stats.promptTemplateDefined ? "Yes" : "No"}</div>

          <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <div className="text-xs font-semibold text-[var(--text-primary)]">Monitoring Notification Targets</div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">Brevo recipients for monitoring alerts.</div>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                value={notificationTargetInput}
                onChange={(e) => setNotificationTargetInput(e.target.value)}
                placeholder="team-alerts@company.com"
                className="h-8 flex-1 rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 text-xs"
              />
              <button
                type="button"
                onClick={() => addNotificationTarget()}
                className="h-8 rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs"
              >
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {notificationTargets.map((target) => (
                <span key={target} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2 py-0.5 text-[11px]">
                  {target}
                  <button type="button" className="text-[var(--accent-red)]" onClick={() => removeNotificationTarget(target)}>x</button>
                </span>
              ))}
              {!notificationTargets.length ? <span className="text-[11px] text-[var(--text-secondary)]">No targets configured.</span> : null}
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void savePrompt()}
              className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-semibold">Created Tasks</h2>
          <div className="mt-2 space-y-2">
            {effectiveCreatedTasks.map((item, idx) => (
              <div key={`${safe(item.id)}:${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{safe(item.title) || safe(item.id)}</div>
                  {safe(item.id) ? (
                    <Link
                      href={`/tasks/${encodeURIComponent(safe(item.id))}`}
                      className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-0.5 text-[11px]"
                    >
                      Open Task
                    </Link>
                  ) : null}
                </div>
                <div className="text-[var(--text-secondary)]">status: {safe(item.status) || "unknown"} | priority: {safe(item.priority) || "n/a"}</div>
                <div className="text-[var(--text-secondary)]">assigned developer: {safe(item.assignee) || "unassigned"} | {ago(safe(item.createdAt))}</div>
              </div>
            ))}
            {!effectiveCreatedTasks.length ? <div className="text-xs text-[var(--text-secondary)]">No agent-created tasks yet.</div> : null}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-semibold">Developer Assignments</h2>
          <div className="mt-2 space-y-2">
            {effectiveAssignments.map((item, idx) => (
              <div key={`${safe(item.id)}:${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{safe(item.taskTitle) || safe(item.taskId)}</div>
                  {safe(item.taskId) ? (
                    <Link
                      href={`/tasks/${encodeURIComponent(safe(item.taskId))}`}
                      className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-0.5 text-[11px]"
                    >
                      Open Task
                    </Link>
                  ) : null}
                </div>
                <div className="text-[var(--text-secondary)]">developer: {safe(item.developer) || "n/a"} | {ago(safe(item.createdAt))}</div>
              </div>
            ))}
            {!effectiveAssignments.length ? <div className="text-xs text-[var(--text-secondary)]">No assignment actions recorded yet.</div> : null}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <h2 className="text-sm font-semibold">Agent Activity</h2>
          <div className="mt-2 space-y-2">
            {decisions.map((item) => (
              <div key={safe(item.id)} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{safe(item.action_description) || "action"}</span>
                  <span className="text-[var(--text-secondary)]">{ago(safe(item.created_at))}</span>
                </div>
                <div className="mt-1 text-[var(--text-secondary)]">status: {safe(item.status) || "unknown"}</div>
                <div className="text-[var(--text-secondary)]">confidence: {safe(item.confidence) || "n/a"}</div>
              </div>
            ))}
            {!decisions.length && !loading ? <div className="text-xs text-[var(--text-secondary)]">No activity yet.</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
