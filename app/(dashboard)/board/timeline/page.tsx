"use client";

import { useEffect, useMemo, useState } from "react";

type Sprint = { id: string; name: string; startDate?: string; endDate?: string; status?: string };
type Task = { id: string; title: string; dueDate?: string };
type Board = { todo: Task[]; in_progress: Task[]; in_review: Task[]; blocked: Task[]; done: Task[] };

function daysBetween(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

function toDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function TimelineTabPage() {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [zoom, setZoom] = useState<"week" | "month" | "quarter">("month");
  const [expandedSprintId, setExpandedSprintId] = useState("");
  const [tasksBySprint, setTasksBySprint] = useState<Record<string, Task[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch("/api/sprints", { cache: "no-store" });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error(String(data?.error || "Failed to load timeline"));
        const items = Array.isArray(data?.items) ? (data.items as Sprint[]) : [];
        if (cancelled) return;
        setSprints(items);
        if (items[0]?.id) setExpandedSprintId(String(items[0].id));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load timeline");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!expandedSprintId || tasksBySprint[expandedSprintId]) return;
    async function loadBoardForSprint() {
      const resp = await fetch(`/api/tasks/board/${encodeURIComponent(expandedSprintId)}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null) as Board | null;
      const all = [
        ...(Array.isArray(data?.todo) ? data!.todo : []),
        ...(Array.isArray(data?.in_progress) ? data!.in_progress : []),
        ...(Array.isArray(data?.in_review) ? data!.in_review : []),
        ...(Array.isArray(data?.blocked) ? data!.blocked : []),
        ...(Array.isArray(data?.done) ? data!.done : []),
      ] as Task[];
      setTasksBySprint((prev) => ({ ...prev, [expandedSprintId]: all }));
    }
    void loadBoardForSprint();
  }, [expandedSprintId, tasksBySprint]);

  const windowDays = zoom === "week" ? 14 : zoom === "month" ? 40 : 120;

  const minDate = useMemo(() => {
    const values = sprints.map((s) => toDate(s.startDate)).filter(Boolean) as Date[];
    return values.length ? new Date(Math.min(...values.map((d) => d.getTime()))) : new Date();
  }, [sprints]);

  const todayOffset = useMemo(() => daysBetween(minDate, new Date()), [minDate]);

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-[#5a1f1f] bg-[#2a1616] px-3 py-2 text-sm text-[#f3b6b6]">{error}</div> : null}

      <div className="flex gap-2">
        {(["week", "month", "quarter"] as const).map((level) => (
          <button key={level} onClick={() => setZoom(level)} className={`rounded border px-3 py-1 text-xs ${zoom === level ? "border-white bg-white text-black" : "border-[#2a2a2a]"}`}>
            {level}
          </button>
        ))}
      </div>

      <div className="relative overflow-x-auto rounded-md border border-[#2a2a2a] bg-[#121212] p-3">
        <div className="relative" style={{ width: `${windowDays * 14}px` }}>
          <div className="absolute top-0 bottom-0 w-px bg-red-500" style={{ left: `${todayOffset * 14}px` }} />
          <div className="space-y-3">
            {sprints.map((sprint) => {
              const start = toDate(sprint.startDate) || minDate;
              const end = toDate(sprint.endDate) || new Date(start.getTime() + 86400000 * 14);
              const left = daysBetween(minDate, start) * 14;
              const width = daysBetween(start, end) * 14;
              const expanded = expandedSprintId === sprint.id;
              const tasks = tasksBySprint[sprint.id] || [];

              return (
                <div key={sprint.id} className="space-y-2">
                  <button onClick={() => setExpandedSprintId(expanded ? "" : sprint.id)} className="w-full text-left">
                    <div className="relative h-10 rounded border border-[#2a2a2a] bg-[#171717]">
                      <div className="absolute top-1 h-8 rounded bg-[#2d5fde] px-2 text-xs leading-8 text-white" style={{ left: `${left}px`, width: `${Math.max(width, 60)}px` }}>
                        {sprint.name}
                      </div>
                    </div>
                  </button>

                  {expanded ? (
                    <div className="space-y-1 pl-2">
                      {tasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between rounded border border-[#2a2a2a] bg-[#101010] px-2 py-1 text-xs">
                          <span>{task.title}</span>
                          <span className="text-[#8f8f8f]">{task.dueDate || "no due date"}</span>
                        </div>
                      ))}
                      {!tasks.length ? <p className="text-xs text-[#8f8f8f]">No tasks in this sprint.</p> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
