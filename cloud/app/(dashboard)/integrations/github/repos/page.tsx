"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GithubConnectEmptyState } from "@/components/github-connect-empty-state";

type GithubRepo = {
  id: number | null;
  name: string | null;
  fullName: string | null;
  private: boolean;
  language: string | null;
  defaultBranch: string | null;
  updatedAt: string | null;
  hasWebhook: boolean;
};

type GithubStatus = {
  connected?: boolean;
  githubOrg?: string;
  repoName?: string;
};

type ConnectState = "idle" | "connecting" | "success" | "error";

type ConnectMap = Record<string, { state: ConnectState; message?: string }>;

type ProjectState = "idle" | "creating" | "success" | "error";
type ProjectMap = Record<string, { state: ProjectState; message?: string }>;

const LANGUAGE_CHIPS = [
  "All",
  "Python",
  "JavaScript",
  "TypeScript",
  "Go",
  "Java",
  "Rust",
  "C#",
  "C++",
];

const LANGUAGE_COLORS: Record<string, string> = {
  Python: "bg-blue-500/20 text-blue-300 border-blue-400/30",
  JavaScript: "bg-yellow-500/20 text-yellow-300 border-yellow-400/30",
  TypeScript: "bg-sky-500/20 text-sky-300 border-sky-400/30",
  Go: "bg-cyan-500/20 text-cyan-300 border-cyan-400/30",
  Java: "bg-orange-500/20 text-orange-300 border-orange-400/30",
  Rust: "bg-amber-600/20 text-amber-300 border-amber-500/30",
  "C#": "bg-green-500/20 text-green-300 border-green-400/30",
  "C++": "bg-pink-500/20 text-pink-300 border-pink-400/30",
  default: "bg-zinc-700/40 text-zinc-200 border-zinc-600",
};

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "Unknown";
  return new Date(ts).toLocaleString();
}

function extractError(data: unknown): string {
  if (!data || typeof data !== "object") return "Unknown error";
  if ("detail" in data && typeof (data as { detail?: unknown }).detail === "string") {
    return (data as { detail: string }).detail;
  }
  if ("error" in data && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return "Unknown error";
}

async function fetchJson<T>(url: string, init?: RequestInit) {
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

function loadingCards() {
  return Array.from({ length: 8 }, (_, idx) => (
    <div
      key={`repo-skeleton-${idx}`}
      className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 overflow-hidden relative"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse" />
      <div className="h-5 w-2/3 rounded bg-zinc-800 mb-3" />
      <div className="h-4 w-1/3 rounded bg-zinc-800 mb-5" />
      <div className="h-4 w-full rounded bg-zinc-800 mb-2" />
      <div className="h-4 w-4/5 rounded bg-zinc-800" />
    </div>
  ));
}

export default function GithubRepoDiscoveryPage() {
  const router = useRouter();
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noTokenConfigured, setNoTokenConfigured] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("All");
  const [connectState, setConnectState] = useState<ConnectMap>({});
  const [projectState, setProjectState] = useState<ProjectMap>({});

  const loadRepos = useCallback(async () => {
    setError(null);
    setRefreshing(true);

    const [statusResp, reposResp] = await Promise.all([
      fetchJson<GithubStatus>("/api/integrations/github/status"),
      fetchJson<GithubRepo[]>("/api/integrations/github/repos?all=1"),
    ]);

    if (!reposResp.ok) {
      const msg = extractError(reposResp.data);
      const noToken =
        msg.toLowerCase().includes("not connected") ||
        msg.toLowerCase().includes("token") ||
        statusResp.data?.connected === false;

      setNoTokenConfigured(noToken);
      setRepos([]);
      setError(noToken ? null : msg);
      setRefreshing(false);
      setLoading(false);
      return;
    }

    setNoTokenConfigured(false);
    setRepos(Array.isArray(reposResp.data) ? reposResp.data : []);
    setRefreshing(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadRepos();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadRepos]);

  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/api/v1/webhooks/github`;
  }, []);

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return repos.filter((repo) => {
      const name = String(repo.name || "").toLowerCase();
      const fullName = String(repo.fullName || "").toLowerCase();
      const language = String(repo.language || "").toLowerCase();

      const matchesText = !q || name.includes(q) || fullName.includes(q) || language.includes(q);
      const matchesLanguage = selectedLanguage === "All" || language === selectedLanguage.toLowerCase();
      return matchesText && matchesLanguage;
    });
  }, [repos, search, selectedLanguage]);

  const connectedRepos = useMemo(() => filteredRepos.filter((r) => r.hasWebhook), [filteredRepos]);
  const otherRepos = useMemo(() => filteredRepos.filter((r) => !r.hasWebhook), [filteredRepos]);

  async function onConnectRepo(fullName: string | null) {
    const repoId = String(fullName || "");
    if (!repoId || !repoId.includes("/")) return;

    const [owner, repo] = repoId.split("/");
    setConnectState((prev) => ({ ...prev, [repoId]: { state: "connecting" } }));

    const resp = await fetchJson<unknown>(
      `/api/integrations/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/connect`,
      { method: "POST", headers: { "Content-Type": "application/json" } }
    );

    if (!resp.ok) {
      setConnectState((prev) => ({ ...prev, [repoId]: { state: "error", message: extractError(resp.data) } }));
      return;
    }

    setConnectState((prev) => ({ ...prev, [repoId]: { state: "success" } }));
    window.setTimeout(() => {
      setConnectState((prev) => ({ ...prev, [repoId]: { state: "idle" } }));
    }, 1600);

    await loadRepos();
  }

  function projectNameFromRepo(repo: GithubRepo): string {
    const base = String(repo.name || repo.fullName || "").trim();
    if (!base) return "GitHub Project";
    return base
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  async function onUseAsProject(repo: GithubRepo) {
    const fullName = String(repo.fullName || "").trim();
    if (!fullName) return;

    setProjectState((prev) => ({ ...prev, [fullName]: { state: "creating" } }));
    const payload = {
      name: projectNameFromRepo(repo),
      description: `Linked to GitHub repository ${fullName}`,
      githubRepo: fullName,
      techStack: repo.language ? [String(repo.language)] : [],
    };

    const resp = await fetchJson<Record<string, unknown>>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      setProjectState((prev) => ({ ...prev, [fullName]: { state: "error", message: extractError(resp.data) } }));
      return;
    }

    const projectId = typeof resp.data?.id === "string" ? resp.data.id : "";
    setProjectState((prev) => ({ ...prev, [fullName]: { state: "success" } }));
    if (projectId) {
      router.push(`/projects/${encodeURIComponent(projectId)}`);
      return;
    }
    window.setTimeout(() => {
      setProjectState((prev) => ({ ...prev, [fullName]: { state: "idle" } }));
    }, 1800);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">GitHub Repository Discovery</h1>
            <p className="mt-1 text-sm text-zinc-400">Discover accessible repositories and connect webhooks.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadRepos()}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-semibold hover:bg-zinc-800 disabled:opacity-60"
              disabled={refreshing || loading}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <Link
              href="/api/auth/github/start"
              className="rounded-lg bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300 border border-emerald-400/30 hover:bg-emerald-500/30"
            >
              Connect GitHub
            </Link>
          </div>
        </div>

        {noTokenConfigured ? (
          <GithubConnectEmptyState
            title="No GitHub token configured"
            description="Connect GitHub first to discover repositories accessible to your token."
          />
        ) : null}

        {!noTokenConfigured ? (
          <>
            <div className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by repo name or language"
                  className="w-full lg:max-w-lg rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
                />

                <div className="flex flex-wrap gap-2">
                  {LANGUAGE_CHIPS.map((chip) => {
                    const active = selectedLanguage === chip;
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setSelectedLanguage(chip)}
                        className={
                          `rounded-full border px-3 py-1 text-xs font-semibold transition ` +
                          (active
                            ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800")
                        }
                      >
                        {chip}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Connected Repositories</h2>
                <span className="text-xs text-zinc-400">{connectedRepos.length} connected</span>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{loadingCards()}</div>
              ) : connectedRepos.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
                  No connected repositories yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {connectedRepos.map((repo) => {
                    const fullName = String(repo.fullName || "");
                    const languageClass = LANGUAGE_COLORS[repo.language || ""] || LANGUAGE_COLORS.default;
                    const pState = projectState[fullName]?.state || "idle";
                    return (
                      <article key={`connected-${repo.id}-${fullName}`} className="rounded-2xl border border-emerald-500/30 bg-zinc-900 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-base font-semibold truncate">{repo.name || fullName}</h3>
                          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">
                            Connected ✓
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${languageClass}`}>{repo.language || "Unknown"}</span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                            {repo.private ? "Private" : "Public"}
                          </span>
                          <span className="relative group inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />Webhook
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] whitespace-nowrap opacity-0 shadow-lg transition group-hover:opacity-100">
                              Webhook registered at {webhookUrl || "configured URL"}
                            </span>
                          </span>
                        </div>

                        <p className="mt-3 text-xs text-zinc-400">Updated {formatDate(repo.updatedAt)}</p>

                        <div className="mt-4 flex items-center justify-end gap-2">
                          <a
                            href={`https://github.com/${fullName}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-700"
                          >
                            View
                          </a>
                          <button
                            type="button"
                            onClick={() => void onUseAsProject(repo)}
                            disabled={pState === "creating"}
                            className={
                              "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 transition " +
                              (pState === "success"
                                ? "border-sky-300/60 bg-sky-500/30 text-sky-100"
                                : "border-sky-400/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30")
                            }
                          >
                            {pState === "creating" ? "Creating..." : pState === "success" ? "Project Ready" : "Use as Project"}
                          </button>
                        </div>
                        {pState === "error" ? (
                          <p className="mt-2 text-xs text-red-300">{projectState[fullName]?.message || "Create project failed"}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">All Repositories</h2>
                <span className="text-xs text-zinc-400">{otherRepos.length} available</span>
              </div>

              {error ? (
                <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
              ) : null}

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{loadingCards()}</div>
              ) : otherRepos.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 text-sm text-zinc-400">
                  No repositories match your filters.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {otherRepos.map((repo) => {
                    const fullName = String(repo.fullName || "");
                    const state = connectState[fullName]?.state || "idle";
                    const pState = projectState[fullName]?.state || "idle";
                    const languageClass = LANGUAGE_COLORS[repo.language || ""] || LANGUAGE_COLORS.default;

                    return (
                      <article key={`repo-${repo.id}-${fullName}`} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-base font-semibold truncate">{repo.name || fullName}</h3>
                          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                            {repo.private ? "Private" : "Public"}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${languageClass}`}>{repo.language || "Unknown"}</span>
                          <span className="relative group inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-400" />Webhook
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] whitespace-nowrap opacity-0 shadow-lg transition group-hover:opacity-100">
                              No webhook — click Connect
                            </span>
                          </span>
                        </div>

                        <p className="mt-3 text-xs text-zinc-400">Updated {formatDate(repo.updatedAt)}</p>

                        <div className="mt-4 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <a
                              href={`https://github.com/${fullName}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-700"
                            >
                              View
                            </a>
                            <button
                              type="button"
                              onClick={() => void onUseAsProject(repo)}
                              disabled={pState === "creating"}
                              className={
                                "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 transition " +
                                (pState === "success"
                                  ? "border-sky-300/60 bg-sky-500/30 text-sky-100"
                                  : "border-sky-400/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30")
                              }
                            >
                              {pState === "creating" ? "Creating..." : pState === "success" ? "Project Ready" : "Use as Project"}
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => void onConnectRepo(repo.fullName)}
                            disabled={state === "connecting"}
                            className={
                              "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-60 transition " +
                              (state === "success"
                                ? "border-emerald-300/60 bg-emerald-500/30 text-emerald-100"
                                : "border-emerald-400/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30") +
                              (state === "connecting" ? " animate-pulse" : "")
                            }
                          >
                            {state === "connecting" ? "Connecting..." : state === "success" ? "Connected ✓" : "Connect"}
                          </button>
                        </div>

                        {state === "error" ? (
                          <p className="mt-2 text-xs text-red-300">{connectState[fullName]?.message || "Connect failed"}</p>
                        ) : null}
                        {pState === "error" ? (
                          <p className="mt-2 text-xs text-red-300">{projectState[fullName]?.message || "Create project failed"}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
