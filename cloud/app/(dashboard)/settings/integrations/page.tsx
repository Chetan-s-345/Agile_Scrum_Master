"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AutoTaskRulesPanel } from "@/components/auto-task-rules-panel";

type GithubStatus = {
  connected?: boolean;
  githubOrg?: string;
  repoName?: string;
  lastEventAt?: string | null;
  accessTokenConfigured?: boolean;
  webhookConfigured?: boolean;
  publicGatewayUrlConfigured?: boolean;
  error?: string | null;
};

type GithubWebhookRepoStatus = {
  repo: string;
  webhookUrl: string | null;
  status: "active" | "inactive" | "failed";
  lastDeliveryAt: string | null;
};

type GithubWebhookDelivery = {
  id: string;
  eventType: string;
  repo: string;
  timestamp: string;
  responseCode: number | null;
  latencyMs: number | null;
  status: "success" | "failed";
  requestHeaders?: Record<string, unknown> | null;
  requestBody?: unknown;
  errorResponse?: unknown;
};

type GithubWebhookStatusResponse = {
  callbackUrl?: string;
  repos?: GithubWebhookRepoStatus[];
  items?: GithubWebhookRepoStatus[];
};

type GithubWebhookDeliveriesResponse = {
  deliveries?: GithubWebhookDelivery[];
  items?: GithubWebhookDelivery[];
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function formatWhen(v: string | null | undefined): string {
  if (!v) return "-";
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return String(v);
  return new Date(t).toLocaleString();
}

function stringifyPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if (!("error" in data)) return null;
  const err = (data as { error?: unknown }).error;
  return typeof err === "string" && err ? err : null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
    const text = await resp.text().catch(() => "");
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 503, data: null };
  }
}

function IntegrationsSettingsContent() {
  const searchParams = useSearchParams();

  const oauthMessage = useMemo(() => {
    const status = searchParams.get("github_oauth");
    const repo = searchParams.get("repo");
    const detail = searchParams.get("detail");
    if (!status) return null;
    if (status === "connected") {
      return repo ? `GitHub OAuth connected. Auto-connected ${repo}.` : "GitHub OAuth connected.";
    }
    if (status === "no_repo") return "GitHub OAuth connected, but no repositories were found to auto-connect.";
    if (status === "failed") return detail ? `GitHub OAuth failed: ${detail}` : "GitHub OAuth failed. Please try again.";
    return null;
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [githubWebhookCallbackUrl, setGithubWebhookCallbackUrl] = useState<string>("");
  const [githubWebhookRepos, setGithubWebhookRepos] = useState<GithubWebhookRepoStatus[]>([]);
  const [githubWebhookDeliveries, setGithubWebhookDeliveries] = useState<GithubWebhookDelivery[]>([]);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [redeliveringId, setRedeliveringId] = useState<string | null>(null);
  const [githubCopyOk, setGithubCopyOk] = useState(false);
  const [patOrg, setPatOrg] = useState("");
  const [patRepo, setPatRepo] = useState("");
  const [patToken, setPatToken] = useState("");
  const [patSaving, setPatSaving] = useState(false);
  const [patStatus, setPatStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [ghResp, ghWebhookStatusResp, ghWebhookDeliveriesResp] = await Promise.all([
        fetchJson<GithubStatus>("/api/integrations/github/status"),
        fetchJson<GithubWebhookStatusResponse>("/api/integrations/github/webhook-status"),
        fetchJson<GithubWebhookDeliveriesResponse>("/api/integrations/github/webhook-deliveries"),
      ]);

      setGithubStatus(ghResp.ok ? ghResp.data : null);
      setPatOrg(ghResp.ok && ghResp.data?.githubOrg ? ghResp.data.githubOrg : "");
      setPatRepo(ghResp.ok && ghResp.data?.repoName ? ghResp.data.repoName : "");

      if (ghWebhookStatusResp.ok && ghWebhookStatusResp.data) {
        const callback =
          ghWebhookStatusResp.data.callbackUrl ||
          (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "");
        setGithubWebhookCallbackUrl(callback);

        const items = Array.isArray(ghWebhookStatusResp.data.repos)
          ? ghWebhookStatusResp.data.repos
          : Array.isArray(ghWebhookStatusResp.data.items)
            ? ghWebhookStatusResp.data.items
            : [];
        setGithubWebhookRepos(items);
      } else {
        setGithubWebhookCallbackUrl(typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "");
        setGithubWebhookRepos([]);
      }

      if (ghWebhookDeliveriesResp.ok && ghWebhookDeliveriesResp.data) {
        const items = Array.isArray(ghWebhookDeliveriesResp.data.deliveries)
          ? ghWebhookDeliveriesResp.data.deliveries
          : Array.isArray(ghWebhookDeliveriesResp.data.items)
            ? ghWebhookDeliveriesResp.data.items
            : [];
        setGithubWebhookDeliveries(items.slice(0, 10));
      } else {
        setGithubWebhookDeliveries([]);
      }

      if (!ghResp.ok) {
        setError(extractError(ghResp.data) || `Failed to load GitHub status (${ghResp.status})`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const selectedDelivery = githubWebhookDeliveries.find((d) => d.id === selectedDeliveryId) || null;
  const latestGithubDelivery = githubWebhookDeliveries[0] || null;
  const githubLive = Boolean(
    nowMs > 0 && latestGithubDelivery?.timestamp && nowMs - new Date(latestGithubDelivery.timestamp).getTime() < 60000
  );

  async function copyGithubCallbackUrl(text: string) {
    setGithubCopyOk(false);
    try {
      await navigator.clipboard.writeText(text);
      setGithubCopyOk(true);
      window.setTimeout(() => setGithubCopyOk(false), 1200);
    } catch {
      setGithubCopyOk(false);
    }
  }

  async function redeliverGithubWebhook(deliveryId: string) {
    setRedeliveringId(deliveryId);
    setError(null);

    const resp = await fetchJson<unknown>(`/api/integrations/github/webhooks/redeliver/${encodeURIComponent(deliveryId)}`, {
      method: "POST",
    });

    setRedeliveringId(null);
    if (!resp.ok) {
      setError(extractError(resp.data) || `Redeliver failed (${resp.status})`);
      return;
    }

    await load();
  }

  async function saveGithubPat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPatStatus(null);

    const githubOrg = patOrg.trim();
    const repoName = patRepo.trim();
    const accessToken = patToken.trim();
    if (!githubOrg || !repoName || !accessToken) {
      setError("GitHub org, repo, and PAT token are required.");
      return;
    }

    setPatSaving(true);
    const resp = await fetchJson<unknown>("/api/integrations/github/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubOrg, repoName, accessToken }),
    });
    setPatSaving(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `PAT save failed (${resp.status})`);
      return;
    }

    setPatToken("");
    setPatStatus("Shared PAT saved for this organization.");
    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Integrations</h1>
        <p className="text-slate-600 dark:text-slate-300">GitHub integration status and webhook operations.</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {oauthMessage ? (
          <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            {oauthMessage}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">GitHub</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Status: <span className="font-semibold">{githubStatus?.connected ? "connected" : "not connected"}</span>
              </div>
            </div>

            <Link
              href="/integrations/github/repos"
              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              Discover Repos
            </Link>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">OAuth Auto-Connect</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Authorize GitHub once, then auto-connect your latest active repository and list all accessible repos.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/auth/github/start"
                className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold"
              >
                Authorize GitHub
              </a>
              <Link
                href="/integrations/github/repos"
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white"
              >
                Open Repo Discovery
              </Link>
            </div>
          </div>

          <form onSubmit={(event) => void saveGithubPat(event)} className="mt-5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Shared GitHub PAT</div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Store one organization-wide token here so every team member can use the same GitHub connection.
                </p>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 text-right">
                {githubStatus?.accessTokenConfigured ? "PAT saved" : "No PAT saved"}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">GitHub Org</span>
                <input
                  value={patOrg}
                  onChange={(e) => setPatOrg(e.target.value)}
                  placeholder="acme-inc"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Repo Name</span>
                <input
                  value={patRepo}
                  onChange={(e) => setPatRepo(e.target.value)}
                  placeholder="repository-name"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">PAT Token</span>
                <input
                  value={patToken}
                  onChange={(e) => setPatToken(e.target.value)}
                  type="password"
                  placeholder="ghp_..."
                  autoComplete="off"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={patSaving}
                className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {patSaving ? "Saving..." : "Save shared PAT"}
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                The token is stored once in the org connection record and reused across the workspace.
              </span>
            </div>

            {patStatus ? <div className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{patStatus}</div> : null}
          </form>

          {loading ? (
            <div className="mt-4 text-slate-600 dark:text-slate-300">Loading...</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div>Connection: {githubStatus?.connected ? "active" : "inactive"}</div>
              <div>Last event: {githubStatus?.lastEventAt || "-"}</div>
              <div>Webhook ready: {githubStatus?.publicGatewayUrlConfigured ? "yes" : "no"}</div>
            </div>
          )}

          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">GitHub Webhook Status</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 inline-flex items-center gap-2">
                  <span className={"h-2.5 w-2.5 rounded-full " + (githubLive ? "bg-green-500 animate-pulse" : "bg-slate-400")} />
                  <span>{githubLive ? "Live: event received in last 60s" : "Idle"}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Webhook callback URL</div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={githubWebhookCallbackUrl || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "")}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => void copyGithubCallbackUrl(githubWebhookCallbackUrl || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : ""))}
                  className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  {githubCopyOk ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <details className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-white">Setup Instructions</summary>
              <div className="mt-3 text-sm text-slate-700 dark:text-slate-200 space-y-2">
                <div>Auto-registration note: Webhooks are auto-registered when you connect a repo.</div>
                <div>Manual fallback:</div>
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/30 p-2 text-xs font-mono break-all">
                  URL: {githubWebhookCallbackUrl || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "")}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Select events: create, push, pull_request, pull_request_review, issues</div>
              </div>
            </details>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Per-repo webhook status</div>
              {githubWebhookRepos.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        <th className="pb-2 pr-3">Repo</th>
                        <th className="pb-2 pr-3">Webhook URL</th>
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2">Last Delivery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {githubWebhookRepos.map((r) => (
                        <tr key={r.repo} className="border-t border-slate-100 dark:border-zinc-800">
                          <td className="py-2 pr-3 font-mono text-slate-900 dark:text-white">{r.repo}</td>
                          <td className="py-2 pr-3 text-slate-700 dark:text-slate-200 max-w-[320px] truncate">{r.webhookUrl || "-"}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={
                                "inline-flex rounded-full px-2 py-0.5 border text-[11px] font-semibold " +
                                (r.status === "active"
                                  ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-200"
                                  : r.status === "failed"
                                    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200"
                                    : "border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-slate-200")
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2 text-slate-700 dark:text-slate-200">{formatWhen(r.lastDeliveryAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No webhook status data available yet.</div>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Last 10 webhook deliveries</div>
              {githubWebhookDeliveries.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        <th className="pb-2 pr-3">Event</th>
                        <th className="pb-2 pr-3">Repo</th>
                        <th className="pb-2 pr-3">Timestamp</th>
                        <th className="pb-2 pr-3">Code</th>
                        <th className="pb-2 pr-3">Latency</th>
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {githubWebhookDeliveries.map((d) => {
                        const failed = (d.responseCode || 0) >= 400 || d.status === "failed";
                        const selected = selectedDeliveryId === d.id;
                        return (
                          <tr
                            key={d.id}
                            className={
                              "border-t border-slate-100 dark:border-zinc-800 cursor-pointer " +
                              (selected ? "bg-slate-50 dark:bg-zinc-800/40" : "")
                            }
                            onClick={() => setSelectedDeliveryId((prev) => (prev === d.id ? null : d.id))}
                          >
                            <td className="py-2 pr-3 font-mono text-slate-900 dark:text-white">{d.eventType}</td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{d.repo}</td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{formatWhen(d.timestamp)}</td>
                            <td className={"py-2 pr-3 font-semibold " + ((d.responseCode || 0) >= 400 ? "text-red-600 dark:text-red-300" : "text-green-600 dark:text-green-300")}>{d.responseCode ?? "-"}</td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{d.latencyMs != null ? `${d.latencyMs} ms` : "-"}</td>
                            <td className="py-2 pr-3">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 border text-[11px] font-semibold " +
                                  (failed
                                    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200"
                                    : "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-200")
                                }
                              >
                                {failed ? "failed" : "ok"}
                              </span>
                            </td>
                            <td className="py-2">
                              {failed ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void redeliverGithubWebhook(d.id);
                                  }}
                                  disabled={redeliveringId === d.id}
                                  className="rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                                >
                                  {redeliveringId === d.id ? "Redelivering..." : "Redeliver"}
                                </button>
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No delivery logs yet.</div>
              )}
            </div>

            {selectedDelivery ? (
              <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Failed Delivery Detail</div>
                <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Request Headers</div>
                    <pre className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-2 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-64">{stringifyPretty(asRecord(selectedDelivery.requestHeaders) || {})}</pre>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Request Body</div>
                    <pre className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-2 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-64">{stringifyPretty(selectedDelivery.requestBody ?? {})}</pre>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Error Response</div>
                  <pre className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-2 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-64">{stringifyPretty(selectedDelivery.errorResponse ?? {})}</pre>
                </div>
              </div>
            ) : null}

            <AutoTaskRulesPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Integrations</h1>
            <p className="text-slate-600 dark:text-slate-300">Loading integrations...</p>
          </div>
        </div>
      }
    >
      <IntegrationsSettingsContent />
    </Suspense>
  );
}
