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
  sprint?: string;
  sprintId?: string;
  dueDate?: string;
  acceptanceCriteria?: string;
  techTags?: string[];
  storyPoints?: number;
  assignee?: { id?: string; name?: string } | null;
  blockers?: { id?: string; description?: string; createdAt?: string }[];
  comments?: Comment[];
  relatedTasks?: { id?: string; title?: string; status?: string; relation?: string }[];
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

type AIAnalysis = {
  complexityScore?: number;
  riskFlags?: string[];
  suggestedActions?: string[];
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

export default function ScrumMasterTaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = safe(params?.taskId);

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<{ id?: string; title?: string; status?: string; relation?: string }[]>([]);
  const [timeline, setTimeline] = useState<FeedItem[]>([]);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [blockerInput, setBlockerInput] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTask = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    try {
      const [taskData, commentsTimeline, aiData] = await Promise.all([
        invokeDesktop<Task>("tasks:getById", { taskId }),
        invokeDesktop<FeedItem[]>("tasks:getActivityLog", { taskId }),
        invokeDesktop<AIAnalysis>("scrumMaster:analyzeTask", { taskId })
      ]);
      const nextTask = {
        ...taskData,
        id: safe(taskData?.id) || taskId,
        techTags: arr(taskData?.techTags)
      };

      setTask(nextTask);
      setComments(Array.isArray(nextTask.comments) ? nextTask.comments : []);
      setRelatedTasks(Array.isArray(nextTask.relatedTasks) ? nextTask.relatedTasks : []);
      setTimeline(Array.isArray(commentsTimeline) ? commentsTimeline : []);
      setAnalysis(aiData || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task detail");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const addBlocker = useCallback(async () => {
    const description = blockerInput.trim();
    if (!taskId || !description) return;

    setBusyAction("add-blocker");
    setError(null);
    try {
      const updated = await invokeDesktop<Task>("tasks:addBlocker", { taskId, description });
      setTask(updated);
      setBlockerInput("");
      const events = await invokeDesktop<FeedItem[]>("tasks:getActivityLog", { taskId });
      setTimeline(Array.isArray(events) ? events : []);
      setAnalysis(await invokeDesktop<AIAnalysis>("scrumMaster:analyzeTask", { taskId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add blocker");
    } finally {
      setBusyAction(null);
    }
  }, [blockerInput, taskId]);

  const removeBlocker = useCallback(async (blockerId: string) => {
    if (!taskId || !blockerId) return;

    setBusyAction(`remove-blocker:${blockerId}`);
    setError(null);
    try {
      const updated = await invokeDesktop<Task>("tasks:removeBlocker", { taskId, blockerId });
      setTask(updated);
      const events = await invokeDesktop<FeedItem[]>("tasks:getActivityLog", { taskId });
      setTimeline(Array.isArray(events) ? events : []);
      setAnalysis(await invokeDesktop<AIAnalysis>("scrumMaster:analyzeTask", { taskId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove blocker");
    } finally {
      setBusyAction(null);
    }
  }, [taskId]);

  const addComment = useCallback(async () => {
    const content = commentInput.trim();
    if (!taskId || !content) return;

    setBusyAction("add-comment");
    setError(null);
    try {
      const comment = await invokeDesktop<Comment>("tasks:addComment", { taskId, content });
      setComments((prev) => [comment, ...prev]);
      setCommentInput("");
      const events = await invokeDesktop<FeedItem[]>("tasks:getActivityLog", { taskId });
      setTimeline(Array.isArray(events) ? events : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setBusyAction(null);
    }
  }, [commentInput, taskId]);

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
        {error ? (
          <div className="rounded-lg border border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 p-3 text-sm text-[var(--accent-red)]">
            {error}
          </div>
        ) : null}

        <header className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{task.title || "Task Detail"}</h1>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">Task ID: {task.id}</div>
            </div>
            <div className="grid gap-1 text-xs text-[var(--text-secondary)] md:text-right">
              <div>Status: <span className="text-[var(--text-primary)]">{task.status || "unknown"}</span></div>
              <div>Assigned: <span className="text-[var(--text-primary)]">{safe(task.assignee?.name) || "unassigned"}</span></div>
              <div>Sprint: <span className="text-[var(--text-primary)]">{task.sprint || task.sprintId || "n/a"}</span></div>
              <div>Priority: <span className="text-[var(--text-primary)]">{task.priority || "medium"}</span></div>
              <div>Story Points: <span className="text-[var(--text-primary)]">{Number(task.storyPoints || 0)}</span></div>
              <div>AI Confidence: <span className="text-[var(--accent-green)]">{aiConfidence}%</span></div>
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
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">AI Analysis</h2>
              <div className="mt-2 grid gap-2 text-sm text-[var(--text-primary)]">
                <div>Complexity Score: <span className="font-semibold">{Number(analysis?.complexityScore || 0)}</span></div>
                <div className="text-xs text-[var(--text-secondary)]">Risk Flags</div>
                <div className="space-y-1">
                  {(analysis?.riskFlags || []).map((flag, idx) => (
                    <div key={`${flag}-${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs">
                      {flag}
                    </div>
                  ))}
                  {!(analysis?.riskFlags || []).length ? (
                    <div className="text-xs text-[var(--text-secondary)]">No immediate risks detected.</div>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">Suggested Actions</div>
                <div className="space-y-1">
                  {(analysis?.suggestedActions || []).map((action, idx) => (
                    <div key={`${action}-${idx}`} className="text-xs text-[var(--text-primary)]">• {action}</div>
                  ))}
                </div>
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

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Comments</h2>
              <div className="mt-2 flex gap-2">
                <input
                  value={commentInput}
                  onChange={(event) => setCommentInput(event.target.value)}
                  placeholder="Add comment..."
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addComment()}
                  disabled={busyAction === "add-comment" || !commentInput.trim()}
                  className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-xs disabled:opacity-60"
                >
                  {busyAction === "add-comment" ? "Posting..." : "Add"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {comments.map((item, idx) => (
                  <div key={safe(item.id) || `comment-${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{safe(item.author_name) || "Scrum Master"}</span>
                      <span className="text-[var(--text-secondary)]">{ago(safe(item.created_at) || new Date().toISOString())}</span>
                    </div>
                    <div className="mt-1 text-[var(--text-secondary)]">{safe(item.content)}</div>
                  </div>
                ))}
                {!comments.length ? <div className="text-xs text-[var(--text-secondary)]">No comments yet.</div> : null}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Blockers</h2>
              <div className="mt-2 flex gap-2">
                <input
                  value={blockerInput}
                  onChange={(event) => setBlockerInput(event.target.value)}
                  placeholder="Describe blocker..."
                  className="w-full rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addBlocker()}
                  disabled={busyAction === "add-blocker" || !blockerInput.trim()}
                  className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-xs disabled:opacity-60"
                >
                  {busyAction === "add-blocker" ? "Adding..." : "Add"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {(task.blockers || []).map((item, idx) => {
                  const blockerId = safe(item.id) || `blocker-${idx}`;
                  return (
                    <div key={blockerId} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                      <div className="text-[var(--text-primary)]">{safe(item.description) || "Blocker"}</div>
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => void removeBlocker(blockerId)}
                          disabled={busyAction === `remove-blocker:${blockerId}`}
                          className="rounded border border-[var(--accent-red)]/50 px-2 py-1 text-[var(--accent-red)] disabled:opacity-60"
                        >
                          {busyAction === `remove-blocker:${blockerId}` ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!(task.blockers || []).length ? <div className="text-xs text-[var(--text-secondary)]">No blockers on this task.</div> : null}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Related Tasks</h2>
              <div className="mt-2 space-y-1">
                {relatedTasks.map((item, idx) => (
                  <div key={safe(item.id) || `related-${idx}`} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
                    <div className="font-semibold">{safe(item.title) || safe(item.id) || "task"}</div>
                    <div className="text-[var(--text-secondary)]">
                      {safe(item.relation) || "linked"} · {safe(item.status) || "unknown"}
                    </div>
                  </div>
                ))}
                {!relatedTasks.length ? <div className="text-xs text-[var(--text-secondary)]">No related tasks.</div> : null}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
