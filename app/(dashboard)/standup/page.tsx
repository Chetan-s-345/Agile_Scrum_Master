"use client";

import { useMemo, useState } from "react";

export default function StandupPage() {
  const [text, setText] = useState("");
  const maxChars = 2000;
  const remaining = useMemo(() => maxChars - text.length, [text.length]);

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
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold"
              onClick={() => alert("Standup submit endpoint not implemented yet.")}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
