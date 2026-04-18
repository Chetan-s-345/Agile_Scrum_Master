"use client";

import { useEffect, useMemo, useState } from "react";

type AutoTaskRules = {
  createFromIssues: boolean;
  createFromUnlinkedPrs: boolean;
  sprintReadyLabel: string;
  labelMappings: Record<string, string>;
};

type RulesResponse = {
  success?: boolean;
  data?: AutoTaskRules;
  error?: string;
  detail?: string;
};

const TASK_TYPES = ["task", "story", "bug"] as const;

function fallbackRules(): AutoTaskRules {
  return {
    createFromIssues: true,
    createFromUnlinkedPrs: true,
    sprintReadyLabel: "sprint-ready",
    labelMappings: {
      bug: "bug",
      enhancement: "story",
      task: "task",
    },
  };
}

function extractErrorText(data: unknown): string {
  if (!data || typeof data !== "object") return "Request failed";
  const rec = data as Record<string, unknown>;
  const error = typeof rec.error === "string" ? rec.error : "Request failed";
  const detail = typeof rec.detail === "string" ? rec.detail : "";
  return detail ? `${error}: ${detail}` : error;
}

export function AutoTaskRulesPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [rules, setRules] = useState<AutoTaskRules>(fallbackRules());

  const labels = useMemo(() => Object.entries(rules.labelMappings), [rules.labelMappings]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const resp = await fetch("/api/integrations/github/auto-task-rules", { cache: "no-store" });
      const data = (await resp.json().catch(() => null)) as RulesResponse | null;

      if (cancelled) return;

      if (!resp.ok) {
        setError(extractErrorText(data));
        setLoading(false);
        return;
      }

      setRules(data?.data || fallbackRules());
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateMapLabel(oldKey: string, newKey: string) {
    const normalized = newKey.trim().toLowerCase();
    setRules((prev) => {
      const next = { ...prev.labelMappings };
      const value = next[oldKey] || "task";
      delete next[oldKey];
      if (normalized) next[normalized] = value;
      return { ...prev, labelMappings: next };
    });
  }

  function updateMapType(key: string, nextType: string) {
    setRules((prev) => ({
      ...prev,
      labelMappings: {
        ...prev.labelMappings,
        [key]: nextType,
      },
    }));
  }

  function removeMapping(key: string) {
    setRules((prev) => {
      const next = { ...prev.labelMappings };
      delete next[key];
      return { ...prev, labelMappings: next };
    });
  }

  function addMapping() {
    setRules((prev) => {
      if (!prev.labelMappings["new-label"]) {
        return { ...prev, labelMappings: { ...prev.labelMappings, "new-label": "task" } };
      }

      let i = 2;
      while (prev.labelMappings[`new-label-${i}`]) i += 1;
      return {
        ...prev,
        labelMappings: {
          ...prev.labelMappings,
          [`new-label-${i}`]: "task",
        },
      };
    });
  }

  async function saveRules() {
    setSaving(true);
    setError(null);
    setSavedAt(null);

    const payload: AutoTaskRules = {
      createFromIssues: Boolean(rules.createFromIssues),
      createFromUnlinkedPrs: Boolean(rules.createFromUnlinkedPrs),
      sprintReadyLabel: String(rules.sprintReadyLabel || "sprint-ready").trim().toLowerCase(),
      labelMappings: Object.fromEntries(
        Object.entries(rules.labelMappings)
          .map(([k, v]) => [k.trim().toLowerCase(), String(v || "task").toLowerCase()])
          .filter(([k]) => Boolean(k))
      ),
    };

    const resp = await fetch("/api/integrations/github/auto-task-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await resp.json().catch(() => null)) as RulesResponse | null;

    setSaving(false);
    if (!resp.ok) {
      setError(extractErrorText(data));
      return;
    }

    setRules(data?.data || payload);
    setSavedAt(Date.now());
  }

  return (
    <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Auto-Task Rules</div>
          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Configure how GitHub issues and unlinked PRs create internal backlog items and tasks.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void saveRules()}
          disabled={loading || saving}
          className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Rules"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {savedAt ? (
        <div className="mt-3 text-xs text-green-700 dark:text-green-300">Saved at {new Date(savedAt).toLocaleTimeString()}.</div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={rules.createFromIssues}
            onChange={(e) => setRules((prev) => ({ ...prev, createFromIssues: e.target.checked }))}
            disabled={loading || saving}
          />
          Auto-create backlog from issues.opened
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={rules.createFromUnlinkedPrs}
            onChange={(e) => setRules((prev) => ({ ...prev, createFromUnlinkedPrs: e.target.checked }))}
            disabled={loading || saving}
          />
          Auto-create in-progress task from unlinked PR
        </label>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Sprint-ready label</div>
        <input
          value={rules.sprintReadyLabel}
          onChange={(e) => setRules((prev) => ({ ...prev, sprintReadyLabel: e.target.value }))}
          placeholder="sprint-ready"
          disabled={loading || saving}
          className="w-full md:w-72 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
        />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Label to task-type mapping</div>
          <button
            type="button"
            onClick={addMapping}
            disabled={loading || saving}
            className="rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-slate-900 dark:text-white disabled:opacity-60"
          >
            Add Mapping
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {labels.length ? (
            labels.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[1fr_auto_auto] gap-2">
                <input
                  value={k}
                  onChange={(e) => updateMapLabel(k, e.target.value)}
                  disabled={loading || saving}
                  className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
                <select
                  value={v}
                  onChange={(e) => updateMapType(k, e.target.value)}
                  disabled={loading || saving}
                  className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeMapping(k)}
                  disabled={loading || saving}
                  className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-60"
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <div className="text-xs text-slate-600 dark:text-slate-300">No mappings yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
