"use client";

import Image from "@/next-shims/image";
import Link from "@/next-shims/link";
import { Grid2x2PlusIcon } from "lucide-react";

type FooterLink = {
  title: string;
  href: string;
};

type FooterSection = {
  label: string;
  links: FooterLink[];
};

const footerSections: FooterSection[] = [
  {
    label: "Product",
    links: [
      { title: "Features", href: "/features" },
      { title: "Pricing", href: "/pricing" },
      { title: "Solution", href: "/solution" },
      { title: "Platform", href: "/board" },
    ],
  },
  {
    label: "Workspace",
    links: [
      { title: "Dashboard", href: "/dashboard" },
      { title: "Board", href: "/board" },
      { title: "Tasks", href: "/tasks" },
      { title: "Teams", href: "/teams" },
    ],
  },
  {
    label: "Account",
    links: [
      { title: "Sign In", href: "/auth/sign-in" },
      { title: "Sign Up", href: "/auth/sign-up" },
      { title: "Login", href: "/login" },
      { title: "Register", href: "/register" },
    ],
  },
  {
    label: "Support",
    links: [
      { title: "Roadmap", href: "/solution" },
      { title: "Team Workflow", href: "/features" },
      { title: "Compare Plans", href: "/pricing" },
      { title: "Platform", href: "/board" },
    ],
  },
];

export function HomeFooter() {
  return (
    <footer className="mt-16 w-full border-t border-[var(--border)] bg-[linear-gradient(180deg,var(--bg-app)_0%,var(--bg-card)_45%,var(--bg-app)_100%)]">
      <div className="w-full px-6 py-12 md:px-10 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Link href="/" className="inline-flex items-center gap-3" aria-label="Go to home">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
                <Grid2x2PlusIcon className="h-5 w-5 text-[var(--accent-blue)]" />
              </span>
              <span className="font-mono text-2xl font-bold tracking-tight text-[var(--text-primary)]">Sprint</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
              Agentic Scrum workspace for planning, delivery, monitoring, and team execution in one place.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5">
              <span className="text-xs text-[var(--text-secondary)]">Hosted on</span>
              <Image src="/vercel.svg" alt="Vercel" width={74} height={16} className="h-3.5 w-auto dark:invert" />
            </div>
            <p className="mt-6 text-xs text-[var(--text-muted)]">
              © {new Date().getFullYear()} Agile Scrum Master. All rights reserved.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-3">
            {footerSections.map((section) => (
              <div key={section.label}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">{section.label}</h3>
                <ul className="mt-4 space-y-2.5">
                  {section.links.map((link) => (
                    <li key={link.title}>
                      <Link href={link.href} className="text-sm text-[var(--text-primary)] transition hover:text-[var(--accent-blue)]">
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

export { HomeFooter as Footer };