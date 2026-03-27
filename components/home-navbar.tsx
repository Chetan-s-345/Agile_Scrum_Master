"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Menu, X, Sun, Moon } from "lucide-react";
import { useState, useEffect } from "react";
import { getMe, signOut, type MeResponse } from "@/lib/org-member-auth";
import { useThemeStore } from "@/lib/theme-store";

export function HomeNavbar() {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMe();
        if (!cancelled) setMe(data);
      } finally {
        if (!cancelled) setMeLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
      setMe(null);
      setProfileOpen(false);
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const links = [
    { label: "Features", href: "/features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Changelog", href: "/changelog" },
    { label: "Docs", href: "/solution" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-zinc-800 bg-white/80 dark:bg-black/80 backdrop-blur">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="home">
          <Image
            src="/sprint-grid-logo.svg"
            alt="Sprint logo"
            width={24}
            height={24}
            className="h-6 w-6"
            priority
          />
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
            {me?.user ? (
              <>
                <Link
                  href="/board"
                  className="rounded-lg border border-[#2b3449] bg-[#151a25] px-4 py-2 text-sm font-bold text-[#dce4f3] transition hover:bg-[#1c2433]"
                >
                  Dashboard
                </Link>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProfileOpen((v) => !v)}
                    className="w-9 h-9 rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-center text-sm font-bold text-slate-900 dark:text-white"
                    aria-label="Open profile menu"
                  >
                    {String(me.user.fullName || me.user.email || "U")
                      .trim()
                      .slice(0, 1)
                      .toUpperCase()}
                  </button>

                  {profileOpen ? (
                    <div className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-2">
                      <div className="px-3 py-2 border-b border-slate-200 dark:border-zinc-800">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {me.user.fullName || "User"}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{me.user.email}</p>
                      </div>

                      <Link
                        href="/profile"
                        className="block px-3 py-2 rounded text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
                        onClick={() => setProfileOpen(false)}
                      >
                        Profile
                      </Link>
                      <Link
                        href="/settings"
                        className="block px-3 py-2 rounded text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
                        onClick={() => setProfileOpen(false)}
                      >
                        Settings
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="w-full text-left px-3 py-2 rounded text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950"
                        disabled={loggingOut}
                      >
                        {loggingOut ? "Logging out..." : "Logout"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : meLoaded ? (
              <>
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
              </>
            ) : null}
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
            {me?.user ? (
              <>
                <Link
                  href="/board"
                  className="block rounded-lg border border-[#2b3449] bg-[#151a25] py-2 text-center font-bold text-[#dce4f3]"
                  onClick={() => setOpen(false)}
                >
                  Dashboard
                </Link>
                <Link
                  href="/profile"
                  className="block text-center py-2 text-slate-900 dark:text-white bg-slate-100 dark:bg-zinc-900 rounded-lg"
                  onClick={() => setOpen(false)}
                >
                  Profile
                </Link>
                <Link
                  href="/settings"
                  className="block text-center py-2 text-slate-900 dark:text-white bg-slate-100 dark:bg-zinc-900 rounded-lg"
                  onClick={() => setOpen(false)}
                >
                  Settings
                </Link>
                <button
                  type="button"
                  className="block text-center py-2 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 rounded-lg"
                  onClick={() => {
                    setOpen(false);
                    void handleLogout();
                  }}
                  disabled={loggingOut}
                >
                  {loggingOut ? "Logging out..." : "Logout"}
                </button>
              </>
            ) : meLoaded ? (
              <>
                <Link
                  href="/auth/sign-in"
                  className="block text-center py-2 text-slate-900 dark:text-white bg-slate-100 dark:bg-zinc-900 rounded-lg"
                  onClick={() => setOpen(false)}
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/sign-up"
                  className="block text-center py-2 bg-blue-600 text-white rounded-lg font-bold"
                  onClick={() => setOpen(false)}
                >
                  Get Started
                </Link>
              </>
            ) : null}
          </div>
        </div>
      )}
    </header>
  );
}