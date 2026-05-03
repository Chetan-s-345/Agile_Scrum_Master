"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Circle, Clock3, Copy, ExternalLink, Github, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GithubConnectEmptyState } from "@/components/github-connect-empty-state";

type TabKey = "overview" | "commits" | "pull-requests" | "issues" | "workflows" | "branches";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "commits", label: "Commits" },
  { key: "pull-requests", label: "Pull Requests" },
  { key: "issues", label: "Issues" },
  { key: "workflows", label: "Workflows" },
  { key: "branches", label: "Branches" },
];

type ApiResult<T> = { ok: boolean; status: number; data: T | null; message?: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }

  const message =
    (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : undefined) || undefined;

  return { ok: resp.ok, status: resp.status, data, message };
}

function rel(date: string | null | undefined) {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";
  return formatDistanceToNow(d, { addSuffix: true });
}

function useDebouncedValue<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function GithubHubPage() {
  const [tab, setTabState] = useState<TabKey>("overview");

  useEffect(() => {
    const qp = new URLSearchParams(window.location.search);
    const value = qp.get("tab");
    if (value && TABS.some((t) => t.key === value)) {
      setTabState(value as TabKey);
    }
  }, []);

  const [connected, setConnected] = useState<boolean | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const [repoFilter, setRepoFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchBranch, setSearchBranch] = useState("");

  const dBranch = useDebouncedValue(branchFilter, 300);
  const dAuthor = useDebouncedValue(authorFilter, 300);
  const dLabel = useDebouncedValue(labelFilter, 300);
  const dSearchBranch = useDebouncedValue(searchBranch, 300);

  const [overview, setOverview] = useState<any>(null);
  const [commits, setCommits] = useState<any>({ items: [] });
  const [prs, setPrs] = useState<any>({ items: [] });
  const [issues, setIssues] = useState<any>({ items: [] });
  const [workflows, setWorkflows] = useState<any>({ items: [], chart: [] });
  const [branches, setBranches] = useState<any>({ items: [] });

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const st = await fetchJson<{ connected?: boolean }>("/api/integrations/github/status");
      if (st.ok) {
        setConnected(Boolean(st.data?.connected));
        return;
      }

      // Keep hub reachable even when status endpoint is role-restricted.
      setConnected(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!connected) return;

      const repoResp = await fetchJson<any>("/api/integrations/github/repos?all=1");
      if (!repoResp.ok) return;

      const rows = Array.isArray(repoResp.data)
        ? repoResp.data
        : Array.isArray(repoResp.data?.items)
          ? repoResp.data.items
          : [];

      const repoNames = rows
        .map((r: any) => String(r?.fullName || r?.full_name || r?.name || "").trim())
        .filter((v: string) => Boolean(v));

      if (repoNames.length) setRepos(repoNames);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [connected]);
  function setTab(next: TabKey) {
    setTabState(next);
    const qp = new URLSearchParams(window.location.search);
    qp.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${qp.toString()}`);
  }

  async function loadTab() {
    if (!connected) return;
    setLoading(true);
    setBanner(null);

    const qs = new URLSearchParams();
    if (repoFilter !== "all") qs.set("repo", repoFilter);

    let endpoint = "/api/github/overview";
    if (tab === "commits") {
      endpoint = "/api/github/commits";
      if (dBranch) qs.set("branch", dBranch);
      if (dAuthor) qs.set("author", dAuthor);
      qs.set("page", "1");
      qs.set("perPage", "20");
    }
    if (tab === "pull-requests") {
      endpoint = "/api/github/pull-requests";
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (dAuthor) qs.set("author", dAuthor);
      if (dLabel) qs.set("label", dLabel);
      qs.set("page", "1");
      qs.set("perPage", "20");
    }
    if (tab === "issues") {
      endpoint = "/api/github/issues";
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (dLabel) qs.set("label", dLabel);
      qs.set("page", "1");
      qs.set("perPage", "20");
    }
    if (tab === "workflows") {
      endpoint = "/api/github/workflows";
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (dBranch) qs.set("workflow", dBranch);
      qs.set("page", "1");
      qs.set("perPage", "20");
    }
    if (tab === "branches") {
      endpoint = "/api/github/branches";
      if (dSearchBranch) qs.set("search", dSearchBranch);
    }

    const resp = await fetchJson<any>(`${endpoint}${qs.toString() ? `?${qs.toString()}` : ""}`);
    if (!resp.ok) {
      const msg = String(resp.message || `Request failed (${resp.status})`);
      if (msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("revoked")) {
        setBanner("GitHub token expired or revoked. Reconnect your GitHub account.");
      } else if (msg.toLowerCase().includes("rate limit")) {
        setBanner("GitHub API rate limit hit. Try again after reset.");
      } else {
        setBanner(msg);
      }
      setLoading(false);
      return;
    }

    if (tab === "overview") {
      setOverview(resp.data);
      if (Array.isArray(resp.data?.repos)) setRepos(resp.data.repos);
    }
    if (tab === "commits") setCommits(resp.data || { items: [] });
    if (tab === "pull-requests") setPrs(resp.data || { items: [] });
    if (tab === "issues") setIssues(resp.data || { items: [] });
    if (tab === "workflows") setWorkflows(resp.data || { items: [], chart: [] });
    if (tab === "branches") setBranches(resp.data || { items: [] });

    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTab();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, tab, repoFilter, dBranch, dAuthor, dLabel, statusFilter, dSearchBranch]);

  async function importIssue(issueId: string) {
    const resp = await fetchJson(`/api/github/issues/${encodeURIComponent(issueId)}/import`, { method: "POST" });
    if (!resp.ok) {
      setBanner("Failed to import issue as task");
      return;
    }
    await loadTab();
  }

  async function linkPrToTask(prId: string) {
    const taskId = window.prompt("Enter task ID to link");
    if (!taskId) return;

    const resp = await fetchJson(`/api/github/prs/${encodeURIComponent(prId)}/link-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });

    if (!resp.ok) {
      setBanner("Failed to link PR to task");
      return;
    }
    await loadTab();
  }

  async function deleteBranch(repo: string, branch: string) {
    const ok = window.confirm(`Delete branch ${branch}?`);
    if (!ok) return;

    const encodedRepo = encodeURIComponent(repo);
    const resp = await fetchJson(`/api/github/branches/${encodedRepo}/${encodeURIComponent(branch)}`, { method: "DELETE" });
    if (!resp.ok) {
      setBanner("Failed to delete branch");
      return;
    }
    await loadTab();
  }

  if (connected === false) {
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Github className="w-7 h-7 text-slate-900 dark:text-white" />
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">GitHub</h1>
              <p className="text-slate-600 dark:text-slate-300">Activity hub for linked repositories</p>
            </div>
          </div>
          <Link href="/git-nexus" className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-700 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white transition">
            📊 GitNexus
          </Link>
        </div>

        {banner ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {banner}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "rounded-full border px-4 py-2 text-sm font-semibold " +
                (tab === t.key
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-black"
                  : "border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-zinc-900")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
          <select
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
          >
            <option value="all">All repos</option>
            {repos.map((repo) => (
              <option key={repo} value={repo}>{repo}</option>
            ))}
          </select>

          {tab === "commits" || tab === "workflows" ? (
            <input
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              placeholder={tab === "workflows" ? "Workflow name" : "Branch"}
              className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            />
          ) : null}

          {tab === "commits" || tab === "pull-requests" ? (
            <input
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              placeholder="Author"
              className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            />
          ) : null}

          {tab === "pull-requests" || tab === "issues" ? (
            <input
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              placeholder="Label"
              className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            />
          ) : null}

          {tab === "pull-requests" || tab === "issues" || tab === "workflows" ? (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              {tab === "pull-requests" ? (
                <>
                  <option value="open">Open</option>
                  <option value="merged">Merged</option>
                  <option value="closed">Closed</option>
                  <option value="draft">Draft</option>
                </>
              ) : null}
              {tab === "issues" ? (
                <>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </>
              ) : null}
              {tab === "workflows" ? (
                <>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="running">Running</option>
                </>
              ) : null}
            </select>
          ) : null}

          {tab === "branches" ? (
            <input
              value={searchBranch}
              onChange={(e) => setSearchBranch(e.target.value)}
              placeholder="Search branches"
              className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            />
          ) : null}
        </div>

        {loading ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-zinc-800" />
              <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-zinc-800" />
            </div>
          </div>
        ) : null}

        {!loading && tab === "overview" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Open PRs" value={overview?.metrics?.openPrs || 0} />
              <MetricCard label="Open Issues" value={overview?.metrics?.openIssues || 0} />
              <MetricCard label="Failed Workflows" value={overview?.metrics?.failedWorkflows || 0} />
              <MetricCard label="Commits this week" value={overview?.metrics?.commitsThisWeek || 0} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Recent commits</div>
                {overview?.commits?.length ? overview.commits.map((c: any) => (
                  <div key={`${c.repo}-${c.sha}`} className="py-2 border-b border-slate-100 dark:border-zinc-800 last:border-b-0 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white truncate">{c.message}</span>
                      <span className="rounded-full border border-slate-200 dark:border-zinc-700 px-2 py-0.5 text-xs">{c.repo}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{c.author} -+ {rel(c.authoredAt)}</div>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(String(c.sha || ""))}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-mono text-slate-700 dark:text-slate-300"
                    >
                      {String(c.sha || "").slice(0, 7)} <Copy className="w-3 h-3" />
                    </button>
                  </div>
                )) : <EmptyRow text="No commits found." />}
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Open pull requests</div>
                {overview?.pullRequests?.length ? overview.pullRequests.map((pr: any) => (
                  <div key={pr.id} className="py-2 border-b border-slate-100 dark:border-zinc-800 last:border-b-0 text-sm">
                    <a href={pr.htmlUrl} target="_blank" className="font-semibold text-slate-900 dark:text-white hover:underline">{pr.title}</a>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{pr.repo} -+ {pr.author} -+ {rel(pr.createdAt)}</div>
                  </div>
                )) : <EmptyRow text="No open pull requests." />}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Recent workflow runs</div>
              {overview?.workflows?.length ? overview.workflows.map((run: any) => (
                <div key={run.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 dark:border-zinc-800 last:border-b-0 text-sm">
                  <div className="truncate">
                    <span className="font-semibold text-slate-900 dark:text-white">{run.name}</span>
                    <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">{run.repo} -+ {run.branch}</span>
                  </div>
                  <StatusIcon status={run.conclusion || run.status} />
                </div>
              )) : <EmptyRow text="No workflow runs found." />}
            </div>
          </div>
        ) : null}

        {!loading && tab === "commits" ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
            {commits?.items?.length ? commits.items.map((c: any) => (
              <div key={`${c.repo}-${c.sha}`} className="border-b border-slate-100 dark:border-zinc-800 last:border-b-0 py-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{c.message}</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{c.author} -+ {c.repo} -+ {rel(c.authoredAt)}</div>
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <button type="button" onClick={() => void navigator.clipboard.writeText(String(c.sha || ""))} className="inline-flex items-center gap-1 font-mono">
                    {String(c.sha || "").slice(0, 7)} <Copy className="w-3 h-3" />
                  </button>
                  <a href={c.htmlUrl} target="_blank" className="inline-flex items-center gap-1 hover:underline">Open <ExternalLink className="w-3 h-3" /></a>
                </div>
              </div>
            )) : <EmptyRow text="No commits found." />}
          </div>
        ) : null}

        {!loading && tab === "pull-requests" ? (
          <div className="space-y-3">
            {prs?.items?.length ? prs.items.map((pr: any) => (
              <article key={pr.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <a href={pr.htmlUrl} target="_blank" className="text-base font-semibold text-slate-900 dark:text-white hover:underline">{pr.title}</a>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">#{pr.number} -+ {pr.repo} -+ {pr.baseBranch} {"->"} {pr.headBranch}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(pr.labels || []).map((lb: any) => (
                    <span key={`${pr.id}-${lb.name}`} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: `#${lb.color || "94a3b8"}` }}>
                      {lb.name}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <div className="text-slate-600 dark:text-slate-300">{pr.author} -+ {rel(pr.createdAt)}</div>
                  {pr.linkedTask ? (
                    <Link href={`/tasks/${encodeURIComponent(pr.linkedTask.id)}`} className="rounded-lg border border-slate-200 dark:border-zinc-700 px-2 py-1 text-xs">{pr.linkedTask.title}</Link>
                  ) : (
                    <button type="button" onClick={() => void linkPrToTask(String(pr.id))} className="rounded-lg border border-slate-200 dark:border-zinc-700 px-2 py-1 text-xs">
                      Link to task
                    </button>
                  )}
                </div>
              </article>
            )) : <EmptyRow text="No pull requests found." />}
          </div>
        ) : null}

        {!loading && tab === "issues" ? (
          <div className="space-y-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            {issues?.items?.length ? issues.items.map((issue: any) => (
              <div key={issue.id} className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 last:border-b-0 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {issue.state === "open" ? <Circle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    <a href={issue.htmlUrl} target="_blank" className="truncate font-semibold text-slate-900 dark:text-white hover:underline">{issue.title}</a>
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">#{issue.number} -+ {issue.repo} -+ {issue.author} -+ {rel(issue.createdAt)}</div>
                </div>
                <button type="button" onClick={() => void importIssue(String(issue.id))} className="rounded-lg border border-slate-200 dark:border-zinc-700 px-2 py-1 text-xs">
                  Import as task
                </button>
              </div>
            )) : <EmptyRow text="No issues found." />}
          </div>
        ) : null}

        {!loading && tab === "workflows" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Workflow summary (7 days)</div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workflows?.chart || []}>
                    <XAxis dataKey="day" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="success" stackId="a" fill="#34d399" />
                    <Bar dataKey="failed" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="other" stackId="a" fill="#94a3b8" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
              {workflows?.items?.length ? workflows.items.map((run: any) => (
                <div key={run.id} className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 last:border-b-0 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900 dark:text-white">{run.workflowName} #{run.runNumber}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">{run.repo} -+ {run.branch} -+ {run.event} -+ {rel(run.startedAt)}</div>
                  </div>
                  <a href={run.htmlUrl} target="_blank" className="inline-flex items-center gap-1 text-xs hover:underline">View logs <ExternalLink className="w-3 h-3" /></a>
                </div>
              )) : <EmptyRow text="No workflow runs found." />}
            </div>
          </div>
        ) : null}

        {!loading && tab === "branches" ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
            {branches?.items?.length ? branches.items.map((b: any) => (
              <div key={`${b.repo}-${b.name}`} className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-800 last:border-b-0 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => void navigator.clipboard.writeText(String(b.name || ""))} className="font-mono text-sm">{b.name}</button>
                    {b.isDefault ? <span className="rounded-full border border-slate-200 dark:border-zinc-700 px-2 py-0.5 text-[10px]">Default</span> : null}
                    {b.protected ? <span className="rounded-full border border-slate-200 dark:border-zinc-700 px-2 py-0.5 text-[10px]">Protected</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{b.repo}</div>
                </div>
                {!b.isDefault && !b.protected ? (
                  <button type="button" onClick={() => void deleteBranch(String(b.repo), String(b.name))} className="rounded-lg border border-slate-200 dark:border-zinc-700 px-2 py-1 text-xs">
                    Delete branch
                  </button>
                ) : null}
              </div>
            )) : <EmptyRow text="No branches found." />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-slate-600 dark:text-slate-300">{text}</div>;
}

function StatusIcon({ status }: { status: string }) {
  const s = String(status || "").toLowerCase();
  if (s.includes("success") || s.includes("open")) return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (s.includes("running") || s.includes("pending") || s.includes("in_progress")) return <Loader2 className="w-4 h-4 animate-spin text-amber-500" />;
  if (s.includes("failure") || s.includes("failed") || s.includes("cancel")) return <Clock3 className="w-4 h-4 text-amber-500" />;
  return <Circle className="w-4 h-4 text-slate-500" />;
}






