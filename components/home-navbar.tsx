"use client";

import Link from "next/link";
import { Grid2x2PlusIcon, Menu, X, Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";
import { useState, useEffect } from "react";

export function HomeNavbar() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const links = [
    { label: "Features", href: "/features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Solution", href: "/solution" },
    { label: "About", href: "/about" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-zinc-800 bg-white/80 dark:bg-black/80 backdrop-blur">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="home">
          <Grid2x2PlusIcon className="size-6 text-blue-600" />
          <span className="font-mono text-lg font-bold text-slate-900 dark:text-white">Sprint</span>
        </Link>

        {/* Desktop Links */}
        <div className="hidden lg:flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition"
            aria-label="Toggle theme"
          >
            {mounted && (theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />)}
            {!mounted && <div className="size-5" />}
          </button>
          <div className="hidden lg:flex items-center gap-4">
            <Link 
              href="/auth/sign-in" 
              className="text-sm font-medium text-slate-900 dark:text-white hover:underline"
            >
              Sign In
            </Link>
            <Link
              href="/auth/sign-up"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition"
            >
              Get Started
            </Link>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="lg:hidden p-2 text-slate-900 dark:text-white"
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {open && (
        <div className="lg:hidden border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-black p-4 space-y-4">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="block text-sm font-medium text-slate-600 dark:text-slate-400"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-4 border-t border-slate-200 dark:border-zinc-800 flex flex-col gap-3">
            <Link 
              href="/auth/sign-in" 
              className="block text-center py-2 text-slate-900 dark:text-white bg-slate-100 dark:bg-zinc-900 rounded-lg"
            >
              Sign In
            </Link>
            <Link
              href="/auth/sign-up"
              className="block text-center py-2 bg-blue-600 text-white rounded-lg font-bold"
            >
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}