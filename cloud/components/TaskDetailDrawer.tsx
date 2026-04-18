"use client";

import Image from "next/image";

export type DrawerSubtask = {
  id: string;
  code: string;
  title: string;
  status: string;
  assignee: { id: string; name: string; avatarUrl: string } | null;
};

export type DrawerTaskDetail = {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  subtasks: DrawerSubtask[];
};

type TaskDetailDrawerProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  task: DrawerTaskDetail | null;
  newSubtaskTitle: string;
  addingSubtask: boolean;
  onClose: () => void;
  onSubtaskToggle: (subtaskId: string, checked: boolean) => void;
  onNewSubtaskTitleChange: (value: string) => void;
  onAddSubtask: () => void;
};

function initials(name: string): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export function TaskDetailDrawer({
  open,
  loading,
  error,
  task,
  newSubtaskTitle,
  addingSubtask,
  onClose,
  onSubtaskToggle,
  onNewSubtaskTitleChange,
  onAddSubtask,
}: TaskDetailDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-xl overflow-auto border-l border-slate-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{task?.title || "Task details"}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{task?.code || ""}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:text-slate-200 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        {loading ? <p className="text-sm text-slate-600 dark:text-slate-300">Loading task details...</p> : null}
        {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</p> : null}

        {!loading && !error && task ? (
          <div className="space-y-5">
            <section className="rounded border border-slate-200 p-4 dark:border-zinc-800">
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Description</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                {task.description || "No description provided."}
              </p>
            </section>

            <section className="rounded border border-slate-200 p-4 dark:border-zinc-800">
              <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Sub-tasks</h3>

              <div className="space-y-2">
                {task.subtasks.map((subtask) => {
                  const done = String(subtask.status || "").toLowerCase() === "done";
                  return (
                    <label
                      key={subtask.id}
                      className="flex items-center gap-3 rounded border border-slate-200 px-3 py-2 text-sm dark:border-zinc-800"
                    >
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={(e) => onSubtaskToggle(subtask.id, e.target.checked)}
                      />
                      <span className="font-medium text-slate-700 dark:text-slate-300">{subtask.code}</span>
                      <span className="flex-1 text-slate-900 dark:text-white">{subtask.title}</span>
                      <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-zinc-700 dark:text-slate-300">
                        {subtask.status}
                      </span>
                      {subtask.assignee?.avatarUrl ? (
                        <Image
                          src={subtask.assignee.avatarUrl}
                          alt={subtask.assignee.name || "assignee"}
                          width={24}
                          height={24}
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-[11px] text-slate-700 dark:border-zinc-700 dark:text-slate-300">
                          {initials(subtask.assignee?.name || "")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {!task.subtasks.length ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No subtasks yet.</p>
              ) : null}

              <div className="mt-3 flex items-center gap-2">
                <input
                  value={newSubtaskTitle}
                  onChange={(e) => onNewSubtaskTitleChange(e.target.value)}
                  placeholder="+ Add subtask"
                  className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={onAddSubtask}
                  disabled={addingSubtask || !newSubtaskTitle.trim()}
                  className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {addingSubtask ? "Adding..." : "Add"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
