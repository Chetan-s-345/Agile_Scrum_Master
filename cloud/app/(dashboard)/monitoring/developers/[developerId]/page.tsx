"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Github, Loader2, ShieldAlert, UserRound } from "lucide-react";

type DeveloperRecord = Record<string, unknown>;

type BurnoutItem = {
  developerId: string;
  name: string;
  consecutiveOverSprints: number;
  avgOverloadPct: number;
  alertLevel: string;
};

type CapacityItem = {
  name: string;
  role?: string | null;
  maxSprintCapacity: number;
  currentSprintLoad: number;
  remainingCapacity: number;
  utilizationPct: number;
  meritScore: number;
  burnoutRiskFlag: boolean;
};

type DeveloperResp = { developer?: DeveloperRecord; error?: string } | (DeveloperRecord & { error?: never });
type BurnoutResp = { items: BurnoutItem[]; error?: string };
type CapacityResp = { items: CapacityItem[]; totals?: { maxSprintCapacity: number; currentSprintLoad: number; overallUtilizationPct: number }; error?: string };
type GitHubOverviewResp = {
  metrics?: { openPrs?: number; openIssues?: number; failedWorkflows?: number; commitsThisWeek?: number };
  repos?: string[];
  commits?: Array<Record<string, unknown>>;
  pullRequests?: Array<Record<string, unknown>>;
  workflows?: Array<Record<string, unknown>>;
  error?: string;
};
type ListResp<T> = { items?: T[]; error?: string };

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickString(source: DeveloperRecord | null, keys: string[]): string {
  if (!source) return "";
  for (const key of keys) {
    const value = asString(source[key]);
    if (value) return value;
  }
  return "";
}

export default function MonitoringDeveloperPage() {
  const params = useParams<{ developerId: string }>();
  const developerId = String(params?.developerId || "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [developer, setDeveloper] = useState<DeveloperRecord | null>(null);
  const [burnout, setBurnout] = useState<BurnoutItem | null>(null);
  const [capacity, setCapacity] = useState<CapacityItem | null>(null);
  const [githubOverview, setGithubOverview] = useState<GitHubOverviewResp | null>(null);
  const [recentCommits, setRecentCommits] = useState<Array<Record<string, unknown>>>([]);
  const [recentPullRequests, setRecentPullRequests] = useState<Array<Record<string, unknown>>>([]);

  const displayName = useMemo(
    () => pickString(developer, ["fullName", "displayName", "name", "title"]) || developerId,
    [developer, developerId]
  );
  const githubHandle = useMemo(
    () => pickString(developer, ["githubUsername", "githubHandle", "githubLogin", "github", "username", "handle"]),
    [developer]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!developerId) {
        setLoading(false);
        setError("Missing developer id");
        return;
      }

      setLoading(true);
      setError(null);

      const [developerResp, burnoutResp, capacityResp, githubResp] = await Promise.all([
        fetchJson<DeveloperResp>(`/api/developers/${encodeURIComponent(developerId)}`),
        fetchJson<BurnoutResp>("/api/monitoring/burnout"),
        fetchJson<CapacityResp>("/api/monitoring/capacity"),
        fetchJson<GitHubOverviewResp>(`/api/github/overview?developerId=${encodeURIComponent(developerId)}`),
      ]);

      if (cancelled) return;

      let resolvedDeveloper: DeveloperRecord | null = null;

      if (!developerResp.ok) {
        const listResp = await fetchJson<{ items?: DeveloperRecord[] }>("/api/developers");
        const items = Array.isArray(listResp.data?.items) ? listResp.data.items : [];
        const needle = developerId.toLowerCase();
        resolvedDeveloper = items.find((item) => {
          const itemId = pickString(item, ["id", "developerId", "userId", "uuid"]).toLowerCase();
          const itemName = pickString(item, ["fullName", "displayName", "name", "title"]).toLowerCase();
          return itemId === needle || itemName === needle;
        }) || null;

        if (!resolvedDeveloper) {
          setDeveloper(null);
          const message = typeof developerResp.data === "object" && developerResp.data && "error" in developerResp.data
            ? String((developerResp.data as { error?: string }).error || `Failed to load developer (${developerResp.status})`)
            : `Failed to load developer (${developerResp.status})`;
          setError(message);
          setLoading(false);
          return;
        }
      } else {
        resolvedDeveloper = typeof developerResp.data === "object" && developerResp.data && "developer" in developerResp.data
          ? (developerResp.data as { developer?: DeveloperRecord }).developer || null
          : (developerResp.data as DeveloperRecord | null);
      }

      setDeveloper(resolvedDeveloper);
      const developerName = pickString(resolvedDeveloper, ["fullName", "displayName", "name", "title"]);
      const nameForMatching = developerName || developerId;
      const capacityMatch = Array.isArray(capacityResp.data?.items)
        ? capacityResp.data.items.find((item) => item.name.toLowerCase() === nameForMatching.toLowerCase()) || null
        : null;
      const burnoutMatch = Array.isArray(burnoutResp.data?.items)
        ? burnoutResp.data.items.find((item) => item.developerId === developerId || item.name.toLowerCase() === nameForMatching.toLowerCase()) || null
        : null;

      setCapacity(capacityMatch);
      setBurnout(burnoutMatch);
      setGithubOverview(githubResp.ok ? githubResp.data : null);

      const author = githubHandle || developerName || developerId;
      if (author) {
        const encodedAuthor = encodeURIComponent(author);
        const [commitsResp, prsResp] = await Promise.all([
          fetchJson<ListResp<Record<string, unknown>>>(`/api/github/commits?author=${encodedAuthor}&page=1&perPage=10`),
          fetchJson<ListResp<Record<string, unknown>>>(`/api/github/pull-requests?author=${encodedAuthor}&page=1&perPage=10`),
        ]);

        if (!cancelled) {
          setRecentCommits(Array.isArray(commitsResp.data?.items) ? commitsResp.data.items : []);
          setRecentPullRequests(Array.isArray(prsResp.data?.items) ? prsResp.data.items : []);
        }
      }

      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [developerId, githubHandle]);

  const repoCount = githubOverview?.repos?.length || 0;
  const githubMetrics = githubOverview?.metrics || null;
  const capacityUsage = capacity ? `${capacity.currentSprintLoad}/${capacity.maxSprintCapacity} (${Math.round(capacity.utilizationPct * 10) / 10}%)` : "Unavailable";
  const burnoutLabel = burnout ? `${burnout.alertLevel} • ${burnout.consecutiveOverSprints} sprints` : "Unavailable";

  return (
    <div className="min-h-screen bg-white px-4 py-8 dark:bg-black">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <UserRound className="h-7 w-7 text-slate-900 dark:text-white" />
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{displayName}</h1>
            </div>
            <p className="mt-2 text-slate-600 dark:text-slate-300">Monitoring profile for {developerId}</p>
            {githubHandle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">GitHub: {githubHandle}</p> : null}
          </div>

          <Link
            href="/monitoring"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
          >
            Back to monitoring
          </Link>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading developer profile...
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Capacity" value={capacityUsage} />
          <StatCard label="Burnout" value={burnoutLabel} />
          <StatCard label="GitHub repos" value={String(repoCount)} />
          <StatCard label="Commits this week" value={String(githubMetrics?.commitsThisWeek ?? recentCommits.length)} />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <ShieldAlert className="h-4 w-4" />
              Snapshot
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field label="Role" value={pickString(developer, ["role", "title", "position"]) || "Unknown"} />
              <Field label="Team" value={pickString(developer, ["team", "group", "department"]) || "Unknown"} />
              <Field label="Capacity score" value={capacity ? String(Math.round(capacity.meritScore * 10) / 10) : "Unavailable"} />
              <Field label="Burnout risk" value={burnout?.alertLevel || "Unavailable"} />
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-black/20">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Profile fields</div>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                {[
                  ["Email", pickString(developer, ["email", "workEmail", "mail"])],
                  ["GitHub handle", githubHandle],
                  ["Status", pickString(developer, ["status", "availabilityStatus"])],
                  ["Developer id", developerId],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{String(value || "Unavailable")}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Github className="h-4 w-4" />
              GitHub activity
            </div>

            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-zinc-800 dark:bg-black/20 dark:text-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">Open PRs</span>
                  <span>{String(githubMetrics?.openPrs ?? recentPullRequests.length)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="font-semibold">Open issues</span>
                  <span>{String(githubMetrics?.openIssues ?? 0)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="font-semibold">Failed workflows</span>
                  <span>{String(githubMetrics?.failedWorkflows ?? 0)}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>Recent commits</span>
                  <span>{recentCommits.length}</span>
                </div>
                <div className="mt-2 space-y-2">
                  {recentCommits.length ? recentCommits.slice(0, 5).map((commit, index) => (
                    <ActivityRow key={`${index}-${String(commit.sha || commit.id || "commit")}`} item={commit} kind="commit" />
                  )) : (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-zinc-800 dark:text-slate-300">No commit activity found.</div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>Recent pull requests</span>
                  <span>{recentPullRequests.length}</span>
                </div>
                <div className="mt-2 space-y-2">
                  {recentPullRequests.length ? recentPullRequests.slice(0, 5).map((pr, index) => (
                    <ActivityRow key={`${index}-${String(pr.id || pr.number || "pr")}`} item={pr} kind="pr" />
                  )) : (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-zinc-800 dark:text-slate-300">No pull request activity found.</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <ArrowUpRight className="h-4 w-4" />
            Linked work
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ListPanel title="Capacity snapshot" emptyText="No capacity record available.">
              {capacity ? (
                <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
                  <div>Load: {capacity.currentSprintLoad}</div>
                  <div>Remaining: {capacity.remainingCapacity}</div>
                  <div>Utilization: {Math.round(capacity.utilizationPct * 10) / 10}%</div>
                  <div>Risk flag: {capacity.burnoutRiskFlag ? "Yes" : "No"}</div>
                </div>
              ) : null}
            </ListPanel>

            <ListPanel title="Developer record" emptyText="No developer record loaded.">
              {developer ? (
                <pre className="max-h-80 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-800 dark:bg-black/30 dark:text-slate-200">
                  {JSON.stringify(developer, null, 2)}
                </pre>
              ) : null}
            </ListPanel>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</div>
      <div className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

function ListPanel({ title, emptyText, children }: { title: string; emptyText: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-black/20">
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      <div className="mt-3">{children || <div className="text-sm text-slate-600 dark:text-slate-300">{emptyText}</div>}</div>
    </div>
  );
}

function ActivityRow({ item, kind }: { item: Record<string, unknown>; kind: "commit" | "pr" }) {
  const title = asString(item.message) || asString(item.title) || asString(item.summary) || asString(item.sha) || asString(item.id) || "Activity";
  const repo = asString(item.repo) || asString(item.repository) || asString(item.repositoryName);
  const url = asString(item.htmlUrl) || asString(item.url);
  const createdAt = asString(item.authoredAt) || asString(item.createdAt) || asString(item.updatedAt);

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900 dark:text-white">{title}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {repo || kind.toUpperCase()}
            {createdAt ? ` • ${createdAt}` : ""}
          </div>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:underline dark:text-slate-200">
            Open
          </a>
        ) : null}
      </div>
    </div>
  );
}
