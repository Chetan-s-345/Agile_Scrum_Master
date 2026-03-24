"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  CircleHelp,
  Crown,
  Plus,
  Search,
  Settings,
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const [sendingNotification, setSendingNotification] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<"idle" | "sent" | "error">("idle");

  const topRoutes = [
    { label: "Board", href: "/board" },
    { label: "Dashboard", href: "/dashboard" },
    { label: "Sprint Plan", href: "/sprint-plan" },
    { label: "Scrum Master", href: "/scrum-master" },
    { label: "Sprints", href: "/sprints" },
    { label: "Tasks", href: "/tasks" },
    { label: "Developers", href: "/developers" },
    { label: "Assignment", href: "/assignment" },
    { label: "Monitoring", href: "/monitoring" },
    { label: "Reports", href: "/reports" },
    { label: "Webhooks", href: "/webhooks" },
    { label: "Settings", href: "/settings" },
  ];

  function isRouteActive(href: string) {
    if (href === "/board") return pathname === "/board" || pathname.startsWith("/board/");
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function triggerEmailNotification() {
    setSendingNotification(true);
    setNotificationStatus("idle");
    try {
      const resp = await fetch("/api/notifications/brevo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "navbar-bell" }),
      });
      if (!resp.ok) throw new Error("Failed to send notification");
      setNotificationStatus("sent");
    } catch {
      setNotificationStatus("error");
    } finally {
      setSendingNotification(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 w-full border-b border-[#2a2a2a] bg-[#0d0d0d]">
      <nav className="flex h-16 items-center gap-3 border-b border-[#2a2a2a] px-4 sm:px-5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9f9f9f]" />
          <input
            type="search"
            placeholder="Search"
            className="h-10 w-full rounded-md border border-[#2a2a2a] bg-[#121212] pl-9 pr-3 text-sm text-white outline-none placeholder:text-[#9f9f9f] focus:border-white"
          />
        </div>

        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white bg-white px-3 text-sm font-semibold text-black"
        >
          <Plus className="h-4 w-4" />
          Create
        </button>

        <button
          type="button"
          className="hidden h-10 items-center gap-2 rounded-md border border-[#6a4aff] bg-[#231640] px-3 text-sm font-semibold text-[#d8c7ff] sm:inline-flex"
        >
          <Crown className="h-4 w-4" />
          See plans
        </button>

        <button
          type="button"
          onClick={() => void triggerEmailNotification()}
          disabled={sendingNotification}
          title={
            sendingNotification
              ? "Sending email..."
              : notificationStatus === "sent"
                ? "Email notification sent"
                : notificationStatus === "error"
                  ? "Failed to send email"
                  : "Send notification email"
          }
          className="rounded-md border border-[#2a2a2a] p-2.5 hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Bell className="h-4 w-4" />
        </button>
        <button type="button" className="rounded-md border border-[#2a2a2a] p-2.5 hover:bg-[#2a2a2a]">
          <CircleHelp className="h-4 w-4" />
        </button>
        <button type="button" className="rounded-md border border-[#2a2a2a] p-2.5 hover:bg-[#2a2a2a]">
          <Settings className="h-4 w-4" />
        </button>

        <div className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-[#2a2a2a] bg-[#1a1a1a] text-xs font-bold">
          DS
        </div>
      </nav>

      <div className="flex h-11 items-center gap-2 overflow-x-auto px-4 sm:px-5">
        {topRoutes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className={`whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
              isRouteActive(route.href)
                ? "border-white bg-white text-black"
                : "border-[#2a2a2a] text-[#b0b0b0] hover:bg-[#1a1a1a] hover:text-white"
            }`}
          >
            {route.label}
          </Link>
        ))}
      </div>
    </header>
  );
}
