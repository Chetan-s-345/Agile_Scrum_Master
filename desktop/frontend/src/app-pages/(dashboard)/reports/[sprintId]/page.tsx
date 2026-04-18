"use client";

import { useParams } from "@/next-shims/navigation";
import { useEffect, useMemo, useState } from "react";

type AnyJson = Record<string, unknown>;

type Sprint = { id: string; name?: string; status?: string } & Record<string, unknown>;
type SprintGetResp = { sprint?: Sprint; error?: string } | (Sprint & { error?: never });

function normalizeSprint(data: SprintGetResp | null): AnyJson | null {
  if (!data) return null;
  if (typeof data === "object" && data && "sprint" in data) {
    const maybe = (data as { sprint?: AnyJson }).sprint;
    return maybe ?? null;
  }
  return data;
}

function extractError(data: SprintGetResp | null): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

export default function SprintReportPage() {
  const params = useParams<{ sprintId: string }>();
  const sprintId = params?.sprintId;
  const hasId = useMemo(() => typeof sprintId === "string" && sprintId.length > 0, [sprintId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sprint, setSprint] = useState<AnyJson | null>(null);
  const [burndown, setBurndown] = useState<AnyJson | null>(null);
  const [risk, setRisk] = useState<AnyJson | null>(null);

  useEffect(() => {
    if (!hasId) return;
    (async () => {
      setLoading(true);
      setError(null);

      const [sResp, bResp, rResp] = await Promise.all([
        fetchJson<SprintGetResp>(`/api/sprints/${encodeURIComponent(sprintId)}`),
        fetchJson<unknown>(`/api/sprints/${encodeURIComponent(sprintId)}/burndown`),
        fetchJson<unknown>(`/api/sprints/${encodeURIComponent(sprintId)}/risk`),
      ]);

      if (!sResp.ok) {
        setError(extractError(sResp.data) || `Failed to load sprint (${sResp.status})`);
        setSprint(null);
        setBurndown(null);
        setRisk(null);
        setLoading(false);
        return;
      }

      setSprint(normalizeSprint(sResp.data));
      setBurndown(bResp.ok && typeof bResp.data === "object" ? (bResp.data as AnyJson) : null);
      setRisk(rResp.ok && typeof rResp.data === "object" ? (rResp.data as AnyJson) : null);
      setLoading(false);
    })();
  }, [hasId, sprintId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Sprint Report</h1>
        <p className="text-slate-600 dark:text-slate-300">Sprint ID: {sprintId}</p>

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
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Sprint (raw)</div>
              <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
                {JSON.stringify(sprint, null, 2)}
              </pre>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Burndown (raw)</div>
              <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
                {JSON.stringify(burndown, null, 2)}
              </pre>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Risk (raw)</div>
              <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
                {JSON.stringify(risk, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
