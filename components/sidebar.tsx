"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Compass,
  Ellipsis,
  ExternalLink,
  Filter,
  Flag,
  Grid3X3,
  LayoutDashboard,
  ListTodo,
  PanelsTopLeft,
  Plus,
  Settings,
  Sparkles,
  Star,
  UserRound,
  Users,
  Workflow,
  Zap,
  Activity,
  ShieldAlert,
} from "lucide-react";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

type LinkItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  external?: boolean;
};

const mainLinks: LinkItem[] = [
  { label: "For you", href: "/board", icon: UserRound },
  { label: "Recent", href: "/sprints", icon: ChevronRight },
  { label: "Starred", href: "/reports", icon: Star },
  { label: "Apps", href: "/tasks", icon: AppWindow },
  { label: "Plans", href: "/sprint-plan", icon: Workflow },
  { label: "Spaces", href: "/board", icon: PanelsTopLeft },
];

const appPages: LinkItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Sprint Plan", href: "/sprint-plan", icon: Zap },
  { label: "Agentic Scrum Master", href: "/scrum-master", icon: Bot },
  { label: "Sprints", href: "/sprints", icon: Flag },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Developers", href: "/developers", icon: Users },
  { label: "Assignment", href: "/assignment", icon: Compass },
  { label: "Monitoring", href: "/monitoring", icon: Activity },
  { label: "Reports", href: "/reports", icon: BookOpen },
  { label: "Admin Webhooks", href: "/webhooks", icon: ShieldAlert },
  { label: "Settings", href: "/settings", icon: Settings },
];

const bottomLinks: LinkItem[] = [
  { label: "Filters", href: "/tasks", icon: Filter },
  { label: "Dashboards", href: "/dashboard", icon: LayoutDashboard },
  { label: "Goals", href: "/dashboard", icon: Flag, external: true },
  { label: "Teams", href: "/developers", icon: Users, external: true },
  { label: "More", href: "/settings", icon: Ellipsis },
];

function Item({
  item,
  active,
  compact,
  className,
  right,
}: {
  item: LinkItem;
  active?: boolean;
  compact: boolean;
  className?: string;
  right?: React.ReactNode;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex h-9 items-center gap-2 rounded-md border border-transparent px-2 text-sm transition hover:bg-[#2a2a2a] ${
        active ? "bg-white text-black" : "text-white"
      } ${className || ""}`}
      title={compact ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!compact ? <span className="truncate">{item.label}</span> : null}
      {!compact && item.external ? <ExternalLink className="ml-auto h-3.5 w-3.5" /> : null}
      {!compact ? right : null}
    </Link>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const sidebarWidth = collapsed ? "w-[82px]" : "w-[260px]";

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen shrink-0 border-r border-[#2a2a2a] bg-[#0d0d0d] ${sidebarWidth}`}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-[#2a2a2a] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-6 w-6 grid-cols-2 gap-0.5 rounded-sm border border-[#2a2a2a] p-0.5">
                <span className="rounded-[2px] bg-white" />
                <span className="rounded-[2px] bg-white" />
                <span className="rounded-[2px] bg-white" />
                <span className="rounded-[2px] bg-white" />
              </div>
              {!collapsed ? <span className="text-base font-semibold">Sprint</span> : null}
            </div>
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md border border-[#2a2a2a] p-1 text-white hover:bg-[#2a2a2a]"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <div className="space-y-0.5">
            {mainLinks.map((item) => (
              <Item
                key={item.label}
                item={item}
                active={item.label === "For you" && pathname === "/board"}
                compact={collapsed}
                right={
                  item.label === "Recent" || item.label === "Starred" ? (
                    <ChevronDown className="ml-auto h-3.5 w-3.5" />
                  ) : item.label === "Spaces" ? (
                    <span className="ml-auto flex items-center gap-1">
                      <Plus className="h-3.5 w-3.5" />
                      <Ellipsis className="h-3.5 w-3.5" />
                    </span>
                  ) : null
                }
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!collapsed ? (
            <>
              <p className="px-2 pb-2 text-xs uppercase tracking-wide text-[#8f8f8f]">Recent</p>
              <Link
                href="/dashboard"
                className="mb-2 flex h-9 items-center gap-2 rounded-md bg-[#2a2a2a] px-2 text-sm"
              >
                <span className="h-4 w-4 rounded-sm bg-[#57a7ff]" />
                <span className="truncate">My Software Team</span>
              </Link>
              <Item
                item={{ label: "More spaces", href: "/dashboard", icon: ChevronUp }}
                compact={false}
              />

              <p className="px-2 pb-2 pt-4 text-xs uppercase tracking-wide text-[#8f8f8f]">Recommended</p>
              <Link
                href="/assignment"
                className="flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-[#2a2a2a]"
              >
                <Sparkles className="h-4 w-4" />
                <span className="truncate">Collect requests</span>
                <span className="ml-auto rounded border border-[#6a4aff] px-1.5 py-0.5 text-[10px] font-semibold text-[#d7c8ff]">
                  TRY
                </span>
              </Link>

              <p className="px-2 pb-2 pt-5 text-xs uppercase tracking-wide text-[#8f8f8f]">Workspace</p>
              <div className="space-y-0.5">
                {appPages.map((item) => (
                  <Item key={item.label} item={item} compact={false} active={pathname.startsWith(item.href)} />
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-1">
              {appPages.map((item) => (
                <Item key={item.label} item={item} compact />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[#2a2a2a] p-3">
          <div className="space-y-0.5">
            {bottomLinks.map((item) => (
              <Item key={item.label} item={item} compact={collapsed} />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
