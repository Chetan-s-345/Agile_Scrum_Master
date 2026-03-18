"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Task = Record<string, unknown>;

type TaskResp = { task?: Task; error?: string } | (Task & { error?: never });

type CommentsResp = { items: Array<Record<string, unknown>> };

function normalizeTask(data: TaskResp | null): Task | null {
  if (!data) return null;
  if (typeof data === "object" && data && "task" in data) {
    const maybe = (data as { task?: Task }).task;
    return maybe ?? null;
  }
  return data;
}

function extractError(data: TaskResp | null): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null; text?: string }> {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data, text };
}

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId;
  const hasId = useMemo(() => typeof taskId === "string" && taskId.length > 0, [taskId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<CommentsResp | null>(null);

  useEffect(() => {
    if (!hasId) return;

    (async () => {
      setLoading(true);
      setError(null);

      const [tResp, cResp] = await Promise.all([
        fetchJson<TaskResp>(`/api/tasks/${encodeURIComponent(taskId)}`),
        fetchJson<CommentsResp>(`/api/tasks/${encodeURIComponent(taskId)}/comments`),
      ]);

      if (!tResp.ok) {
        setTask(null);
        setComments(null);
        setError(extractError(tResp.data) || `Failed to load task (${tResp.status})`);
        setLoading(false);
        return;
      }

      setTask(normalizeTask(tResp.data));
      setComments(cResp.ok ? cResp.data : null);
      setLoading(false);
    })();
  }, [hasId, taskId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Task</h1>
        <p className="text-slate-600 dark:text-slate-300">ID: {taskId}</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Task (raw)</div>
              <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
                {JSON.stringify(task, null, 2)}
              </pre>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Comments (raw)</div>
              <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
                {JSON.stringify(comments, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
