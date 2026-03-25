"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Sprint = { id: string; name: string; goal?: string; startDate?: string; endDate?: string };
type BoardTask = { id: string; title: string; status?: string };
type Board = { todo: BoardTask[]; in_progress: BoardTask[]; in_review: BoardTask[]; blocked: BoardTask[]; done: BoardTask[] };
type Developer = { id: string; fullName?: string; name?: string; avatarUrl?: string };

function stat(label: string, value: number) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
      <p className="text-xs text-[#9f9f9f]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

export default function SummaryTabPage() {
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [board, setBoard] = useState<Board>({ todo: [], in_progress: [], in_review: [], blocked: [], done: [] });
  const [activity, setActivity] = useState<BoardTask[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const sprintsResp = await fetch("/api/sprints?status=active", { cache: "no-store" });
        const sprintsData = await sprintsResp.json().catch(() => null);
        const sprint = Array.isArray(sprintsData?.items) ? (sprintsData.items[0] as Sprint | undefined) : undefined;
        if (cancelled) return;
        setActiveSprint(sprint || null);

        if (sprint?.id) {
          const [boardResp, tasksResp] = await Promise.all([
            fetch(`/api/tasks/board/${encodeURIComponent(sprint.id)}`, { cache: "no-store" }),
            fetch(`/api/tasks?sprintId=${encodeURIComponent(sprint.id)}`, { cache: "no-store" }),
          ]);
          const boardData = await boardResp.json().catch(() => null);
          const tasksData = await tasksResp.json().catch(() => null);
          if (cancelled) return;
          setBoard({
            todo: Array.isArray(boardData?.todo) ? boardData.todo : [],
            in_progress: Array.isArray(boardData?.in_progress) ? boardData.in_progress : [],
            in_review: Array.isArray(boardData?.in_review) ? boardData.in_review : [],
            blocked: Array.isArray(boardData?.blocked) ? boardData.blocked : [],
            done: Array.isArray(boardData?.done) ? boardData.done : [],
          });
          setActivity(Array.isArray(tasksData?.items) ? (tasksData.items as BoardTask[]).slice(0, 10) : []);
        }

        const devResp = await fetch("/api/developers", { cache: "no-store" });
        const devData = await devResp.json().catch(() => null);
        if (cancelled) return;
        setDevelopers(Array.isArray(devData?.items) ? (devData.items as Developer[]) : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load summary");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    const total = board.todo.length + board.in_progress.length + board.in_review.length + board.blocked.length + board.done.length;
    return { total, completed: board.done.length, inProgress: board.in_progress.length, blocked: board.blocked.length };
  }, [board]);

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-[#5a1f1f] bg-[#2a1616] px-3 py-2 text-sm text-[#f3b6b6]">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {stat("Total Tasks", totals.total)}
        {stat("Completed", totals.completed)}
        {stat("In Progress", totals.inProgress)}
        {stat("Blocked", totals.blocked)}
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
        <h2 className="text-lg font-semibold">Active Sprint</h2>
        {activeSprint ? (
          <p className="mt-2 text-sm text-[#b0b0b0]">
            {activeSprint.name} {activeSprint.goal ? `• ${activeSprint.goal}` : ""} • {activeSprint.startDate || "-"} to {activeSprint.endDate || "-"}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[#8f8f8f]">No active sprint.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
          <div className="mt-3 space-y-2">
            {activity.length ? activity.map((task) => (
              <Link key={task.id} href={`/tasks/${encodeURIComponent(task.id)}`} className="block rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">
                {task.title}
              </Link>
            )) : <p className="text-sm text-[#8f8f8f]">No recent updates.</p>}
          </div>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
          <h2 className="text-lg font-semibold">Team</h2>
          <div className="mt-3 space-y-2">
            {developers.length ? developers.slice(0, 10).map((dev) => (
              <Link key={dev.id} href={`/developers/${encodeURIComponent(dev.id)}`} className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card)]">
                <span>{dev.fullName || dev.name || "Developer"}</span>
                <span className="text-[#8f8f8f]">View</span>
              </Link>
            )) : <p className="text-sm text-[#8f8f8f]">No team members found.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
