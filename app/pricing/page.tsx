import { HomeNavbar } from "@/components/home-navbar";
import { HomeFooter } from "@/components/home-footer";
import Link from "next/link";

export const metadata = {
  title: "Pricing - Agile Scrum Master",
  description: "Simple, transparent pricing for teams of all sizes.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <HomeNavbar />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-12">
          <section className="space-y-4 text-center">
            <h1 className="text-5xl font-bold text-[var(--text-primary)]">Simple INR Pricing</h1>
            <p className="text-xl text-[var(--text-secondary)]">
              Transparent Indian Rupee pricing with clear monthly and annual billing options.
            </p>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Billing Options</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="text-sm font-semibold text-[var(--text-primary)]">Monthly Billing</div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Pay month-to-month with full flexibility.</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                <div className="text-sm font-semibold text-[var(--text-primary)]">Annual Billing</div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Pay yearly and save about 15%.</p>
              </div>
            </div>
          </section>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {/* Free Tier */}
            <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[linear-gradient(145deg,#0b0b0d,#121725)] p-8">
              <h3 className="text-2xl font-bold text-[var(--text-primary)]">Starter</h3>
              <p className="mt-2 text-[var(--text-secondary)]">Perfect for small teams getting started.</p>
              <div className="mb-8 mt-6 text-4xl font-bold text-[var(--text-primary)]">₹0<span className="text-lg font-normal text-[var(--text-secondary)]">/month</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> Up to 5 team members
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> Basic Kanban Boards
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> 1 Active Sprint
                </li>
              </ul>
              <Link
                href="/auth/sign-up"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
              >
                Start for Free
              </Link>
            </div>

            {/* Pro Tier */}
            <div className="relative flex scale-105 flex-col rounded-xl border-2 border-[#2d63c9] bg-[linear-gradient(145deg,#0f172b,#111c33)] p-8 shadow-xl">
              <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2d63c9] px-3 py-1 text-sm font-semibold text-white">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold text-[var(--text-primary)]">Pro</h3>
              <p className="mt-2 text-[var(--text-secondary)]">For growing teams requiring advanced tools.</p>
              <div className="mb-1 mt-6 text-4xl font-bold text-[var(--text-primary)]">₹799<span className="text-lg font-normal text-[var(--text-secondary)]">/user/month</span></div>
              <div className="mb-8 text-sm text-[#8cb3ff]">₹679/user/month when billed annually</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span className="text-[#8cb3ff]">✓</span> Unlimited team members
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span className="text-[#8cb3ff]">✓</span> Advanced Sprint Planning
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span className="text-[#8cb3ff]">✓</span> Velocity & Burndown Charts
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span className="text-[#8cb3ff]">✓</span> Priority Support
                </li>
              </ul>
              <div className="grid gap-2">
                <Link
                  href="/settings/billing?plan=pro&currency=INR&billing=monthly"
                  className="w-full rounded-lg bg-[#2d63c9] px-4 py-3 text-center font-bold text-white transition hover:bg-[#2454ad]"
                >
                  Choose Monthly
                </Link>
                <Link
                  href="/settings/billing?plan=pro&currency=INR&billing=annual"
                  className="w-full rounded-lg border border-[#2d63c9] bg-[#0f1a33] px-4 py-3 text-center font-semibold text-[#c7d9ff] transition hover:bg-[#132345]"
                >
                  Choose Annual (Save 15%)
                </Link>
              </div>
            </div>

            {/* Enterprise Tier */}
            <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[linear-gradient(145deg,#0b0b0d,#171717)] p-8">
              <h3 className="text-2xl font-bold text-[var(--text-primary)]">Enterprise</h3>
              <p className="mt-2 text-[var(--text-secondary)]">Custom solutions for large organizations.</p>
              <div className="mb-1 mt-6 text-4xl font-bold text-[var(--text-primary)]">₹1,999<span className="text-lg font-normal text-[var(--text-secondary)]">/user/month</span></div>
              <div className="mb-8 text-sm text-[var(--text-secondary)]">Annual contract pricing available for large teams</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> SSO & SAML
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> Dedicated Success Manager
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> Custom Workflows
                </li>
                <li className="flex items-center gap-3 text-[var(--text-secondary)]">
                  <span>✓</span> Advanced Security
                </li>
              </ul>
              <div className="grid gap-2">
                <Link
                  href="/settings/billing?plan=enterprise&currency=INR&billing=monthly"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
                >
                  Enterprise Monthly
                </Link>
                <Link
                  href="/settings/billing?plan=enterprise&currency=INR&billing=annual"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-center font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
                >
                  Enterprise Annual
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
