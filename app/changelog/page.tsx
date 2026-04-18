import { HomeNavbar } from "@/components/home-navbar";

export const metadata = {
  title: "Changelog - Sprint",
  description: "Product release notes and feature history for Sprint",
};

const releaseHighlights = {
  version: "1.0.0",
  date: "2026-03-27",
  sections: [
    {
      title: "Added - Agent System",
      items: [
        "Task Factory created tasks from issue and pull request events.",
        "Auto Assigner ranked developers by skill, load, and throughput.",
        "Monitor agent introduced daily risk and stale-task checks.",
        "Merge-aware automation closed linked tasks after PR merges.",
        "Agentic Scrum Master controls centralized automation management.",
      ],
    },
    {
      title: "Added - Core Platform",
      items: [
        "Email auth flows for sign-up, sign-in, reset, and verification.",
        "Organization onboarding, invitations, and role-aware membership.",
        "Sprint planning, sprint lifecycle, and sprint-level analytics.",
        "Task board and task detail experiences for execution tracking.",
        "Developer, assignment, monitoring, reporting, and standup modules.",
      ],
    },
    {
      title: "Added - Integrations",
      items: [
        "GitHub repository connection and webhook processing support.",
        "Inngest-powered background job orchestration.",
        "AI/ML endpoints for risk narration, standup summaries, and planning.",
        "Agent support for coding workflows and enriched task context.",
      ],
    },
    {
      title: "Added - Documentation",
      items: [
        "End-user product documentation under docs/product.",
        "In-app Pages hub at /pages for self-serve guidance.",
        "Public changelog route for release communication.",
      ],
    },
  ],
};

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <HomeNavbar />
      <main className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 sm:p-10">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white">Changelog</h1>
          <p className="mt-3 text-slate-600 dark:text-slate-300">
            Release notes for Sprint. Track platform capabilities, integration updates, and automation improvements.
          </p>

          <div className="mt-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 p-5">
            <p className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">Current Release</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
              {releaseHighlights.version}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">Released on {releaseHighlights.date}</p>
          </div>

          <div className="mt-10 space-y-8">
            {releaseHighlights.sections.map((section) => (
              <section key={section.title}>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{section.title}</h2>
                <ul className="mt-3 list-disc space-y-2 pl-6 text-slate-700 dark:text-slate-200">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
