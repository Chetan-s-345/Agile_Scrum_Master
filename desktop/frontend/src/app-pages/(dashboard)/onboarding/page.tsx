import Link from "@/next-shims/link";

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Onboarding</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          UI scaffold for a multi-step onboarding wizard.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="text-slate-900 dark:text-white font-semibold">Suggested steps</div>
          <ol className="mt-2 list-decimal pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>Connect Jira</li>
            <li>Invite team members</li>
            <li>Sync backlog</li>
            <li>Plan your first sprint</li>
          </ol>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/settings/integrations" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold">
              Connect Jira
            </Link>
            <Link href="/sprint/plan" className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800">
              Plan Sprint
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
