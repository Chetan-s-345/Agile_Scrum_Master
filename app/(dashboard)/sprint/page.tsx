"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

type Sprint = {
  id: string;
  projectId?: string;
  name: string;
  status: string;
  startDate?: string;
  endDate?: string;
  plannedPoints?: number;
  completedPoints?: number;
};

type SprintsResp = { items?: Sprint[]; error?: string };

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

export default function SprintListPage() {
  const [status, setStatus] = useState<string>("");
  const [items, setItems] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tabs = useMemo(
    () => [
      { key: "", label: "All" },
      { key: "planning", label: "Planning" },
      { key: "active", label: "Active" },
      { key: "completed", label: "Completed" },
    ],
    []
  );

  async function load() {
    setLoading(true);
    setError(null);

    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const resp = await fetchJson<SprintsResp>(`/api/sprints${qs}`);

    if (!resp.ok) {
      setItems([]);
      setLoading(false);
      setError(resp.data?.error ? String(resp.data.error) : `Failed to load sprints (${resp.status})`);
      return;
    }

    setItems(Array.isArray(resp.data?.items) ? resp.data.items! : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Sprints</h1>
            <p className="text-slate-600 dark:text-slate-300">View planning, active, and completed sprints.</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={
                "rounded-full px-4 py-2 text-sm font-semibold border transition " +
                (status === t.key
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-black dark:border-white"
                  : "bg-white dark:bg-zinc-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="text-slate-600 dark:text-slate-300">Loading…</div>
        ) : items.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((s) => (
              <Link
                key={s.id}
                href={`/sprint/${encodeURIComponent(s.id)}`}
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-lg font-bold text-slate-900 dark:text-white">{s.name}</div>
                  <span className="rounded-full px-3 py-1 text-xs font-semibold bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-slate-200">
                    {s.status}
                  </span>
                </div>
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  {s.startDate || s.endDate ? (
                    <span>
                      {s.startDate || ""} {s.endDate ? `→ ${s.endDate}` : ""}
                    </span>
                  ) : (
                    <span>No dates</span>
                  )}
                </div>
                <div className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                  Planned: <span className="font-semibold">{s.plannedPoints ?? 0}</span> · Completed:{" "}
                  <span className="font-semibold">{s.completedPoints ?? 0}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-slate-600 dark:text-slate-300">
            No sprints found.
          </div>
        )}
      </div>
    </div>
  );
}
