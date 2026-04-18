"use client";

import Link from "@/next-shims/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "@/next-shims/navigation";
import {
  Bookmark,
  CheckSquare,
  CircleUserRound,
  Ellipsis,
  Flame,
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  Rocket,
  Search,
  Users,
  AlertTriangle,
  Gauge,
  CalendarClock,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SprintListItem = {
  id: string;
  projectId: string;
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

type DashboardSummary = {
  activeSprint: {
    id?: string;
    projectId?: string;
    name?: string;
    progress?: number;
  } | null;
  openTasks: number;
  blockers: number;
  velocity: number;
  upcomingStandups: number;
};

type ActivityEvent = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  userId: string;
};

type BurndownData = {
  dates: string[];
  ideal: number[];
  actual: number[];
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

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function normalizeSummary(summary: unknown): DashboardSummary {
  const raw = summary && typeof summary === "object" ? (summary as Record<string, unknown>) : {};
  const activeRaw = raw.activeSprint && typeof raw.activeSprint === "object" ? (raw.activeSprint as Record<string, unknown>) : null;

  return {
    activeSprint: activeRaw
      ? {
          id: String(activeRaw.id || "").trim() || undefined,
          projectId: String(activeRaw.projectId || "").trim() || undefined,
          name: String(activeRaw.name || "").trim() || "Active Sprint",
          progress: toFiniteNumber(activeRaw.progress, 0),
        }
      : null,
    openTasks: Math.max(0, Math.round(toFiniteNumber(raw.openTasks, 0))),
    blockers: Math.max(0, Math.round(toFiniteNumber(raw.blockers, 0))),
    velocity: Math.max(0, Math.round(toFiniteNumber(raw.velocity, 0))),
    upcomingStandups: Math.max(0, Math.round(toFiniteNumber(raw.upcomingStandups, 0))),
  };
}

function normalizeRecentActivity(payload: unknown): ActivityEvent[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item, index) => {
      const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = String(raw.id || `activity-${index + 1}`).trim() || `activity-${index + 1}`;
      return {
        id,
        type: String(raw.type || "task.updated").trim() || "task.updated",
        message: String(raw.message || "Task updated").trim() || "Task updated",
        timestamp: String(raw.timestamp || new Date().toISOString()),
        userId: String(raw.userId || "system"),
      };
    })
    .slice(0, 10);
}

function normalizeBurndownData(payload: unknown): BurndownData {
  const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const datesRaw = Array.isArray(raw.dates) ? raw.dates : [];
  const idealRaw = Array.isArray(raw.ideal) ? raw.ideal : [];
  const actualRaw = Array.isArray(raw.actual) ? raw.actual : [];

  return {
    dates: datesRaw.map((v) => String(v || "")),
    ideal: idealRaw.map((v) => Math.max(0, toFiniteNumber(v, 0))),
    actual: actualRaw.map((v) => Math.max(0, toFiniteNumber(v, 0))),
  };
}

function mapActivityTypeToColumn(type: string): keyof BoardData {
  const normalized = type.toLowerCase();
  if (normalized.includes("block")) return "blocked";
  if (normalized.includes("review")) return "in_review";
  if (normalized.includes("done") || normalized.includes("close") || normalized.includes("complete")) return "done";
  if (normalized.includes("progress") || normalized.includes("start") || normalized.includes("move")) return "in_progress";
  return "todo";
}

function toBoardTask(event: ActivityEvent): BoardTask {
  const date = new Date(event.timestamp);
  return {
    id: String(event.id),
    title: event.message,
    taskKey: event.type,
    dueDate: Number.isNaN(date.getTime()) ? undefined : date.toISOString(),
    storyPoints: 0,
    assignee: event.userId ? { id: event.userId } : null,
  };
}

function buildBoardFromActivity(events: ActivityEvent[]): BoardData {
  const next: BoardData = { todo: [], in_progress: [], in_review: [], blocked: [], done: [] };
  for (const event of events) {
    const column = mapActivityTypeToColumn(event.type);
    next[column].push(normalizeTask(toBoardTask(event)));
  }
  return next;
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

function formatActivityTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DashboardPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sprints, setSprints] = useState<SprintListItem[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [board, setBoard] = useState<BoardData>({ todo: [], in_progress: [], in_review: [], blocked: [], done: [] });
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityEvent[]>([]);
  const [burndownData, setBurndownData] = useState<BurndownData>({ dates: [], ideal: [], actual: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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
    async function loadDashboardData() {
      setLoading(true);
      setError(null);

      try {
        const payload = {
          sprintId: selectedSprintId || preferredSprintId || undefined,
          projectId: preferredProjectId || undefined,
        };

        const [summaryRaw, activityRaw, burndownRaw] = await Promise.all([
          invokeDesktop<unknown>("dashboard:getSummary", payload),
          invokeDesktop<unknown>("dashboard:getRecentActivity", payload),
          invokeDesktop<unknown>("dashboard:getBurndownData", payload),
        ]);

        if (cancelled) return;

        const normalizedSummary = normalizeSummary(summaryRaw);
        const normalizedActivity = normalizeRecentActivity(activityRaw);
        const normalizedBurndown = normalizeBurndownData(burndownRaw);
        const nextBoard = buildBoardFromActivity(normalizedActivity);

        const activeSprintId = String(normalizedSummary.activeSprint?.id || "").trim();
        const activeProjectId = String(normalizedSummary.activeSprint?.projectId || preferredProjectId || "").trim();
        const activeSprintName = String(normalizedSummary.activeSprint?.name || "Active Sprint").trim() || "Active Sprint";

        setSummary(normalizedSummary);
        setRecentActivity(normalizedActivity);
        setBurndownData(normalizedBurndown);
        setBoard(nextBoard);
        setSprints(
          activeSprintId
            ? [
                {
                  id: activeSprintId,
                  projectId: activeProjectId,
                  name: activeSprintName,
                },
              ]
            : []
        );

        if (activeSprintId && activeSprintId !== selectedSprintId) {
          setSelectedSprintId(activeSprintId);
        } else {
          if (!activeSprintId && selectedSprintId) setSelectedSprintId("");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load dashboard");
          setSummary(null);
          setRecentActivity([]);
          setBurndownData({ dates: [], ideal: [], actual: [] });
          setBoard({ todo: [], in_progress: [], in_review: [], blocked: [], done: [] });
          setSprints([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDashboardData();

    return () => {
      cancelled = true;
    };
  }, [preferredProjectId, preferredSprintId, selectedSprintId]);

  useEffect(() => {
    if (!selectedSprintId) return;
    const next = new URLSearchParams(searchParams?.toString() || "");
    if (selectedSprintId) next.set("sprintId", selectedSprintId);
    const selectedSprint = sprints.find((item) => String(item.id) === String(selectedSprintId));
    if (selectedSprint?.projectId) next.set("projectId", String(selectedSprint.projectId));
    const nextQuery = next.toString();
    const currentQuery = searchParams?.toString() || "";
    if (nextQuery === currentQuery) return;
    router.replace(`${pathname}?${nextQuery}`, { scroll: false });
  }, [pathname, router, searchParams, selectedSprintId, sprints]);

  const inReviewPlusBlocked = useMemo(
    () => [...filteredBoard.in_review, ...filteredBoard.blocked],
    [filteredBoard.in_review, filteredBoard.blocked]
  );

  const sprintLabel = useMemo(() => {
    const sprint = sprints.find((item) => String(item.id) === String(selectedSprintId));
    return sprint?.name || "No active sprint";
  }, [selectedSprintId, sprints]);

  const totalTasks = filteredBoard.todo.length + filteredBoard.in_progress.length + filteredBoard.in_review.length + filteredBoard.blocked.length + filteredBoard.done.length;
  const completedTasks = filteredBoard.done.length;
  const completionPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const sprintProgress = Math.max(0, Math.min(100, Math.round(toFiniteNumber(summary?.activeSprint?.progress, completionPct))));
  const summaryOpenTasks = summary?.openTasks ?? totalTasks;
  const summaryBlockers = summary?.blockers ?? filteredBoard.blocked.length;
  const summaryVelocity = summary?.velocity ?? 0;
  const summaryStandups = summary?.upcomingStandups ?? 0;

  const burndownSeries = useMemo(() => {
    const maxLength = Math.max(burndownData.dates.length, burndownData.ideal.length, burndownData.actual.length);
    return Array.from({ length: maxLength }).map((_, index) => ({
      date: burndownData.dates[index] || `Day ${index + 1}`,
      ideal: Math.max(0, toFiniteNumber(burndownData.ideal[index], 0)),
      actual: Math.max(0, toFiniteNumber(burndownData.actual[index], 0)),
    }));
  }, [burndownData]);

  const showSummarySkeleton = loading && !summary;
  const showActivitySkeleton = loading && !recentActivity.length;
  const showBurndownSkeleton = loading && !burndownSeries.length;

  return (
    <div>
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
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/standup")}
              className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <PlayCircle className="mr-1.5 h-4 w-4" />
              Start Standup
            </button>
            <button
              type="button"
              onClick={() => router.push("/board")}
              className="inline-flex h-9 items-center rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm hover:bg-[#2a2a2a]"
            >
              <LayoutDashboard className="mr-1.5 h-4 w-4" />
              View Board
            </button>
            <button
              type="button"
              onClick={() => router.push("/sprint/plan")}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm hover:bg-[#2a2a2a]"
            >
              <Rocket className="mr-1.5 h-4 w-4" />
              Plan Sprint
            </button>
          </div>
        </div>

        {error ? <div className="mb-3 rounded-md border border-[#5a1f1f] bg-[#2a1616] px-3 py-2 text-sm text-[#f3b6b6]">{error}</div> : null}

        <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {showSummarySkeleton ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={`summary-skeleton-${index}`} className="h-24 animate-pulse rounded-md border border-[var(--border)] bg-[var(--bg-card)]" />
            ))
          ) : (
            <>
              <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <Flame className="h-3.5 w-3.5" />
                  Active Sprint Progress
                </div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{sprintProgress}%</div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-[#1f1f1f]">
                  <div className="h-full bg-[var(--accent-blue)]" style={{ width: `${sprintProgress}%` }} />
                </div>
              </div>

              <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <ListChecks className="h-3.5 w-3.5" />
                  Total Open Tasks
                </div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{summaryOpenTasks}</div>
              </div>

              <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Blockers Count
                </div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{summaryBlockers}</div>
              </div>

              <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <Gauge className="h-3.5 w-3.5" />
                  Team Velocity
                </div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{summaryVelocity}</div>
              </div>

              <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
                <div className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Upcoming Standups
                </div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">{summaryStandups}</div>
              </div>
            </>
          )}
        </section>

        <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{sprintLabel}</span>
            <span>{completedTasks}/{totalTasks} done ({completionPct}%)</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-[#1f1f1f]">
            <div className="h-full bg-[var(--accent-blue)]" style={{ width: `${completionPct}%` }} />
          </div>
        </div>

        <section className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3 xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Active Sprint Burndown</h2>
              <span className="text-xs text-[var(--text-secondary)]">{sprintLabel}</span>
            </div>

            {showBurndownSkeleton ? (
              <div className="h-[260px] animate-pulse rounded border border-[var(--border)] bg-[var(--bg-surface)]" />
            ) : burndownSeries.length ? (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={burndownSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" stroke="var(--text-secondary)" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                    <YAxis stroke="var(--text-secondary)" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--bg-card)",
                        borderColor: "var(--border)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Legend wrapperStyle={{ color: "var(--text-secondary)" }} />
                    <Line type="monotone" dataKey="ideal" stroke="var(--text-secondary)" strokeDasharray="6 4" dot={false} name="Ideal" />
                    <Line type="monotone" dataKey="actual" stroke="var(--accent-blue)" strokeWidth={2} dot={{ r: 2 }} name="Actual" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex h-[260px] items-center justify-center rounded border border-dashed border-[var(--border)] text-sm text-[var(--text-secondary)]">
                No burndown data available.
              </div>
            )}
          </div>

          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent Activity</h2>
              <span className="text-xs text-[var(--text-secondary)]">Last 10</span>
            </div>

            {showActivitySkeleton ? (
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, index) => (
                  <div key={`activity-skeleton-${index}`} className="h-10 animate-pulse rounded border border-[var(--border)] bg-[var(--bg-surface)]" />
                ))}
              </div>
            ) : recentActivity.length ? (
              <div className="space-y-2">
                {recentActivity.map((event) => (
                  <div key={event.id} className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-2">
                    <div className="text-sm text-[var(--text-primary)]">{event.message}</div>
                    <div className="mt-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                      <span>{event.type}</span>
                      <span>{formatActivityTime(event.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-[var(--border)] p-3 text-sm text-[var(--text-secondary)]">No recent updates.</div>
            )}
          </div>
        </section>

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
