"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUIStore } from "@/lib/ui-store";
import {
  Activity,
  Archive,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Copy,
  Ellipsis,
  ExternalLink,
  Filter,
  Flag,
  GitBranch,
  Grid3X3,
  PanelsTopLeft,
  Pencil,
  Plus,
  Star,
  Trash2,
  UserRound,
  Users,
  Workflow,
  Video,
  Zap,
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

type SavedNavItem = {
  label: string;
  href: string;
};

type SpaceChild = { id: string; name: string; status?: string };
type Space = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  archived: boolean;
  isDefault: boolean;
  order: number;
  sprints: SpaceChild[];
  tasks: SpaceChild[];
  goals: SpaceChild[];
};

type SpacesResp = { spaces?: Space[]; archived?: Space[] };

const mainLinks: LinkItem[] = [
  { label: "Overview", href: "/board", icon: UserRound },
  { label: "Tasks", href: "/tasks", icon: Filter },
  { label: "Sprint Planner", href: "/sprint-plan", icon: Workflow },
  { label: "Recent", href: "/sprints", icon: ChevronRight },
  { label: "Starred", href: "/reports", icon: Star },
];

const appPages: LinkItem[] = [
  { label: "Agentic Scrum Master", href: "/scrum-master", icon: Bot },
  { label: "Sprints", href: "/sprints", icon: Flag },
  { label: "GitHub", href: "/github", icon: GitBranch },
  { label: "Assignment", href: "/assignment", icon: Compass },
  { label: "Monitoring", href: "/monitoring", icon: Activity },
  { label: "Reports", href: "/reports", icon: BookOpen },
];

const bottomLinks: LinkItem[] = [
  { label: "Meetings", href: "/meetings", icon: Video },
  { label: "Goals", href: "/goals", icon: Flag },
  { label: "Teams", href: "/teams", icon: Users },
  { label: "More", href: "/settings", icon: Ellipsis },
];

const RECENT_STORAGE_KEY = "asm.sidebar.recent.v1";
const STARRED_STORAGE_KEY = "asm.sidebar.starred.v1";

function safeParseItems(raw: string | null): SavedNavItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((it) => it && typeof it === "object")
      .map((it) => ({
        label: String((it as { label?: unknown }).label || "").trim(),
        href: String((it as { href?: unknown }).href || "").trim(),
      }))
      .filter((it) => it.label && it.href);
  } catch {
    return [];
  }
}

function inferLabel(href: string): string {
  const fromAppPage = appPages.find((p) => p.href === href)?.label;
  if (fromAppPage) return fromAppPage;
  const fromMainLink = mainLinks.find((p) => p.href === href)?.label;
  if (fromMainLink) return fromMainLink;
  if (href.startsWith("/projects/")) return "Project";
  const clean = href.replace(/^\//, "").replace(/[-_]/g, " ").trim();
  if (!clean) return "Home";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

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
      className={`flex h-9 items-center gap-2 rounded-md px-2 text-sm transition hover:bg-[var(--sidebar-hover)] ${className || ""}`}
      style={{
        background: active ? "var(--sidebar-active)" : "transparent",
        color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
      }}
      title={compact ? item.label : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!compact ? <span className="truncate">{item.label}</span> : null}
      {!compact && item.external ? <ExternalLink className="ml-auto h-3.5 w-3.5" /> : null}
      {!compact ? right : null}
    </Link>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
    const text = await resp.text().catch(() => "");
    let data: T | null = null;
    try {
      data = text ? (JSON.parse(text) as T) : null;
    } catch {
      data = null;
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 503, data: null };
  }
}

function SortableSpaceRow({
  space,
  collapsed,
  childrenOpen,
  renameId,
  renameValue,
  setRenameValue,
  onRenameSave,
  onToggleChildren,
  onOpenAdd,
  onOpenMenu,
  addOpen,
  menuOpen,
  deleteConfirm,
  onDeleteConfirm,
  onDuplicate,
  onSetDefault,
  onCopyLink,
  onArchiveToggle,
  onStartRename,
  onActionLink,
  githubConnected,
}: {
  space: Space;
  collapsed: boolean;
  childrenOpen: boolean;
  renameId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onRenameSave: () => void;
  onToggleChildren: () => void;
  onOpenAdd: () => void;
  onOpenMenu: () => void;
  addOpen: boolean;
  menuOpen: boolean;
  deleteConfirm: boolean;
  onDeleteConfirm: () => void;
  onDuplicate: () => void;
  onSetDefault: () => void;
  onCopyLink: () => void;
  onArchiveToggle: (v: boolean) => void;
  onStartRename: () => void;
  onActionLink: (href: string) => void;
  githubConnected: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: space.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (collapsed) {
    return (
      <Link ref={setNodeRef} style={style} href={`/projects/${encodeURIComponent(space.id)}`} className="flex h-9 items-center justify-center rounded-md hover:bg-[#2a2a2a]">
        <PanelsTopLeft className="h-4 w-4" />
      </Link>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="group rounded-md">
      <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-[#2a2a2a]">
        <button type="button" {...attributes} {...listeners} className="rounded p-1 text-[#8f8f8f] hover:text-white" title="Drag to reorder">
          <PanelsTopLeft className="h-3.5 w-3.5" />
        </button>

        <Link href={`/projects/${encodeURIComponent(space.id)}`} className="rounded p-1 hover:bg-[#1f1f1f]" title="Open space page">
          <Grid3X3 className="h-3.5 w-3.5" />
        </Link>

        {renameId === space.id ? (
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={onRenameSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSave();
            }}
            className="h-7 flex-1 rounded border border-[var(--border-strong)] bg-[#111] px-2 text-xs text-white outline-none"
            autoFocus
          />
        ) : (
          <button type="button" onClick={onToggleChildren} className="flex-1 text-left text-sm truncate">
            {space.name}
            {space.isDefault ? <span className="ml-2 rounded-full border border-emerald-500/40 px-1.5 py-0.5 text-[10px] text-emerald-300">Default</span> : null}
          </button>
        )}

        <div className="ml-auto hidden items-center gap-1 group-hover:flex">
          <button type="button" onClick={onOpenAdd} className="rounded p-1 hover:bg-[#1f1f1f]" title="Add item">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onOpenMenu} className="rounded p-1 hover:bg-[#1f1f1f]" title="Space options">
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {addOpen ? (
        <div className="ml-10 mt-1 rounded-md border border-[var(--border)] bg-[#121212] p-1 text-xs">
          <button type="button" onClick={() => onActionLink(`/sprint-plan?spaceId=${encodeURIComponent(space.id)}&new=sprint`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">New sprint</button>
          <button type="button" onClick={() => onActionLink(`/tasks?spaceId=${encodeURIComponent(space.id)}&new=task`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">New task</button>
          <button type="button" onClick={() => onActionLink(`/goals?spaceId=${encodeURIComponent(space.id)}&new=goal`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">New goal</button>
          {githubConnected ? (
            <button type="button" onClick={() => onActionLink(`/integrations/github/repos?spaceId=${encodeURIComponent(space.id)}`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">Add repo</button>
          ) : null}
        </div>
      ) : null}

      {menuOpen ? (
        <div className="ml-10 mt-1 rounded-md border border-[var(--border)] bg-[#121212] p-1 text-xs">
          <button type="button" onClick={onStartRename} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]"><Pencil className="h-3.5 w-3.5" />Rename space</button>
          <button type="button" onClick={onDuplicate} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]"><Copy className="h-3.5 w-3.5" />Duplicate space</button>
          <button type="button" onClick={onSetDefault} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">Set as default</button>
          <button type="button" onClick={onCopyLink} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">Copy space link</button>
          <div className="my-1 h-px bg-[#2a2a2a]" />
          <button type="button" onClick={() => onArchiveToggle(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]"><Archive className="h-3.5 w-3.5" />Archive space</button>
          {deleteConfirm ? (
            <div className="rounded px-2 py-1.5 text-xs">
              <div className="mb-1 text-[#bfbfbf]">Delete this space?</div>
              <div className="flex gap-2">
                <button type="button" onClick={onDeleteConfirm} className="rounded border border-[var(--border-strong)] px-2 py-1 hover:bg-[#1f1f1f]">Confirm</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={onOpenMenu} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]"><Trash2 className="h-3.5 w-3.5" />Delete space</button>
          )}
        </div>
      ) : null}

      {childrenOpen ? (
        <div className="ml-10 mt-1 space-y-1 pb-1">
          {space.sprints.map((s) => (
            <Link key={`sp-${s.id}`} href={`/sprint/${encodeURIComponent(s.id)}`} className="block truncate rounded px-2 py-1 text-xs text-[#bdbdbd] hover:bg-[#1f1f1f]">Sprint: {s.name}</Link>
          ))}
          {space.tasks.map((t) => (
            <Link key={`tk-${t.id}`} href={`/tasks/${encodeURIComponent(t.id)}`} className="block truncate rounded px-2 py-1 text-xs text-[#bdbdbd] hover:bg-[#1f1f1f]">Task: {t.name}</Link>
          ))}
          {space.goals.map((g) => (
            <Link key={`gl-${g.id}`} href={`/goals`} className="block truncate rounded px-2 py-1 text-xs text-[#bdbdbd] hover:bg-[#1f1f1f]">Goal: {g.name}</Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const sidebarWidth = collapsed ? "w-[82px]" : "w-[260px]";
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const closeSidebar = useUIStore((state) => state.closeSidebar);

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [archivedSpaces, setArchivedSpaces] = useState<Space[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [githubConnected, setGithubConnected] = useState(false);

  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({});
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [addMenuId, setAddMenuId] = useState<string | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [starredOpen, setStarredOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<SavedNavItem[]>([]);
  const [starredItems, setStarredItems] = useState<SavedNavItem[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem("asm.sidebar.space.collapsed.v1");
        if (raw) setCollapsedById(JSON.parse(raw));
      } catch {
        setCollapsedById({});
      }

      setRecentItems(safeParseItems(window.localStorage.getItem(RECENT_STORAGE_KEY)));
      setStarredItems(safeParseItems(window.localStorage.getItem(STARRED_STORAGE_KEY)));
    }, 0);

    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!pathname || !pathname.startsWith("/")) return;

    const id = window.setTimeout(() => {
      const nextEntry: SavedNavItem = { label: inferLabel(pathname), href: pathname };
      setRecentItems((prev) => {
        const next = [nextEntry, ...prev.filter((it) => it.href !== pathname)].slice(0, 8);
        try {
          window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore local storage failures
        }
        return next;
      });
    }, 0);

    return () => window.clearTimeout(id);
  }, [pathname]);

  const persistCollapsed = useCallback((next: Record<string, boolean>) => {
    setCollapsedById(next);
    try {
      window.localStorage.setItem("asm.sidebar.space.collapsed.v1", JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const loadSpaces = useCallback(async () => {
    setLoadingSpaces(true);
    try {
      const [spacesResp, githubResp] = await Promise.all([
        fetchJson<SpacesResp>("/api/spaces"),
        fetchJson<{ connected?: boolean }>("/api/integrations/github/status"),
      ]);

      setSpaces(Array.isArray(spacesResp.data?.spaces) ? spacesResp.data!.spaces : []);
      setArchivedSpaces(Array.isArray(spacesResp.data?.archived) ? spacesResp.data!.archived : []);
      setGithubConnected(Boolean(githubResp.data?.connected));
    } finally {
      setLoadingSpaces(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadSpaces();
    }, 0);

    return () => window.clearTimeout(id);
  }, [loadSpaces]);

  async function renameSpace(id: string, name: string) {
    await fetchJson(`/api/spaces/${encodeURIComponent(id)}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenameId(null);
    await loadSpaces();
  }

  async function duplicateSpace(id: string) {
    await fetchJson(`/api/spaces/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
    setContextMenuId(null);
    await loadSpaces();
  }

  async function archiveSpace(id: string, archived: boolean) {
    await fetchJson(`/api/spaces/${encodeURIComponent(id)}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    setContextMenuId(null);
    await loadSpaces();
  }

  async function deleteSpace(id: string) {
    await fetchJson(`/api/spaces/${encodeURIComponent(id)}`, { method: "DELETE" });
    setDeleteConfirmId(null);
    setContextMenuId(null);
    await loadSpaces();
  }

  async function setDefaultSpace(id: string) {
    await fetchJson(`/api/spaces/${encodeURIComponent(id)}/default`, { method: "PATCH" });
    setContextMenuId(null);
    await loadSpaces();
  }

  async function reorder(ids: string[]) {
    await fetchJson("/api/spaces/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    await loadSpaces();
  }

  function onDragEnd(evt: DragEndEvent) {
    const activeId = String(evt.active.id || "");
    const overId = String(evt.over?.id || "");
    if (!activeId || !overId || activeId === overId) return;

    const oldIndex = spaces.findIndex((s) => s.id === activeId);
    const newIndex = spaces.findIndex((s) => s.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(spaces, oldIndex, newIndex);
    setSpaces(next);
    void reorder(next.map((s) => s.id));
  }

  const githubDot = useMemo(
    () => <span className={`ml-auto h-2 w-2 rounded-full ${githubConnected ? "bg-emerald-400" : "bg-slate-500"}`} />,
    [githubConnected]
  );

  function toggleStarred(item: SavedNavItem) {
    setStarredItems((prev) => {
      const exists = prev.some((it) => it.href === item.href);
      const next = exists ? prev.filter((it) => it.href !== item.href) : [item, ...prev].slice(0, 12);
      try {
        window.localStorage.setItem(STARRED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore local storage failures
      }
      return next;
    });
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-screen shrink-0 overflow-hidden border-r transition-transform duration-300 ease-in-out md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} ${sidebarWidth}`}
      suppressHydrationWarning
      style={{ background: "var(--sidebar-bg)", borderColor: "var(--border)" }}
    >
      <div className="flex h-full flex-col">
        <div className="flex-shrink-0 border-b border-[var(--border)] p-3">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2" aria-label="Go to home page">
              <div className="grid h-6 w-6 grid-cols-2 gap-0.5 rounded-sm border border-[var(--border)] p-0.5">
                <span className="rounded-[2px] bg-[var(--text-primary)]" />
                <span className="rounded-[2px] bg-[var(--text-primary)]" />
                <span className="rounded-[2px] bg-[var(--text-primary)]" />
                <span className="rounded-[2px] bg-[var(--text-primary)]" />
              </div>
              {!collapsed ? <span className="text-base font-semibold text-[var(--text-primary)]">Sprint</span> : null}
            </Link>
            <button
              type="button"
              onClick={onToggle}
              className="hidden rounded-md p-1 text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] md:inline-flex"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={closeSidebar}
              className="inline-flex rounded-md p-1 text-[var(--text-primary)] hover:bg-[var(--sidebar-hover)] md:hidden"
              aria-label="Close sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-0.5">
            {mainLinks.map((item) => {
              if (item.label === "Recent") {
                return (
                  <div key={item.label}>
                    <button
                      type="button"
                      onClick={() => setRecentOpen((v) => !v)}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm transition hover:bg-[var(--sidebar-hover)]"
                      style={{
                        background: pathname === item.href ? "var(--sidebar-active)" : "transparent",
                        color: pathname === item.href ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
                      }}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {!collapsed ? <ChevronDown className={`ml-auto h-3.5 w-3.5 transition ${recentOpen ? "rotate-180" : ""}`} /> : null}
                    </button>
                    {!collapsed && recentOpen ? (
                      <div className="ml-6 mt-1 space-y-1">
                        {recentItems.length ? (
                          recentItems.map((it) => (
                            <Link key={`recent-${it.href}`} href={it.href} className="block truncate rounded px-2 py-1 text-xs text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)]">
                              {it.label}
                            </Link>
                          ))
                        ) : (
                          <div className="px-2 py-1 text-xs text-[var(--text-secondary)]">No recent pages.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              }

              if (item.label === "Starred") {
                return (
                  <div key={item.label}>
                    <button
                      type="button"
                      onClick={() => setStarredOpen((v) => !v)}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm transition hover:bg-[var(--sidebar-hover)]"
                      style={{
                        background: pathname === item.href ? "var(--sidebar-active)" : "transparent",
                        color: pathname === item.href ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
                      }}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {!collapsed ? <ChevronDown className={`ml-auto h-3.5 w-3.5 transition ${starredOpen ? "rotate-180" : ""}`} /> : null}
                    </button>
                    {!collapsed && starredOpen ? (
                      <div className="ml-6 mt-1 space-y-1">
                        {starredItems.length ? (
                          starredItems.map((it) => (
                            <Link key={`star-${it.href}`} href={it.href} className="block truncate rounded px-2 py-1 text-xs text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)]">
                              {it.label}
                            </Link>
                          ))
                        ) : (
                          <div className="px-2 py-1 text-xs text-[var(--text-secondary)]">No starred pages.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return (
                <Item
                  key={item.label}
                  item={item}
                  active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  compact={collapsed}
                />
              );
            })}

          </div>
        </div>

        <div className="sidebar-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3">
          {!collapsed ? <p className="px-2 pb-1 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Spaces</p> : null}

          {loadingSpaces ? (
            <div className="px-2 py-2 text-xs text-[var(--text-secondary)]">Loading spaces...</div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={spaces.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {spaces.map((space) => (
                    <SortableSpaceRow
                      key={space.id}
                      space={space}
                      collapsed={collapsed}
                      childrenOpen={!collapsedById[space.id]}
                      renameId={renameId}
                      renameValue={renameValue}
                      setRenameValue={setRenameValue}
                      onRenameSave={() => void renameSpace(space.id, renameValue.trim() || space.name)}
                      onToggleChildren={() =>
                        persistCollapsed({
                          ...collapsedById,
                          [space.id]: !collapsedById[space.id],
                        })
                      }
                      onOpenAdd={() => {
                        setAddMenuId((v) => (v === space.id ? null : space.id));
                        setContextMenuId(null);
                        setDeleteConfirmId(null);
                      }}
                      onOpenMenu={() => {
                        if (deleteConfirmId === space.id) {
                          setDeleteConfirmId(null);
                          return;
                        }
                        if (contextMenuId === space.id) {
                          setDeleteConfirmId(space.id);
                        } else {
                          setContextMenuId(space.id);
                          setAddMenuId(null);
                        }
                      }}
                      addOpen={addMenuId === space.id}
                      menuOpen={contextMenuId === space.id}
                      deleteConfirm={deleteConfirmId === space.id}
                      onDeleteConfirm={() => void deleteSpace(space.id)}
                      onDuplicate={() => void duplicateSpace(space.id)}
                      onSetDefault={() => void setDefaultSpace(space.id)}
                      onCopyLink={() => {
                        void navigator.clipboard.writeText(`${window.location.origin}/projects/${encodeURIComponent(space.id)}`);
                        setContextMenuId(null);
                      }}
                      onArchiveToggle={(v) => void archiveSpace(space.id, v)}
                      onStartRename={() => {
                        setRenameId(space.id);
                        setRenameValue(space.name);
                        setContextMenuId(null);
                      }}
                      onActionLink={(href) => {
                        window.location.href = href;
                      }}
                      githubConnected={githubConnected}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {!collapsed ? (
            <div className="pt-2">
              <button type="button" onClick={() => setArchivedOpen((v) => !v)} className="flex h-8 w-full items-center rounded-md px-2 text-xs text-[#bdbdbd] hover:bg-[#2a2a2a]">
                <Archive className="mr-2 h-3.5 w-3.5" /> Archived ({archivedSpaces.length})
                <span className="ml-auto">{archivedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
              </button>

              {archivedOpen ? (
                <div className="ml-4 mt-1 space-y-1">
                  {archivedSpaces.map((space) => (
                    <div key={`arch-${space.id}`} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[#2a2a2a]">
                      <span className="truncate text-xs">{space.name}</span>
                      <button type="button" onClick={() => void archiveSpace(space.id, false)} className="ml-auto rounded px-1 py-0.5 text-[11px] hover:bg-[#1f1f1f]">Restore</button>
                      <button type="button" onClick={() => void deleteSpace(space.id)} className="rounded px-1 py-0.5 text-[11px] hover:bg-[#1f1f1f]">Delete</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {!collapsed ? (
            <>
              {starredItems.length ? (
                <>
                  <p className="px-2 pb-2 pt-4 text-xs uppercase tracking-wide text-[#8f8f8f]">Starred</p>
                  <div className="space-y-1">
                    {starredItems.map((it) => (
                      <Link key={`star-middle-${it.href}`} href={it.href} className="flex h-8 items-center gap-2 rounded px-2 text-xs text-[#d8d8d8] hover:bg-[#2a2a2a]">
                        <Star className="h-3.5 w-3.5 text-yellow-300" />
                        <span className="truncate">{it.label}</span>
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}

              <p className="px-2 pb-2 pt-4 text-xs uppercase tracking-wide text-[#8f8f8f]">Recommended</p>
              <Link href="/assignment" className="flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-[#2a2a2a]">
                <Zap className="h-4 w-4" />
                <span className="truncate">Collect requests</span>
                <span className="ml-auto rounded border border-[#3f3f3f] px-1.5 py-0.5 text-[10px] font-semibold text-[#d7c8ff]">TRY</span>
              </Link>

              <p className="px-2 pb-2 pt-5 text-xs uppercase tracking-wide text-[#8f8f8f]">Workspace</p>
              <div className="space-y-0.5">
                {appPages.map((item) => (
                  <div key={item.label} className="group flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <Item
                        item={item}
                        compact={false}
                        active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                        right={item.label === "GitHub" ? githubDot : null}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleStarred({ label: item.label, href: item.href })}
                      className="rounded p-1 text-[#8f8f8f] hover:bg-[#2a2a2a] hover:text-yellow-300"
                      title="Toggle starred"
                    >
                      <Star
                        className={`h-3.5 w-3.5 ${
                          starredItems.some((it) => it.href === item.href) ? "fill-yellow-300 text-yellow-300" : ""
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-1">
              {appPages.map((item) => (
                <Item key={item.label} item={item} compact right={item.label === "GitHub" ? githubDot : null} />
              ))}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-[var(--border)] p-3">
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
