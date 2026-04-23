"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BlockLoadingOverlay } from "@/components/block-loading-overlay";
import {
  Bell,
  Bookmark,
  ChartColumn,
  CheckSquare,
  ChevronDown,
  CircleUserRound,
  Ellipsis,
  Search,
  Settings2,
  Users,
} from "lucide-react";

type SprintListItem = {
  id: string;
  projectId: string;
  project_id?: string;
  name: string;
};

type BoardTask = {
  id: string;
  title: string;
  storyPoints?: number;
  priority?: string;
  taskKey?: string;
  dueDate?: string;
  aiRiskScore?: number;
  assignee?: { id: string; name?: string } | null;
};

type BoardData = {
  todo: BoardTask[];
  in_progress: BoardTask[];
  in_review: BoardTask[];
  blocked: BoardTask[];
  done: BoardTask[];
};

type BoardColumnData = {
  key: "todo" | "in_progress" | "in_review" | "done";
  title: string;
  done?: boolean;
};

const boardColumns: BoardColumnData[] = [
  { key: "todo", title: "BACKLOG" },
  { key: "in_progress", title: "IN DEVELOPMENT" },
  { key: "in_review", title: "IN REVIEW" },
  { key: "done", title: "DONE", done: true },
];

function formatDueDate(value?: string) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function normalizeTask(task: BoardTask): BoardTask {
  const raw = task as BoardTask & {
    task_id?: string;
    due_date?: string;
    issue_key?: string;
    assignee_name?: string;
  };
  return {
    ...task,
    id: String(raw.id || raw.task_id || ""),
    title: String(raw.title || "Untitled Task"),
    taskKey: String(raw.taskKey || raw.issue_key || "").trim() || undefined,
    dueDate: String(raw.dueDate || raw.due_date || "").trim() || undefined,
    assignee: task.assignee || (raw.assignee_name ? { id: "", name: raw.assignee_name } : null),
  };
}

function normalizeSprint(input: unknown): SprintListItem | null {
  if (!input || typeof input !== "object") return null;
  const row = input as { id?: unknown; projectId?: unknown; project_id?: unknown; name?: unknown };
  const id = String(row.id || "").trim();
  if (!id) return null;
  const projectId = String(row.projectId || row.project_id || "").trim();
  return {
    id,
    projectId,
    project_id: projectId,
    name: String(row.name || "Sprint"),
  };
}
function TaskCard({ task }: { task: BoardTask }) {
  const dueText = formatDueDate(task.dueDate);
  const hasDueDate = dueText !== "No due date";

  return (
    <article className="rounded-md border border-[var(--border)] bg-gradient-to-br from-[#1b2438] via-[#1a1f2d] to-[#191826] p-3 transition hover:-translate-y-0.5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="text-[20px] leading-7 text-[#f5f5f5] hover:underline">
          {task.title}
        </Link>
        <Ellipsis className="h-4 w-4 text-[#a7a7a7]" />
      </div>

      <div
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${
          hasDueDate ? "border-[#e3b54a] text-[#f3d188]" : "border-[#4a4a4a] text-[#b4b4b4]"
        }`}
      >
        <span aria-hidden>{hasDueDate ? "🕐" : "•"}</span>
        <span>{dueText}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-sm text-[#c8c8c8]">
          <Bookmark className="h-4 w-4" />
          <span>{task.taskKey || `SCRUM-${String(task.id).slice(0, 6).toUpperCase()}`}</span>
          <span className="ml-2 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs text-[#9d9d9d]">
            {Number(task.storyPoints || 0)}pt
          </span>
        </div>
        <div className="inline-flex items-center gap-1 text-[#9d9d9d]">
          {task.assignee?.name ? <CircleUserRound className="h-4 w-4" /> : <Users className="h-4 w-4" />}
        </div>
      </div>
    </article>
  );
}

function BoardColumn({ column, tasks }: { column: BoardColumnData; tasks: BoardTask[] }) {
  const tone =
    column.key === "todo"
      ? "bg-gradient-to-b from-[#182236] to-[#161c2c]"
      : column.key === "in_progress"
        ? "bg-gradient-to-b from-[#1f2436] to-[#1a1c2b]"
        : column.key === "in_review"
          ? "bg-gradient-to-b from-[#2a2134] to-[#201a2c]"
          : "bg-gradient-to-b from-[#1f2b22] to-[#18211d]";

  return (
    <section className={`flex min-h-[420px] min-w-[280px] flex-1 flex-col rounded-lg border border-[var(--border)] p-3 ${tone}`}>
      <header className="mb-3 flex items-center gap-2 border-b border-[var(--border)] pb-3 text-[22px]">
        <span className="tracking-wide text-[#e9e9e9]">{column.title}</span>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-[var(--border)] px-1 text-xs text-[#a5a5a5]">
          {tasks.length}
        </span>
        {column.done ? <CheckSquare className="h-4 w-4 text-[#96d266]" /> : null}
      </header>

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {!tasks.length ? <div className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[#8f8f8f]">No tasks</div> : null}
      </div>

      <div className="mt-auto inline-flex h-10 items-center rounded-md border border-dashed border-[var(--border)] px-3 text-sm text-[#8f8f8f]">
        View only
      </div>
    </section>
  );
}

function DashboardPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sprints, setSprints] = useState<SprintListItem[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [board, setBoard] = useState<BoardData>({ todo: [], in_progress: [], in_review: [], blocked: [], done: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sendingNotification, setSendingNotification] = useState(false);
  const preferredSprintId = String(searchParams?.get("sprintId") || "").trim();
  const preferredProjectId = String(searchParams?.get("projectId") || "").trim();

  const filteredBoard = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return board;
    const matches = (task: BoardTask) => {
      const hay = `${task.title} ${task.taskKey || ""} ${task.assignee?.name || ""}`.toLowerCase();
      return hay.includes(q);
    };
    return {
      todo: board.todo.filter(matches),
      in_progress: board.in_progress.filter(matches),
      in_review: board.in_review.filter(matches),
      blocked: board.blocked.filter(matches),
      done: board.done.filter(matches),
    };
  }, [board, query]);

  useEffect(() => {
    let cancelled = false;
    async function loadSprints() {
      try {
        const respAll = await fetch(`/api/sprints`, { cache: "no-store" });
        const dataAll = await respAll.json().catch(() => null);
        if (!respAll.ok) {
          const message = String(dataAll?.error || "Failed to load sprints");
          throw new Error(message);
        }

        const merged = Array.isArray(dataAll?.items) ? dataAll.items : [];

        const dedup = new Map<string, SprintListItem>();
        for (const item of merged) {
          const normalized = normalizeSprint(item);
          if (!normalized || dedup.has(normalized.id)) continue;
          dedup.set(normalized.id, normalized);
        }

        if (preferredSprintId && !dedup.has(preferredSprintId)) {
          const requestedResp = await fetch(`/api/sprints/${encodeURIComponent(preferredSprintId)}`, { cache: "no-store" });
          const requestedData = await requestedResp.json().catch(() => null) as { sprint?: unknown } | null;
          if (requestedResp.ok) {
            const requested = normalizeSprint(requestedData?.sprint);
            if (requested) dedup.set(requested.id, requested);
          }
        }

        const items = [...dedup.values()];
        if (cancelled) return;
        setSprints(items);
        if (preferredSprintId && items.some((x) => String(x.id) === preferredSprintId)) {
          setSelectedSprintId(preferredSprintId);
        } else {
          setSelectedSprintId(items[0]?.id ? String(items[0].id) : (preferredSprintId || ""));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load sprints");
      }
    }
    void loadSprints();
    return () => {
      cancelled = true;
    };
  }, [preferredProjectId, preferredSprintId]);

  useEffect(() => {
    if (!selectedSprintId) return;
    const next = new URLSearchParams(searchParams?.toString() || "");
    if (selectedSprintId) next.set("sprintId", selectedSprintId);
    const selectedSprint = sprints.find((item) => String(item.id) === String(selectedSprintId));
    const selectedProjectId = String(selectedSprint?.projectId || selectedSprint?.project_id || "");
    if (selectedProjectId) next.set("projectId", selectedProjectId);
    const nextQuery = next.toString();
    const currentQuery = searchParams?.toString() || "";
    if (nextQuery === currentQuery) return;
    router.replace(`${pathname}?${nextQuery}`, { scroll: false });
  }, [pathname, router, searchParams, selectedSprintId, sprints]);

  useEffect(() => {
    let cancelled = false;
    async function loadBoard() {
      if (!selectedSprintId) return;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/tasks/board/${encodeURIComponent(selectedSprintId)}`, { cache: "no-store" });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error(String(data?.error || "Failed to load board"));
        if (cancelled) return;
        setBoard({
          todo: Array.isArray(data?.todo) ? (data.todo as BoardTask[]).map(normalizeTask) : [],
          in_progress: Array.isArray(data?.in_progress) ? (data.in_progress as BoardTask[]).map(normalizeTask) : [],
          in_review: Array.isArray(data?.in_review) ? (data.in_review as BoardTask[]).map(normalizeTask) : [],
          blocked: Array.isArray(data?.blocked) ? (data.blocked as BoardTask[]).map(normalizeTask) : [],
          done: Array.isArray(data?.done) ? (data.done as BoardTask[]).map(normalizeTask) : [],
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load board");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadBoard();
    return () => {
      cancelled = true;
    };
  }, [selectedSprintId]);

  const inReviewPlusBlocked = useMemo(
    () => [...filteredBoard.in_review, ...filteredBoard.blocked],
    [filteredBoard.in_review, filteredBoard.blocked]
  );

  const sprintLabel = useMemo(() => {
    const sprint = sprints.find((item) => String(item.id) === String(selectedSprintId));
    return sprint?.name || "No active sprint";
  }, [selectedSprintId, sprints]);

  const sprintOptions = useMemo(() => {
    if (!selectedSprintId || sprints.some((item) => String(item.id) === String(selectedSprintId))) return sprints;
    return [{ id: selectedSprintId, name: "Selected Sprint", projectId: preferredProjectId, project_id: preferredProjectId }, ...sprints];
  }, [preferredProjectId, selectedSprintId, sprints]);

  const totalTasks = filteredBoard.todo.length + filteredBoard.in_progress.length + filteredBoard.in_review.length + filteredBoard.blocked.length + filteredBoard.done.length;
  const completedTasks = filteredBoard.done.length;
  const completionPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  async function sendNotificationEmail() {
    setSendingNotification(true);
    try {
      await fetch("/api/notifications/brevo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: "board-toolbar",
          subject: `Sprint Board Notification: ${sprintLabel}`,
          message: `Board notification triggered for ${sprintLabel}.`,
        }),
      });
    } finally {
      setSendingNotification(false);
    }
  }

  return (
    <div>
        <BlockLoadingOverlay active={loading} label="Loading board data..." fullScreen={true} delayMs={420} />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8f8f8f]" />
              <input
                type="search"
                placeholder="Search board"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-[180px] rounded-md border border-[var(--border)] bg-[var(--bg-surface)] pl-8 pr-2 text-sm text-white outline-none placeholder:text-[#8f8f8f] focus:border-white"
              />
            </div>
            <div className="inline-flex items-center gap-1">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-xs font-semibold">
                DS
              </span>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-xs font-semibold">
                TM
              </span>
            </div>
            <select
              value={selectedSprintId}
              onChange={(e) => setSelectedSprintId(e.target.value)}
              className="h-9 min-w-[220px] rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none"
            >
              {sprintOptions.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              Complete sprint
            </button>
            <button
              type="button"
              disabled={sendingNotification}
              onClick={() => void sendNotificationEmail()}
              className="rounded-md border border-[var(--border)] p-2 hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm hover:bg-[#2a2a2a]"
            >
              Group
              <ChevronDown className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-md border border-[var(--border)] p-2 hover:bg-[#2a2a2a]">
              <ChartColumn className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-md border border-[var(--border)] p-2 hover:bg-[#2a2a2a]">
              <Settings2 className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-md border border-[var(--border)] p-2 hover:bg-[#2a2a2a]">
              <Ellipsis className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error ? <div className="mb-3 rounded-md border border-[#5a1f1f] bg-[#2a1616] px-3 py-2 text-sm text-[#f3b6b6]">{error}</div> : null}
        {loading ? <div className="mb-3 rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-[#b0b0b0]">Loading board...</div> : null}

        <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{sprintLabel}</span>
            <span>{completedTasks}/{totalTasks} done ({completionPct}%)</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-[#1f1f1f]">
            <div className="h-full bg-[var(--accent-blue)]" style={{ width: `${completionPct}%` }} />
          </div>
        </div>

        <div className="show-scrollbar flex gap-3 overflow-x-auto pb-3">
          {boardColumns.map((column) => (
            <BoardColumn
              key={column.title}
              column={column}
              tasks={
                column.key === "todo"
                  ? filteredBoard.todo
                  : column.key === "in_progress"
                    ? filteredBoard.in_progress
                    : column.key === "in_review"
                      ? inReviewPlusBlocked
                      : filteredBoard.done
              }
            />
          ))}
        </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">Loading board...</div>}>
      <DashboardPageContent />
    </Suspense>
  );
}