"use client";

import { useEffect, useState } from "react";

type JiraStatus = {
  connected?: boolean;
  status?: string;
  baseUrl?: string;
  projectKey?: string;
  boardId?: string | number | null;
  storyPointsField?: string | null;
  lastSyncAt?: string | null;
  error?: string | null;
};

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

export default function IntegrationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<JiraStatus | null>(null);

  const [baseUrl, setBaseUrl] = useState("https://yourcompany.atlassian.net");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [boardId, setBoardId] = useState("");
  const [storyPointsField, setStoryPointsField] = useState("");

  async function load() {
    setLoading(true);
    setError(null);

    const resp = await fetchJson<JiraStatus>("/api/integrations/jira/status");
    setStatus(resp.ok ? resp.data : null);

    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const resp = await fetchJson<unknown>("/api/integrations/jira/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl,
        email,
        apiToken,
        projectKey,
        boardId: boardId ? boardId : undefined,
        storyPointsField: storyPointsField ? storyPointsField : undefined,
      }),
    });

    setSaving(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Connect failed (${resp.status})`);
      return;
    }

    await load();
  }

  async function syncNow() {
    setSaving(true);
    setError(null);

    const resp = await fetchJson<unknown>("/api/integrations/jira/sync", { method: "POST" });

    setSaving(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Sync failed (${resp.status})`);
      return;
    }

    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Integrations</h1>
        <p className="text-slate-600 dark:text-slate-300">Connect Jira and trigger sync.</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">Jira</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Status: <span className="font-semibold">{status?.status || (status?.connected ? "connected" : "not connected") || "unknown"}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={syncNow}
              disabled={saving}
              className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              Sync now
            </button>
          </div>

          {loading ? (
            <div className="mt-4 text-slate-600 dark:text-slate-300">Loading…</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div>Base URL: {status?.baseUrl || "—"}</div>
              <div>Project key: {status?.projectKey || "—"}</div>
              <div>Board ID: {String(status?.boardId ?? "—")}</div>
              <div>Story points field: {String(status?.storyPointsField ?? "—")}</div>
            </div>
          )}

          <form onSubmit={connect} className="mt-6 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Jira base URL</div>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="https://yourcompany.atlassian.net"
                />
              </label>
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Project key</div>
                <input
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="PROJ"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Email</div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="you@company.com"
                />
              </label>
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">API token</div>
                <input
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  type="password"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="••••••••••"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Board ID (optional)</div>
                <input
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="123"
                />
              </label>
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Story points field (optional)</div>
                <input
                  value={storyPointsField}
                  onChange={(e) => setStoryPointsField(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="customfield_10016"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !baseUrl || !email || !apiToken || !projectKey}
              className="mt-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? "Saving…" : "Connect Jira"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
