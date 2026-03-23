"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Grid2x2PlusIcon, 
  LayoutDashboard, 
  Bot,
  Zap, 
  ListTodo, 
  Users, 
  TouchpadOff, 
  BarChart3, 
  Activity,
  Flag,
  Settings,
  AlertTriangle,
  Menu,
  X
} from "lucide-react";
import { useEffect, useState } from "react";

const navigation = [
  { id: "dashboard", name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { id: "sprint-plan", name: "Sprint Plan", href: "/sprint_plan", icon: Zap },
  { id: "scrum-master", name: "Agentic Scrum Master", href: "/scrum-master", icon: Bot },
  { id: "sprints", name: "Sprints", href: "/sprint", icon: Flag },
  { id: "tasks", name: "Tasks", href: "/tasks", icon: ListTodo },
  { id: "developers", name: "Developers", href: "/developers", icon: Users },
  { id: "assignment", name: "Assignment", href: "/assign", icon: TouchpadOff },
  { id: "monitoring", name: "Monitoring", href: "/monitoring", icon: Activity },
  { id: "reports", name: "Reports", href: "/reports", icon: BarChart3 },
  { id: "admin-webhooks", name: "Admin Webhooks", href: "/admin/webhooks", icon: AlertTriangle },
  { id: "settings", name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [dlqCount, setDlqCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDlqCount() {
      try {
        const resp = await fetch('/api/admin/webhooks/dlq?limit=1', { cache: 'no-store' });
        const data = await resp.json().catch(() => null);
        if (cancelled) return;
        if (!resp.ok || !data || typeof data !== 'object') {
          setDlqCount(0);
          return;
        }
        const total = Number((data as { total?: unknown }).total || 0);
        setDlqCount(Number.isFinite(total) ? total : 0);
      } catch {
        if (!cancelled) setDlqCount(0);
      }
    }

    void loadDlqCount();
    const id = window.setInterval(() => {
      void loadDlqCount();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  const NavLink = ({ item }: { item: typeof navigation[0] }) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    const showDlqBadge = item.id === 'admin-webhooks' && dlqCount > 0;

    return (
      <Link
        href={item.href}
        onClick={() => setIsOpen(false)}
        className={`flex items-center gap-3 px-4 py-2 rounded-lg transition border ${
          active
            ? "bg-slate-100 dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-white"
            : "border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-zinc-900"
        }`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className="font-medium text-sm">{item.name}</span>
        {showDlqBadge ? (
          <span className="ml-auto inline-flex min-w-5 justify-center rounded-full border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-200">
            {dlqCount}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black hover:bg-slate-100 dark:hover:bg-zinc-900 transition text-slate-700 dark:text-slate-300"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 h-screen w-64 bg-white dark:bg-black border-r border-slate-200 dark:border-zinc-800 overflow-y-auto transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="sticky top-0 flex items-center gap-2 px-6 py-4 bg-white dark:bg-black border-b border-slate-200 dark:border-zinc-800 z-10">
          <Grid2x2PlusIcon className="w-8 h-8 text-blue-600" />
          <span className="font-mono text-lg font-bold text-slate-900 dark:text-white">Sprint</span>
        </div>

        {/* Main Navigation */}
        <nav className="px-4 py-6 space-y-2">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-2 mb-4">
            Applications
          </div>
          {navigation.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

      </aside>
    </>
  );
}
