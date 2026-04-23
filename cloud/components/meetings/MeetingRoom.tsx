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
import { Check, Copy, Loader2, Maximize2, MessageSquareText, Minimize2, PhoneOff, Volume2 } from "lucide-react";
import { useDeepgramTranscription } from "@/hooks/useDeepgramTranscription";
import { ParticipantList } from "@/components/meetings/ParticipantList";
import { MeetingChatPanel } from "@/components/meetings/MeetingChatPanel";

type RoomTokenResponse = {
  token?: string;
  url?: string;
  identity?: string;
  error?: string;
  detail?: string;
};

type TranscriptResponse = {
  summary?: string;
  captured?: boolean;
  charCount?: number;
  source?: string;
  summaryEngine?: string;
  groqUsed?: boolean;
  transcriptPersisted?: boolean;
  error?: string;
  detail?: string;
};

type EndMeetingResponse = {
  item?: {
    summary?: string;
    mySummary?: string;
  };
  error?: string;
  detail?: string;
};

type MeetingRoomProps = {
  roomName: string;
  participantName: string;
  canEndMeeting?: boolean;
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
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const { transcript, isTranscribing } = useDeepgramTranscription(audioTrack);

  useEffect(() => {
    const maxRetries = 6;

    function clearSyncTimer() {
      if (!syncTimerRef.current) return;
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }

    function queueRetry() {
      clearSyncTimer();
      if (retriesRef.current >= maxRetries) return;

      const attempt = retriesRef.current + 1;
      retriesRef.current = attempt;
      const waitMs = Math.min(1200, 250 * attempt);
      syncTimerRef.current = setTimeout(() => {
        syncTrack();
      }, waitMs);
    }

    function syncTrack() {
      const publications = Array.from(room.localParticipant.trackPublications.values());
      const micPublication = publications.find((publication) => publication.source === Track.Source.Microphone && publication.track);
      const localTrack = micPublication?.track as { mediaStreamTrack?: MediaStreamTrack } | undefined;
      const nextTrack = localTrack?.mediaStreamTrack || null;

      if (!nextTrack) {
        setAudioTrack(null);
        queueRetry();
        return;
      }

      retriesRef.current = 0;
      clearSyncTimer();
      setAudioTrack(nextTrack);
    }

    retriesRef.current = 0;
    syncTrack();
    room.on(RoomEvent.LocalTrackPublished, syncTrack);
    room.on(RoomEvent.LocalTrackUnpublished, syncTrack);
    room.on(RoomEvent.TrackMuted, syncTrack);
    room.on(RoomEvent.TrackUnmuted, syncTrack);

    return () => {
      clearSyncTimer();
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

function RoomBridge({ onRoom }: { onRoom: (room: Room | null) => void }) {
  const room = useRoomContext();

  useEffect(() => {
    onRoom(room);
    return () => onRoom(null);
  }, [onRoom, room]);

  return null;
}

export function MeetingRoom({ roomName, participantName, canEndMeeting = false, onMeetingEnded }: MeetingRoomProps) {
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [saveTranscriptBusy, setSaveTranscriptBusy] = useState(false);
  const [transcriptSaveMessage, setTranscriptSaveMessage] = useState("");
  const [summaryText, setSummaryText] = useState("");
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [needsAudioResume, setNeedsAudioResume] = useState(false);
  const [micPermissionHint, setMicPermissionHint] = useState("");
  const [participantIdentity, setParticipantIdentity] = useState("");
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"participants" | "transcript" | "chat">("participants");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedShareLink, setCopiedShareLink] = useState(false);
  const leftReportedRef = useRef(false);
  const activeRoomRef = useRef<Room | null>(null);
  const roomContainerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    function syncFullscreen() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const transcriptPreview = useMemo(() => transcript.trim() || "Waiting for transcript...", [transcript]);
  const meetingSummaryPreview = useMemo(() => summaryText.trim() || "Overall summary will appear after transcript is saved.", [summaryText]);
  const hasTranscript = useMemo(() => Boolean(transcript.trim()), [transcript]);
  const roomOptions = useMemo(
    () => ({
      autoSubscribe: true,
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      audioOutput: {
        deviceId: "default",
      },
      stopLocalTrackOnUnpublish: false,
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function inspectMicPermission() {
      if (!navigator.permissions?.query) return;

      try {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (cancelled) return;
        if (status.state === "denied") {
          setMicPermissionHint("Microphone permission is denied. Enable mic access in your browser site settings.");
        } else {
          setMicPermissionHint("");
        }
      } catch {
        if (!cancelled) setMicPermissionHint("");
      }
    }

    void inspectMicPermission();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const target = roomContainerRef.current;
    if (!target) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => null);
      return;
    }

    await target.requestFullscreen().catch(() => null);
  }, []);

  const copyShareLink = useCallback(async () => {
    const url = `${window.location.origin}/meetings/live/${encodeURIComponent(roomName)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShareLink(true);
      window.setTimeout(() => setCopiedShareLink(false), 1800);
    } catch {
      setCopiedShareLink(false);
    }
  }, [roomName]);

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

  useEffect(() => {
    if (!activeRoom) return;

    activeRoomRef.current = activeRoom;
    const identity = String(activeRoom.localParticipant?.identity || participantIdentity || "").trim();
    void reportJoin(identity);

    return () => {
      activeRoomRef.current = null;
    };
  }, [activeRoom, participantIdentity, reportJoin]);

  useEffect(() => {
    if (!activeRoom) return;

    let cancelled = false;
    const ensureAudioPlayback = async () => {
      try {
        await activeRoom.localParticipant.setMicrophoneEnabled(true).catch(() => null);
        await activeRoom.startAudio();
        if (!cancelled) setNeedsAudioResume(false);
      } catch {
        if (!cancelled) setNeedsAudioResume(true);
      }
    };

    void ensureAudioPlayback();
    return () => {
      cancelled = true;
    };
  }, [activeRoom]);

  // Auto-save transcript every 30 seconds while meeting is active
  useEffect(() => {
    if (!transcript.trim() || !activeRoom) return;

    const intervalId = setInterval(() => {
      console.log("[Auto-Save] Persisting transcript to backend...");
      fetch("/api/meetings/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, transcript: transcript.trim() }),
      }).catch((err) => {
        console.warn("[Auto-Save] Failed to persist:", err instanceof Error ? err.message : String(err));
      });
    }, 30000); // Every 30 seconds

    return () => clearInterval(intervalId);
  }, [roomName, transcript, activeRoom]);

  const saveFullTranscript = useCallback(
    async (allowEmpty: boolean) => {
      setSaveTranscriptBusy(true);
      setTranscriptSaveMessage("");

      const transcriptToSave = String(transcript || "").trim();
      if (!transcriptToSave && !allowEmpty) {
        setSaveTranscriptBusy(false);
        setTranscriptSaveMessage("No transcript text captured yet. Keep speaking and try again.");
        return { summary: "", warning: "No transcript text captured yet.", transcript: "" };
      }

      try {
        const transcriptResp = await fetch("/api/meetings/transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName, transcript: transcriptToSave }),
        });
        const transcriptPayload = (await transcriptResp.json().catch(() => null)) as TranscriptResponse | null;
        if (!transcriptResp.ok) {
          const warning = String(transcriptPayload?.detail || transcriptPayload?.error || "Failed to save transcript");
          setTranscriptSaveMessage(warning);
          return { summary: "", warning, transcript: transcriptToSave };
        }

        const summary = String(transcriptPayload?.summary || "").trim();
        if (summary) setSummaryText(summary);
        const captured = transcriptPayload?.captured !== false;
        const groqUsed = transcriptPayload?.groqUsed === true;
        const summaryEngine = String(transcriptPayload?.summaryEngine || "").trim();
        if (captured && groqUsed) {
          setTranscriptSaveMessage("Full transcript saved and summarized by Groq.");
        } else if (captured && summaryEngine === "fallback-groq-error") {
          setTranscriptSaveMessage("Transcript saved, but Groq summary failed so fallback summary was used.");
        } else if (captured) {
          setTranscriptSaveMessage("Full transcript saved.");
        } else {
          setTranscriptSaveMessage("Transcript save request succeeded, but no converted text was captured yet.");
        }
        return { summary, warning: "", transcript: transcriptToSave };
      } catch {
        const warning = "Failed to save transcript";
        setTranscriptSaveMessage(warning);
        return { summary: "", warning, transcript: transcriptToSave };
      } finally {
        setSaveTranscriptBusy(false);
      }
    },
    [roomName, transcript]
  );

  const endMeeting = useCallback(async () => {
    if (!canEndMeeting) {
      setError("Only organization admins can end meetings");
      return;
    }

    setEnding(true);
    setError("");

    try {
      let summaryFromSave = "";
      let transcriptWarning = "";
      // Auto-save transcript on meeting end
      const saveResult = await saveFullTranscript(true);
      summaryFromSave = saveResult.summary;
      transcriptWarning = saveResult.warning;

      const endResp = await fetch("/api/meetings/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName }),
      });

      const endPayload = (await endResp.json().catch(() => null)) as EndMeetingResponse | null;
      if (!endResp.ok) {
        throw new Error(String(endPayload?.detail || endPayload?.error || "Failed to end meeting"));
      }

      if (!summaryFromSave) {
        summaryFromSave = String(endPayload?.item?.summary || "").trim();
      }
      const personalSummary = String(endPayload?.item?.mySummary || "").trim();

      if (activeRoom) {
        activeRoom.disconnect();
      }

      await reportLeave();

      if (onMeetingEnded) {
        onMeetingEnded({
          summary: summaryFromSave,
          transcript: saveResult.transcript,
          individualSummary: personalSummary || undefined,
        });
      }

      window.location.assign("/meetings");

      if (transcriptWarning) {
        setError(`Meeting ended. ${transcriptWarning}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end meeting");
    } finally {
      setEnding(false);
    }
  }, [activeRoom, canEndMeeting, onMeetingEnded, reportLeave, roomName, saveFullTranscript]);

  const resumeAudioPlayback = useCallback(async () => {
    if (!activeRoom) return;
    try {
      await activeRoom.startAudio();
      setNeedsAudioResume(false);
    } catch {
      setNeedsAudioResume(true);
    }
  }, [activeRoom]);

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
    <div
      ref={roomContainerRef}
      className={isFullscreen ? "h-screen w-screen overflow-hidden rounded-none bg-black p-2" : "h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-2 backdrop-blur-sm"}
    >
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        options={roomOptions}
        connect
        video
        audio
        onDisconnected={() => {
          activeRoomRef.current = null;
          setActiveRoom(null);
          void reportLeave();
        }}
        className="flex h-full min-h-0 flex-col gap-2"
        data-lk-theme="default"
      >
        <div className="flex items-center justify-between rounded-xl border border-white/15 bg-black/45 px-3 py-2">
          <div>
            <p className="text-xs font-semibold text-white">Meeting ID</p>
            <p className="text-xs text-slate-300">{roomName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copyShareLink()}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 text-xs text-white transition hover:bg-white/20"
            >
              {copiedShareLink ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedShareLink ? "Link copied" : "Share link"}
            </button>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-white/20 bg-white/10 px-3 text-xs text-white transition hover:bg-white/20"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {isFullscreen ? "Exit full screen" : "Full screen"}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-h-0 overflow-hidden rounded-xl border border-white/15 bg-black">
            <div className="h-full w-full">
              <VideoConference />
            </div>
            <RoomAudioRenderer />
            <RoomBridge onRoom={setActiveRoom} />
            <TranscriptionBridge onTranscript={setTranscript} onTranscribing={setIsTranscribing} />
          </div>

          <aside className="flex min-h-0 flex-col rounded-xl border border-white/15 bg-black/45 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarTab("participants")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    sidebarTab === "participants"
                      ? "border border-sky-400/40 bg-sky-500/25 text-sky-100"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Participants
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab("transcript")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    sidebarTab === "transcript"
                      ? "border border-sky-400/40 bg-sky-500/25 text-sky-100"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  Transcript
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab("chat")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    sidebarTab === "chat"
                      ? "border border-sky-400/40 bg-sky-500/25 text-sky-100"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Chat
                  </span>
                </button>
              </div>
              {canEndMeeting ? (
                <button
                  type="button"
                  onClick={() => void endMeeting()}
                  disabled={ending}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-400/50 bg-rose-500/25 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/35 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
                  End Meeting
                </button>
              ) : null}
            </div>

            {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
            {micPermissionHint ? <p className="mb-2 text-xs text-amber-300">{micPermissionHint}</p> : null}
            {needsAudioResume ? (
              <button
                type="button"
                onClick={() => void resumeAudioPlayback()}
                className="mb-2 inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-xs text-amber-100"
              >
                <Volume2 className="h-3.5 w-3.5" />
                Click to enable meeting audio
              </button>
            ) : null}

            {sidebarTab === "participants" ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <ParticipantList />
              </div>
            ) : null}

            {sidebarTab === "transcript" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 space-y-1">
                  <div className={`text-xs font-medium px-2 py-1 rounded ${isTranscribing ? "border border-green-500/40 bg-green-500/10 text-green-200" : "border border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                    {isTranscribing ? "🟢 Deepgram connected" : "🟡 Connecting to Deepgram..."}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {isTranscribing ? "Audio is being transcribed in real-time" : "Waiting for microphone track to publish..."}
                  </div>
                </div>
                <div className="mb-2 rounded-md border border-white/15 bg-black/35 p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Overall Summary</p>
                  </div>
                  <div className="max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-100">
                    {meetingSummaryPreview}
                  </div>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveFullTranscript(false)}
                    disabled={saveTranscriptBusy || !hasTranscript}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2.5 py-1 text-xs text-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveTranscriptBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save Full Transcript
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFullTranscript((prev) => !prev)}
                    className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-xs text-white"
                  >
                    {showFullTranscript ? "Hide transcript" : "Show transcript"}
                  </button>
                  <span className="text-[11px] text-slate-400">
                    {hasTranscript ? `${transcript.length} chars` : "No text captured"}
                  </span>
                </div>
                {transcriptSaveMessage ? <p className="mb-2 text-xs text-slate-300">{transcriptSaveMessage}</p> : null}
                <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-white/15 bg-black/40 p-3 text-xs leading-relaxed text-slate-100">
                  {showFullTranscript ? transcriptPreview : "Full transcript is hidden. Click Show transcript to view all converted text."}
                </div>
              </div>
            ) : null}

            {sidebarTab === "chat" ? (
              <div className="min-h-0 flex-1">
                <MeetingChatPanel roomName={roomName} participantName={participantName} />
              </div>
            ) : null}
          </aside>
        </div>
      </LiveKitRoom>
    </div>
  );
}
