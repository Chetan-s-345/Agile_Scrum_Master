"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { label: "Summary", href: "/board/summary" },
  { label: "Backlog", href: "/board/backlog" },
  { label: "Board", href: "/board" },
  { label: "Code", href: "/board/code" },
  { label: "Timeline", href: "/board/timeline" },
  { label: "Pages", href: "/board/pages" },
  { label: "Forms", href: "/board/forms" },
];

export function BoardTabs() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/board") return pathname === "/board";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-[#2a2a2a] pb-3 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
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
