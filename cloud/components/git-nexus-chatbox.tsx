"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NexusAnalysisResult } from "@/types/git-nexus";
import { Badge, Button, Card } from "@/components/ui/themed";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ConversationRow = { id: string; user_message?: string | null; ai_response?: string | null; created_at?: string | null };

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
  const eventBlock = text.split(/\n\n+/).find((block) => block.startsWith("data: ")) || "";
  const payload = eventBlock.slice(6).trim();
  return payload === "[DONE]" ? "" : payload;
}

function summaryForAnalysis(result: NexusAnalysisResult | null): string {
  if (!result) return "No analysis attached yet.";
  return `${result.repo_meta.primary_language} · ${result.suggested_tasks.length} tasks · ${result.developer_insights.length} developers · ${result.risk_signals.length} risks`;
}

export function GitNexusChatBox({ projectId, analysisResult }: { projectId: string; analysisResult: NexusAnalysisResult | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (!projectId.trim()) {
      setMessages([]);
      return;
    }

    const controller = new AbortController();
    setLoadingHistory(true);
    setError(null);

    fetch(`/api/ai/history?projectId=${encodeURIComponent(projectId.trim())}&limit=12`, { cache: "no-store", signal: controller.signal })
      .then(async (resp) => {
        const payload = (await resp.json().catch(() => null)) as { items?: ConversationRow[]; error?: string } | null;
        if (!resp.ok) throw new Error(payload?.error || `Failed to load chat history (${resp.status})`);
        setMessages(historyToMessages(Array.isArray(payload?.items) ? payload.items : []));
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== "AbortError") setError(err instanceof Error ? err.message : "Failed to load chat history.");
      })
      .finally(() => setLoadingHistory(false));

    return () => controller.abort();
  }, [projectId]);

  async function sendMessage() {
    const question = draft.trim();
    if (!projectId.trim() || !question || sending) return;

    const nextMessages = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    setError(null);

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectId.trim(), message: question, mode: "chat", history: nextMessages.slice(-10) }),
      });

      const text = await resp.text();
      if (!resp.ok) throw new Error(parseSseResponse(text) || `Chat request failed (${resp.status})`);

      const reply = parseSseResponse(text) || "No reply returned.";
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send chat message.");
      setMessages(messages);
    } finally {
      setSending(false);
    }
  }

  const contextLabel = useMemo(() => summaryForAnalysis(analysisResult), [analysisResult]);

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">GitNexus chatbox</h3>
          <p className="text-sm text-[var(--text-secondary)]">Ask follow-up questions about the current project and analysis.</p>
        </div>
        <Badge color={projectId.trim() ? "green" : "default"}>{projectId.trim() ? "Ready" : "No project"}</Badge>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">{contextLabel}</div>

      <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
        {loadingHistory ? <p className="text-sm text-[var(--text-secondary)]">Loading conversation...</p> : null}
        {!loadingHistory && messages.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No messages yet. Ask for a summary, risk review, or task breakdown.</p> : null}
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "bg-[var(--text-primary)] text-[var(--text-inverse)]" : "border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)]"}`}>
              {message.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error ? <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}

      <div className="space-y-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={projectId.trim() ? "Ask about architecture, risks, tasks, or ownership..." : "Enter a project ID first"}
          disabled={!projectId.trim() || sending}
          rows={4}
          className="w-full rounded-2xl border px-3 py-3 text-sm outline-none transition focus:border-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", borderColor: "var(--border)" }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-secondary)]">Press Ctrl+Enter to send.</p>
          <Button variant="primary" onClick={() => void sendMessage()} disabled={!projectId.trim() || !draft.trim() || sending}>
            {sending ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
    </Card>
  );
}