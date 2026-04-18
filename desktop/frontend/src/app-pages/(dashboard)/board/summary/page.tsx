"use client";

import Link from "@/next-shims/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "@/next-shims/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type SprintSummary = {
  sprintId: string;
  sprintName: string;
  sprintGoal: string;
  totalTasks: number;
  completedPct: number;
  blockersCount: number;
  daysRemaining: number;
};

type Burndown = {
  dates: string[];
  ideal: number[];
  actual: number[];
};

type VelocityEntry = {
  sprintId: string;
  sprintName: string;
  committedPoints: number;
  completedPoints: number;
};

type Contributor = {
  developerId: string;
  developer: string;
  tasksCompleted: number;
  storyPointsDelivered: number;
};

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function asString(value: unknown, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stat(label: string, value: number) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
      <p className="text-xs text-[#9f9f9f]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function SummaryTabPageContent() {
  const searchParams = useSearchParams();
  const requestedSprintId = asString(searchParams?.get("sprintId") || "");

  const [sprintSummary, setSprintSummary] = useState<SprintSummary | null>(null);
  const [velocity, setVelocity] = useState<VelocityEntry[]>([]);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [burndown, setBurndown] = useState<Burndown>({ dates: [], ideal: [], actual: [] });

  const [sprints, setSprints] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedSprintId, setSelectedSprintId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const burndownData = useMemo(() => {
    const size = Math.min(burndown.dates.length, burndown.ideal.length, burndown.actual.length);
    return Array.from({ length: size }, (_, idx) => ({
      date: burndown.dates[idx],
      ideal: asNumber(burndown.ideal[idx]),
      actual: asNumber(burndown.actual[idx]),
    }));
  }, [burndown]);

  const velocityData = useMemo(() => {
    return velocity.map((entry) => ({
      sprint: entry.sprintName,
      committed: asNumber(entry.committedPoints),
      delivered: asNumber(entry.completedPoints),
    }));
  }, [velocity]);

  useEffect(() => {
    let disposed = false;

    async function loadInitial() {
      setLoading(true);
      setError(null);
      try {
        const velocityRows = await invokeDesktop<VelocityEntry[]>("sprint:getVelocityHistory", { count: 5 });
        if (disposed) return;

        const normalizedVelocity = Array.isArray(velocityRows) ? velocityRows : [];
        setVelocity(normalizedVelocity);

        const sprintRows = normalizedVelocity.map((entry) => ({ id: asString(entry.sprintId), name: asString(entry.sprintName, asString(entry.sprintId)) }));
        setSprints(sprintRows);

        const nextSprintId = requestedSprintId || sprintRows[0]?.id || "sprint-1";
        setSelectedSprintId(nextSprintId);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "Failed to load sprint summary");
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void loadInitial();
    return () => {
      disposed = true;
    };
  }, [requestedSprintId]);

  useEffect(() => {
    let disposed = false;

    async function loadSprintData() {
      if (!selectedSprintId) return;
      try {
        setError(null);
        const [summaryResp, burndownResp, contributorsResp] = await Promise.all([
          invokeDesktop<SprintSummary>("sprint:getSummary", { sprintId: selectedSprintId }),
          invokeDesktop<Burndown>("sprint:getBurndown", { sprintId: selectedSprintId }),
          invokeDesktop<Contributor[]>("sprint:getContributors", { sprintId: selectedSprintId }),
        ]);
        if (disposed) return;

        setSprintSummary(summaryResp || null);
        setBurndown({
          dates: Array.isArray(burndownResp?.dates) ? burndownResp.dates : [],
          ideal: Array.isArray(burndownResp?.ideal) ? burndownResp.ideal : [],
          actual: Array.isArray(burndownResp?.actual) ? burndownResp.actual : [],
        });
        setContributors(Array.isArray(contributorsResp) ? contributorsResp : []);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "Failed to load sprint summary");
      }
    }

    void loadSprintData();
    return () => {
      disposed = true;
    };
  }, [selectedSprintId]);

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-md border border-[#5a1f1f] bg-[#2a1616] px-3 py-2 text-sm text-[#f3b6b6]">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {stat("Total Tasks", asNumber(sprintSummary?.totalTasks))}
        {stat("Completed %", asNumber(sprintSummary?.completedPct))}
        {stat("Blockers", asNumber(sprintSummary?.blockersCount))}
        {stat("Days Remaining", asNumber(sprintSummary?.daysRemaining))}
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Sprint Summary</h2>
          <div className="flex items-center gap-2">
            <select
              value={selectedSprintId}
              onChange={(e) => setSelectedSprintId(e.target.value)}
              className="h-8 min-w-[220px] rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-xs"
            >
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
              ))}
            </select>
            <Link href={`/reports/${encodeURIComponent(selectedSprintId || "")}`} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg-card)]">Generate Report</Link>
          </div>
        </div>
        {sprintSummary ? (
          <p className="mt-2 text-sm text-[#b0b0b0]">
            {sprintSummary.sprintName} {sprintSummary.sprintGoal ? `• ${sprintSummary.sprintGoal}` : ""}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[#8f8f8f]">{loading ? "Loading sprint..." : "No active sprint."}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
          <h2 className="text-lg font-semibold">Burndown</h2>
          <div className="mt-3 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={burndownData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" />
                <XAxis dataKey="date" stroke="#9f9f9f" tick={{ fill: "#9f9f9f", fontSize: 11 }} />
                <YAxis stroke="#9f9f9f" tick={{ fill: "#9f9f9f", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", color: "#ddd" }} />
                <Legend />
                <Line type="monotone" dataKey="ideal" stroke="#8f8f8f" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="actual" stroke="#57a7ff" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
          <h2 className="text-lg font-semibold">Velocity (Last 5 Sprints)</h2>
          <div className="mt-3 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocityData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b2b2b" />
                <XAxis dataKey="sprint" stroke="#9f9f9f" tick={{ fill: "#9f9f9f", fontSize: 11 }} />
                <YAxis stroke="#9f9f9f" tick={{ fill: "#9f9f9f", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", color: "#ddd" }} />
                <Legend />
                <Bar dataKey="committed" fill="#5a5a5a" />
                <Bar dataKey="delivered" fill="#3f82d9" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-[var(--border)] bg-[#141414] p-4">
        <h2 className="text-lg font-semibold">Top Contributors</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[#9f9f9f]">
                <th className="border-b border-[#262626] px-2 py-2 font-medium">Developer</th>
                <th className="border-b border-[#262626] px-2 py-2 font-medium">Tasks Completed</th>
                <th className="border-b border-[#262626] px-2 py-2 font-medium">Story Points Delivered</th>
              </tr>
            </thead>
            <tbody>
              {contributors.length ? contributors.map((entry) => (
                <tr key={entry.developerId}>
                  <td className="border-b border-[#1f1f1f] px-2 py-2 text-white">{entry.developer}</td>
                  <td className="border-b border-[#1f1f1f] px-2 py-2 text-[#d0d0d0]">{asNumber(entry.tasksCompleted)}</td>
                  <td className="border-b border-[#1f1f1f] px-2 py-2 text-[#d0d0d0]">{asNumber(entry.storyPointsDelivered)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={3} className="px-2 py-3 text-[#8f8f8f]">No contributor data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function SummaryTabPage() {
  return (
    <Suspense fallback={<div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">Loading summary...</div>}>
      <SummaryTabPageContent />
    </Suspense>
  );
}

