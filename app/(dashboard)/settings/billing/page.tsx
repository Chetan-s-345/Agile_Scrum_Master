"use client";

import { useEffect, useState } from "react";

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

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const resp = await fetchJson<unknown>("/api/org/billing");
      if (!resp.ok) {
        setError(extractError(resp.data) || `Failed to load billing (${resp.status})`);
        setBilling(null);
        setLoading(false);
        return;
      }
      setBilling(resp.data && typeof resp.data === "object" ? (resp.data as Record<string, unknown>) : null);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Billing</h1>
        <p className="text-slate-600 dark:text-slate-300">Current plan and subscription status.</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Billing (raw)</div>
            <pre className="mt-3 max-h-[520px] overflow-auto rounded-md bg-slate-50 dark:bg-black/40 p-3 text-xs text-slate-800 dark:text-slate-200">
              {JSON.stringify(billing, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
