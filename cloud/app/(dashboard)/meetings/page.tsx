"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PlayCircle, Share2, Copy, Check } from "lucide-react";
import { MeetingRoom } from "@/components/meetings/MeetingRoom";
import { MeetingsList } from "@/components/meetings/MeetingsList";
import { useMeetingStore } from "@/src/store/meetingStore";

type AuthMeResponse = {
  user?: { fullName?: string };
  activeOrgId?: string | null;
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

export default function MeetingsPage() {
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [starting, setStarting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [participantName, setParticipantName] = useState("Team Member");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [joinRoomInput, setJoinRoomInput] = useState("");
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [copied, setCopied] = useState(false);

  const { currentRoom, isInMeeting, setRoom, setSummary, appendTranscript, endMeeting } = useMeetingStore();

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
        setOrgId(nextOrg);
        setParticipantName(nextName || "Team Member");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        if (!cancelled) {
          setLoadingProfile(false);
        }
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const startMeeting = useCallback(async () => {
    setStarting(true);
    setError("");

    const roomName = `sprint-${orgId || "org"}-${Date.now()}`;

    try {
      const resp = await fetch("/api/meetings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName }),
      });

      const payload = (await resp.json().catch(() => null)) as CreateRoomResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to create meeting room"));
      }

      const createdRoom =
        String(payload?.item?.roomName || "").trim() ||
        String(payload?.item?.room_name || "").trim() ||
        roomName;

      setRoom(createdRoom);
      setSummary("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting room");
    } finally {
      setStarting(false);
    }
  }, [orgId, setRoom, setSummary]);

  const joinMeeting = useCallback(async () => {
    const roomToJoin = joinRoomInput.trim();
    if (!roomToJoin) {
      setError("Please enter a room name");
      return;
    }

    setJoining(true);
    setError("");

    try {
      // Verify room exists by attempting to get token
      const resp = await fetch("/api/meetings/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: roomToJoin, participantName }),
      });

      if (!resp.ok) {
        throw new Error("Room not found or access denied");
      }

      setRoom(roomToJoin);
      setSummary("");
      setJoinRoomInput("");
      setShowJoinForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join meeting room");
    } finally {
      setJoining(false);
    }
  }, [joinRoomInput, participantName, setRoom, setSummary]);

  const copyRoomToClipboard = async () => {
    if (!currentRoom) return;
    try {
      await navigator.clipboard.writeText(currentRoom);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy room name");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-6 p-4 md:p-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-5">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Meetings</h1>
            <p className="text-sm text-[var(--text-muted)]">
              LiveKit room + Deepgram real-time transcript + Groq scrum summary.
            </p>
          </div>

          {/* Active Room Info */}
          {isInMeeting && currentRoom ? (
            <div className="rounded-lg bg-blue-500/10 p-4 border border-blue-500/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-blue-400">Meeting Room</p>
                  <p className="text-xs text-blue-300 font-mono break-all">{currentRoom}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyRoomToClipboard()}
                  className="flex items-center gap-2 rounded px-3 py-2 text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy Room Name
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-blue-300/70 mt-2">
                📌 Share this room name with other developers to let them join your meeting
              </p>
            </div>
          ) : null}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <button
              type="button"
              onClick={() => void startMeeting()}
              disabled={loadingProfile || starting || !orgId || isInMeeting}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Start New Meeting
            </button>

            <button
              type="button"
              onClick={() => setShowJoinForm(!showJoinForm)}
              disabled={isInMeeting}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" />
              {showJoinForm ? "Close" : "Join Meeting"}
            </button>
          </div>

          {/* Join Form */}
          {showJoinForm && !isInMeeting ? (
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
              <label className="text-xs font-medium text-[var(--text-muted)]">Enter room name to join:</label>
              <div className="flex flex-col gap-2 md:flex-row">
                <input
                  type="text"
                  value={joinRoomInput}
                  onChange={(e) => setJoinRoomInput(e.target.value)}
                  placeholder="e.g., sprint-org-abc-1234567890"
                  className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void joinMeeting();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void joinMeeting()}
                  disabled={joining || !joinRoomInput.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join"}
                </button>
              </div>
            </div>
          ) : null}

          {loadingProfile ? <p className="text-xs text-[var(--text-muted)]">Loading profile...</p> : null}
          {!loadingProfile && !orgId ? (
            <p className="text-xs text-amber-400">No active organization found. Switch to an organization to start meetings.</p>
          ) : null}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
      </section>

      {isInMeeting && currentRoom ? (
        <section>
          <MeetingRoom
            roomName={currentRoom}
            participantName={participantName}
            onMeetingEnded={(payload) => {
              setSummary(payload.summary);
              appendTranscript(payload.transcript);
              endMeeting();
              setRefreshSignal((value) => value + 1);
            }}
          />
        </section>
      ) : null}

      <MeetingsList refreshSignal={refreshSignal} />
    </main>
  );
}
