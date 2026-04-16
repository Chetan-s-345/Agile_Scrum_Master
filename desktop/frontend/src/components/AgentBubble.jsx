"use client";

import Link from "@/next-shims/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Circle, CircleX, Sparkles, X } from "lucide-react";
import { useAgentStore } from "@/store/agentStore";

function safe(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function bubbleTone(agents, pendingCount) {
  if (pendingCount > 0) return "amber";
  if (agents.some((a) => safe(a?.status).toLowerCase().includes("fail"))) return "red";
  if (agents.some((a) => ["ok", "running", "scheduled"].includes(safe(a?.status).toLowerCase()))) return "green";
  return "gray";
}

export default function AgentBubble() {
  const [loadingProject, setLoadingProject] = useState(false);

  const projectId = useAgentStore((state) => state.projectId);
  const setProjectId = useAgentStore((state) => state.setProjectId);
  const start = useAgentStore((state) => state.start);
  const stop = useAgentStore((state) => state.stop);
  const expanded = useAgentStore((state) => state.expanded);
  const toggleExpanded = useAgentStore((state) => state.toggleExpanded);
  const agents = useAgentStore((state) => state.agents);
  const pendingApprovals = useAgentStore((state) => state.pendingApprovals);
  const recentActions = useAgentStore((state) => state.recentActions);
  const approve = useAgentStore((state) => state.approve);
  const reject = useAgentStore((state) => state.reject);

  const pendingCount = pendingApprovals.length;
  const tone = useMemo(() => bubbleTone(agents, pendingCount), [agents, pendingCount]);

  useEffect(() => {
    let mounted = true;

    async function loadProject() {
      if (projectId) {
        start();
        return;
      }

      setLoadingProject(true);
      const resp = await fetch("/api/projects", { cache: "no-store" });
      const data = await resp.json().catch(() => ({}));
      const firstId = String(data?.items?.[0]?.id || "").trim();
      if (mounted && firstId) {
        setProjectId(firstId);
        useAgentStore.getState().start();
      }
      setLoadingProject(false);
    }

    loadProject();
    return () => {
      mounted = false;
      stop();
    };
  }, [projectId, setProjectId, start, stop]);

  return (
    <div className="fixed bottom-5 right-5 z-[9999]">
      <button
        type="button"
        onClick={toggleExpanded}
        aria-label="Toggle agent panel"
        className={[
          "relative flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 bg-black text-white shadow-lg transition",
          tone === "green" ? "border-[var(--accent-green)]" : "",
          tone === "amber" ? "border-[var(--accent-yellow)]" : "",
          tone === "red" ? "border-[var(--accent-red)]" : "",
          tone === "gray" ? "border-[var(--border-strong)]" : "",
          !expanded && tone === "green" ? "animate-[pulse_2s_infinite]" : "",
          "hover:shadow-xl",
        ].join(" ")}
      >
        <Bot className="h-5 w-5" />
        {pendingCount > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-[var(--accent-red)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{pendingCount}</span>
        ) : null}
      </button>

      {expanded ? (
        <div className="mt-3 w-[320px] max-h-[480px] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3 text-[var(--text-primary)] shadow-2xl">
          <div className="mb-2 flex items-center justify-between border-b border-[var(--border)] pb-2">
            <div className="text-sm font-semibold">Agent Status</div>
            <button type="button" onClick={toggleExpanded} className="rounded p-1 hover:bg-[var(--bg-hover)]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            {loadingProject ? <div className="text-xs text-[var(--text-secondary)]">Loading project context...</div> : null}
            {agents.map((agent) => (
              <div key={safe(agent?.name)} className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Circle className="h-3 w-3" />
                  {safe(agent?.name)}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">Status: {safe(agent?.status) || "idle"}</div>
              </div>
            ))}
            {!agents.length ? <div className="text-xs text-[var(--text-secondary)]">No agents available.</div> : null}
          </div>

          <div className="my-3 border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Pending Approvals ({pendingCount})</div>
            <div className="space-y-2">
              {pendingApprovals.slice(0, 3).map((approval) => (
                <div key={safe(approval?.id)} className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-2">
                  <div className="text-sm font-medium">{safe(approval?.title) || "Approval request"}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{safe(approval?.description) || "No description"}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void approve(safe(approval?.id))}
                      className="inline-flex items-center gap-1 rounded border border-emerald-400/50 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-400/10"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void reject(safe(approval?.id), "Rejected from bubble")}
                      className="inline-flex items-center gap-1 rounded border border-rose-400/50 px-2 py-1 text-xs text-rose-300 hover:bg-rose-400/10"
                    >
                      <CircleX className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
              {!pendingApprovals.length ? <div className="text-xs text-[var(--text-secondary)]">No approvals waiting.</div> : null}
            </div>
          </div>

          <div className="my-3 border-t border-[var(--border)] pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Last 3 Actions</div>
            <div className="space-y-1 text-xs text-[var(--text-secondary)]">
              {recentActions.slice(0, 3).map((action) => (
                <div key={`${safe(action?.id)}:${safe(action?.created_at || action?.createdAt)}`}>
                  {safe(action?.action_name || action?.actionName)} - {safe(action?.status) || "executed"}
                </div>
              ))}
              {!recentActions.length ? <div>No recent actions yet.</div> : null}
            </div>
          </div>

          <Link href="/scrum-master" className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]">
            <Sparkles className="h-3.5 w-3.5" /> Open Command Center
          </Link>
        </div>
      ) : null}
    </div>
  );
}
