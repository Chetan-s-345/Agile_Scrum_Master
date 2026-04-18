"use client";

import { formatDistanceToNow } from "date-fns";
import { Github, Loader2, RefreshCw } from "lucide-react";
import Link from "@/next-shims/link";
import { useEffect, useMemo, useState } from "react";
import { GithubConnectEmptyState } from "@/components/github-connect-empty-state";

type GithubConnectionStatus = {
  connected: boolean;
  org: string;
  lastSynced: string;
};

type GithubRepo = {
  id: string;
  name: string;
  fullName?: string;
  visibility: string;
  lastCommit: string;
  openPrsCount: number;
  syncStatus: string;
};

type GithubRecentPr = {
  id: string;
  title: string;
  author: string;
  status: string;
  linkedTask?: { id: string; title: string } | null;
  repo: string;
  createdAt: string;
  htmlUrl?: string;
};

type GithubSyncResult = {
  success: boolean;
  synced: number;
};

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function rel(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDistanceToNow(date, { addSuffix: true });
}

function asString(value: unknown, fallback = ""): string {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function syncStatusClass(status: string): string {
  const normalized = asString(status).toLowerCase();
  if (normalized === "synced" || normalized === "success") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  }
  if (normalized === "pending" || normalized === "running") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  }
  return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
}

function prStatusClass(status: string): string {
  const normalized = asString(status).toLowerCase();
  if (normalized === "open") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  }
  if (normalized === "merged") {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  }
  if (normalized === "closed") {
    return "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-slate-200";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
}

export default function GithubHubPage() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [connection, setConnection] = useState<GithubConnectionStatus | null>(null);
  const [linkedRepos, setLinkedRepos] = useState<GithubRepo[]>([]);
  const [recentPrs, setRecentPrs] = useState<GithubRecentPr[]>([]);

  const connected = Boolean(connection?.connected);

  const repoCount = useMemo(() => linkedRepos.length, [linkedRepos]);

  async function loadOverview() {
    setLoading(true);
    setError(null);

    try {
      const [statusResp, reposResp, prsResp] = await Promise.all([
        invokeDesktop<GithubConnectionStatus>("github:getConnectionStatus"),
        invokeDesktop<GithubRepo[]>("github:getLinkedRepos"),
        invokeDesktop<GithubRecentPr[]>("github:getRecentPRs"),
      ]);

      setConnection(statusResp || null);
      setLinkedRepos(Array.isArray(reposResp) ? reposResp : []);
      setRecentPrs(Array.isArray(prsResp) ? prsResp : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load GitHub overview");
      setConnection(null);
      setLinkedRepos([]);
      setRecentPrs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function syncNow() {
    try {
      setSyncing(true);
      setError(null);
      const result = await invokeDesktop<GithubSyncResult>("github:syncNow");
      if (!result?.success) {
        throw new Error("Sync failed");
      }
      setBanner(`Sync complete. ${asNumber(result.synced)} repositories updated.`);
      await loadOverview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sync GitHub data");
    } finally {
      setSyncing(false);
    }
  }

  if (!loading && !connected) {
    return (
      <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <GithubConnectEmptyState
            title="Connect GitHub to open your activity hub"
            description="This page becomes available once GitHub OAuth is connected for your workspace."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Github className="w-7 h-7 text-slate-900 dark:text-white" />
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">GitHub</h1>
              <p className="text-slate-600 dark:text-slate-300">Activity hub for linked repositories</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={loading || syncing}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync Now
            </button>
            <Link
              href="/integrations/github/repos"
              className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
            >
              Manage Repos
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {banner ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {banner}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                Connected: {asString(connection?.org, "-")}
              </div>
              <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {repoCount} repos linked • last synced {rel(connection?.lastSynced)}
              </div>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-zinc-800" />
            </div>
          </div>
        ) : (
          <>
            <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Linked repositories</div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300">
                      <th className="px-3 py-2 text-left font-semibold">Repo</th>
                      <th className="px-3 py-2 text-left font-semibold">Visibility</th>
                      <th className="px-3 py-2 text-left font-semibold">Last commit</th>
                      <th className="px-3 py-2 text-left font-semibold">Open PRs</th>
                      <th className="px-3 py-2 text-left font-semibold">Sync status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedRepos.length ? (
                      linkedRepos.map((repo) => (
                        <tr key={repo.id || repo.fullName || repo.name} className="border-b border-slate-200 dark:border-zinc-800">
                          <td className="px-3 py-2 text-slate-900 dark:text-white">{repo.fullName || repo.name}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{repo.visibility}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{rel(repo.lastCommit)}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{asNumber(repo.openPrsCount)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${syncStatusClass(repo.syncStatus)}`}>
                              {repo.syncStatus}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-slate-600 dark:text-slate-300">
                          No linked repositories.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Recent PR activity</div>
              <div className="space-y-2">
                {recentPrs.length ? (
                  recentPrs.map((pr) => (
                    <article key={pr.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            href={pr.htmlUrl || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-semibold text-slate-900 dark:text-white hover:underline"
                          >
                            {pr.title}
                          </a>
                          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            {pr.repo} • {pr.author} • {rel(pr.createdAt)}
                          </div>
                        </div>
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${prStatusClass(pr.status)}`}>
                          {pr.status}
                        </span>
                      </div>

                      <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                        Linked task:{" "}
                        {pr.linkedTask?.id ? (
                          <Link href={`/tasks/${encodeURIComponent(pr.linkedTask.id)}`} className="font-semibold text-slate-900 dark:text-white hover:underline">
                            {pr.linkedTask.title}
                          </Link>
                        ) : (
                          <span>-</span>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="py-8 text-center text-sm text-slate-600 dark:text-slate-300">No recent PR activity.</div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
