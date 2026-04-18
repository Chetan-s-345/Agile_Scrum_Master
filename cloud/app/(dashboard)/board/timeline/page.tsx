"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns";

type Sprint = { id: string; name: string; startDate?: string; endDate?: string; status?: string };
type Task = {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  storyPoints?: number;
  assignee?: { id: string; name?: string } | null;
  dueDate?: string;
  startDate?: string;
  sprintId: string;
  epic?: string;
};

type Dependency = { fromId: string; toId: string };
type GroupBy = "sprint" | "assignee" | "priority" | "epic" | "status";
type Zoom = "week" | "month" | "quarter";

type DragState =
  | { taskId: string; mode: "move"; startX: number; origStart: Date; origEnd: Date }
  | { taskId: string; mode: "resize"; startX: number; origEnd: Date }
  | null;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toIso(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

function priorityColor(priority: string): string {
  if (priority === "critical" || priority === "high") return "#ff6d6d";
  if (priority === "medium") return "#ffd166";
  return "#66d1a5";
}

function detectCycle(edges: Dependency[]): boolean {
  const graph = new Map<string, string[]>();
  edges.forEach((edge) => {
    const next = graph.get(edge.fromId) || [];
    next.push(edge.toId);
    graph.set(edge.fromId, next);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    const next = graph.get(node) || [];
    for (const child of next) {
      if (dfs(child)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (dfs(node)) return true;
  }
  return false;
}

function TimelineTabPageContent() {
  const searchParams = useSearchParams();
  const requestedSprintId = String(searchParams?.get("sprintId") || "").trim();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [groupBy, setGroupBy] = useState<GroupBy>("sprint");
  const [colorBy, setColorBy] = useState<"priority" | "assignee" | "status">("priority");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [todayAnchor, setTodayAnchor] = useState(new Date());
  const [drag, setDrag] = useState<DragState>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [linkingFromTaskId, setLinkingFromTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const ganttRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const sprintsResp = await fetch("/api/sprints", { cache: "no-store" });
        const sprintsData = await sprintsResp.json().catch(() => null) as { items?: Sprint[] } | null;
        if (!sprintsResp.ok) throw new Error("Failed to load sprints");

        const sprintItems = Array.isArray(sprintsData?.items) ? sprintsData!.items : [];
        const taskLists = await Promise.all(
          sprintItems.map(async (sprint) => {
            const resp = await fetch(`/api/tasks?sprintId=${encodeURIComponent(sprint.id)}`, { cache: "no-store" });
            const data = await resp.json().catch(() => null) as { items?: unknown[] } | null;
            if (!resp.ok) return [] as Task[];
            const items = Array.isArray(data?.items) ? data!.items : [];
            return items.map((item) => {
              const rec = (item || {}) as Record<string, unknown>;
              const dueDate = asString(rec.dueDate) || toIso(addDays(new Date(), 5));
              return {
                id: asString(rec.id),
                title: asString(rec.title),
                status: asString(rec.status) || "todo",
                priority: asString(rec.priority) || "medium",
                storyPoints: Number(rec.storyPoints || 0),
                assignee: (rec.assignee as { id?: string; name?: string } | null) || null,
                dueDate,
                startDate: toIso(addDays(new Date(dueDate), -3)),
                sprintId: sprint.id,
                epic: asString(rec.epicTitle) || "none",
              } as Task;
            });
          })
        );

        if (ignore) return;
        setSprints(sprintItems);
        setTasks(taskLists.flat());
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to load timeline");
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    tasks.forEach((task) => map.set(task.id, task));
    return map;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const bySprint = requestedSprintId
      ? tasks.filter((task) => String(task.sprintId) === requestedSprintId)
      : tasks;
    if (assigneeFilter === "all") return bySprint;
    return bySprint.filter((task) => task.assignee?.id === assigneeFilter);
  }, [assigneeFilter, requestedSprintId, tasks]);

  const allAssignees = useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((task) => {
      if (task.assignee?.id) map.set(task.assignee.id, task.assignee.name || task.assignee.id.slice(0, 6));
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks]);

  const minStartDate = useMemo(() => {
    const starts = filteredTasks.map((task) => toDate(task.startDate)).filter(Boolean) as Date[];
    if (!starts.length) return startOfDay(new Date());
    return startOfDay(new Date(Math.min(...starts.map((d) => d.getTime()))));
  }, [filteredTasks]);

  const windowDays = zoom === "week" ? 14 : zoom === "month" ? 45 : 120;
  const pxPerDay = zoom === "week" ? 30 : zoom === "month" ? 20 : 10;
  const gridWidth = windowDays * pxPerDay;
  const todayOffset = Math.max(0, differenceInCalendarDays(startOfDay(todayAnchor), minStartDate));

  const grouped = useMemo(() => {
    const output = new Map<string, Task[]>();
    const keyOf = (task: Task) => {
      if (groupBy === "assignee") return task.assignee?.name || "Unassigned";
      if (groupBy === "priority") return task.priority || "none";
      if (groupBy === "epic") return task.epic || "none";
      if (groupBy === "status") return task.status || "todo";
      return sprints.find((sprint) => sprint.id === task.sprintId)?.name || "Unknown sprint";
    };

    filteredTasks.forEach((task) => {
      const key = keyOf(task);
      const list = output.get(key) || [];
      list.push(task);
      output.set(key, list);
    });

    return Array.from(output.entries());
  }, [filteredTasks, groupBy, sprints]);

  function colorForTask(task: Task): string {
    if (colorBy === "status") {
      if (task.status === "done") return "#6ed49f";
      if (task.status === "blocked") return "#ff6d6d";
      if (task.status === "in_progress") return "#7fb3ff";
      return "#a9a9a9";
    }
    if (colorBy === "assignee") {
      if (!task.assignee?.id) return "#8a8a8a";
      const code = task.assignee.id.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
      return `hsl(${code % 360}, 55%, 55%)`;
    }
    return priorityColor(task.priority || "medium");
  }

  function startDependency(fromId: string) {
    setLinkingFromTaskId(fromId);
    setToast("Select a second task to link dependency");
  }

  async function addDependency(toId: string) {
    if (!linkingFromTaskId) return;
    const draft = [...dependencies, { fromId: linkingFromTaskId, toId }];
    if (detectCycle(draft)) {
      setToast("Circular dependency detected");
      setLinkingFromTaskId(null);
      return;
    }

    const resp = await fetch("/api/task-dependencies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId: linkingFromTaskId, toId }),
    });

    if (!resp.ok) {
      setToast("Dependency save failed");
      setLinkingFromTaskId(null);
      return;
    }

    setDependencies(draft);
    setLinkingFromTaskId(null);
    setToast("Dependency added");
  }

  function beginDrag(task: Task, mode: "move" | "resize", event: React.MouseEvent) {
    event.preventDefault();
    const start = toDate(task.startDate) || new Date();
    const end = toDate(task.dueDate) || addDays(start, 3);
    if (mode === "move") {
      setDrag({ taskId: task.id, mode, startX: event.clientX, origStart: start, origEnd: end });
      return;
    }
    setDrag({ taskId: task.id, mode, startX: event.clientX, origEnd: end });
  }

  useEffect(() => {
    if (!drag) return;
    const dragState = drag;
    function onMouseMove(event: MouseEvent) {
      const dayDelta = Math.round((event.clientX - dragState.startX) / pxPerDay);
      setTasks((prev) =>
        prev.map((task) => {
          if (task.id !== dragState.taskId) return task;
          if (dragState.mode === "move") {
            return {
              ...task,
              startDate: toIso(addDays(dragState.origStart, dayDelta)),
              dueDate: toIso(addDays(dragState.origEnd, dayDelta)),
            };
          }
          return {
            ...task,
            dueDate: toIso(addDays(dragState.origEnd, dayDelta)),
          };
        })
      );
    }

    async function onMouseUp() {
      const task = taskById.get(dragState.taskId);
      if (!task) {
        setDrag(null);
        return;
      }

      if (dragState.mode === "move") {
        await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate: task.dueDate }),
        });
      } else {
        await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate: task.dueDate }),
        });
      }

      setDrag(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [drag, pxPerDay, taskById]);

  async function shiftSprint(sprint: Sprint, dayDelta: number) {
    const start = toDate(sprint.startDate) || new Date();
    const end = toDate(sprint.endDate) || addDays(start, 14);
    const nextStart = toIso(addDays(start, dayDelta));
    const nextEnd = toIso(addDays(end, dayDelta));

    await fetch(`/api/sprints/${encodeURIComponent(sprint.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: nextStart, endDate: nextEnd }),
    });

    const sprintTasks = tasks.filter((task) => task.sprintId === sprint.id);
    await Promise.all(
      sprintTasks.map((task) => {
        const taskStart = toDate(task.startDate) || new Date();
        const taskEnd = toDate(task.dueDate) || addDays(taskStart, 3);
        return fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate: toIso(addDays(taskEnd, dayDelta)) }),
        });
      })
    );

    setSprints((prev) => prev.map((row) => (row.id === sprint.id ? { ...row, startDate: nextStart, endDate: nextEnd } : row)));
    setTasks((prev) =>
      prev.map((task) => {
        if (task.sprintId !== sprint.id) return task;
        const taskStart = toDate(task.startDate) || new Date();
        const taskEnd = toDate(task.dueDate) || addDays(taskStart, 3);
        return {
          ...task,
          startDate: toIso(addDays(taskStart, dayDelta)),
          dueDate: toIso(addDays(taskEnd, dayDelta)),
        };
      })
    );

    setToast("Sprint shift applied (date updates depend on backend field support)");
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1">
          {(["week", "month", "quarter"] as const).map((value) => (
            <button key={value} onClick={() => setZoom(value)} className={`rounded px-2 py-1 ${zoom === value ? "bg-slate-900 text-white" : "text-slate-600"}`}>
              {value}
            </button>
          ))}
        </div>

        <button onClick={() => setTodayAnchor(new Date())} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700">Today</button>

        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700">
          <option value="all">Assignee</option>
          {allAssignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>

        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700">
          <option value="sprint">Group by Sprint</option>
          <option value="assignee">Group by Assignee</option>
          <option value="priority">Group by Priority</option>
          <option value="epic">Group by Epic</option>
          <option value="status">Group by Status</option>
        </select>

        <select value={colorBy} onChange={(e) => setColorBy(e.target.value as "priority" | "assignee" | "status")} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700">
          <option value="priority">Color by Priority</option>
          <option value="assignee">Color by Assignee</option>
          <option value="status">Color by Status</option>
        </select>
      </div>

      <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-2">
        <div className="rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900">Tasks / Sprints</div>
          <div className="max-h-[65vh] overflow-auto px-2 py-2 text-xs">
            {grouped.map(([group, items]) => (
              <div key={group} className="mb-2 rounded border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between border-b border-slate-200 px-2 py-1.5">
                  <span className="font-semibold text-slate-900">{group}</span>
                  {groupBy === "sprint" ? (
                    <button
                      onClick={() => {
                        const sprint = sprints.find((s) => s.name === group);
                        if (sprint) void shiftSprint(sprint, 1);
                      }}
                      className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
                    >
                      Shift +1d
                    </button>
                  ) : null}
                </div>
                {items.map((task) => (
                  <div key={task.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-slate-700">
                    <button
                      onClick={() => {
                        if (linkingFromTaskId) {
                          void addDependency(task.id);
                        }
                      }}
                      className="truncate text-left"
                    >
                      {task.title}
                    </button>
                    <button onClick={() => startDependency(task.id)} className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-600">Link</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div ref={ganttRef} className="relative overflow-auto rounded-md border border-slate-200 bg-white">
          <div style={{ width: gridWidth }} className="relative min-h-[65vh]">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white">
              <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(${pxPerDay}px, 1fr))` }}>
                {Array.from({ length: windowDays }).map((_, index) => {
                  const date = addDays(minStartDate, index);
                  const monthLabel = format(date, "MMM yyyy");
                  const shouldShowMonth = index === 0 || date.getDate() === 1;
                  return (
                    <div key={`m-${index}`} className="h-5 border-r border-slate-100 px-1 text-[10px] font-semibold text-slate-500">
                      {shouldShowMonth ? monthLabel : ""}
                    </div>
                  );
                })}
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${windowDays}, minmax(${pxPerDay}px, 1fr))` }}>
              {Array.from({ length: windowDays }).map((_, index) => {
                const date = addDays(minStartDate, index);
                return (
                  <div key={index} className="border-r border-slate-100 px-1 py-1 text-[10px] text-slate-500">
                    {format(date, zoom === "quarter" ? "MMM d" : "d MMM")}
                  </div>
                );
              })}
            </div>
            </div>

            <div className="absolute bottom-0 top-0 z-[1] w-px bg-red-500" style={{ left: `${todayOffset * pxPerDay}px` }} />
            <div className="absolute left-0 top-8 z-[2] rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ transform: `translateX(${Math.max(0, todayOffset * pxPerDay - 10)}px)` }}>
              Today
            </div>

            <div className="relative space-y-4 px-2 py-3">
              {grouped.map(([group, items]) => (
                <div key={group} className="space-y-2 rounded-md border border-slate-100 bg-slate-50/30 p-2">
                  {groupBy === "sprint" ? (
                    <SprintBar
                      sprint={sprints.find((sprint) => sprint.name === group) || null}
                      minStartDate={minStartDate}
                      pxPerDay={pxPerDay}
                      onShift={(delta) => {
                        const sprint = sprints.find((s) => s.name === group);
                        if (sprint) void shiftSprint(sprint, delta);
                      }}
                    />
                  ) : null}

                  {items.map((task) => {
                    const start = toDate(task.startDate) || new Date();
                    const end = toDate(task.dueDate) || addDays(start, 2);
                    const left = Math.max(0, differenceInCalendarDays(start, minStartDate) * pxPerDay);
                    const width = Math.max(pxPerDay, (differenceInCalendarDays(end, start) + 1) * pxPerDay);
                    const color = colorForTask(task);
                    return (
                      <div key={task.id} className="relative h-8">
                        <div
                          onMouseDown={(event) => beginDrag(task, "move", event)}
                          className="absolute top-0 flex h-8 items-center rounded-md border border-black/10 px-2 text-[11px] font-medium text-black shadow-sm"
                          style={{ left, width, background: color }}
                          title={`${task.title} • ${task.assignee?.name || "Unassigned"} • ${task.startDate} → ${task.dueDate} • ${task.status} • ${task.storyPoints || 0}pt`}
                        >
                          <span className="truncate">{task.title}</span>
                          <button
                            onMouseDown={(event) => beginDrag(task, "resize", event)}
                            className="ml-auto h-full w-2 cursor-ew-resize rounded bg-black/20"
                            title="Resize"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <svg className="pointer-events-none absolute left-0 top-0 h-full w-full">
              {dependencies.map((edge, index) => {
                const from = taskById.get(edge.fromId);
                const to = taskById.get(edge.toId);
                if (!from || !to) return null;
                const fromStart = toDate(from.startDate) || new Date();
                const fromEnd = toDate(from.dueDate) || addDays(fromStart, 2);
                const toStart = toDate(to.startDate) || new Date();
                const x1 = Math.max(0, differenceInCalendarDays(fromEnd, minStartDate) * pxPerDay + pxPerDay);
                const x2 = Math.max(0, differenceInCalendarDays(toStart, minStartDate) * pxPerDay);
                const y1 = 90 + index * 14;
                const y2 = 110 + index * 14;
                return <line key={`${edge.fromId}-${edge.toId}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#cfcfcf" strokeWidth="1.2" />;
              })}
            </svg>
          </div>
        </div>
      </div>

      {toast ? <div className="fixed bottom-4 right-4 z-20 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow">{toast}</div> : null}
    </div>
  );
}

export default function TimelineTabPage() {
  return (
    <Suspense fallback={<div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">Loading timeline...</div>}>
      <TimelineTabPageContent />
    </Suspense>
  );
}

function SprintBar({
  sprint,
  minStartDate,
  pxPerDay,
  onShift,
}: {
  sprint: Sprint | null;
  minStartDate: Date;
  pxPerDay: number;
  onShift: (delta: number) => void;
}) {
  if (!sprint) return null;
  const start = toDate(sprint.startDate) || new Date();
  const end = toDate(sprint.endDate) || addDays(start, 14);
  const left = Math.max(0, differenceInCalendarDays(start, minStartDate) * pxPerDay);
  const width = Math.max(pxPerDay * 2, (differenceInCalendarDays(end, start) + 1) * pxPerDay);
  return (
    <div className="relative h-7">
      <div className="absolute top-0 flex h-7 items-center rounded bg-blue-600 px-2 text-[11px] text-white" style={{ left, width }}>
        <span className="truncate">{sprint.name}</span>
        <button onClick={() => onShift(-1)} className="ml-2 rounded border border-white/40 px-1 text-[10px]">-1d</button>
        <button onClick={() => onShift(1)} className="ml-1 rounded border border-white/40 px-1 text-[10px]">+1d</button>
      </div>
    </div>
  );
}
