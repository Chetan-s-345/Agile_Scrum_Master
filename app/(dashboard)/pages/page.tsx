import Link from "next/link";

const docs = [
  {
    title: "Getting Started",
    description: "Account setup, first project, first sprint, and team onboarding.",
    href: "/changelog",
    note: "Read the full guide in docs/product/getting-started.md",
  },
  {
    title: "Pages Guide",
    description: "Route-by-route reference for all major product experiences.",
    href: "/dashboard",
    note: "Read the full guide in docs/product/pages-guide.md",
  },
  {
    title: "Features",
    description: "Task lifecycle, sprint management, agents, integrations, and reporting.",
    href: "/scrum-master",
    note: "Read the full guide in docs/product/features.md",
  },
  {
    title: "FAQ",
    description: "Answers to common questions from users, admins, and developers.",
    href: "/settings",
    note: "Read the full guide in docs/product/faq.md",
  },
  {
    title: "Troubleshooting",
    description: "Fixes for common integration, workflow, and UI issues.",
    href: "/monitoring",
    note: "Read the full guide in docs/product/troubleshooting.md",
  },
  {
    title: "Changelog",
    description: "Release notes and newly shipped capabilities.",
    href: "/changelog",
    note: "Read the full guide in docs/product/changelog.md",
  },
];

export default function PagesHubPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Pages</h1>
        <p className="text-slate-600 dark:text-slate-300">
          In-app documentation hub for onboarding, feature behavior, release history, and troubleshooting.
        </p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          {docs.map((doc) => (
            <article
              key={doc.title}
              className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
            >
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{doc.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{doc.description}</p>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{doc.note}</p>
              <Link
                href={doc.href}
                className="mt-4 inline-flex rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 text-sm font-semibold"
              >
                Open Related Page
              </Link>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
