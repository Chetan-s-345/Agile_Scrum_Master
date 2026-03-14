"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Grid2x2PlusIcon, 
  LayoutDashboard, 
  Zap, 
  ListTodo, 
  Users, 
  TouchpadOff, 
  BarChart3, 
  Settings,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Sprint Plan", href: "/sprint_plan", icon: Zap },
  { name: "Tasks", href: "/tasks", icon: ListTodo },
  { name: "Developers", href: "/developers", icon: Users },
  { name: "Assignment", href: "/assign", icon: TouchpadOff },
  { name: "Reports", href: "/reports", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(href);
  };

  const NavLink = ({ item }: { item: typeof navigation[0] }) => {
    const Icon = item.icon;
    const active = isActive(item.href);

    return (
      <Link
        href={item.href}
        onClick={() => setIsOpen(false)}
        className={`flex items-center gap-3 px-4 py-2 rounded-lg transition ${
          active
            ? "bg-blue-600 text-white shadow-md"
            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
        }`}
      >
        <Icon className="w-5 h-5 flex-shrink-0" />
        <span className="font-medium text-sm">{item.name}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
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
