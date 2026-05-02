"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NexusAnalysisResult } from "@/types/git-nexus";

// Types

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatMode = "chat" | "graph" | "groq";
type ConversationRow = {
  id: string;
  user_message?: string | null;
  ai_response?: string | null;
  created_at?: string | null;
};
type GraphJsonNode = {
  id: string;
  kind: "root" | "folder" | "file";
  label: string;
  path: string;
  depth: number;
};
type GraphJsonEdge = { from: string; to: string };

// Graph context caps

const MAX_GRAPH_CONTEXT_NODES = 320;
const MAX_GRAPH_CONTEXT_EDGES = 420;
const MAX_GRAPH_CONTEXT_CHARS = 12000;

// Helpers

function historyToMessages(rows: ConversationRow[]): ChatMessage[] {
  return rows
    .slice()
    .reverse()
    .flatMap((row) => [
      ...(row.user_message ? [{ role: "user" as const, content: row.user_message }] : []),
      ...(row.ai_response ? [{ role: "assistant" as const, content: row.ai_response }] : []),
    ]);
}

function parseSseResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed) as { error?: string; detail?: string; message?: string };
    return parsed.detail || parsed.error || parsed.message || "";
  } catch {
    const eventBlock = trimmed.split(/\n\n+/).find((block) => block.startsWith("data: ")) || "";
    const payload = eventBlock.slice(6).trim();
    return payload === "[DONE]" ? "" : payload;
  }
}

function buildGraphContext(result: NexusAnalysisResult | null): string {
  if (!result) return "";

  const structure = result.project_structure || {};
  const allFolders = Array.from(
    new Set(
      [...(structure.all_dirs || []), ...(structure.key_dirs || [])]
        .map((path) => path.replace(/\\/g, "/").replace(/^\.?\//, "").trim())
        .filter(Boolean),
    ),
  );
  const rootFiles = Array.from(
    new Set(
      [...(structure.root_files || []), ...(structure.package_files || [])]
        .map((path) => path.replace(/\\/g, "/").replace(/^\.?\//, "").trim())
        .filter(Boolean),
    ),
  );
  const symbolFiles = Array.from(
    new Set(
      (result.symbol_inventory?.top_files || [])
        .map((entry) => entry.file.replace(/\\/g, "/").replace(/^\.?\//, "").trim())
        .filter(Boolean),
    ),
  );
  const allFiles = Array.from(
    new Set([
      ...rootFiles,
      ...symbolFiles,
      ...((structure.all_files || []) as string[])
        .map((path) => path.replace(/\\/g, "/").replace(/^\.?\//, "").trim())
        .filter(Boolean),
    ]),
  );

  const folderMap = new Map<string, GraphJsonNode>();
  const nodes: GraphJsonNode[] = [
    {
      id: "root",
      kind: "root",
      label: result.repo_meta.url.split("/").pop() || "root",
      path: "/",
      depth: 0,
    },
  ];
  const edges: GraphJsonEdge[] = [];

  const ensureFolder = (folderPath: string): string => {
    const normalized = folderPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
    if (!normalized) return "root";
    if (folderMap.has(normalized)) return folderMap.get(normalized)!.id;
    const parts = normalized.split("/").filter(Boolean);
    const depth = parts.length;
    const id = `folder:${normalized}`;
    folderMap.set(normalized, { id, kind: "folder", label: parts[parts.length - 1] || normalized, path: normalized, depth });
    nodes.push(folderMap.get(normalized)!);
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "root";
    edges.push({ from: parentPath === "root" ? "root" : `folder:${parentPath}`, to: id });
    return id;
  };

  allFolders.forEach((folderPath) => {
    const normalized = folderPath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
    if (!normalized) return;
    const parts = normalized.split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      ensureFolder(parts.slice(0, index).join("/"));
    }
  });

  allFiles.forEach((filePath) => {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
    if (!normalized) return;
    const folderPath = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    const folderId = folderPath ? ensureFolder(folderPath) : "root";
    const fileId = `file:${normalized}`;
    const depth = normalized.split("/").filter(Boolean).length;
    if (!nodes.some((node) => node.id === fileId)) {
      nodes.push({ id: fileId, kind: "file", label: normalized.split("/").pop() || normalized, path: normalized, depth });
      edges.push({ from: folderId, to: fileId });
    }
  });

  const limitedNodes = nodes.slice(0, MAX_GRAPH_CONTEXT_NODES);
  const allowedNodeIds = new Set(limitedNodes.map((node) => node.id));
  const limitedEdges = edges
    .filter((edge) => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to))
    .slice(0, MAX_GRAPH_CONTEXT_EDGES);

  const payload = JSON.stringify({
    nodes: limitedNodes,
    edges: limitedEdges,
    truncated: nodes.length > limitedNodes.length || edges.length > limitedEdges.length,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      includedNodes: limitedNodes.length,
      includedEdges: limitedEdges.length,
    },
  }, null, 2);

  return payload.length <= MAX_GRAPH_CONTEXT_CHARS
    ? payload
    : `${payload.slice(0, MAX_GRAPH_CONTEXT_CHARS)}\n... [graph context truncated]`;
}
function AIAvatar() {
  return (
    <div
      style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: 8,
        background: "linear-gradient(135deg, #1a56db 0%, #0e3a9e 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 700,
        color: "#fff",
        letterSpacing: "0.04em",
        boxShadow: "0 2px 8px rgba(26,86,219,0.35)",
      }}
    >
      GN
    </div>
  );
}

function UserAvatar() {
  return (
    <div
      style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: 8,
        background: "var(--nx-surface)",
        border: "1px solid var(--nx-border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 600,
        color: "var(--nx-muted)",
      }}
    >
      U
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        flexDirection: isUser ? "row-reverse" : "row",
        animation: "nx-fadein 0.18s ease-out both",
      }}
    >
      {isUser ? <UserAvatar /> : <AIAvatar />}

      <div
        style={{
          maxWidth: 'min(640px, 84%)',
          padding: '10px 14px',
          fontSize: 13,
          lineHeight: 1.65,
          color: isUser ? '#e6f0ff' : '#e6eef7',
          background: isUser ? 'linear-gradient(180deg,#163a6b,#0f2a55)' : 'rgba(255,255,255,0.02)',
          border: isUser ? '1px solid rgba(255,255,255,0.03)' : '1px solid rgba(255,255,255,0.02)',
          borderRadius: isUser ? '16px 6px 16px 16px' : '6px 16px 16px 16px',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      <AIAvatar />
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
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              display: "block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--nx-muted)",
              animation: "nx-dot 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ mode }: { mode: ChatMode }) {
  const prompts: Record<ChatMode, string[]> = {
    chat: ["Summarize this repository", "Find potential security risks", "Who owns the auth module?"],
    graph: ["List all top-level directories", "Which files are at the root?", "Show me the folder depth"],
    groq: ["Reason over the project structure", "Identify bottlenecks", "Suggest refactoring targets"],
  };

  return (
    <div style={{ padding: "24px 0 8px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "linear-gradient(135deg, #1a56db 0%, #0e3a9e 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(26,86,219,0.3)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </div>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--nx-text)", margin: 0, lineHeight: 1.3 }}>GitNexus</p>
          <p style={{ fontSize: 11, color: "var(--nx-muted)", margin: 0, lineHeight: 1.3 }}>{MODE_META[mode].label} mode | Ready</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--nx-muted)", textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>
          Try asking
        </p>
        {prompts[mode].map((prompt) => (
          <div
            key={prompt}
            style={{
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--nx-text-2)",
              background: "var(--nx-surface)",
              border: "1px solid var(--nx-border)",
              borderRadius: 8,
              cursor: "default",
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

export function GitNexusChatBox({
  projectId,
  analysisResult,
}: {
  projectId: string;
  analysisResult: NexusAnalysisResult | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>("chat");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, sending]);

  // draft change does not require explicit resize for the compact input
  useEffect(() => {}, [draft]);

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
      .then(async (resp) => {
        const payload = (await resp.json().catch(() => null)) as { items?: ConversationRow[]; error?: string } | null;
        if (!resp.ok) throw new Error(payload?.error || `Failed to load chat history (${resp.status})`);
        setMessages(historyToMessages(Array.isArray(payload?.items) ? payload.items : []));
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Failed to load chat history.");
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
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId.trim(),
          message: question,
          mode,
          history: nextMessages.slice(-10),
          graphContext: mode === "graph" ? graphContext : undefined,
        }),
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error(parseSseResponse(text) || `Chat request failed (${resp.status})`);

      const reply = parseSseResponse(text) || "No reply returned.";
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send chat message.");
      setMessages(nextMessages.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  const graphContext = useMemo(() => buildGraphContext(analysisResult), [analysisResult]);
  const isEmpty = !loadingHistory && messages.length === 0;
  const canSend = !!projectId.trim() && !!draft.trim() && !sending;

  return (
    <>
      <style>{`
        .gitnexus-chat {
          --nx-bg: #0c1017;
          --nx-surface: #141922;
          --nx-surface-hover: #1a2130;
          --nx-border: rgba(255,255,255,0.07);
          --nx-border-strong: rgba(255,255,255,0.12);
          --nx-text: #e4e8ef;
          --nx-text-2: #a0aab8;
          --nx-muted: #5a6478;
          --nx-accent: #1a56db;
          --nx-user-bubble: rgba(26,86,219,0.1);
          --nx-user-border: rgba(26,86,219,0.22);
          --nx-danger: rgba(239,68,68,0.85);
          --nx-danger-bg: rgba(239,68,68,0.08);
          --nx-danger-border: rgba(239,68,68,0.2);
          font-family: "DM Sans", "IBM Plex Sans", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        @keyframes nx-spin { to { transform: rotate(360deg); } }
        @keyframes nx-fadein { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes nx-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-4px); opacity: 1; }
        }

        .nx-scrollbar::-webkit-scrollbar { width: 3px; }
        .nx-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .nx-scrollbar::-webkit-scrollbar-thumb { background: var(--nx-border-strong); border-radius: 99px; }

        .nx-tab-btn {
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 500;
          border-radius: 6px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: all 0.14s ease;
          letter-spacing: 0.01em;
          font-family: inherit;
        }
        .nx-tab-btn:not(.nx-tab-active) {
          background: transparent;
          color: var(--nx-muted);
          border-color: transparent;
        }
        .nx-tab-btn:not(.nx-tab-active):hover {
          color: var(--nx-text-2);
          background: var(--nx-surface-hover);
        }
        .nx-tab-btn.nx-tab-active {
          background: var(--nx-surface-hover);
          color: var(--nx-text);
          border-color: var(--nx-border-strong);
        }

        .nx-send-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 7px 16px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          transition: all 0.14s ease;
          font-family: inherit;
          flex-shrink: 0;
        }
        .nx-send-btn:not(:disabled) {
          background: var(--nx-accent);
          color: #fff;
        }
        .nx-send-btn:not(:disabled):hover {
          background: #1649c5;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(26,86,219,0.4);
        }
        .nx-send-btn:not(:disabled):active {
          transform: translateY(0);
          box-shadow: none;
        }
        .nx-send-btn:disabled {
          background: var(--nx-surface-hover);
          color: var(--nx-muted);
          cursor: not-allowed;
          border: 1px solid var(--nx-border);
        }

        .nx-textarea {
          width: 100%;
          resize: none;
          background: transparent;
          border: none;
          outline: none;
          font-size: 13px;
          line-height: 1.6;
          color: var(--nx-text);
          font-family: inherit;
          min-height: 22px;
          max-height: 180px;
        }
        .nx-textarea::placeholder { color: var(--nx-muted); }
        .nx-textarea:disabled { cursor: not-allowed; opacity: 0.5; }
      `}</style>

      <div
        className="gitnexus-chat"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          background: "linear-gradient(180deg,#0a0c0f 0%, #071017 100%)",
          border: "1px solid rgba(255,255,255,0.03)",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 18px 60px rgba(2,6,23,0.7)",
        }}
      >
        <div style={{ padding: '12px 14px 6px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['chat', 'graph', 'groq'] as ChatMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={`nx-tab-btn${mode === item ? ' nx-tab-active' : ''}`}
                  style={ mode === item ? { background: 'rgba(20,40,80,0.28)', color: 'var(--nx-text)', borderColor: 'rgba(255,255,255,0.04)' } : {} }
                >
                  {MODE_META[item].label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {loadingHistory ? <Spinner /> : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: sending ? '#f59e0b' : '#22c55e', fontWeight: 500 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: sending ? '#f59e0b' : '#22c55e', boxShadow: sending ? '0 0 6px #f59e0b' : '0 0 6px rgba(34,197,94,0.6)' }} />
                  {sending ? 'Responding' : 'Ready'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className="nx-scrollbar"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {isEmpty && <EmptyState mode={mode} />}

          {messages.map((msg, index) => (
            <MessageBubble key={`${msg.role}-${index}`} msg={msg} />
          ))}

          {sending && <ThinkingBubble />}

          <div ref={bottomRef} style={{ height: 1 }} />
        </div>

        {error && (
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
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm7.5-3.5a.5.5 0 0 1 1 0v4a.5.5 0 0 1-1 0v-4Zm.5 6.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
            </svg>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                opacity: 0.6,
                padding: 0,
                lineHeight: 1,
                fontSize: 14,
              }}
            >
              x
            </button>
          </div>
        )}

        <div style={{ flexShrink: 0, padding: '12px', borderTop: '1px solid rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div
                onClick={() => textareaRef.current?.focus()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.03)',
                  cursor: 'text',
                }}
              >
                <button style={{ background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 18 }}>+</button>
                <input
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={MODE_META[mode].placeholder}
                  disabled={!projectId.trim() || sending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--nx-text)',
                    fontSize: 14,
                  }}
                />
                <button
                  onClick={() => { if (canSend) void sendMessage(); }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 36,
                    height: 36,
                    background: 'linear-gradient(180deg,#2e6bd8,#1849b0)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 999,
                    cursor: canSend ? 'pointer' : 'not-allowed',
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

            {/* send button moved into pill */}
          </div>
        </div>
      </div>
    </>
  );
}

// Mode metadata and small UI helpers
const MODE_META: Record<ChatMode, { label: string; placeholder: string; hint: string }> = {
  chat: { label: 'Chat', placeholder: 'Ask about architecture, risks, or ownership...', hint: 'Enter to send | Shift+Enter for newline' },
  graph: { label: 'Graph JSON', placeholder: 'Ask about the folder or file graph...', hint: 'Graph JSON is attached automatically' },
  groq: { label: 'Groq', placeholder: 'Ask Groq to reason over the project...', hint: 'Uses Groq inference backend' },
};

function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'nx-spin 0.7s linear infinite', opacity: 0.5 }} />
  );
}