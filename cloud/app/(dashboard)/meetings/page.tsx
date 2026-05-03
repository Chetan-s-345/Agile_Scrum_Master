"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, PlusCircle, PlayCircle } from "lucide-react";
import { MeetingsList } from "@/components/meetings/MeetingsList";

type AuthMeResponse = {
  user?: { fullName?: string };
  activeOrgId?: string | null;
  memberships?: Array<{
    org?: { id?: string };
    role?: string;
  }>;
  error?: string;
  detail?: string;
};

type CreateRoomResponse = {
  item?: {
    room_name?: string;
    roomName?: string;
  };
  error?: string;
  detail?: string;
};

type ScheduledSessionItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  scheduledStart: string;
  joinUrl?: string | null;
};

type MeetingsListResponse = {
  items?: ScheduledSessionItem[];
  error?: string;
  detail?: string;
};

type StartSessionResponse = {
  item?: {
    joinUrl?: string;
    title?: string;
  };
  error?: string;
  detail?: string;
};

type MeetingKind = "normal" | "sprint_planner";
type CreateMode = "live" | "scheduled";
type NormalCategory = "daily_sprint" | "weekly_sprint" | "backlogs" | "business_meeting" | "retrospective";

const NORMAL_OPTIONS: Array<{ value: NormalCategory; label: string; meetingType: string }> = [
  { value: "daily_sprint", label: "Daily Sprint", meetingType: "daily" },
  { value: "weekly_sprint", label: "Weekly Sprint", meetingType: "weekly" },
  { value: "backlogs", label: "Backlogs", meetingType: "planning" },
  { value: "business_meeting", label: "Business Meeting", meetingType: "business" },
  { value: "retrospective", label: "Retrospective", meetingType: "retrospective" },
];

function defaultTitle(kind: MeetingKind, category: NormalCategory) {
  if (kind === "sprint_planner") return "Sprint Planner";
  return NORMAL_OPTIONS.find((item) => item.value === category)?.label || "Daily Sprint";
}

function mapMeetingType(kind: MeetingKind, category: NormalCategory) {
  if (kind === "sprint_planner") return "planning";
  return NORMAL_OPTIONS.find((item) => item.value === category)?.meetingType || "daily";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function extractRoomName(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (!raw.includes("//")) {
    const local = raw.match(/\/meetings\/live\/([^/?#]+)/i);
    if (local?.[1]) return decodeURIComponent(local[1]);
    return raw;
  }

  try {
    const url = new URL(raw);
    const pathMatch = url.pathname.match(/\/meetings\/live\/([^/?#]+)/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
    const roomParam = url.searchParams.get("room");
    return String(roomParam || "").trim();
  } catch {
    return raw;
  }
}

export default function MeetingsPage() {
  const router = useRouter();
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [startingScheduledId, setStartingScheduledId] = useState("");
  const [loadingScheduled, setLoadingScheduled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [participantName, setParticipantName] = useState("Team Member");
  const [canManageMeetings, setCanManageMeetings] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [joinRoomInput, setJoinRoomInput] = useState("");
  const [scheduledMeetings, setScheduledMeetings] = useState<ScheduledSessionItem[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("live");
  const [meetingKind, setMeetingKind] = useState<MeetingKind>("normal");
  const [normalCategory, setNormalCategory] = useState<NormalCategory>("daily_sprint");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDescription, setMeetingDescription] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  const canSubmitCreate = useMemo(() => {
    if (!canManageMeetings || !orgId || loadingProfile || submitting) return false;
    if (createMode === "scheduled") return Boolean(scheduleTime.trim());
    return true;
  }, [canManageMeetings, createMode, loadingProfile, orgId, scheduleTime, submitting]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoadingProfile(true);
      setError("");
      try {
        const resp = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = (await resp.json().catch(() => null)) as AuthMeResponse | null;
        if (!resp.ok) {
          throw new Error(String(payload?.detail || payload?.error || "Failed to load profile"));
        }

        if (cancelled) return;
        const nextOrg = String(payload?.activeOrgId || "").trim();
        const nextName = String(payload?.user?.fullName || "Team Member").trim();
        const memberships = Array.isArray(payload?.memberships) ? payload.memberships : [];
        const activeMembership =
          memberships.find((membership) => String(membership?.org?.id || "").trim() === nextOrg) || memberships[0];
        const role = String(activeMembership?.role || "").trim().toLowerCase();
        setOrgId(nextOrg);
        setParticipantName(nextName || "Team Member");
        setCanManageMeetings(role === "owner" || role === "admin");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadScheduledMeetings = useCallback(async () => {
    setLoadingScheduled(true);
    try {
      const resp = await fetch("/api/meetings?kind=session&status=scheduled&limit=50", { cache: "no-store" });
      const payload = (await resp.json().catch(() => null)) as MeetingsListResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to load scheduled meetings"));
      }

      const items = Array.isArray(payload?.items) ? payload.items : [];
      setScheduledMeetings(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheduled meetings");
      setScheduledMeetings([]);
    } finally {
      setLoadingScheduled(false);
    }
  }, []);

  useEffect(() => {
    void loadScheduledMeetings();
  }, [loadScheduledMeetings, refreshSignal]);

  const createLiveMeeting = useCallback(async () => {
    const roomName = `sprint-${orgId || "org"}-${Date.now()}`;
    const finalTitle = meetingTitle.trim() || defaultTitle(meetingKind, normalCategory);

    const resp = await fetch("/api/meetings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName,
        meetingKind,
        normalCategory,
        title: finalTitle,
        description: meetingDescription.trim() || undefined,
      }),
    });

    const payload = (await resp.json().catch(() => null)) as CreateRoomResponse | null;
    if (!resp.ok) {
      throw new Error(String(payload?.detail || payload?.error || "Failed to create meeting room"));
    }

    const createdRoom =
      String(payload?.item?.roomName || "").trim() || String(payload?.item?.room_name || "").trim() || roomName;

    router.push(`/meetings/live/${encodeURIComponent(createdRoom)}`);
  }, [meetingDescription, meetingKind, meetingTitle, normalCategory, orgId, router]);

  const createScheduledMeeting = useCallback(async () => {
    const title = meetingTitle.trim() || defaultTitle(meetingKind, normalCategory);
    const type = mapMeetingType(meetingKind, normalCategory);
    const resp = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        title,
        scheduledStart: scheduleTime,
        createJoinUrl: true,
        provider: "livekit",
        description: meetingDescription.trim() || `mode:${meetingKind};category:${normalCategory}`,
      }),
    });

    const payload = (await resp.json().catch(() => null)) as MeetingsListResponse | null;
    if (!resp.ok) {
      throw new Error(String(payload?.detail || payload?.error || "Failed to schedule meeting"));
    }

    await loadScheduledMeetings();
    setRefreshSignal((value) => value + 1);
  }, [loadScheduledMeetings, meetingDescription, meetingKind, meetingTitle, normalCategory, scheduleTime]);

  const submitCreateMeeting = useCallback(async () => {
    if (!canManageMeetings) {
      setError("Only organization admins can create meetings");
      return;
    }

    if (createMode === "scheduled" && !scheduleTime.trim()) {
      setError("Pick a schedule time");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      if (createMode === "live") {
        await createLiveMeeting();
      } else {
        await createScheduledMeeting();
        setCreateOpen(false);
      }

      setMeetingTitle("");
      setMeetingDescription("");
      setScheduleTime("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setSubmitting(false);
    }
  }, [canManageMeetings, createMode, createLiveMeeting, createScheduledMeeting, scheduleTime]);

  const joinMeetingByRoom = useCallback(
    async (roomToJoinRaw: string) => {
      const roomToJoin = extractRoomName(roomToJoinRaw);
      if (!roomToJoin) {
        setError("Please enter a valid room ID or live meeting link");
        return;
      }

      setJoining(true);
      setError("");

      try {
        const resp = await fetch("/api/meetings/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName: roomToJoin, participantName }),
        });

        if (!resp.ok) {
          const payload = (await resp.json().catch(() => null)) as MeetingsListResponse | null;
          throw new Error(String(payload?.detail || payload?.error || "Room not found or access denied"));
        }

        setJoinRoomInput("");
        router.push(`/meetings/live/${encodeURIComponent(roomToJoin)}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to join meeting room");
      } finally {
        setJoining(false);
      }
    },
    [participantName, router]
  );

  const startScheduledMeeting = useCallback(
    async (meetingId: string) => {
      if (!meetingId) return;
      if (!isUuid(meetingId)) {
        setError("Unable to start this meeting because its ID is invalid");
        return;
      }
      if (!canManageMeetings) {
        setError("Only organization admins can start scheduled meetings");
        return;
      }

      setStartingScheduledId(meetingId);
      setError("");

      try {
        const resp = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "livekit" }),
        });
        const payload = (await resp.json().catch(() => null)) as StartSessionResponse | null;
        if (!resp.ok) {
          throw new Error(String(payload?.detail || payload?.error || "Failed to start scheduled meeting"));
        }

        await loadScheduledMeetings();
        setRefreshSignal((value) => value + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start scheduled meeting");
      } finally {
        setStartingScheduledId("");
      }
    },
    [canManageMeetings, loadScheduledMeetings]
  );

  return (
    <main className="mx-auto w-full max-w-[1280px] space-y-5 p-4 md:p-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Meetings</h1>
            <p className="text-xs text-[var(--text-muted)]">Create meetings, join live rooms, and review previous sessions.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!canManageMeetings || loadingProfile || !orgId}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlusCircle className="h-4 w-4" />
            Create Meeting
          </button>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            type="text"
            value={joinRoomInput}
            onChange={(event) => setJoinRoomInput(event.target.value)}
            placeholder="Paste room ID or live meeting URL"
            className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)]"
          />
          <button
            type="button"
            onClick={() => void joinMeetingByRoom(joinRoomInput)}
            disabled={joining || !joinRoomInput.trim()}
            className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join Meeting"}
          </button>
        </div>

        {loadingProfile ? <p className="mt-3 text-xs text-[var(--text-muted)]">Loading profile...</p> : null}
        {!loadingProfile && !orgId ? (
          <p className="mt-3 text-xs text-amber-400">No active organization found. Switch organization to create or join meetings.</p>
        ) : null}
        {!loadingProfile && orgId && !canManageMeetings ? (
          <p className="mt-3 text-xs text-amber-400">You can join and view meetings. Only admins can create, schedule, start, or end them.</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Daily Scheduled Meetings</h2>
            <p className="text-xs text-[var(--text-muted)]">Start scheduled items when the team is ready.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadScheduledMeetings()}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-primary)]"
          >
            {loadingScheduled ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="space-y-2">
          {!scheduledMeetings.length && !loadingScheduled ? (
            <p className="text-sm text-[var(--text-muted)]">No scheduled meetings yet.</p>
          ) : null}
          {scheduledMeetings.map((meeting) => (
            <div key={meeting.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{meeting.title}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {meeting.type} •{" "}
                  {new Date(meeting.scheduledStart).toLocaleString("en-US", {
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {meeting.joinUrl ? (
                  <a
                    href={meeting.joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-primary)]"
                  >
                    Open Join URL
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void startScheduledMeeting(meeting.id)}
                  disabled={startingScheduledId === meeting.id || !canManageMeetings || !isUuid(meeting.id)}
                  className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {startingScheduledId === meeting.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                  <span className="ml-1">Start</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <MeetingsList refreshSignal={refreshSignal} />

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-[680px] rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Create Meeting</h2>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreateMode("live")}
                  className={`rounded-md px-3 py-2 text-xs ${
                    createMode === "live"
                      ? "bg-blue-600 text-white"
                      : "border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  }`}
                >
                  Start Live Now
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode("scheduled")}
                  className={`rounded-md px-3 py-2 text-xs ${
                    createMode === "scheduled"
                      ? "bg-blue-600 text-white"
                      : "border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Daily Schedule
                  </span>
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={meetingKind}
                  onChange={(event) => setMeetingKind(event.target.value as MeetingKind)}
                  className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
                >
                  <option value="normal">Normal</option>
                  <option value="sprint_planner">Sprint Planner</option>
                </select>

                {meetingKind === "normal" ? (
                  <select
                    value={normalCategory}
                    onChange={(event) => setNormalCategory(event.target.value as NormalCategory)}
                    className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
                  >
                    {NORMAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]">
                    Sprint Planning
                  </div>
                )}
              </div>

              <input
                type="text"
                value={meetingTitle}
                onChange={(event) => setMeetingTitle(event.target.value)}
                placeholder={`Title (default: ${defaultTitle(meetingKind, normalCategory)})`}
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
              />

              <textarea
                value={meetingDescription}
                onChange={(event) => setMeetingDescription(event.target.value)}
                placeholder="Description (optional)"
                className="min-h-[90px] rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />

              {createMode === "scheduled" ? (
                <input
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={(event) => setScheduleTime(event.target.value)}
                  className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)]"
                />
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitCreateMeeting()}
                  disabled={!canSubmitCreate}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                  {createMode === "scheduled" ? "Create Schedule" : "Start Meeting"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
