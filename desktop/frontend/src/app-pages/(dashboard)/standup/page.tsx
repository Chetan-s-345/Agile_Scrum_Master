"use client";

import { useMemo, useState } from "react";

export default function StandupPage() {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const maxChars = 2000;
  const remaining = useMemo(() => maxChars - text.length, [text.length]);

  async function submitStandup() {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const resp = await fetch("/api/standup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput: text,
          inputChannel: "web",
        }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(String(data?.error || "Failed to submit standup"));

      const blockers = Array.isArray(data?.item?.blockerTaskIds) ? data.item.blockerTaskIds.length : 0;
      setSuccess(
        blockers
          ? `Standup submitted. ${blockers} blocker task${blockers > 1 ? "s" : ""} created automatically.`
          : "Standup submitted successfully."
      );
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

