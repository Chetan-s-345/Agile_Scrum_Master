"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const tabs = [
  { label: "Summary", href: "/board/summary" },
  { label: "Backlog", href: "/board/backlog" },
  { label: "Board", href: "/board" },
  { label: "Code", href: "/board/code" },
  { label: "Timeline", href: "/board/timeline" },
  { label: "Forms", href: "/board/forms" },
];

export function BoardTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function isActive(href: string) {
    if (href === "/board") return pathname === "/board";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function withContext(href: string): string {
    const next = new URLSearchParams();
    const sprintId = String(searchParams?.get("sprintId") || "").trim();
    const projectId = String(searchParams?.get("projectId") || "").trim();
    if (sprintId) next.set("sprintId", sprintId);
    if (projectId) next.set("projectId", projectId);
    const query = next.toString();
    return query ? `${href}?${query}` : href;
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-[var(--border)] pb-3 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={withContext(tab.href)}
          className={
            isActive(tab.href)
              ? "rounded px-3 py-1.5 border-b-2 border-white text-white font-semibold"
              : "rounded px-3 py-1.5 text-[#a9a9a9] hover:bg-[#2a2a2a] hover:text-white"
          }
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
