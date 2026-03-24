"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Bot,
  Bug,
  ChartColumn,
  CheckCircle2,
  Code2,
  GitBranch,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

const features = [
  { icon: Sparkles, title: "AI Sprint Planning", text: "Generate sprint scope from your existing backlog and priorities." },
  { icon: Workflow, title: "Automated Task Assignment", text: "Assign work by role, availability, and workflow context." },
  { icon: ChartColumn, title: "Smart Analytics & Burndown", text: "Track progress, risk, and sprint execution quality in one place." },
  { icon: Code2, title: "Developer Insights", text: "Get visibility into ownership, throughput, and bottlenecks." },
  { icon: Users, title: "Real-time Collaboration", text: "Keep teams aligned with shared sprint context and updates." },
  { icon: GitBranch, title: "Git/Tool Integration", text: "Connect delivery workflows with engineering tooling and activity." },
];

const agents = [
  { icon: Bot, title: "Scrum Master Agent", text: "Automates planning support, sprint cadence, and risk follow-ups." },
  { icon: Code2, title: "Developer Agent", text: "Automates assignment guidance and execution-state updates." },
  { icon: Bug, title: "QA Agent", text: "Automates quality checks and release-readiness signals." },
];

const steps = ["Create Project", "Add Team", "AI Plans Sprint", "Track & Optimize"];

function Fade({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.3, delay, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

export function HomeSections() {
  return (
    <div className="relative z-20 bg-white text-slate-900 dark:bg-black dark:text-white">
      <section className="mx-auto w-full max-w-7xl px-6 py-14">
        <Fade>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Features</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-zinc-300">Built for modern engineering teams with clean, focused workflows.</p>
        </Fade>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, idx) => (
            <Fade key={feature.title} delay={idx * 0.03}>
              <article className="rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
                <feature.icon className="h-5 w-5 text-slate-700 dark:text-zinc-200" />
                <h3 className="mt-3 text-sm font-semibold">{feature.title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-zinc-300">{feature.text}</p>
              </article>
            </Fade>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-8">
        <Fade>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">AI Agents</h2>
        </Fade>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {agents.map((agent, idx) => (
            <Fade key={agent.title} delay={idx * 0.04}>
              <article className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-5 transition hover:-translate-y-1 hover:shadow-md dark:border-zinc-800 dark:from-zinc-900 dark:to-black">
                <agent.icon className="h-5 w-5 text-slate-700 dark:text-zinc-200" />
                <h3 className="mt-3 text-base font-semibold">{agent.title}</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">{agent.text}</p>
              </article>
            </Fade>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-10">
        <Fade>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">How It Works</h2>
        </Fade>
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid gap-3 md:grid-cols-4">
            {steps.map((step, idx) => (
              <Fade key={step} delay={idx * 0.03}>
                <div className="relative rounded-xl border border-slate-200 p-4 dark:border-zinc-800">
                  {idx < steps.length - 1 ? <div className="absolute right-0 top-1/2 hidden h-px w-6 bg-slate-300 md:block dark:bg-zinc-700" /> : null}
                  <div className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white dark:bg-white dark:text-black">{idx + 1}</div>
                  <div className="mt-2 text-sm font-semibold">{step}</div>
                </div>
              </Fade>
            ))}
          </div>
        </div>
      </section>

      <section id="preview" className="mx-auto w-full max-w-7xl px-6 py-10">
        <Fade>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Product Preview</h2>
        </Fade>
        <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.25, ease: "easeInOut" }} className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="grid gap-3 md:grid-cols-3">
                {["To do", "In progress", "Done"].map((col) => (
                  <div key={col} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">{col}</div>
                    <div className="space-y-2">
                      {[1, 2].map((i) => (
                        <div key={`${col}-${i}`} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs dark:border-zinc-800">Sprint task {i}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-zinc-400">Analytics</div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-zinc-800"><span>Velocity</span><span className="font-semibold">+18%</span></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-zinc-800"><span>Cycle time</span><span className="font-semibold">2.4d</span></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-zinc-800"><span>Blocked</span><span className="font-semibold">3</span></div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 py-10">
        <Fade>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-slate-600 dark:text-zinc-300">Built for modern engineering teams</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-zinc-800"><div className="text-xs text-slate-500 dark:text-zinc-400">Projects managed</div><div className="text-xl font-semibold">150+</div></div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-zinc-800"><div className="text-xs text-slate-500 dark:text-zinc-400">Automation actions</div><div className="text-xl font-semibold">1.2M+</div></div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-zinc-800"><div className="text-xs text-slate-500 dark:text-zinc-400">Teams onboarded</div><div className="text-xl font-semibold">500+</div></div>
            </div>
          </div>
        </Fade>
      </section>

      <section className="mx-auto w-full max-w-7xl px-6 pb-20 pt-10">
        <Fade>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Start managing smarter with AI</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600 dark:text-zinc-300">Bring planning, execution, and optimization into one workflow.</p>
            <Link href="/auth/sign-up" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-black">
              <CheckCircle2 className="h-4 w-4" />
              Get Started Free
            </Link>
          </div>
        </Fade>
      </section>
    </div>
  );
}
