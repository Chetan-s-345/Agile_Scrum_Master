"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Developer = Record<string, unknown>;

type DeveloperResp = { developer?: Developer; error?: string } | (Developer & { error?: never });

function normalizeDeveloper(data: DeveloperResp | null): Developer | null {
  if (!data) return null;
  if (typeof data === "object" && data && "developer" in data) {
    const maybe = (data as { developer?: Developer }).developer;
    return maybe ?? null;
  }
  return data;
}

function extractError(data: DeveloperResp | null): string | null {
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

export default function DeveloperProfilePage() {
  const params = useParams<{ developerId: string }>();
  const developerId = params?.developerId;
  const hasId = useMemo(() => typeof developerId === "string" && developerId.length > 0, [developerId]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [developer, setDeveloper] = useState<Developer | null>(null);

  useEffect(() => {
    if (!hasId) return;
    (async () => {
      setLoading(true);
      setError(null);
      const resp = await fetchJson<DeveloperResp>(`/api/developers/${encodeURIComponent(developerId)}`);
      if (!resp.ok) {
        setDeveloper(null);
        setError(extractError(resp.data) || `Failed to load developer (${resp.status})`);
        setLoading(false);
        return;
      }
      setDeveloper(normalizeDeveloper(resp.data));
      setLoading(false);
    })();
  }, [hasId, developerId]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Developer Profile</h1>
        <p className="text-slate-600 dark:text-slate-300">ID: {developerId}</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Raw data</div>
            <pre className="mt-3 max-h-[520px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
              {JSON.stringify(developer, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
