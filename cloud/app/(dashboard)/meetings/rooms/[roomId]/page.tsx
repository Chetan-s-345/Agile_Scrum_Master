"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import type { IndividualMeetingSummary, MeetingRoomItem, MeetingRoomParticipant } from "@/components/meetings/types";

type AuthMeResponse = {
  activeOrgId?: string | null;
  memberships?: Array<{
    org?: { id?: string };
    role?: string;
  }>;
  error?: string;
  detail?: string;
};

type MeetingRoomDetail = MeetingRoomItem & {
  participants?: MeetingRoomParticipant[];
  individualSummaries?: IndividualMeetingSummary[];
};

type MeetingRoomDetailResponse = {
  item?: MeetingRoomDetail;
  error?: string;
  detail?: string;
};

type EndMeetingResponse = {
  item?: MeetingRoomDetail;
  error?: string;
  detail?: string;
};

type LoadRoomOptions = {
  silent?: boolean;
};

function labelMeetingKind(value?: string) {
  if (value === "sprint_planner") return "Sprint Planner";
  return "Normal";
}

function labelCategory(value?: string) {
  if (!value) return "-";
  if (value === "daily_sprint") return "Daily Sprint";
  if (value === "weekly_sprint") return "Weekly Sprint";
  if (value === "backlogs") return "Backlogs";
  if (value === "business_meeting") return "Business Meeting";
  if (value === "retrospective") return "Retrospective";
  return value;
}

function prettyDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export default function MeetingRoomDetailPage() {
  const router = useRouter();
  const routeParams = useParams<{ roomId?: string | string[] }>();
  const routeRoomId = Array.isArray(routeParams?.roomId) ? routeParams.roomId[0] : routeParams?.roomId;
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  const [roomId, setRoomId] = useState("");
  const [item, setItem] = useState<MeetingRoomDetail | null>(null);
  const [canManageMeetings, setCanManageMeetings] = useState(false);
  const [showFullTranscript, setShowFullTranscript] = useState(false);

  const loadRoom = useCallback(async (id: string, options?: LoadRoomOptions) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError("");
    try {
      const resp = await fetch(`/api/meetings/rooms/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = (await resp.json().catch(() => null)) as MeetingRoomDetailResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to load meeting page"));
      }
      setItem(payload?.item || null);
    } catch (err) {
      setItem(null);
      setError(err instanceof Error ? err.message : "Failed to load meeting page");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const id = String(routeRoomId || "").trim();
    setRoomId(id);
    if (!id) {
      setLoading(false);
      setError("Missing meeting room ID");
      return;
    }
    void loadRoom(id);
  }, [loadRoom, routeRoomId]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const resp = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = (await resp.json().catch(() => null)) as AuthMeResponse | null;
        if (!resp.ok || cancelled) return;

        const nextOrg = String(payload?.activeOrgId || "").trim();
        const memberships = Array.isArray(payload?.memberships) ? payload.memberships : [];
        const activeMembership =
          memberships.find((membership) => String(membership?.org?.id || "").trim() === nextOrg) || memberships[0];
        const role = String(activeMembership?.role || "").trim().toLowerCase();
        setCanManageMeetings(role === "owner" || role === "admin");
      } catch {
        if (!cancelled) setCanManageMeetings(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const participants = useMemo(() => item?.participants || [], [item]);
  const summaries = useMemo(() => item?.individualSummaries || [], [item]);


  const endMeeting = useCallback(async () => {
    if (!item?.roomName || !canManageMeetings || item.status !== "active") return;

    setEnding(true);
    setError("");
    try {
      const resp = await fetch("/api/meetings/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: item.roomName }),
      });
      const payload = (await resp.json().catch(() => null)) as EndMeetingResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to end meeting"));
      }
      router.push("/meetings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end meeting");
    } finally {
      setEnding(false);
    }
  }, [canManageMeetings, item?.roomName, item?.status, router]);

  const refreshTranscript = useCallback(() => {
    if (!roomId) return;
    void loadRoom(roomId, { silent: true });
  }, [loadRoom, roomId]);

  useEffect(() => {
    if (!showFullTranscript || !roomId || item?.status !== "active") {
      return;
    }

    const id = window.setInterval(() => {
      void loadRoom(roomId, { silent: true });
    }, 2000); // Refresh every 2 seconds when transcript is visible and meeting is active

    return () => {
      window.clearInterval(id);
    };
  }, [item?.status, loadRoom, roomId, showFullTranscript]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[360px] max-w-[1200px] items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </main>
    );
  }

  if (error || !item) {
    return (
      <main className="mx-auto max-w-[1200px] space-y-4 p-6">
        <Link href="/meetings" className="text-sm text-blue-300 underline">
          Back to meetings
        </Link>
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error || "Meeting page not found"}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
        <div>
          <Link href="/meetings" className="text-sm text-blue-300 underline">
            Back to meetings
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">{item.title || item.roomName}</h1>
          <p className="text-xs text-[var(--text-muted)]">Room ID: {roomId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">
            {labelMeetingKind(item.meetingKind)}
          </span>
          <span className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">
            {labelCategory(item.normalCategory)}
          </span>
          <span className="rounded-md border border-[var(--border)] px-2 py-1 text-xs uppercase text-[var(--text-muted)]">
            {item.status}
          </span>
          <Link
            href={`/meetings/live/${encodeURIComponent(item.roomName)}`}
            className="rounded-md border border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-200"
          >
            Join Meeting
          </Link>
          <button
            type="button"
            onClick={() => setShowFullTranscript(true)}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
          >
            View Full Live Transcript
          </button>
          {canManageMeetings && item.status === "active" ? (
            <button
              type="button"
              onClick={() => void endMeeting()}
              disabled={ending}
              className="inline-flex items-center rounded-md border border-red-500/40 bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {ending ? "Ending..." : "End Meeting"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Meeting Details</h2>
          <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
            <p>Created by: {item.createdBy}</p>
            <p>Created at: {prettyDate(item.createdAt)}</p>
            <p>Scheduled for: {prettyDate(item.scheduledFor)}</p>
            <p>Ended at: {prettyDate(item.endedAt)}</p>
            <p>Room name: {item.roomName}</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Participants ({participants.length})</h2>
          <div className="mt-2 space-y-2">
            {participants.map((participant) => (
              <div key={participant.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-2 text-xs">
                <p className="font-semibold text-[var(--text-primary)]">{participant.participantName}</p>
                <p className="text-[var(--text-muted)]">
                  {participant.role} • {participant.status}
                </p>
              </div>
            ))}
            {!participants.length ? <p className="text-xs text-[var(--text-muted)]">No participants recorded.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Meeting Summary</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshTranscript}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowFullTranscript((prev) => !prev)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
            >
              {showFullTranscript ? "Hide full transcript" : "Show full transcript"}
            </button>
          </div>
        </div>
        <div className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-primary)]">
          {item.summary || "Summary is not generated yet."}
        </div>
        {!showFullTranscript ? (
          <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-muted)]">
            Full transcript is hidden. Use View Full Live Transcript to show everything spoken in this meeting.
          </div>
        ) : null}
      </section>

      {showFullTranscript ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Full Live Transcript</h2>
            <button
              type="button"
              onClick={() => setShowFullTranscript(false)}
              className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
            >
              Hide Transcript
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">This updates automatically every 2 seconds while the meeting is active.</p>
          <div className="mt-2 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-sm text-[var(--text-primary)]">
            {item.transcript || "Transcript is empty for this meeting."}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Individual Summaries ({summaries.length})</h2>
        <div className="mt-2 space-y-2">
          {summaries.map((summary) => (
            <div key={summary.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-2 text-xs">
              <p className="font-semibold text-[var(--text-primary)]">{summary.participantName}</p>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[var(--text-muted)]">{summary.summary || "No summary"}</p>
            </div>
          ))}
          {!summaries.length ? <p className="text-xs text-[var(--text-muted)]">No individual summaries generated yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
