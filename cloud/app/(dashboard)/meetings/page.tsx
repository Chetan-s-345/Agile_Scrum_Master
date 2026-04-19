"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, FileText, Loader2, NotebookPen, PlayCircle, RefreshCw, Sparkles, Trash2, Upload, Users } from "lucide-react";

type MeetingType = "daily" | "weekly" | "retrospective" | "business";
type MeetingStatus = "scheduled" | "in_progress" | "completed" | "archived";
type FilterValue = "all" | MeetingStatus;

type MeetingItem = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  videoProvider?: string;
  providerMeetingId?: string | null;
  joinUrl?: string | null;
  description?: string | null;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  sprintName?: string | null;
  attendeeCount?: number;
  noteCount?: number;
};

type MeetingNote = {
  id: string;
  content: string;
  createdAt: string;
  authorName?: string | null;
  isAiGenerated: boolean;
};

type MeetingActionItem = {
  id: string;
  title: string;
  status: string;
  source?: string;
};

type MeetingTranscript = {
  id: string;
  sourceType: string;
  fileName?: string | null;
  mimeType?: string | null;
  transcriptText: string;
  language?: string | null;
  status: string;
  createdAt: string;
};

type MeetingAttendee = {
  developerId: string;
  name: string;
  attendanceStatus: string;
};

type MeetingDetail = MeetingItem & {
  aiSummary?: string | null;
  aiDecisions?: string | null;
  aiRisks?: string | null;
  aiActionItems?: MeetingActionItem[];
  notes?: MeetingNote[];
  attendees?: MeetingAttendee[];
};

type CreateProvisioningWarning = {
  code?: string;
  detail?: string;
  hint?: string | null;
};

type DeveloperItem = {
  id: string;
  fullName: string;
  role?: string | null;
  availabilityStatus?: string | null;
};

type MeetingsListResponse = { items?: MeetingItem[]; error?: string };
type MeetingDetailResponse = {
  item?: MeetingDetail & { provisioningWarning?: CreateProvisioningWarning };
  error?: string;
};
type DevelopersResponse = { items?: DeveloperItem[]; error?: string };
type MeetingTranscriptsResponse = { items?: MeetingTranscript[]; error?: string };
type ApiErrorPayload = { error?: string; detail?: string; hint?: string; code?: string | number };

const MEETING_TYPES: Array<{ id: MeetingType; label: string; route: string }> = [
  { id: "daily", label: "Daily", route: "/meetings/daily" },
  { id: "weekly", label: "Weekly", route: "/meetings/weekly" },
  { id: "retrospective", label: "Retrospective", route: "/meetings/retrospective" },
  { id: "business", label: "Business", route: "/meetings/business" },
];

const STATUS_FILTERS: Array<{ id: FilterValue; label: string }> = [
  { id: "all", label: "All" },
  { id: "scheduled", label: "Scheduled" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "archived", label: "Archived" },
];

const GOOGLE_MEET_URL_REGEX = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:[/?#].*)?$/i;

function typeFromPath(pathname: string): MeetingType {
  if (pathname.endsWith("/meetings/weekly")) return "weekly";
  if (pathname.endsWith("/meetings/retrospective")) return "retrospective";
  if (pathname.endsWith("/meetings/business")) return "business";
  return "daily";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)
    ? value.replace(" ", "T")
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateTimeInputValue(value?: string | null): string {
  if (!value) return "";
  const localDateTimeMatch = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
  if (localDateTimeMatch) {
    const [, y, m, d, hh, mm] = localDateTimeMatch;
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

  const normalized = String(value);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function normalizeError(payload: unknown, fallback: string): string {
  const maybe = payload as { error?: unknown; detail?: unknown; hint?: unknown } | null;
  if (typeof maybe?.detail === "string" && maybe.detail.trim()) return maybe.detail;
  if (typeof maybe?.hint === "string" && maybe.hint.trim()) return maybe.hint;
  if (typeof maybe?.error === "string" && maybe.error.trim()) return maybe.error;
  return fallback;
}

function isValidGoogleMeetJoinUrl(value: string): boolean {
  return GOOGLE_MEET_URL_REGEX.test(value.trim());
}

function MeetingsPageContent() {
  const router = useRouter();
  const pathname = usePathname();

  const [activeType, setActiveType] = useState<MeetingType>("daily");
  const [statusFilter, setStatusFilter] = useState<FilterValue>("all");

  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [developerLoading, setDeveloperLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingAttendees, setSavingAttendees] = useState(false);
  const [startingMeeting, setStartingMeeting] = useState(false);
  const [savingMeetingMeta, setSavingMeetingMeta] = useState(false);
  const [deletingMeeting, setDeletingMeeting] = useState(false);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [summarizingMeeting, setSummarizingMeeting] = useState(false);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [developers, setDevelopers] = useState<DeveloperItem[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>("");
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingDetail | null>(null);
  const [transcripts, setTranscripts] = useState<MeetingTranscript[]>([]);

  const [newTitle, setNewTitle] = useState("");
  const [newDateTime, setNewDateTime] = useState("");
  const [meetingSearch, setMeetingSearch] = useState("");
  const [developerSearch, setDeveloperSearch] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDateTime, setEditDateTime] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [transcriptFileName, setTranscriptFileName] = useState("");
  const [selectedAttendeeIds, setSelectedAttendeeIds] = useState<string[]>([]);

  const meetingsRequestRef = useRef(0);
  const meetingDetailRequestRef = useRef(0);
  const transcriptsRequestRef = useRef(0);
  const meetingsAbortRef = useRef<AbortController | null>(null);
  const meetingDetailAbortRef = useRef<AbortController | null>(null);
  const transcriptsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setActiveType(typeFromPath(pathname || ""));
  }, [pathname]);

  const refreshMeetings = async (preferId?: string) => {
    const requestId = ++meetingsRequestRef.current;
    meetingsAbortRef.current?.abort();
    const controller = new AbortController();
    meetingsAbortRef.current = controller;

    setListLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("type", activeType);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "100");

      const response = await fetch(`/api/meetings?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      const payload = (await response.json().catch(() => null)) as MeetingsListResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to load meetings"));

      if (requestId !== meetingsRequestRef.current) return;

      const items = Array.isArray(payload?.items) ? payload.items : [];
      setMeetings(items);

      const nextSelected =
        items.find((item) => item.id === (preferId || selectedMeetingId))?.id || items[0]?.id || "";
      setSelectedMeetingId(nextSelected);
    } catch (err) {
      if (controller.signal.aborted || requestId !== meetingsRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load meetings");
      setMeetings([]);
      setSelectedMeetingId("");
      setSelectedMeeting(null);
    } finally {
      if (requestId === meetingsRequestRef.current) {
        setListLoading(false);
      }
    }
  };

  const refreshMeetingDetail = async (meetingId: string) => {
    if (!meetingId) {
      setSelectedMeeting(null);
      setSelectedAttendeeIds([]);
      setDescriptionDraft("");
      setEditTitle("");
      setEditDateTime("");
      return;
    }

    const requestId = ++meetingDetailRequestRef.current;
    meetingDetailAbortRef.current?.abort();
    const controller = new AbortController();
    meetingDetailAbortRef.current = controller;

    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) {
        if (controller.signal.aborted || requestId !== meetingDetailRequestRef.current) return;
        if (response.status === 404) {
          setSelectedMeeting(null);
          setSelectedAttendeeIds([]);
          setDescriptionDraft("");
          setEditTitle("");
          setEditDateTime("");
          return;
        }
        throw new Error(normalizeError(payload, "Failed to load meeting details"));
      }

      if (requestId !== meetingDetailRequestRef.current) return;

      const item = payload?.item || null;
      setSelectedMeeting(item);
      setDescriptionDraft(item?.description || "");
      setSelectedAttendeeIds((item?.attendees || []).map((attendee) => attendee.developerId));
      setEditTitle(item?.title || "");
      setEditDateTime(toDateTimeInputValue(item?.scheduledStart));
    } catch (err) {
      if (controller.signal.aborted || requestId !== meetingDetailRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load meeting details");
      setSelectedMeeting(null);
      setSelectedAttendeeIds([]);
      setDescriptionDraft("");
      setEditTitle("");
      setEditDateTime("");
    } finally {
      if (requestId === meetingDetailRequestRef.current) {
        setDetailLoading(false);
      }
    }
  };

  const refreshDevelopers = async () => {
    setDeveloperLoading(true);
    try {
      const response = await fetch("/api/developers", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as DevelopersResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to load developers"));
      setDevelopers(Array.isArray(payload?.items) ? payload.items : []);
    } catch {
      setDevelopers([]);
    } finally {
      setDeveloperLoading(false);
    }
  };

  const refreshTranscripts = async (meetingId: string) => {
    if (!meetingId) {
      setTranscripts([]);
      return;
    }

    const requestId = ++transcriptsRequestRef.current;
    transcriptsAbortRef.current?.abort();
    const controller = new AbortController();
    transcriptsAbortRef.current = controller;

    setTranscriptsLoading(true);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/transcripts`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as MeetingTranscriptsResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to load transcripts"));
      if (requestId !== transcriptsRequestRef.current) return;
      setTranscripts(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      if (controller.signal.aborted || requestId !== transcriptsRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load transcripts");
      setTranscripts([]);
    } finally {
      if (requestId === transcriptsRequestRef.current) {
        setTranscriptsLoading(false);
      }
    }
  };

  useEffect(() => {
    return () => {
      meetingsAbortRef.current?.abort();
      meetingDetailAbortRef.current?.abort();
      transcriptsAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void refreshDevelopers();
  }, []);

  useEffect(() => {
    void refreshMeetings();
  }, [activeType, statusFilter]);

  useEffect(() => {
    void refreshMeetingDetail(selectedMeetingId);
  }, [selectedMeetingId]);

  useEffect(() => {
    void refreshTranscripts(selectedMeetingId);
  }, [selectedMeetingId]);

  const filteredMeetings = useMemo(() => {
    const q = meetingSearch.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((meeting) => `${meeting.title} ${meeting.sprintName || ""}`.toLowerCase().includes(q));
  }, [meetings, meetingSearch]);

  const filteredDevelopers = useMemo(() => {
    const q = developerSearch.trim().toLowerCase();
    if (!q) return developers;
    return developers.filter((developer) => `${developer.fullName} ${developer.role || ""}`.toLowerCase().includes(q));
  }, [developers, developerSearch]);

  const stats = useMemo(() => {
    return {
      total: meetings.length,
      scheduled: meetings.filter((meeting) => meeting.status === "scheduled").length,
      inProgress: meetings.filter((meeting) => meeting.status === "in_progress").length,
      completed: meetings.filter((meeting) => meeting.status === "completed").length,
    };
  }, [meetings]);

  const createMeeting = async () => {
    if (!newTitle.trim() || !newDateTime) return;

    setCreating(true);
    setError(null);
    setWarning(null);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeType,
          title: newTitle.trim(),
          scheduledStart: newDateTime,
          createJoinUrl: true,
          provider: "google_meet",
        }),
      });

      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to create meeting"));

      const createdId = payload?.item?.id || "";
      const provisioningWarning = payload?.item?.provisioningWarning;
      setNewTitle("");
      setNewDateTime("");
      await refreshMeetings(createdId);

      if (provisioningWarning?.detail) {
        const hint = provisioningWarning?.hint ? ` ${provisioningWarning.hint}` : "";
        setWarning(`Meeting was scheduled, but auto Meet link failed: ${provisioningWarning.detail}${hint}`);
      }
    } catch (err) {
      setWarning(null);
      setError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setCreating(false);
    }
  };

  const updateStatus = async (status: MeetingStatus) => {
    if (!selectedMeetingId) return;

    setSavingStatus(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to update status"));

      const updated = payload?.item || null;
      setSelectedMeeting(updated);
      setMeetings((prev) => prev.map((item) => (item.id === selectedMeetingId ? { ...item, status } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  };

  const saveMeetingMeta = async () => {
    if (!selectedMeetingId || !editTitle.trim() || !editDateTime) return;

    setSavingMeetingMeta(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          scheduledStart: editDateTime,
        }),
      });
      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to update meeting"));

      const updated = payload?.item || null;
      setSelectedMeeting(updated);
      setMeetings((prev) =>
        prev.map((item) =>
          item.id === selectedMeetingId
            ? {
                ...item,
                title: updated?.title || item.title,
                scheduledStart: updated?.scheduledStart || item.scheduledStart,
              }
            : item
        )
      );
      setEditTitle(updated?.title || editTitle.trim());
      setEditDateTime(toDateTimeInputValue(updated?.scheduledStart || editDateTime));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update meeting");
    } finally {
      setSavingMeetingMeta(false);
    }
  };

  const deleteMeeting = async () => {
    if (!selectedMeetingId) return;
    const ok = window.confirm("Delete this meeting? This also removes notes, attendees, transcripts, and action items.");
    if (!ok) return;

    const deletedId = selectedMeetingId;
    setDeletingMeeting(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(deletedId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to delete meeting"));

      setSelectedMeeting(null);
      setSelectedMeetingId("");
      setDescriptionDraft("");
      setEditTitle("");
      setEditDateTime("");
      setSelectedAttendeeIds([]);
      await refreshMeetings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete meeting");
    } finally {
      setDeletingMeeting(false);
    }
  };

  const saveDescription = async (autoGenerate: boolean) => {
    if (!selectedMeetingId) return;

    setSavingDescription(true);
    setError(null);
    try {
      const sourceText = (selectedMeeting?.notes || []).map((note) => note.content).join("\n");
      const body = autoGenerate
        ? { autoGenerate: true, sourceText: `${selectedMeeting?.title || ""}\n${sourceText}` }
        : { description: descriptionDraft };

      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}/description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to save description"));

      const updated = payload?.item || null;
      setSelectedMeeting(updated);
      setDescriptionDraft(updated?.description || "");
      setMeetings((prev) =>
        prev.map((item) => (item.id === selectedMeetingId ? { ...item, description: updated?.description || null } : item))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save description");
    } finally {
      setSavingDescription(false);
    }
  };

  const addNote = async () => {
    if (!selectedMeetingId || !noteDraft.trim()) return;

    setSavingNote(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteDraft.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to add note"));

      setNoteDraft("");
      await refreshMeetingDetail(selectedMeetingId);
      await refreshMeetings(selectedMeetingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setSavingNote(false);
    }
  };

  const toggleAttendee = (developerId: string) => {
    setSelectedAttendeeIds((current) => {
      if (current.includes(developerId)) return current.filter((id) => id !== developerId);
      return [...current, developerId];
    });
  };

  const saveAttendees = async () => {
    if (!selectedMeetingId) return;

    setSavingAttendees(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}/attendees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendeeDeveloperIds: selectedAttendeeIds }),
      });
      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to save attendees"));
      setSelectedMeeting(payload?.item || null);
      await refreshMeetings(selectedMeetingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save attendees");
    } finally {
      setSavingAttendees(false);
    }
  };

  const startMeeting = async () => {
    if (!selectedMeetingId) return;

    setStartingMeeting(true);
    setError(null);
    try {
      const callStartMeeting = async (body: Record<string, unknown>) =>
        fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

      let response = await callStartMeeting({
        provider: "google_meet",
        joinUrl: selectedMeeting?.joinUrl || undefined,
        providerMeetingId: selectedMeeting?.providerMeetingId || undefined,
      });
      let payload = (await response.json().catch(() => null)) as (MeetingDetailResponse & ApiErrorPayload) | null;

      if (!response.ok) {
        const code = String(payload?.code || "").toUpperCase();
        const detail = `${String(payload?.detail || "")} ${String(payload?.error || "")}`.toLowerCase();
        const isGoogleMeetProvisionFailure = code.startsWith("GOOGLE_MEET_");
        const isGatewayTimeout = response.status === 504 || response.status === 502;
        const looksLikeMeetFailure =
          detail.includes("google meet") || detail.includes("join url") || detail.includes("timeout");

        if (isGoogleMeetProvisionFailure || isGatewayTimeout || looksLikeMeetFailure) {
          const manualJoinUrl = window.prompt(
            "Auto Google Meet link failed. Paste a manual Google Meet URL to start this meeting, or Cancel to keep the error."
          );
          if (manualJoinUrl) {
            const candidateUrl = manualJoinUrl.trim();
            if (!isValidGoogleMeetJoinUrl(candidateUrl)) {
              throw new Error("Manual URL must be a valid https://meet.google.com/... link.");
            }
            response = await callStartMeeting({ provider: "google_meet", joinUrl: candidateUrl });
            payload = (await response.json().catch(() => null)) as (MeetingDetailResponse & ApiErrorPayload) | null;
          }
        }
      }

      if (!response.ok) throw new Error(normalizeError(payload, "Failed to start meeting"));

      const updated = payload?.item || null;
      setSelectedMeeting(updated);
      setMeetings((prev) =>
        prev.map((item) =>
          item.id === selectedMeetingId
            ? {
                ...item,
                status: (updated?.status as MeetingStatus) || item.status,
                joinUrl: updated?.joinUrl,
                videoProvider: updated?.videoProvider,
                providerMeetingId: updated?.providerMeetingId,
                actualStart: updated?.actualStart,
              }
            : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start meeting");
    } finally {
      setStartingMeeting(false);
    }
  };

  const onTranscriptFilePicked = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setTranscriptDraft(text);
    setTranscriptFileName(file.name);
  };

  const uploadTranscript = async () => {
    if (!selectedMeetingId || !transcriptDraft.trim()) return;

    setSavingTranscript(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}/transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "manual_upload",
          fileName: transcriptFileName || null,
          mimeType: "text/plain",
          transcriptText: transcriptDraft,
          language: "en",
          speakerSegments: [],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to upload transcript"));

      setTranscriptDraft("");
      setTranscriptFileName("");
      await refreshTranscripts(selectedMeetingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload transcript");
    } finally {
      setSavingTranscript(false);
    }
  };

  const summarizeMeeting = async () => {
    if (!selectedMeetingId) return;

    setSummarizingMeeting(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(selectedMeetingId)}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeNotes: true, updateDescription: true }),
      });
      const payload = (await response.json().catch(() => null)) as MeetingDetailResponse | null;
      if (!response.ok) throw new Error(normalizeError(payload, "Failed to summarize meeting"));

      const updated = payload?.item || null;
      setSelectedMeeting(updated);
      setDescriptionDraft(updated?.description || "");
      setMeetings((prev) =>
        prev.map((item) =>
          item.id === selectedMeetingId
            ? {
                ...item,
                description: updated?.description || null,
              }
            : item
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to summarize meeting");
    } finally {
      setSummarizingMeeting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Meetings</h1>
            <p className="text-sm text-[var(--text-secondary)]">Full working meetings page: lifecycle, notes, AI summary, and attendee assignment.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshMeetings(selectedMeetingId)}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {MEETING_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => {
                setActiveType(type.id);
                router.replace(type.route);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                activeType === type.id
                  ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--text-primary)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                statusFilter === filter.id
                  ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--text-primary)]"
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">Total</p>
          <p className="text-xl font-semibold">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">Scheduled</p>
          <p className="text-xl font-semibold">{stats.scheduled}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">In Progress</p>
          <p className="text-xl font-semibold">{stats.inProgress}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">Completed</p>
          <p className="text-xl font-semibold">{stats.completed}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Create meeting</p>
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Meeting title"
              className="mt-2 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
            />
            <input
              type="datetime-local"
              value={newDateTime}
              onChange={(event) => setNewDateTime(event.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void createMeeting()}
              disabled={creating || !newTitle.trim() || !newDateTime}
              className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[var(--border-strong)] text-sm font-semibold disabled:opacity-60"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              Schedule
            </button>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Meetings</p>
            <input
              value={meetingSearch}
              onChange={(event) => setMeetingSearch(event.target.value)}
              placeholder="Search meeting"
              className="mt-2 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
            />

            <div className="mt-2 space-y-2">
              {listLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="h-14 animate-pulse rounded-md border border-[var(--border)] bg-[var(--bg-card)]" />
                  ))}
                </div>
              ) : filteredMeetings.length ? (
                filteredMeetings.map((meeting) => (
                  <button
                    key={meeting.id}
                    type="button"
                    onClick={() => setSelectedMeetingId(meeting.id)}
                    className={`w-full rounded-md border p-2 text-left ${
                      selectedMeetingId === meeting.id
                        ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10"
                        : "border-[var(--border)] bg-[var(--bg-card)]"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{meeting.title}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{formatDateTime(meeting.scheduledStart)}</p>
                    <p className="text-[11px] uppercase text-[var(--text-secondary)]">{meeting.status.replace("_", " ")}</p>
                  </button>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-3 text-xs text-[var(--text-secondary)]">
                  No meetings found.
                </div>
              )}
            </div>
          </div>
        </aside>

        <section>
          {detailLoading ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-sm text-[var(--text-secondary)]">Loading meeting details...</div>
          ) : !selectedMeeting ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-6 text-sm text-[var(--text-secondary)]">Select a meeting from the left panel.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">{selectedMeeting.title}</h2>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {formatDateTime(selectedMeeting.scheduledStart)} - {selectedMeeting.sprintName || "No sprint linked"}
                    </p>
                  </div>
                  <select
                    value={selectedMeeting.status}
                    disabled={savingStatus}
                    onChange={(event) => void updateStatus(event.target.value as MeetingStatus)}
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
                  >
                    <option value="scheduled">scheduled</option>
                    <option value="in_progress">in progress</option>
                    <option value="completed">completed</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_220px_auto_auto]">
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    placeholder="Meeting title"
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
                  />
                  <input
                    type="datetime-local"
                    value={editDateTime}
                    onChange={(event) => setEditDateTime(event.target.value)}
                    className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void saveMeetingMeta()}
                    disabled={savingMeetingMeta || !editTitle.trim() || !editDateTime}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border-strong)] px-3 text-xs font-semibold disabled:opacity-60"
                  >
                    {savingMeetingMeta ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save + Reschedule"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteMeeting()}
                    disabled={deletingMeeting}
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[#7c3030] bg-[#4a2020] px-3 text-xs font-semibold text-[#ffd7d7] disabled:opacity-60"
                  >
                    {deletingMeeting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void startMeeting()}
                    disabled={startingMeeting}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-xs disabled:opacity-60"
                  >
                    {startingMeeting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                    Start meeting
                  </button>
                  {selectedMeeting.joinUrl ? (
                    <a
                      href={selectedMeeting.joinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      Join link
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--text-secondary)]">No join link yet.</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Description</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void saveDescription(true)}
                        disabled={savingDescription}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs"
                      >
                        {savingDescription ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        AI Assist
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveDescription(false)}
                        disabled={savingDescription}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-xs"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={descriptionDraft}
                    onChange={(event) => setDescriptionDraft(event.target.value)}
                    className="mt-2 min-h-[130px] w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-2 text-sm"
                    placeholder="Write meeting description or click AI Assist."
                  />
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Notes</p>
                  <div className="mt-2 max-h-[180px] space-y-2 overflow-auto pr-1">
                    {(selectedMeeting.notes || []).map((note) => (
                      <div key={note.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-2">
                        <p className="text-sm">{note.content}</p>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {note.authorName || "Member"} - {formatDateTime(note.createdAt)} {note.isAiGenerated ? "- AI" : ""}
                        </p>
                      </div>
                    ))}
                    {!selectedMeeting.notes?.length ? (
                      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-card)] p-2 text-xs text-[var(--text-secondary)]">No notes yet.</div>
                    ) : null}
                  </div>

                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    className="mt-2 min-h-[90px] w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-2 text-sm"
                    placeholder="Add a note"
                  />
                  <button
                    type="button"
                    onClick={() => void addNote()}
                    disabled={savingNote || !noteDraft.trim()}
                    className="mt-2 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-strong)] px-3 text-sm font-semibold disabled:opacity-60"
                  >
                    {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />}
                    Add note
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <Users className="h-4 w-4" />
                    Attendees ({selectedAttendeeIds.length})
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveAttendees()}
                    disabled={savingAttendees || !selectedMeetingId}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-xs disabled:opacity-60"
                  >
                    {savingAttendees ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save attendees
                  </button>
                </div>

                <input
                  value={developerSearch}
                  onChange={(event) => setDeveloperSearch(event.target.value)}
                  placeholder="Search developer"
                  className="mt-2 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm"
                />

                <div className="mt-2 max-h-[180px] space-y-1 overflow-auto pr-1">
                  {developerLoading ? (
                    <p className="text-xs text-[var(--text-secondary)]">Loading developers...</p>
                  ) : filteredDevelopers.length ? (
                    filteredDevelopers.map((developer) => {
                      const checked = selectedAttendeeIds.includes(developer.id);
                      return (
                        <label
                          key={developer.id}
                          className="flex cursor-pointer items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 text-sm"
                        >
                          <span className="truncate pr-2">
                            {developer.fullName}
                            {developer.role ? ` (${developer.role})` : ""}
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAttendee(developer.id)}
                            className="h-4 w-4"
                          />
                        </label>
                      );
                    })
                  ) : (
                    <p className="text-xs text-[var(--text-secondary)]">No developers found.</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Meeting transcript</p>
                  <button
                    type="button"
                    onClick={() => void summarizeMeeting()}
                    disabled={summarizingMeeting}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-xs disabled:opacity-60"
                  >
                    {summarizingMeeting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Generate summary
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] px-2 text-xs">
                    <Upload className="h-3.5 w-3.5" />
                    Import transcript
                    <input
                      type="file"
                      accept=".txt,.md,.vtt,.srt,text/plain"
                      className="hidden"
                      onChange={(event) => void onTranscriptFilePicked(event.target.files?.[0] || null)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void uploadTranscript()}
                    disabled={savingTranscript || !transcriptDraft.trim()}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-xs disabled:opacity-60"
                  >
                    {savingTranscript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Save transcript
                  </button>
                  {transcriptFileName ? <span className="text-xs text-[var(--text-secondary)]">{transcriptFileName}</span> : null}
                </div>

                <textarea
                  value={transcriptDraft}
                  onChange={(event) => setTranscriptDraft(event.target.value)}
                  className="mt-2 min-h-[120px] w-full rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-2 text-sm"
                  placeholder="Paste transcript text here, or import a transcript file."
                />

                <div className="mt-2 max-h-[180px] space-y-2 overflow-auto pr-1">
                  {transcriptsLoading ? (
                    <p className="text-xs text-[var(--text-secondary)]">Loading transcripts...</p>
                  ) : transcripts.length ? (
                    transcripts.map((transcript) => (
                      <div key={transcript.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] p-2">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">
                          {transcript.fileName || "Manual transcript"} - {formatDateTime(transcript.createdAt)}
                        </p>
                        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                          {transcript.transcriptText}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-[var(--text-secondary)]">No transcripts uploaded yet.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">AI Summary</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{selectedMeeting.aiSummary || "No AI summary yet."}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">Decisions</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{selectedMeeting.aiDecisions || "No decisions yet."}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">Risks</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{selectedMeeting.aiRisks || "No risks yet."}</p>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <p className="text-sm font-semibold text-[var(--text-primary)]">AI Action Items</p>
                {(selectedMeeting.aiActionItems || []).length ? (
                  <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
                    {(selectedMeeting.aiActionItems || []).map((item) => (
                      <li key={item.id}>- {item.title}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">No AI action items yet.</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {warning ? <div className="rounded-md border border-[#7a5b1f] bg-[#2f2411] px-3 py-2 text-sm text-[#f3d39b]">{warning}</div> : null}
      {error ? <div className="rounded-md border border-[#5a1f1f] bg-[#2a1616] px-3 py-2 text-sm text-[#f3b6b6]">{error}</div> : null}
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          Loading meetings...
        </div>
      }
    >
      <MeetingsPageContent />
    </Suspense>
  );
}
