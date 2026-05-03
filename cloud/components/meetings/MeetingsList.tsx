"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { MeetingRoomItem } from "@/components/meetings/types";

type MeetingsResponse = {
  items?: MeetingRoomItem[];
  error?: string;
  detail?: string;
};

type MeetingsListProps = {
  refreshSignal?: number;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

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

function categoryLabel(value?: string) {
  if (!value) return "";
  if (value === "daily_sprint") return "Daily Sprint";
  if (value === "weekly_sprint") return "Weekly Sprint";
  if (value === "backlogs") return "Backlogs";
  if (value === "business_meeting") return "Business Meeting";
  if (value === "retrospective") return "Retrospective";
  return value;
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
    <section>
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
            <div
              key={item.id}
              className={`w-full rounded-md border p-3 text-left transition ${
                selected?.id === item.id
                  ? "border-[var(--accent)] bg-[var(--bg-secondary)]"
                  : "border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="truncate text-sm font-medium text-left text-[var(--text-primary)]"
                >
                  {item.title || item.roomName}
                </button>
                <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.status}</span>
              </div>
              <div className="mt-1 flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span>{formatDate(item.createdAt)}</span>
                <span>{meetingDuration(item)}</span>
                {item.meetingKind ? <span>{item.meetingKind === "sprint_planner" ? "Sprint Planner" : "Normal"}</span> : null}
                {item.normalCategory ? <span>{categoryLabel(item.normalCategory)}</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {item.status === "active" ? (
                  <Link
                    href={`/meetings/live/${encodeURIComponent(item.roomName)}`}
                    className="rounded-md border border-green-500/40 bg-green-500/20 px-2 py-1 text-green-200"
                  >
                    Join meeting
                  </Link>
                ) : null}
                <Link
                  href={
                    isUuid(item.id)
                      ? `/meetings/rooms/${encodeURIComponent(item.id)}`
                      : `/meetings/live/${encodeURIComponent(item.roomName)}`
                  }
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-primary)]"
                >
                  Open meeting page
                </Link>
              </div>
              {String(item.mySummary || "").trim() ? (
                <p className="mt-2 text-xs text-blue-300">Personal summary available</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
