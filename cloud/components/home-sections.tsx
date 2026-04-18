import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Gauge,
  GitBranch,
  ShieldCheck,
  Users2,
  Zap,
} from "lucide-react";

const capabilities = [
  { icon: Zap, title: "Agentic Sprint Planning", text: "Generate sprint scope, priorities, and action plans from live backlog context." },
  { icon: Users2, title: "Intelligent Assignment", text: "Assign tasks by role, workload, and sprint health signals across the team." },
  { icon: AlertTriangle, title: "Risk Monitoring", text: "Detect delays, bottlenecks, and blockers early with automated monitoring agents." },
  { icon: BarChart3, title: "Delivery Analytics", text: "Track burndown, velocity, cycle time, and completion trends in one view." },
  { icon: GitBranch, title: "GitHub + Jira Flow", text: "Connect repo and issue activity directly to board execution and sprint planning." },
  { icon: ShieldCheck, title: "Approval Guardrails", text: "Apply human-in-the-loop approvals for sensitive or high-impact automation actions." },
];

const outcomes = [
  { label: "Projects Managed", value: "150+" },
  { label: "Automation Actions", value: "1.2M+" },
  { label: "Teams Onboarded", value: "500+" },
  { label: "Avg Cycle Time", value: "2.4 days" },
];

const executionStages = ["Plan", "Assign", "Monitor", "Optimize"];

export function HomeSections() {
  return (
    <div className="relative z-20 bg-[var(--bg-app)] text-[var(--text-primary)]">
      <section className="mx-auto w-full max-w-7xl px-6 py-14">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Enterprise Delivery Workspace</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
                A structured execution stack inspired by modern product platforms, adapted for scrum teams and AI-assisted delivery.
              </p>
            </div>
            <Link
              href="/features"
              className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              Explore Full Feature Docs
            </Link>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((capability) => (
              <article
                key={capability.title}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition duration-200 hover:border-[var(--border-focus)]"
              >
                <capability.icon className="h-5 w-5 text-[var(--accent-blue)]" />
                <h3 className="mt-3 text-sm font-semibold">{capability.title}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{capability.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Execution Lifecycle</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Minimal, predictable flow for every sprint iteration.</p>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            {executionStages.map((stage, idx) => (
              <div key={stage} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#2d63c9] text-xs font-semibold text-white">
                  {idx + 1}
                </div>
                <div className="mt-2 text-sm font-semibold">{stage}</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {stage === "Plan" && "Backlog shaping, sprint goal creation, and agent guidance."}
                  {stage === "Assign" && "Role-aware distribution of tasks with workload balancing."}
                  {stage === "Monitor" && "Continuous risk and dependency tracking throughout sprint."}
                  {stage === "Optimize" && "Velocity and burndown insights to improve next sprint."}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {outcomes.map((outcome) => (
            <div key={outcome.label} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{outcome.label}</div>
              <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{outcome.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-20 pt-8">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center">
          <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)]">
            <Gauge className="h-5 w-5 text-[#89b4ff]" />
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">Run Sprints Like an Enterprise Product Team</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
            Keep planning, execution, monitoring, and analytics in one cohesive workspace with lightweight motion and clear structure.
          </p>
          <Link
            href="/auth/sign-up"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#2d63c9] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2455b3]"
          >
            <CheckCircle2 className="h-4 w-4" />
            Get Started Free
          </Link>
        </div>
      </section>
    </div>
  );
}
