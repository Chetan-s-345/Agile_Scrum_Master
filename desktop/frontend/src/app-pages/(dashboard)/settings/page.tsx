"use client";

import Link from '@/next-shims/link';
import { usePathname } from '@/next-shims/navigation';
import { Settings } from 'lucide-react';

const SETTINGS_NAV_ITEMS = [
  { label: 'Profile', href: '/settings/profile' },
  { label: 'Organization', href: '/settings/org' },
  { label: 'Team', href: '/settings/team' },
  { label: 'Billing', href: '/settings/billing' },
  { label: 'Integrations', href: '/settings/integrations' },
  { label: 'Developer Management', href: '/settings/developer-management' },
  { label: 'Preferences', href: '/settings/preferences' },
];

export default function SettingsPage() {
  const pathname = usePathname();
  const activePath = pathname === '/settings' ? '/settings/profile' : pathname;

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[240px,1fr] gap-6">
          <aside className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 h-fit">
            <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Settings</div>
            <nav className="space-y-1">
              {SETTINGS_NAV_ITEMS.map((item) => {
                const isActive = activePath === item.href || activePath.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-md px-3 py-2 text-sm transition ${
                      isActive
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <section>
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
                <Settings className="w-8 h-8" />
                Settings
              </h1>
              <p className="text-slate-600 dark:text-slate-300">
                Configure project connections and preferences
              </p>
              <div className="mt-3">
                <Link
                  href="/settings/profile"
                  className="inline-flex rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
                >
                  Open Profile Settings
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <Link
                href="/settings/org"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Organization</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Org profile, preferences, and defaults.
                </div>
              </Link>

              <Link
                href="/settings/team"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Team</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Invite members and manage roles.
                </div>
              </Link>

              <Link
                href="/settings/developer-management"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Developer Management</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Add, remove, and review developer roles.
                </div>
              </Link>

              <Link
                href="/teams"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Teams Hub</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Collaboration, join requests, and team scoring.
                </div>
              </Link>

              <Link
                href="/developers"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Developer Tools</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  API keys, webhooks, and usage monitoring.
                </div>
              </Link>

              <Link
                href="/settings/integrations"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Integrations</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Connect third-party services and APIs.
                </div>
              </Link>

              <Link
                href="/settings/billing"
                className="block rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:shadow-md transition"
              >
                <div className="text-lg font-bold text-slate-900 dark:text-white">Billing</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Manage your plan and payment methods.
                </div>
              </Link>
            </div>

            <div className="mt-4 p-3 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg mb-6">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                 Total weights must equal 100% to save configuration
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
