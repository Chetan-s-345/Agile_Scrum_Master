import { HomeNavbar } from "@/components/home-navbar";

export const metadata = {
  title: "Pricing - Agile Scrum Master",
  description: "Simple, transparent pricing for teams of all sizes.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <HomeNavbar />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="space-y-12">
          <section className="space-y-4 text-center">
            <h1 className="text-5xl font-bold text-slate-900 dark:text-white">Simple Pricing</h1>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              No hidden fees. Scale your agile workflow effortlessly.
            </p>
          </section>

          <div className="grid md:grid-cols-3 gap-8 mt-12">
            {/* Free Tier */}
            <div className="p-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] flex flex-col">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Starter</h3>
              <p className="text-gray-500 mt-2">Perfect for small teams getting started.</p>
              <div className="text-4xl font-bold mt-6 mb-8">$0<span className="text-lg text-gray-500 font-normal">/mo</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> Up to 5 team members
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> Basic Kanban Boards
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> 1 Active Sprint
                </li>
              </ul>
              <button className="w-full py-3 px-4 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-900 dark:text-white rounded-lg font-semibold transition">
                Start for Free
              </button>
            </div>

            {/* Pro Tier */}
            <div className="p-8 rounded-xl border-2 border-blue-600 bg-blue-50/50 dark:bg-blue-900/10 flex flex-col relative transform scale-105 shadow-xl">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Pro</h3>
              <p className="text-gray-500 mt-2">For growing teams requiring advanced tools.</p>
              <div className="text-4xl font-bold mt-6 mb-8">$12<span className="text-lg text-gray-500 font-normal">/user/mo</span></div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-blue-600">✓</span> Unlimited team members
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-blue-600">✓</span> Advanced Sprint Planning
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-blue-600">✓</span> Velocity & Burndown Charts
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span className="text-blue-600">✓</span> Priority Support
                </li>
              </ul>
              <button className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition shadow-lg shadow-blue-500/30">
                Start Trial
              </button>
            </div>

            {/* Enterprise Tier */}
            <div className="p-8 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#0a0a0a] flex flex-col">
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Enterprise</h3>
              <p className="text-gray-500 mt-2">Custom solutions for large organizations.</p>
              <div className="text-4xl font-bold mt-6 mb-8">Custom</div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> SSO & SAML
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> Dedicated Success Manager
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> Custom Workflows
                </li>
                <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                  <span>✓</span> Advanced Security
                </li>
              </ul>
              <button className="w-full py-3 px-4 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-900 dark:text-white rounded-lg font-semibold transition">
                Contact Sales
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
