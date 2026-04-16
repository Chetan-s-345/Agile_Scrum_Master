import Link from "@/next-shims/link";

type GithubConnectEmptyStateProps = {
  title?: string;
  description?: string;
};

export function GithubConnectEmptyState({
  title = "GitHub is not connected",
  description = "Connect GitHub first to start syncing repositories and activity.",
}: GithubConnectEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
      <p className="mt-2 text-slate-600 dark:text-slate-300">{description}</p>
      <div className="mt-5">
        <Link
          href="/api/auth/github/start"
          className="inline-flex rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-100 dark:bg-emerald-900/30 px-5 py-2.5 text-sm font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
        >
          Connect GitHub
        </Link>
      </div>
    </div>
  );
}
