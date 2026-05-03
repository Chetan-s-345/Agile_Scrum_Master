"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import type { MeetingRoomMessage } from "@/components/meetings/types";

type ChatMessagesResponse = {
  items?: MeetingRoomMessage[];
  error?: string;
  detail?: string;
};

type ChatMessageResponse = {
  item?: MeetingRoomMessage;
  error?: string;
  detail?: string;
};

type MeetingChatPanelProps = {
  roomName: string;
  participantName: string;
};

function formatChatTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function MeetingChatPanel({ roomName, participantName }: MeetingChatPanelProps) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<MeetingRoomMessage[]>([]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`/api/meetings/chat?roomName=${encodeURIComponent(roomName)}&limit=300`, {
        cache: "no-store",
      });
      const payload = (await resp.json().catch(() => null)) as ChatMessagesResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to load chat"));
      }

      const items = Array.isArray(payload?.items) ? payload.items : [];
      setMessages(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat");
    } finally {
      setLoading(false);
    }
  }, [roomName]);

  useEffect(() => {
    void loadMessages();
    const timer = window.setInterval(() => {
      void loadMessages();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  const sendMessage = useCallback(async () => {
    const message = draft.trim();
    if (!message) return;

    setSending(true);
    setError("");
    try {
      const resp = await fetch("/api/meetings/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, message, participantName }),
      });
      const payload = (await resp.json().catch(() => null)) as ChatMessageResponse | null;
      if (!resp.ok) {
        throw new Error(String(payload?.detail || payload?.error || "Failed to send message"));
      }

      if (payload?.item) {
        setMessages((current) => [...current, payload.item as MeetingRoomMessage]);
      }
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [draft, participantName, roomName]);

  const renderedMessages = useMemo(() => messages, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-[var(--border)] bg-[var(--bg-secondary)]">
      <div className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)]">
        Team Chat
      </div>

      <div className="flex-1 space-y-2 overflow-auto p-3">
        {!renderedMessages.length && !loading ? (
          <p className="text-xs text-[var(--text-muted)]">No messages yet. Start the conversation.</p>
        ) : null}

        {renderedMessages.map((item) => (
          <div key={item.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--text-primary)]">{item.participantName}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{formatChatTime(item.createdAt)}</p>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text-primary)]">{item.message}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] p-2">
        {error ? <p className="mb-1 text-xs text-red-400">{error}</p> : null}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Send a message"
            className="h-9 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-xs text-[var(--text-primary)]"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={sending || !draft.trim()}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
