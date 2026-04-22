"use client";

import { useMemo, useState } from "react";

type MeetingSummaryProps = {
  summary: string;
  transcript: string;
  startedAt?: string | null;
  endedAt?: string | null;
  individualSummary?: string;
  individualTitle?: string;
};

function formatDuration(startedAt?: string | null, endedAt?: string | null) {
  if (!startedAt || !endedAt) return "Duration unavailable";
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return "Duration unavailable";

  const totalMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

export function MeetingSummary({
  summary,
  transcript,
  startedAt,
  endedAt,
  individualSummary,
  individualTitle = "Your Individual Summary",
}: MeetingSummaryProps) {
  const [copied, setCopied] = useState(false);

  const durationText = useMemo(() => formatDuration(startedAt, endedAt), [startedAt, endedAt]);
  const hasEnded = Boolean(endedAt);
  const normalizedSummary = summary.trim() || (hasEnded ? "No summary available yet." : "Summary becomes available after meeting ends.");
  const normalizedTranscript = transcript.trim() || "No transcript captured.";
  const normalizedIndividualSummary = String(individualSummary || "").trim();

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(normalizedSummary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Meeting Summary</h3>
          <p className="text-xs text-[var(--text-muted)]">{durationText}</p>
        </div>
        <button
          type="button"
          onClick={copySummary}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        >
          {copied ? "Copied" : "Copy Summary"}
        </button>
      </div>

      <div className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-sm leading-relaxed text-[var(--text-primary)]">
        {normalizedSummary}
      </div>

      {normalizedIndividualSummary ? (
        <div className="space-y-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-3">
          <h4 className="text-sm font-semibold text-blue-200">{individualTitle}</h4>
          <div className="max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-blue-100">
            {normalizedIndividualSummary}
          </div>
        </div>
      ) : null}

      <details className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]">Transcript</summary>
        <div className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-muted)]">
          {normalizedTranscript}
        </div>
      </details>
    </div>
  );
}
