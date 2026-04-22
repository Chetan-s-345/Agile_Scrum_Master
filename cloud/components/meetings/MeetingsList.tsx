"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { MeetingSummary } from "@/components/meetings/MeetingSummary";
import type { MeetingRoomItem } from "@/components/meetings/types";

type MeetingsResponse = {
  items?: MeetingRoomItem[];
  error?: string;
  detail?: string;
};

type MeetingsListProps = {
  refreshSignal?: number;
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function meetingDuration(item: MeetingRoomItem) {
  if (!item.endedAt) return "In progress";
  const start = new Date(item.createdAt);
  const end = new Date(item.endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return "-";
  const mins = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function MeetingsList({ refreshSignal = 0 }: MeetingsListProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<MeetingRoomItem[]>([]);
  const [selectedId, setSelectedId] = useState("");

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0] || null, [items, selectedId]);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/meetings", { cache: "no-store" });
      const payload = (await resp.json().catch(() => null)) as MeetingsResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to load meetings"));
      }

      const next = Array.isArray(payload?.items) ? payload.items : [];
      setItems(next);
      setSelectedId((prev) => (next.some((item) => item.id === prev) ? prev : next[0]?.id || ""));
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "Failed to load meetings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings, refreshSignal]);

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Past Meetings</h2>
          <button
            type="button"
            onClick={() => void loadMeetings()}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error ? <p className="mb-2 text-sm text-red-400">{error}</p> : null}

        <div className="space-y-2">
          {!items.length && !loading ? <p className="text-sm text-[var(--text-muted)]">No meetings recorded yet.</p> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              className={`w-full rounded-md border p-3 text-left transition ${
                selected?.id === item.id
                  ? "border-[var(--accent)] bg-[var(--bg-secondary)]"
                  : "border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.roomName}</span>
                <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.status}</span>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span>{formatDate(item.createdAt)}</span>
                <span>{meetingDuration(item)}</span>
              </div>
              {String(item.mySummary || "").trim() ? (
                <p className="mt-2 text-xs text-blue-300">Personal summary available</p>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div>
        {selected ? (
          <MeetingSummary
            summary={selected.summary}
            individualSummary={selected.mySummary}
            transcript={selected.transcript}
            startedAt={selected.createdAt}
            endedAt={selected.endedAt}
          />
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-muted)]">
            Select a meeting to view summary.
          </div>
        )}
      </div>
    </section>
  );
}
