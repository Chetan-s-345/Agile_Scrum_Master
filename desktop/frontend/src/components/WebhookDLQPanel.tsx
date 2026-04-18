"use client";

import { useEffect, useMemo, useState } from "react";

type DlqItem = {
  id: string;
  source: string;
  event_type: string;
  payload: unknown;
  processed: boolean;
  processed_at: string | null;
  processing_error: string | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  dlq: boolean;
  created_at: string;
};

type DlqResponse = {
  total: number;
  items: DlqItem[];
};

function fmt(v: string | null | undefined): string {
  if (!v) return "-";
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return String(v);
  return new Date(t).toLocaleString();
}

function payloadPreview(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    if (!s) return "{}";
    return s.length > 220 ? `${s.slice(0, 220)}...` : s;
  } catch {
    return "{payload}";
  }
}

function payloadPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function extractError(data: unknown): string {
  if (!data || typeof data !== "object") return "Request failed";
  const rec = data as Record<string, unknown>;
  if ("message" in rec && typeof rec.message === "string" && rec.message) {
    return rec.message;
  }
  const err = typeof rec.error === "string" ? rec.error : "Request failed";
  const detail = typeof rec.detail === "string" ? rec.detail : "";
  return detail ? `${err}: ${detail}` : err;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(extractError(wrapped.error));
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

export function WebhookDLQPanel() {
  const [items, setItems] = useState<DlqItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [sourceFilter, setSourceFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const uniqueEventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) set.add(String(i.event_type || ""));
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [items]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const data = await invokeDesktop<DlqItem[]>("monitoring:getWebhookDLQ");
      const allItems = Array.isArray(data) ? data : [];

      const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
      const toTs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;

      const filtered = allItems.filter((item) => {
        if (sourceFilter && String(item.source || "") !== sourceFilter) return false;
        if (eventTypeFilter && String(item.event_type || "") !== eventTypeFilter) return false;

        const createdTs = new Date(String(item.created_at || "")).getTime();
        if (fromTs !== null && Number.isFinite(createdTs) && createdTs < fromTs) return false;
        if (toTs !== null && Number.isFinite(createdTs) && createdTs > toTs) return false;
        return true;
      });

      setItems(filtered);
      setTotal(filtered.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load webhook DLQ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, eventTypeFilter, fromDate, toDate]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, eventTypeFilter, fromDate, toDate]);

  async function retryOne(eventId: string) {
    setRetryingId(eventId);
    setError(null);

    try {
      await invokeDesktop<{ success: boolean }>("webhooks:retryDelivery", { deliveryId: eventId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingId(null);
    }
  }

  async function retryAll() {
    setRetryingAll(true);
    setError(null);

    try {
      await Promise.all(
        items.map((item) => invokeDesktop<{ success: boolean }>("webhooks:retryDelivery", { deliveryId: item.id }))
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry all failed");
    } finally {
      setRetryingAll(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Webhook Dead Letter Queue</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">Failed webhook events that hit max retries.</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-200">
            DLQ: {total}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void retryAll()}
            className="rounded-md bg-red-600 hover:bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            disabled={retryingAll || !items.length}
          >
            {retryingAll ? "Retrying..." : "Retry All"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-2">
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
        >
          <option value="">All sources</option>
          <option value="jira">jira</option>
          <option value="github">github</option>
        </select>

        <select
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
        >
          <option value="">All event types</option>
          {uniqueEventTypes.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
        />

        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
        />
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-zinc-800">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 dark:bg-zinc-950/50 text-slate-600 dark:text-slate-300">
            <tr>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Event Type</th>
              <th className="text-left px-3 py-2">Error</th>
              <th className="text-left px-3 py-2">Retry</th>
              <th className="text-left px-3 py-2">Last Attempt</th>
              <th className="text-left px-3 py-2">Payload Preview</th>
              <th className="text-left px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const expanded = expandedId === it.id;
              return (
                <>
                  <tr key={it.id} className="border-t border-slate-100 dark:border-zinc-800">
                    <td className="px-3 py-2 text-slate-900 dark:text-white">{it.source}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-200 font-mono">{it.event_type}</td>
                    <td className="px-3 py-2 text-red-700 dark:text-red-300 max-w-[260px] truncate">{it.processing_error || "-"}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {it.retry_count}/{it.max_retries}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fmt(it.processed_at)}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200 max-w-[300px] truncate">{payloadPreview(it.payload)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedId((prev) => (prev === it.id ? null : it.id))}
                          className="rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-slate-900 dark:text-white"
                        >
                          {expanded ? "Hide" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void retryOne(it.id)}
                          disabled={retryingId === it.id}
                          className="rounded-md bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-2 py-1 text-[11px] font-semibold disabled:opacity-60"
                        >
                          {retryingId === it.id ? "Retrying..." : "Retry"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="border-t border-slate-100 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/30">
                      <td colSpan={7} className="px-3 py-3">
                        <pre className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-80">
                          {payloadPretty(it.payload)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
            {!loading && !items.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-600 dark:text-slate-300">
                  No DLQ events found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
