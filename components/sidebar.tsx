"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AppWindow,
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
  LayoutDashboard,
  ListTodo,
  PanelsTopLeft,
  Pencil,
  Plus,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Users,
  Workflow,
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
  { label: "For you", href: "/board", icon: UserRound },
  { label: "Recent", href: "/sprints", icon: ChevronRight },
  { label: "Starred", href: "/reports", icon: Star },
  { label: "Apps", href: "/tasks", icon: AppWindow },
  { label: "Plans", href: "/sprint-plan", icon: Workflow },
];

const appPages: LinkItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Goals", href: "/goals", icon: Grid3X3 },
  { label: "Sprint Plan", href: "/sprint-plan", icon: Zap },
  { label: "Agentic Scrum Master", href: "/scrum-master", icon: Bot },
  { label: "Sprints", href: "/sprints", icon: Flag },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Developers", href: "/developers", icon: Users },
  { label: "GitHub", href: "/github", icon: GitBranch },
  { label: "Assignment", href: "/assignment", icon: Compass },
  { label: "Monitoring", href: "/monitoring", icon: Activity },
  { label: "Reports", href: "/reports", icon: BookOpen },
  { label: "Admin Webhooks", href: "/webhooks", icon: ShieldAlert },
  { label: "Settings", href: "/settings", icon: Settings },
];

const bottomLinks: LinkItem[] = [
  { label: "Filters", href: "/tasks", icon: Filter },
  { label: "Dashboards", href: "/dashboard", icon: LayoutDashboard },
  { label: "Goals", href: "/goals", icon: Flag },
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { ...(init || {}), cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
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
            className="h-7 flex-1 rounded border border-[#3a3a3a] bg-[#111] px-2 text-xs text-white outline-none"
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
        <div className="ml-10 mt-1 rounded-md border border-[#2a2a2a] bg-[#121212] p-1 text-xs">
          <button type="button" onClick={() => onActionLink(`/sprint-plan?spaceId=${encodeURIComponent(space.id)}&new=sprint`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">New sprint</button>
          <button type="button" onClick={() => onActionLink(`/tasks?spaceId=${encodeURIComponent(space.id)}&new=task`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">New task</button>
          <button type="button" onClick={() => onActionLink(`/goals?spaceId=${encodeURIComponent(space.id)}&new=goal`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">New goal</button>
          {githubConnected ? (
            <button type="button" onClick={() => onActionLink(`/integrations/github/repos?spaceId=${encodeURIComponent(space.id)}`)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-[#1f1f1f]">Add repo</button>
          ) : null}
        </div>
      ) : null}

      {menuOpen ? (
        <div className="ml-10 mt-1 rounded-md border border-[#2a2a2a] bg-[#121212] p-1 text-xs">
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
                <button type="button" onClick={onDeleteConfirm} className="rounded border border-[#3a3a3a] px-2 py-1 hover:bg-[#1f1f1f]">Confirm</button>
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem("asm.sidebar.space.collapsed.v1");
        if (raw) setCollapsedById(JSON.parse(raw));
      } catch {
        setCollapsedById({});
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

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
    const [spacesResp, githubResp] = await Promise.all([
      fetchJson<SpacesResp>("/api/spaces"),
      fetchJson<{ connected?: boolean }>("/api/integrations/github/status"),
    ]);

    setSpaces(Array.isArray(spacesResp.data?.spaces) ? spacesResp.data!.spaces : []);
    setArchivedSpaces(Array.isArray(spacesResp.data?.archived) ? spacesResp.data!.archived : []);
    setGithubConnected(Boolean(githubResp.data?.connected));
    setLoadingSpaces(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSpaces();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
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

  return (
    <aside className={`fixed left-0 top-0 z-40 h-screen shrink-0 border-r border-[#2a2a2a] bg-[#0d0d0d] ${sidebarWidth}`}>
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
                right={item.label === "Recent" || item.label === "Starred" ? <ChevronDown className="ml-auto h-3.5 w-3.5" /> : null}
              />
            ))}

            {!collapsed ? <p className="px-2 pb-1 pt-3 text-xs uppercase tracking-wide text-[#8f8f8f]">Spaces</p> : null}

            {loadingSpaces ? (
              <div className="px-2 py-2 text-xs text-[#8f8f8f]">Loading spaces...</div>
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
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!collapsed ? (
            <>
              <p className="px-2 pb-2 pt-4 text-xs uppercase tracking-wide text-[#8f8f8f]">Recommended</p>
              <Link href="/assignment" className="flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-[#2a2a2a]">
                <Sparkles className="h-4 w-4" />
                <span className="truncate">Collect requests</span>
                <span className="ml-auto rounded border border-[#3f3f3f] px-1.5 py-0.5 text-[10px] font-semibold text-[#d7c8ff]">TRY</span>
              </Link>

              <p className="px-2 pb-2 pt-5 text-xs uppercase tracking-wide text-[#8f8f8f]">Workspace</p>
              <div className="space-y-0.5">
                {appPages.map((item) => (
                  <Item
                    key={item.label}
                    item={item}
                    compact={false}
                    active={pathname.startsWith(item.href)}
                    right={item.label === "GitHub" ? githubDot : null}
                  />
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
