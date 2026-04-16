"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

type SyncLogItem = {
  id: string;
  timestamp: string;
  action: string | null;
  taskId: string | null;
  jiraIssueKey: string | null;
  status: "success" | "failed";
  errorMessage: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
};

type SyncLogsResponse = {
  items: SyncLogItem[];
};

function toIsoDateInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTs(value: string) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return value;
  return new Date(t).toLocaleString();
}

function safeJsonStringify(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
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

export function JiraSyncLogPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SyncLogItem[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [filterAction, setFilterAction] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>(() => toIsoDateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [toDate, setToDate] = useState<string>(() => toIsoDateInputValue(new Date()));

  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) if (it.action) set.add(it.action);
    return Array.from(set).sort();
  }, [items]);

  const isLive = Boolean(lastRefreshedAt && nowMs - lastRefreshedAt < 35_000);

  async function load() {
    setLoading(true);
    setRefreshing(true);
    setError(null);

    const qs = new URLSearchParams();
    qs.set("limit", "20");
    if (filterStatus) qs.set("status", filterStatus);
    if (filterAction) qs.set("action", filterAction);

    if (fromDate) qs.set("from", `${fromDate} 00:00:00`);
    if (toDate) qs.set("to", `${toDate} 23:59:59`);

    const resp = await fetchJson<SyncLogsResponse>(`/api/integrations/jira/sync-logs?${qs.toString()}`);

    setLoading(false);
    setRefreshing(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Failed to load sync logs (${resp.status})`);
      return;
    }

    setItems(resp.data?.items || []);
    setLastRefreshedAt(Date.now());
  }

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // Refresh immediately when filters change, then keep auto-refreshing.
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAction, filterStatus, fromDate, toDate]);

  async function retryFailedBulk() {
    setError(null);
    const failedTaskIds = Array.from(
      new Set(items.filter((i) => i.status === "failed" && i.taskId).map((i) => String(i.taskId)))
    );

    const resp = await fetchJson<unknown>(`/api/integrations/jira/retry-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds: failedTaskIds }),
    });

    if (!resp.ok) {
      setError(extractError(resp.data) || `Retry failed (${resp.status})`);
      return;
    }

    await load();
  }

  function exportCsv() {
    const rows = items.map((i) => {
      const cols = [
        i.timestamp,
        i.action || "",
        i.taskId || "",
        i.jiraIssueKey || "",
        i.status,
        i.errorMessage || "",
      ];
      return cols
        .map((c) => {
          const s = String(c ?? "");
          const escaped = s.replaceAll('"', '""');
          return `"${escaped}"`;
        })
        .join(",");
    });

    const header = ["Timestamp", "Action", "Task ID", "Jira Issue Key", "Status", "Error Message"]
      .map((h) => `"${h}"`)
      .join(",");

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `jira-sync-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold text-slate-900 dark:text-white">Sync Log Details</div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Last 20 outbound Jira sync actions.
            <span className="ml-2 inline-flex items-center gap-2">
              <span
                className={
                  "inline-block h-2 w-2 rounded-full " +
                  (isLive ? "bg-emerald-500 animate-pulse" : "bg-slate-400 dark:bg-slate-600")
                }
              />
              <span className="text-slate-600 dark:text-slate-400">{isLive ? "live" : "idle"}</span>
              {lastRefreshedAt ? (
                <span className="text-slate-500 dark:text-slate-500">· {formatTs(new Date(lastRefreshedAt).toISOString())}</span>
              ) : null}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-zinc-900"
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-md border border-slate-200 dark:border-zinc-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-zinc-900"
            disabled={!items.length}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void retryFailedBulk()}
            className="rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            disabled={items.filter((i) => i.status === "failed" && i.taskId).length === 0}
          >
            Retry Failed
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Action</label>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="">All</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Status</label>
          <select
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">From</label>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">To</label>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-zinc-900/70">
            <tr className="text-slate-700 dark:text-slate-300">
              <th className="px-3 py-2 font-semibold">Timestamp</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Task ID</th>
              <th className="px-3 py-2 font-semibold">Jira Issue Key</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Error Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-zinc-900">
            {items.map((it) => {
              const isExpanded = expandedId === it.id;
              const rowColor = it.status === "success" ? "bg-emerald-950/10" : "bg-red-950/15";
              const hover = "hover:bg-slate-50 dark:hover:bg-zinc-900";
              return (
                <Fragment key={it.id}>
                  <tr
                    className={`${rowColor} ${hover} cursor-pointer`}
                    onClick={() => setExpandedId((prev) => (prev === it.id ? null : it.id))}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-slate-900 dark:text-slate-100">{formatTs(it.timestamp)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-800 dark:text-slate-200">{it.action || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">{it.taskId || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">{it.jiraIssueKey || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 font-semibold " +
                          (it.status === "success"
                            ? "bg-emerald-600/20 text-emerald-200"
                            : "bg-red-600/20 text-red-200")
                        }
                      >
                        {it.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[420px] truncate">{it.errorMessage || ""}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="bg-white dark:bg-zinc-950">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50 p-3">
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Request payload</div>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-900 dark:text-slate-100">
                              {safeJsonStringify(it.requestPayload)}
                            </pre>
                          </div>
                          <div className="rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50 p-3">
                            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Jira API response</div>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-900 dark:text-slate-100">
                              {safeJsonStringify(it.responsePayload)}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}

            {!items.length && !loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-600 dark:text-slate-400">
                  No sync logs found.
                </td>
              </tr>
            ) : null}

            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-600 dark:text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
