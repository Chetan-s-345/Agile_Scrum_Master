"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WebhookDLQPanel } from "@/components/WebhookDLQPanel";
import { JiraSyncLogPanel } from "@/components/jira-sync-log-panel";

type ServiceHealth = {
  id: string;
  service: string;
  status: "Healthy" | "Degraded" | "Down" | string;
  latencyMs: number;
  lastCheckedAt: string;
};

type ErrorLog = {
  id: string;
  timestamp: string;
  service: string;
  message: string;
  severity: string;
  status: "resolved" | "open" | string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fmtDateTime(value: string): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

function statusTone(status: string): string {
  const value = status.toLowerCase();
  if (value === "healthy") return "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-200";
  if (value === "degraded") return "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-200";
  return "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200";
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(asText(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

export default function MonitoringPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);

  const totalOpen = useMemo(() => errorLogs.filter((log) => asText(log.status).toLowerCase() === "open").length, [errorLogs]);

  async function load() {
    setError(null);
    setRefreshing(true);
    try {
      const [healthData, logData] = await Promise.all([
        invokeDesktop<ServiceHealth[]>("monitoring:getHealthStatus"),
        invokeDesktop<ErrorLog[]>("monitoring:getErrorLogs", { limit: 100 }),
      ]);

      setServiceHealth(Array.isArray(healthData) ? healthData : []);
      setErrorLogs(Array.isArray(logData) ? logData : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monitoring data");
      setServiceHealth([]);
      setErrorLogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Monitoring</h1>
            <p className="text-slate-600 dark:text-slate-300">System/process health, logs, and integration diagnostics.</p>
          </div>
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" /> {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="text-slate-600 dark:text-slate-300">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {serviceHealth.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{item.service}</div>
                  <div className={`mt-2 inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusTone(item.status)}`}>
                    {item.status}
                  </div>
                  <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">{Math.max(0, Number(item.latencyMs || 0))} ms</div>
                  <div className="mt-1 text-xs text-slate-500">Checked {fmtDateTime(item.lastCheckedAt)}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Error logs</div>
                <div className="text-xs text-slate-500">Open: {totalOpen}</div>
              </div>

              <div className="mt-3 overflow-auto rounded-lg border border-slate-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-black/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Timestamp</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Service</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Message</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Severity</th>
                      <th className="text-left px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorLogs.map((log) => (
                      <tr key={log.id} className="border-t border-slate-200 dark:border-zinc-800">
                        <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">{fmtDateTime(log.timestamp)}</td>
                        <td className="px-3 py-3 text-slate-900 dark:text-white font-semibold">{log.service}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{log.message}</td>
                        <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{log.severity}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!errorLogs.length ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-600 dark:text-slate-300">
                          No error logs found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4">
          <WebhookDLQPanel />
          <JiraSyncLogPanel />
        </div>
      </div>
    </div>
  );
}
