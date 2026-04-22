"use client";

import "@livekit/components-styles";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoConference,
  useRoomContext,
} from "@livekit/components-react";
import { Room, RoomEvent, Track } from "livekit-client";
import { Loader2, PhoneOff } from "lucide-react";
import { useDeepgramTranscription } from "@/hooks/useDeepgramTranscription";
import { MeetingSummary } from "@/components/meetings/MeetingSummary";
import { ParticipantList } from "@/components/meetings/ParticipantList";

type RoomTokenResponse = {
  token?: string;
  url?: string;
  identity?: string;
  error?: string;
  detail?: string;
};

type TranscriptResponse = {
  summary?: string;
  item?: {
    mySummary?: string;
  };
  error?: string;
  detail?: string;
};

type IndividualSummaryResponse = {
  item?: {
    summary?: string;
  };
  error?: string;
  detail?: string;
};

type MeetingRoomProps = {
  roomName: string;
  participantName: string;
  onMeetingEnded?: (payload: { summary: string; transcript: string; individualSummary?: string }) => void;
};

function TranscriptionBridge({
  onTranscript,
  onTranscribing,
}: {
  onTranscript: (value: string) => void;
  onTranscribing: (value: boolean) => void;
}) {
  const room = useRoomContext();
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const { transcript, isTranscribing } = useDeepgramTranscription(audioTrack);

  useEffect(() => {
    function syncTrack() {
      const publications = Array.from(room.localParticipant.trackPublications.values());
      const micPublication = publications.find((publication) => publication.source === Track.Source.Microphone && publication.track);
      const localTrack = micPublication?.track as { mediaStreamTrack?: MediaStreamTrack } | undefined;
      setAudioTrack(localTrack?.mediaStreamTrack || null);
    }

    syncTrack();
    room.on(RoomEvent.LocalTrackPublished, syncTrack);
    room.on(RoomEvent.LocalTrackUnpublished, syncTrack);
    room.on(RoomEvent.TrackMuted, syncTrack);
    room.on(RoomEvent.TrackUnmuted, syncTrack);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, syncTrack);
      room.off(RoomEvent.LocalTrackUnpublished, syncTrack);
      room.off(RoomEvent.TrackMuted, syncTrack);
      room.off(RoomEvent.TrackUnmuted, syncTrack);
    };
  }, [room]);

  useEffect(() => {
    onTranscript(transcript);
  }, [transcript, onTranscript]);

  useEffect(() => {
    onTranscribing(isTranscribing);
  }, [isTranscribing, onTranscribing]);

  return null;
}

export function MeetingRoom({ roomName, participantName, onMeetingEnded }: MeetingRoomProps) {
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [summary, setSummary] = useState("");
  const [individualSummary, setIndividualSummary] = useState("");
  const [participantIdentity, setParticipantIdentity] = useState("");
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"participants" | "transcript">("participants");
  const leftReportedRef = useRef(false);
  const activeRoomRef = useRef<Room | null>(null);
  const startedAtRef = useRef<string>(new Date().toISOString());
  const [endedAt, setEndedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadToken() {
      setLoading(true);
      setError("");
      try {
        const resp = await fetch("/api/meetings/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName, participantName }),
        });
        const payload = (await resp.json().catch(() => null)) as RoomTokenResponse | null;
        if (!resp.ok) {
          throw new Error(String(payload?.detail || payload?.error || "Failed to generate meeting token"));
        }

        const nextToken = String(payload?.token || "").trim();
        const nextUrl = String(payload?.url || "").trim();
        const nextIdentity = String(payload?.identity || "").trim();
        if (!nextToken || !nextUrl) {
          throw new Error("Meeting token response is incomplete");
        }

        if (cancelled) return;
        setToken(nextToken);
        setServerUrl(nextUrl);
        setParticipantIdentity(nextIdentity);
        leftReportedRef.current = false;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to generate meeting token");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadToken();

    return () => {
      cancelled = true;
      if (activeRoomRef.current) {
        activeRoomRef.current.disconnect();
      }
    };
  }, [roomName, participantName]);

  const transcriptPreview = useMemo(() => transcript.trim() || "Waiting for transcript...", [transcript]);

  const reportJoin = useCallback(
    async (identity: string) => {
      await fetch("/api/meetings/participants/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName,
          participantName,
          identity,
          role: "member",
        }),
      });
    },
    [roomName, participantName]
  );

  const reportLeave = useCallback(async () => {
    if (leftReportedRef.current) return;
    leftReportedRef.current = true;

    await fetch("/api/meetings/participants/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName }),
    }).catch(() => null);
  }, [roomName]);

  const endMeeting = useCallback(async () => {
    setEnding(true);
    setError("");

    try {
      const transcriptResp = await fetch("/api/meetings/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, transcript }),
      });
      const transcriptPayload = (await transcriptResp.json().catch(() => null)) as TranscriptResponse | null;
      if (!transcriptResp.ok) {
        throw new Error(String(transcriptPayload?.detail || transcriptPayload?.error || "Failed to save transcript"));
      }

      const summaryText = String(transcriptPayload?.summary || "").trim();
      setSummary(summaryText);

      let personalSummary = "";
      try {
        const personalResp = await fetch("/api/meetings/summary/individual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName,
            focus: "Provide a concise personal summary with actions and ownership.",
          }),
        });
        const personalPayload = (await personalResp.json().catch(() => null)) as IndividualSummaryResponse | null;
        if (personalResp.ok) {
          personalSummary = String(personalPayload?.item?.summary || "").trim();
        }
      } catch {
        personalSummary = "";
      }

      setIndividualSummary(personalSummary);
      const now = new Date().toISOString();
      setEndedAt(now);

      const endResp = await fetch("/api/meetings/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName }),
      });

      const endPayload = (await endResp.json().catch(() => null)) as TranscriptResponse | null;
      if (!endResp.ok) {
        throw new Error(String(endPayload?.detail || endPayload?.error || "Failed to end meeting"));
      }

      const endMySummary = String(endPayload?.item?.mySummary || "").trim();
      if (!personalSummary && endMySummary) {
        personalSummary = endMySummary;
        setIndividualSummary(endMySummary);
      }

      if (activeRoom) {
        activeRoom.disconnect();
      }

      await reportLeave();

      if (onMeetingEnded) {
        onMeetingEnded({ summary: summaryText, transcript, individualSummary: personalSummary || undefined });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end meeting");
    } finally {
      setEnding(false);
    }
  }, [activeRoom, onMeetingEnded, reportLeave, roomName, transcript]);

  if (loading) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        video
        audio
        onConnected={(room) => {
          startedAtRef.current = new Date().toISOString();
          activeRoomRef.current = room;
          setActiveRoom(room);
          const identity = String(room.localParticipant?.identity || participantIdentity || "").trim();
          void reportJoin(identity);
        }}
        onDisconnected={() => {
          activeRoomRef.current = null;
          setActiveRoom(null);
          void reportLeave();
        }}
        className="contents"
        data-lk-theme="default"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-[560px] overflow-hidden rounded-lg border border-[var(--border)] bg-black">
            <VideoConference />
            <RoomAudioRenderer />
            <TranscriptionBridge onTranscript={setTranscript} onTranscribing={setIsTranscribing} />
          </div>

          <aside className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarTab("participants")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    sidebarTab === "participants"
                      ? "bg-blue-500/30 text-blue-200 border border-blue-500/40"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  Participants
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab("transcript")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    sidebarTab === "transcript"
                      ? "bg-blue-500/30 text-blue-200 border border-blue-500/40"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  Transcript
                </button>
              </div>
              <button
                type="button"
                onClick={() => void endMeeting()}
                disabled={ending}
                className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
                End Meeting
              </button>
            </div>

            {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}

            {sidebarTab === "participants" ? (
              <ParticipantList />
            ) : (
              <div>
                <div className="mb-2 text-xs text-[var(--text-muted)]">
                  {isTranscribing ? "🎤 Deepgram connected" : "⏳ Waiting for microphone track"}
                </div>
                <div className="h-[460px] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs leading-relaxed text-[var(--text-primary)]">
                  {transcriptPreview}
                </div>
              </div>
            )}
          </aside>
        </div>
      </LiveKitRoom>

      {summary ? (
        <MeetingSummary
          summary={summary}
          individualSummary={individualSummary}
          transcript={transcript}
          startedAt={startedAtRef.current}
          endedAt={endedAt}
        />
      ) : null}
    </div>
  );
}
