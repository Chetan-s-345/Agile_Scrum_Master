import { HomeNavbar } from "@/components/home-navbar";
import { HomeFooter } from "@/components/home-footer";
import { Bell, Bot, BrainCircuit, ChartNoAxesCombined, FileSearch, GitBranch, ShieldCheck, TimerReset, Workflow, Wrench } from "lucide-react";

export const metadata = {
  title: "Features - Agile Scrum Master",
  description: "Discover our powerful features built for agile teams",
};

export default function FeaturesPage() {
  const advancedFeatures = [
    {
      icon: Bot,
      title: "Custom Agent Control",
      text: "Create, configure, pause, run, and monitor scrum agents with role-specific behavior and constraints.",
    },
    {
      icon: Bell,
      title: "Monitoring Alerts + Email",
      text: "Send monitoring summaries and alerts to notification targets via Brevo with run feedback in UI.",
    },
    {
      icon: BrainCircuit,
      title: "AI Sprint Autopilot",
      text: "Generate sprint plans, task suggestions, and execution guidance using AI-assisted workflows.",
    },
    {
      icon: Workflow,
      title: "Approval Workflows",
      text: "Human-in-the-loop approvals for sensitive automation actions with approve/reject pathways.",
    },
    {
      icon: GitBranch,
      title: "GitHub + Jira Integrations",
      text: "Sync repositories, issues, and delivery events with integrated workflow visibility.",
    },
    {
      icon: ChartNoAxesCombined,
      title: "Board Analytics",
      text: "Track sprint progress, burndown, risk scores, velocity, and team load from one dashboard.",
    },
    {
      icon: TimerReset,
      title: "Timeline & Dependency View",
      text: "Visualize timelines, task dependencies, and critical delivery blockers across sprint execution.",
    },
    {
      icon: ShieldCheck,
      title: "Webhook Reliability",
      text: "Retry failed deliveries and inspect DLQ events to keep automation channels reliable.",
    },
    {
      icon: FileSearch,
      title: "Live Agent Activity",
      text: "Inspect created tasks, assignment actions, and decisions from agent runs with fallback visibility.",
    },
    {
      icon: Wrench,
      title: "Org Billing & Plan Controls",
      text: "Manage plan upgrades, coupon application, billing cycle selection, and checkout confirmation flows.",
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <HomeNavbar />
      <main className="mx-auto max-w-7xl px-6 py-20">
        <section className="mb-10 space-y-4">
          <h1 className="text-5xl font-bold tracking-tight">Feature Documentation</h1>
          <p className="max-w-3xl text-lg text-[var(--text-secondary)]">
            Detailed, enterprise-grade capabilities available across planning, assignment, monitoring, integrations, and governance.
          </p>
        </section>

        <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 lg:sticky lg:top-20">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Features Index</div>
            <nav className="space-y-1.5">
              {advancedFeatures.map((feature) => {
                const id = feature.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                return (
                  <a
                    key={feature.title}
                    href={`#${id}`}
                    className="block rounded-md px-2.5 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                  >
                    {feature.title}
                  </a>
                );
              })}
            </nav>
          </aside>

          <div className="space-y-5">
            {advancedFeatures.map((feature) => {
              const Icon = feature.icon;
              const id = feature.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
              return (
                <article
                  id={id}
                  key={feature.title}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
                    <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">{feature.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{feature.text}</p>
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
                    This capability is available in the current implementation and is designed to integrate with sprint workflows, board visibility, and automation controls with predictable enterprise behavior.
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
