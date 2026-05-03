"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ id: string; source_id: string; source_type: string; similarity: number; metadata: Record<string, unknown> }>;
};

type ConversationRow = {
  id: string;
  user_message?: string | null;
  ai_response?: string | null;
  created_at?: string | null;
};

type RagChatResponse = {
  ok?: boolean;
  answer?: string;
  chunks_retrieved?: number;
  sources?: Array<{ id: string; source_id: string; source_type: string; similarity: number; metadata: Record<string, unknown> }>;
  error?: string;
  detail?: string;
};

function historyToMessages(rows: ConversationRow[]): ChatMessage[] {
  return rows
    .slice()
    .reverse()
    .flatMap((row) => [
      ...(row.user_message ? [{ role: "user" as const, content: row.user_message }] : []),
      ...(row.ai_response ? [{ role: "assistant" as const, content: row.ai_response }] : []),
    ]);
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function Avatar({ label, user }: { label: string; user?: boolean }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: 8,
        background: user ? "var(--nx-surface)" : "linear-gradient(135deg, #1a56db 0%, #0e3a9e 100%)",
        border: user ? "1px solid var(--nx-border)" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        color: user ? "var(--nx-muted)" : "#fff",
        letterSpacing: "0.04em",
        boxShadow: user ? "none" : "0 2px 8px rgba(26,86,219,0.35)",
      }}
    >
      {label}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexDirection: isUser ? "row-reverse" : "row" }}>
      <Avatar label={isUser ? "U" : "GN"} user={isUser} />
      <div
        style={{
          maxWidth: "min(700px, 84%)",
          padding: "10px 14px",
          fontSize: 13,
          lineHeight: 1.65,
          color: isUser ? "#e6f0ff" : "#e6eef7",
          background: isUser ? "linear-gradient(180deg,#163a6b,#0f2a55)" : "rgba(255,255,255,0.02)",
          border: isUser ? "1px solid rgba(255,255,255,0.03)" : "1px solid rgba(255,255,255,0.02)",
          borderRadius: isUser ? "16px 6px 16px 16px" : "6px 16px 16px 16px",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {message.content}
        {message.sources?.length ? (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "var(--nx-text-2)" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Sources</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {message.sources.slice(0, 5).map((source) => (
                <div key={source.id} style={{ overflowWrap: "anywhere" }}>
                  {safeText(source.metadata?.file_path) || source.source_id} · {Math.round(source.similarity * 100)}%
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      <Avatar label="GN" />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 14px",
          background: "var(--nx-surface)",
          border: "1px solid var(--nx-border)",
          borderRadius: "4px 14px 14px 14px",
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              display: "block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--nx-muted)",
              animation: "nx-dot 1.2s ease-in-out infinite",
              animationDelay: `${index * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: "24px 0 8px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--nx-text)", margin: 0, lineHeight: 1.3 }}>GitNexus</p>
        <p style={{ fontSize: 11, color: "var(--nx-muted)", margin: 0, lineHeight: 1.3 }}>RAG chat</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--nx-muted)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>
          Try asking
        </p>
        {[
          "Where is the GitNexus graph page?",
          "Summarize the repository structure",
          "Which files look most important?",
        ].map((prompt) => (
          <div
            key={prompt}
            style={{
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--nx-text-2)",
              background: "var(--nx-surface)",
              border: "1px solid var(--nx-border)",
              borderRadius: 8,
              lineHeight: 1.4,
            }}
          >
            {prompt}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GitNexusRagChatBox({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (!projectId.trim()) {
      setMessages([]);
      return;
    }

    const controller = new AbortController();
    setLoadingHistory(true);
    setError(null);

    fetch(`/api/ai/history?projectId=${encodeURIComponent(projectId.trim())}&limit=12`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { items?: ConversationRow[]; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || `Failed to load chat history (${response.status})`);
        setMessages(historyToMessages(Array.isArray(payload?.items) ? payload.items : []));
      })
      .catch((caught) => {
        if ((caught as { name?: string }).name !== "AbortError") {
          setError(caught instanceof Error ? caught.message : "Failed to load chat history.");
        }
      })
      .finally(() => setLoadingHistory(false));

    return () => controller.abort();
  }, [projectId]);

  async function sendMessage() {
    const question = draft.trim();
    if (!projectId.trim() || !question || sending) return;

    const nextMessages = [...messages, { role: "user" as const, content: question }];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId.trim(),
          message: question,
          stream: false,
        }),
      });

      const payload = (await response.json().catch(() => null)) as RagChatResponse | null;
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || `Chat request failed (${response.status})`);
      }

      const answer = safeText(payload?.answer) || "No reply returned.";
      setMessages((current) => [...current, { role: "assistant", content: answer, sources: payload?.sources }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to send chat message.");
      setMessages(nextMessages.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  const canSend = !!projectId.trim() && !!draft.trim() && !sending;
  const isEmpty = !loadingHistory && messages.length === 0;

  return (
    <>
      <style>{`
        .gitnexus-chat {
          --nx-bg: #000000;
          --nx-surface: #050505;
          --nx-surface-hover: #0b0b0b;
          --nx-border: rgba(255,255,255,0.1);
          --nx-border-strong: rgba(255,255,255,0.14);
          --nx-text: #e4e8ef;
          --nx-text-2: #a0aab8;
          --nx-muted: #5a6478;
          --nx-accent: #1a56db;
          --nx-danger: rgba(239,68,68,0.85);
          --nx-danger-bg: rgba(239,68,68,0.08);
          --nx-danger-border: rgba(239,68,68,0.2);
          font-family: "DM Sans", "IBM Plex Sans", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        @keyframes nx-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>

      <div
        className="gitnexus-chat"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          background: "#000000",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 18px 60px rgba(2,6,23,0.7)",
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 16px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {isEmpty ? <EmptyState /> : null}
          {messages.map((message, index) => (
            <MessageBubble key={`${message.role}-${index}`} message={message} />
          ))}
          {sending ? <ThinkingBubble /> : null}
          <div ref={bottomRef} style={{ height: 1 }} />
        </div>

        {error ? (
          <div
            style={{
              flexShrink: 0,
              margin: "0 12px 8px",
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid var(--nx-danger-border)",
              background: "var(--nx-danger-bg)",
              color: "var(--nx-danger)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ flexShrink: 0, padding: 12, borderTop: "1px solid rgba(255,255,255,0.02)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.03)",
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={projectId.trim() ? "Ask about architecture, risks, or ownership..." : "Select a project first"}
              disabled={!projectId.trim() || sending}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--nx-text)",
                fontSize: 14,
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (canSend) void sendMessage();
              }}
              disabled={!canSend}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                background: "linear-gradient(180deg,#2e6bd8,#1849b0)",
                border: "none",
                color: "#fff",
                borderRadius: 999,
                cursor: canSend ? "pointer" : "not-allowed",
                opacity: canSend ? 1 : 0.5,
              }}
              aria-label="send"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
