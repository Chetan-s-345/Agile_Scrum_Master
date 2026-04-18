"use client";

import { useEffect, useMemo, useState } from "react";

type StandupEntry = {
  id: string;
  date: string;
  userId: string;
  userName?: string;
  yesterday: string;
  today: string;
  blockers: string;
  submittedAt?: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function buildStandupText(entry: Partial<StandupEntry> | null): string {
  if (!entry) return "";
  const yesterday = asText(entry.yesterday).trim();
  const today = asText(entry.today).trim();
  const blockers = asText(entry.blockers).trim();
  return `Yesterday: ${yesterday}\nToday: ${today}\nBlockers: ${blockers}`.trim();
}

function parseStandupText(input: string): { yesterday: string; today: string; blockers: string } {
  const lines = String(input || "").split(/\r?\n/);
  const parts = { yesterday: "", today: "", blockers: "" };

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    const normalized = raw.toLowerCase();
    if (normalized.startsWith("yesterday:")) {
      parts.yesterday = raw.slice("yesterday:".length).trim();
      continue;
    }
    if (normalized.startsWith("today:")) {
      parts.today = raw.slice("today:".length).trim();
      continue;
    }
    if (normalized.startsWith("blockers:")) {
      parts.blockers = raw.slice("blockers:".length).trim();
      continue;
    }
  }

  if (!parts.yesterday && !parts.today && !parts.blockers) {
    parts.today = String(input || "").trim();
  }
  return parts;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }
  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(asText(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }
  return response as T;
}

export default function StandupPage() {
  const [text, setText] = useState("");
  const [activeUserId, setActiveUserId] = useState("user-1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const maxChars = 2000;
  const remaining = useMemo(() => maxChars - text.length, [text.length]);

  useEffect(() => {
    let cancelled = false;
    async function loadToday() {
      try {
        const [me, entries] = await Promise.all([
          invokeDesktop<{ id?: string; displayName?: string }>("profile:getCurrent"),
          invokeDesktop<StandupEntry[]>("standup:getToday")
        ]);

        if (cancelled) return;
        const userId = String(me?.id || "user-1").trim() || "user-1";
        setActiveUserId(userId);

        const rows = Array.isArray(entries) ? entries : [];
        const mine = rows.find((entry) => String(entry.userId || "") === userId) || rows[0] || null;
        if (mine) {
          setText(buildStandupText(mine));
        }
      } catch {
        if (!cancelled) {
          setActiveUserId("user-1");
        }
      }
    }

    void loadToday();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitStandup() {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const parsed = parseStandupText(text);
      await invokeDesktop<StandupEntry>("standup:submit", {
        userId: activeUserId,
        yesterday: parsed.yesterday,
        today: parsed.today,
        blockers: parsed.blockers,
      });

      setSuccess("Standup submitted successfully.");
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit standup");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Daily Standup</h1>
        <p className="text-slate-600 dark:text-slate-300">Standalone UI shell (API wiring can be added when the backend endpoint exists).</p>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
            What did you do yesterday, what will you do today, blockers?
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            maxLength={maxChars}
            className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
            placeholder="Yesterday: …\nToday: …\nBlockers: …"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>{remaining} characters remaining</span>
            <button
              type="button"
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
              onClick={() => void submitStandup()}
              disabled={submitting || !text.trim()}
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>

          {error ? (
            <div className="mt-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="mt-3 rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 px-3 py-2 text-xs text-green-800 dark:text-green-200">
              {success}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

