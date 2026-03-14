import Link from "next/link";

export default function BacklogPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Backlog</h1>
        <p className="text-slate-600 dark:text-slate-300">
          Backlog items come from Jira sync. Use the Sprint Planner to pull items into a sprint.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="text-slate-900 dark:text-white font-semibold">Next steps</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            - Connect Jira in Settings → Integrations
            <br />- Run a Jira sync
            <br />- Plan a sprint
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/settings/integrations"
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold"
            >
              Go to Integrations
            </Link>
            <Link
              href="/sprint/plan"
              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
            >
              Open Sprint Planner
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
