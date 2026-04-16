"use client";

import { useParams } from "@/next-shims/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockLoadingOverlay } from "@/components/block-loading-overlay";

type Task = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  projectId?: string;
  sprintId?: string;
  dueDate?: string;
  acceptanceCriteria?: string;
  techTags?: string[];
  assignee?: { id?: string; name?: string } | null;
};

type Comment = {
  id?: string;
  content?: string;
  comment_type?: string;
  created_at?: string;
  author_name?: string;
};

type FeedItem = {
  id: string;
  time: string;
  title: string;
  detail: string;
  status: string;
};

function safe(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function arr(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => safe(x)).filter(Boolean);
}

function ago(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "now";
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function confidence(task: Task, feedCount: number): number {
  const p = safe(task.priority).toLowerCase();
  const base = p === "high" ? 82 : p === "medium" ? 86 : 89;
  return Math.max(60, Math.min(98, base + Math.min(feedCount, 8) - 3));
}

export default function ScrumMasterTaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = safe(params?.taskId);

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [sprint, setSprint] = useState<Record<string, unknown> | null>(null);
  const [relatedTasks, setRelatedTasks] = useState<Task[]>([]);
  const [timeline, setTimeline] = useState<FeedItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, unknown>[]>([]);

  const loadTask = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [taskResp, commentsResp] = await Promise.all([
        fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" }),
        fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, { cache: "no-store" }),
      ]);

      const taskJson = await taskResp.json().catch(() => ({}));
      const commentsJson = await commentsResp.json().catch(() => ({}));
      const rawTask = (taskJson?.task || taskJson || {}) as Record<string, unknown>;
      const nextTask: Task = {
        id: safe(rawTask.id) || taskId,
        title: safe(rawTask.title),
        description: safe(rawTask.description),
        status: safe(rawTask.status),
        priority: safe(rawTask.priority),
        projectId: safe(rawTask.projectId),
        sprintId: safe(rawTask.sprintId),
        dueDate: safe(rawTask.dueDate),
        acceptanceCriteria: safe(rawTask.acceptanceCriteria),
        techTags: arr(rawTask.techTags),
        assignee: rawTask.assignee && typeof rawTask.assignee === "object" ? (rawTask.assignee as { id?: string; name?: string }) : null,
      };

      const commentsRows = Array.isArray(commentsJson?.items) ? commentsJson.items : [];
      setTask(nextTask);
      setComments(commentsRows as Comment[]);


      if (nextTask.sprintId) {
        const sprintResp = await fetch(`/api/sprints/${encodeURIComponent(nextTask.sprintId)}`, { cache: "no-store" });
        const sprintJson = await sprintResp.json().catch(() => ({}));
        setSprint((sprintJson?.item || sprintJson?.sprint || sprintJson || null) as Record<string, unknown>);
      }

      if (nextTask.projectId) {
        const [tasksResp, actionsResp, approvalsResp] = await Promise.all([
          fetch(`/api/tasks?projectId=${encodeURIComponent(nextTask.projectId)}${nextTask.assignee?.id ? `&assigneeId=${encodeURIComponent(safe(nextTask.assignee?.id))}` : ""}`, { cache: "no-store" }),
          fetch(`/api/agents/actions?projectId=${encodeURIComponent(nextTask.projectId)}&limit=40`, { cache: "no-store" }),
          fetch(`/api/agents/approvals?projectId=${encodeURIComponent(nextTask.projectId)}&status=pending`, { cache: "no-store" }),
        ]);

        const tasksJson = await tasksResp.json().catch(() => ({}));
        const actionsJson = await actionsResp.json().catch(() => ({}));
        const approvalsJson = await approvalsResp.json().catch(() => ({}));

        const taskRows = Array.isArray(tasksJson?.items) ? tasksJson.items : Array.isArray(tasksJson) ? tasksJson : [];
        const related = taskRows
          .map((x: Record<string, unknown>) => ({
            id: safe(x.id),
            title: safe(x.title),
            status: safe(x.status),
            priority: safe(x.priority),
            assignee: x.assignee && typeof x.assignee === "object" ? (x.assignee as { id?: string; name?: string }) : null,
          }))
          .filter((x: Task) => x.id && x.id !== taskId)
          .slice(0, 8);
        setRelatedTasks(related);

        const actionRows = Array.isArray(actionsJson?.items) ? actionsJson.items : [];
        const timelineRows: FeedItem[] = actionRows
          .map((x: Record<string, unknown>, idx: number) => ({
            id: safe(x.id) || `${idx}`,
            time: safe(x.created_at) || new Date().toISOString(),
            title: safe(x.action_name) || "agent action",
            detail: safe(x.status),
            status: safe(x.status),
          }))
          .slice(0, 20);

        const commentTimeline: FeedItem[] = commentsRows.map((x: Comment, idx: number) => ({
          id: safe(x.id) || `comment:${idx}`,
          time: safe(x.created_at) || new Date().toISOString(),
          title: safe(x.comment_type) || "task update",
          detail: safe(x.content),
          status: "updated",
        }));

        setTimeline([...timelineRows, ...commentTimeline].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()));

        const pending = Array.isArray(approvalsJson?.approvals) ? approvalsJson.approvals : [];
        setPendingApprovals(pending);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const resolveAction = useCallback(async (approvalId: string, action: "approve" | "reject") => {
    const path = action === "approve" ? "approve" : "reject";
    await fetch(`/api/agents/approvals/${encodeURIComponent(approvalId)}/${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "reject" ? { reason: "Rejected from task detail" } : {}),
    });
    await loadTask();
  }, [loadTask]);

  useEffect(() => {
    if (!taskId) return;
    void loadTask();
  }, [loadTask, taskId]);

  const aiConfidence = useMemo(() => confidence(task || ({ id: taskId } as Task), timeline.length), [task, taskId, timeline.length]);

  if (loading) {
    return (
      <div className="jira-page-content min-h-screen p-6">
        <BlockLoadingOverlay active={true} label="Loading task detail..." fullScreen={true} delayMs={0} />
      </div>
    );
  }

  if (!task) {
    return <div className="jira-page-content min-h-screen p-6 text-[var(--accent-red)]">Task not found.</div>;
  }

  return (
    <div className="jira-page-content min-h-screen p-5 md:p-7">
      <div className="mx-auto max-w-[1520px] space-y-4">
        <header className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{task.title || "Task Detail"}</h1>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">Task ID: {task.id}</div>
            </div>
            <div className="grid gap-1 text-xs text-[var(--text-secondary)] md:text-right">
              <div>Status: <span className="text-[var(--text-primary)]">{task.status || "unknown"}</span></div>
              <div>Assigned: <span className="text-[var(--text-primary)]">{safe(task.assignee?.name) || "unassigned"}</span></div>
              <div>Priority: <span className="text-[var(--text-primary)]">{task.priority || "medium"}</span></div>
              <div>AI Confidence: <span className="text-[var(--accent-green)]">{aiConfidence}%</span></div>
              <div>Created by: <span className="text-[var(--text-primary)]">{timeline[0]?.title || "agent workflow"}</span></div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Task Overview</h2>
              <p className="mt-2 text-sm text-[var(--text-primary)]">{task.description || "No description provided."}</p>
              <div className="mt-3 text-xs text-[var(--text-secondary)]">Requirements: {task.acceptanceCriteria || "not specified"}</div>
              <div className="mt-2 text-xs text-[var(--text-secondary)]">Tags / skills: {(task.techTags || []).join(", ") || "not tagged"}</div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Sprint Context</h2>
              <div className="mt-2 grid gap-1 text-sm">
                <div>Sprint: {safe(sprint?.name) || task.sprintId || "n/a"}</div>
                <div>Progress: {safe(task.status).toLowerCase() === "done" ? "100" : safe(task.status).toLowerCase() === "in_progress" ? "50" : "10"}%</div>
                <div>Deadline: {task.dueDate || "n/a"}</div>
                <div>Dependencies: {timeline.length ? "activity-linked" : "not available"}</div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">GitHub Integration</h2>
              <div className="mt-2 space-y-1 text-sm text-[var(--text-primary)]">
                <div>Linked PR: {safe(comments[0]?.content).includes("http") ? "referenced in comments" : "none"}</div>
                <div>Linked Branch: {safe(task.title).toLowerCase().includes("branch") ? "mentioned in task" : "none"}</div>
                <div>Linked Issues: {safe(comments[0]?.comment_type) || "none"}</div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Activity Timeline</h2>
              <div className="mt-2 space-y-2">
                {timeline.map((item) => (
                  <div key={item.id} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{item.title}</span>
                      <span className="text-[var(--text-secondary)]">{ago(item.time)}</span>
                    </div>
                    <div className="mt-1 text-[var(--text-secondary)]">{item.detail}</div>
                  </div>
                ))}
                {!timeline.length ? <div className="text-xs text-[var(--text-secondary)]">No timeline events.</div> : null}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Developer Info</h2>
              <div className="mt-2 text-sm">
                <div>Developer: {safe(task.assignee?.name) || "unassigned"}</div>
                <div className="text-[var(--text-secondary)]">Past related tasks</div>
              </div>
              <div className="mt-2 space-y-1">
                {relatedTasks.map((item) => (
                  <div key={item.id} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                    <div className="font-semibold">{item.title || item.id}</div>
                    <div className="text-[var(--text-secondary)]">{item.status || "unknown"}</div>
                  </div>
                ))}
                {!relatedTasks.length ? <div className="text-xs text-[var(--text-secondary)]">No related tasks.</div> : null}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Agent Actions</h2>
              <div className="mt-2 text-xs text-[var(--text-secondary)]">Suggestions: reassign, update priority</div>
              <div className="mt-2 space-y-2">
                {pendingApprovals.slice(0, 4).map((item) => {
                  const id = safe(item.id);
                  return (
                    <div key={id} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                      <div className="font-semibold">{safe(item.title) || "Pending AI action"}</div>
                      <div className="mt-1 text-[var(--text-secondary)]">{safe(item.description)}</div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void resolveAction(id, "approve")}
                          className="rounded border border-[var(--accent-green)]/50 px-2 py-1 text-[var(--accent-green)]"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveAction(id, "reject")}
                          className="rounded border border-[var(--accent-red)]/50 px-2 py-1 text-[var(--accent-red)]"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!pendingApprovals.length ? <div className="text-xs text-[var(--text-secondary)]">No pending AI actions for this task.</div> : null}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
