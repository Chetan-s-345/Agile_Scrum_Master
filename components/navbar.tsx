"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useUIStore } from "@/lib/ui-store";
import {
  ChevronDown,
  Bell,
  CircleHelp,
  Crown,
  Menu,
  Plus,
  Search,
  Settings,
  FileText,
  ClipboardList,
  Clock3,
  User,
  X,
} from "lucide-react";

type Project = { id: string; name: string };
type Sprint = { id: string; name: string; projectId: string };
type Developer = { id: string; name?: string; fullName?: string; email?: string };
type SearchItem = { id: string; type: "task" | "sprint" | "developer" | "page"; title: string; subtitle: string; href: string };
type NotificationsItem = {
  id: string;
  text: string;
  href: string;
  createdAt: string;
  actor: { initials: string };
  read: boolean;
};

type ChangelogItem = { id: string; title: string; date: string; detail: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function relTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  const diff = Date.now() - date.getTime();
  const mins = Math.max(1, Math.floor(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function useOutsideClick<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);
  return ref;
}

export function Navbar() {
  const router = useRouter();
  const openSidebar = useUIStore((state) => state.openSidebar);

  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState("");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);

  const [searchInput, setSearchInput] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<{ tasks: SearchItem[]; sprints: SearchItem[]; developers: SearchItem[]; pages: SearchItem[] }>({
    tasks: [],
    sprints: [],
    developers: [],
    pages: [],
  });
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTab, setCreateTab] = useState<"task" | "sprint" | "page" | "form">("task");
  const [creating, setCreating] = useState(false);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskSprintId, setTaskSprintId] = useState("");
  const [taskPoints, setTaskPoints] = useState<number | "">("");

  const [sprintName, setSprintName] = useState("");
  const [sprintGoal, setSprintGoal] = useState("");
  const [sprintStartDate, setSprintStartDate] = useState("");
  const [sprintEndDate, setSprintEndDate] = useState("");

  const [pageTitle, setPageTitle] = useState("");
  const [pageContent, setPageContent] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");

  const [plansOpen, setPlansOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [changelog, setChangelog] = useState<ChangelogItem[]>([]);

  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationsItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [switchProjectOpen, setSwitchProjectOpen] = useState(false);
  const [userName, setUserName] = useState("Developer");
  const [userEmail, setUserEmail] = useState("unknown@local");

  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const searchRef = useOutsideClick<HTMLDivElement>(() => setSearchOpen(false));
  const helpRef = useOutsideClick<HTMLDivElement>(() => setHelpOpen(false));
  const notifRef = useOutsideClick<HTMLDivElement>(() => setNotificationsOpen(false));
  const avatarRef = useOutsideClick<HTMLDivElement>(() => setAvatarOpen(false));

  const flatSearchResults = useMemo(
    () => [...searchResults.tasks, ...searchResults.sprints, ...searchResults.developers, ...searchResults.pages],
    [searchResults]
  );

  useEffect(() => {
    let ignore = false;
    async function loadBootData() {
      const [projectsResp, sprintsResp, devResp, meResp] = await Promise.all([
        fetch("/api/projects", { cache: "no-store" }),
        fetch("/api/sprints", { cache: "no-store" }),
        fetch("/api/developers", { cache: "no-store" }),
        fetch("/api/auth/me", { cache: "no-store" }),
      ]);
      const projectsData = await projectsResp.json().catch(() => null) as { items?: Project[] } | null;
      const sprintsData = await sprintsResp.json().catch(() => null) as { items?: Sprint[] } | null;
      const devData = await devResp.json().catch(() => null) as { items?: Developer[] } | null;
      const meData = await meResp.json().catch(() => null) as Record<string, unknown> | null;
      if (ignore) return;

      const projectItems = Array.isArray(projectsData?.items) ? projectsData!.items : [];
      setProjects(projectItems);
      setCurrentProjectId((prev) => (prev || String(projectItems[0]?.id || "")));
      setSprints(Array.isArray(sprintsData?.items) ? sprintsData!.items : []);
      setDevelopers(Array.isArray(devData?.items) ? devData!.items : []);

      const user = (meData?.user || meData?.member || meData || {}) as Record<string, unknown>;
      const nextName = asString(user.name) || asString(user.fullName) || asString(user.email) || "Developer";
      const nextEmail = asString(user.email) || "unknown@local";
      setUserName(nextName);
      setUserEmail(nextEmail);
    }
    void loadBootData();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const query = searchInput.trim();
    if (query.length < 2) {
      setSearchResults({ tasks: [], sprints: [], developers: [], pages: [] });
      setSearchLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(async () => {
      setSearchLoading(true);
      const searchParams = new URLSearchParams({ q: query });
      if (currentProjectId) searchParams.set("projectId", currentProjectId);
      const resp = await fetch(`/api/search?${searchParams.toString()}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null) as {
        tasks?: SearchItem[];
        sprints?: SearchItem[];
        developers?: SearchItem[];
        pages?: SearchItem[];
      } | null;
      setSearchResults({
        tasks: Array.isArray(data?.tasks) ? data!.tasks : [],
        sprints: Array.isArray(data?.sprints) ? data!.sprints : [],
        developers: Array.isArray(data?.developers) ? data!.developers : [],
        pages: Array.isArray(data?.pages) ? data!.pages : [],
      });
      setSearchOpen(true);
      setSearchLoading(false);
      setActiveSearchIndex(-1);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [currentProjectId, searchInput]);

  useEffect(() => {
    async function loadNotifications() {
      setNotificationsLoading(true);
      const [listResp, unreadResp] = await Promise.all([
        fetch("/api/notifications", { cache: "no-store" }),
        fetch("/api/notifications?unread=true", { cache: "no-store" }),
      ]);

      const listData = await listResp.json().catch(() => null) as { items?: NotificationsItem[] } | null;
      const unreadData = await unreadResp.json().catch(() => null) as { unreadCount?: number; items?: NotificationsItem[] } | null;

      setNotifications(Array.isArray(listData?.items) ? listData!.items : []);
      const unreadFallback = Array.isArray(unreadData?.items) ? unreadData!.items.length : 0;
      setUnreadCount(Number(unreadData?.unreadCount || unreadFallback || 0));
      setNotificationsLoading(false);
    }

    void loadNotifications();
    const pollId = window.setInterval(() => {
      void loadNotifications();
    }, 25000);

    let socketCleanup: (() => void) | null = null;
    void import("socket.io-client")
      .then(({ io }) => {
        const socket = io(process.env.NEXT_PUBLIC_API_URL || "", { autoConnect: true, transports: ["websocket", "polling"] });
        socket.on("notifications", () => {
          void loadNotifications();
        });
        socketCleanup = () => socket.disconnect();
      })
      .catch(() => {
        socketCleanup = null;
      });

    return () => {
      window.clearInterval(pollId);
      if (socketCleanup) socketCleanup();
    };
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "PATCH" });
    const resp = await fetch("/api/notifications", { cache: "no-store" });
    const data = await resp.json().catch(() => null) as { items?: NotificationsItem[] } | null;
    setNotifications(Array.isArray(data?.items) ? data!.items : []);
    setUnreadCount(0);
  }

  async function openNotification(item: NotificationsItem) {
    await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    setNotificationsOpen(false);
    router.push(item.href);
  }

  async function submitCreate() {
    setCreating(true);
    try {
      if (createTab === "task") {
        const selectedSprint = sprints.find((s) => String(s.id) === String(taskSprintId));
        const projectId = selectedSprint?.projectId || currentProjectId;
        const resp = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription || undefined,
            projectId,
            sprintId: taskSprintId,
            priority: taskPriority,
            storyPoints: taskPoints === "" ? 0 : Number(taskPoints),
          }),
        });
        const payload = await resp.json().catch(() => null) as { task?: { id?: string } } | null;
        if (!resp.ok) throw new Error("Failed to create task");

        const createdTaskId = asString(payload?.task?.id);
        if (createdTaskId && taskAssigneeId) {
          await fetch("/api/assignment/assign-explicit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: createdTaskId, sprintId: taskSprintId, developerId: taskAssigneeId }),
          });
        }
        setToast({ text: "Task created", type: "success" });
      }

      if (createTab === "sprint") {
        const resp = await fetch("/api/sprints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: sprintName,
            goal: sprintGoal,
            startDate: sprintStartDate,
            endDate: sprintEndDate,
            projectId: currentProjectId,
          }),
        });
        if (!resp.ok) throw new Error("Failed to create sprint");
        setToast({ text: "Sprint created", type: "success" });
      }

      if (createTab === "page") {
        const resp = await fetch("/api/pages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: pageTitle, content: pageContent }),
        });
        if (!resp.ok) throw new Error("Failed to create page");
        setToast({ text: "Page created", type: "success" });
      }

      if (createTab === "form") {
        const resp = await fetch("/api/forms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName, description: formDescription }),
        });
        if (!resp.ok) throw new Error("Failed to create form");
        setToast({ text: "Form created", type: "success" });
      }

      setCreateOpen(false);
    } catch {
      setToast({ text: "Create failed", type: "error" });
    } finally {
      setCreating(false);
    }
  }

  async function loadChangelog() {
    const resp = await fetch("/api/changelog", { cache: "no-store" });
    const data = await resp.json().catch(() => null) as { items?: ChangelogItem[] } | null;
    setChangelog(Array.isArray(data?.items) ? data!.items : []);
    setWhatsNewOpen(true);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!searchOpen || !flatSearchResults.length) {
      if (event.key === "Escape") setSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((prev) => Math.min(prev + 1, flatSearchResults.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = flatSearchResults[activeSearchIndex] || flatSearchResults[0];
      if (item) {
        setSearchOpen(false);
        router.push(item.href);
      }
      return;
    }
    if (event.key === "Escape") {
      setSearchOpen(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      <header className="sticky top-0 z-30 w-full bg-[var(--bg-app)]">
        <nav className="flex h-16 items-center gap-2 px-3 sm:px-5">
          <button
            type="button"
            onClick={openSidebar}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] md:hidden"
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div ref={searchRef} className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="search"
              value={searchInput}
              onFocus={() => {
                setSearchFocused(true);
                if (searchInput.trim().length >= 2) setSearchOpen(true);
              }}
              onBlur={() => setSearchFocused(false)}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search tasks, sprints, developers, pages"
              className={`h-10 w-full rounded-md bg-[var(--bg-surface)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--text-secondary)] ${searchFocused ? "ring-2 ring-[var(--border-focus)]" : ""}`}
            />

            {searchOpen ? (
              <div className="absolute left-0 right-0 top-12 max-h-[65vh] overflow-auto rounded-md bg-[var(--bg-modal)] p-2 shadow-2xl">
                {searchLoading ? <p className="px-2 py-2 text-xs text-[var(--text-secondary)]">Searching...</p> : null}
                {!searchLoading && !flatSearchResults.length ? <p className="px-2 py-2 text-xs text-[var(--text-secondary)]">No results</p> : null}
                <SearchGroup
                  title="Tasks"
                  icon={<ClipboardList className="h-3.5 w-3.5" />}
                  items={searchResults.tasks}
                  activeSearchIndex={activeSearchIndex}
                  offset={0}
                  onClick={(item) => {
                    setSearchOpen(false);
                    router.push(item.href);
                  }}
                />
                <SearchGroup
                  title="Sprints"
                  icon={<Clock3 className="h-3.5 w-3.5" />}
                  items={searchResults.sprints}
                  activeSearchIndex={activeSearchIndex}
                  offset={searchResults.tasks.length}
                  onClick={(item) => {
                    setSearchOpen(false);
                    router.push(item.href);
                  }}
                />
                <SearchGroup
                  title="Developers"
                  icon={<User className="h-3.5 w-3.5" />}
                  items={searchResults.developers}
                  activeSearchIndex={activeSearchIndex}
                  offset={searchResults.tasks.length + searchResults.sprints.length}
                  onClick={(item) => {
                    setSearchOpen(false);
                    router.push(item.href);
                  }}
                />
                <SearchGroup
                  title="Pages"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  items={searchResults.pages}
                  activeSearchIndex={activeSearchIndex}
                  offset={searchResults.tasks.length + searchResults.sprints.length + searchResults.developers.length}
                  onClick={(item) => {
                    setSearchOpen(false);
                    router.push(item.href);
                  }}
                />
              </div>
            ) : null}
          </div>

          <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--text-primary)] px-2.5 text-sm font-semibold text-[var(--text-inverse)] sm:px-3">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create</span>
          </button>

          <button type="button" onClick={() => setPlansOpen(true)} className="hidden h-10 items-center gap-2 rounded-md bg-[var(--accent-purple)] px-3 text-sm font-semibold text-white sm:inline-flex">
            <Crown className="h-4 w-4" />
            <span className="hidden md:inline">See plans</span>
          </button>

          <div ref={notifRef} className="relative">
            <button type="button" onClick={() => setNotificationsOpen((prev) => !prev)} className="relative rounded-md bg-[var(--bg-card)] p-2.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" title="Notifications">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-white px-1.5 text-[10px] font-bold text-black">{unreadCount}</span> : null}
            </button>

            {notificationsOpen ? (
              <div className="absolute right-0 top-12 w-[360px] rounded-md bg-[var(--bg-modal)] p-2 shadow-2xl">
                <div className="mb-2 flex items-center justify-between px-2 py-1">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">Notifications</p>
                  <button onClick={() => void markAllRead()} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Mark all read</button>
                </div>
                {notificationsLoading ? <p className="px-2 py-3 text-xs text-[var(--text-secondary)]">Loading...</p> : null}
                {!notificationsLoading && !notifications.length ? <p className="px-2 py-3 text-xs text-[var(--text-secondary)]">No notifications</p> : null}
                <div className="max-h-[320px] overflow-auto">
                  {notifications.slice(0, 10).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => void openNotification(item)}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--bg-hover)] ${item.read ? "opacity-70" : "opacity-100"}`}
                    >
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-card)] text-[10px] font-bold text-[var(--text-primary)]">{item.actor.initials}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-[var(--text-primary)]">{item.text}</span>
                        <span className="text-[11px] text-[var(--text-secondary)]">{relTime(item.createdAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div ref={helpRef} className="relative hidden sm:block">
            <button type="button" onClick={() => setHelpOpen((prev) => !prev)} className="rounded-md bg-[var(--bg-card)] p-2.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
              <CircleHelp className="h-4 w-4" />
            </button>

            {helpOpen ? (
              <div className="absolute right-0 top-12 w-56 rounded-md bg-[var(--bg-modal)] p-1.5 shadow-2xl">
                <a href="https://docs.github.com/copilot" target="_blank" rel="noreferrer" className="block rounded-md px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Documentation</a>
                <button onClick={() => setShortcutsOpen(true)} className="block w-full rounded-md px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Keyboard shortcuts</button>
                <button
                  onClick={() => {
                    setHelpOpen(false);
                    void loadChangelog();
                  }}
                  className="block w-full rounded-md px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  What&apos;s new
                </button>
                <a href="mailto:support@agilescrummaster.local" className="block rounded-md px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Contact support</a>
              </div>
            ) : null}
          </div>

          <button type="button" onClick={() => router.push("/settings")} className="hidden rounded-md bg-[var(--bg-card)] p-2.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] sm:inline-flex">
            <Settings className="h-4 w-4" />
          </button>

          <div ref={avatarRef} className="relative">
            <button type="button" onClick={() => setAvatarOpen((prev) => !prev)} className="ml-1 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--bg-card)] px-2 text-xs font-bold text-[var(--text-primary)]">
              {userName.slice(0, 2).toUpperCase() || "DS"}
              <ChevronDown className="h-3 w-3 text-[var(--text-secondary)]" />
            </button>

            {avatarOpen ? (
              <div className="absolute right-0 top-12 w-64 rounded-md bg-[var(--bg-modal)] p-2 shadow-2xl">
                <div className="mb-2 rounded-md bg-[var(--bg-surface)] px-3 py-2">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{userName}</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">{userEmail}</p>
                </div>
                <Link href="/settings/profile" className="block rounded-md px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Profile</Link>
                <Link href="/settings/preferences" className="block rounded-md px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Preferences</Link>
                <button onClick={() => setSwitchProjectOpen(true)} className="block w-full rounded-md px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Switch project</button>
                <hr className="my-2 border-[var(--border)]" />
                <button onClick={() => void logout()} className="block w-full rounded-md px-3 py-2 text-left text-xs text-[#ffb4b4] hover:bg-[#2a1616]">Log out</button>
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      {createOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[#101010] p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Global Create</p>
              <button onClick={() => setCreateOpen(false)} className="rounded-md border border-[var(--border)] p-1.5 text-[#bbb] hover:bg-[#212121]"><X className="h-4 w-4" /></button>
            </div>

            <div className="mb-4 flex gap-2 border-b border-[var(--border)] pb-2">
              {(["task", "sprint", "page", "form"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCreateTab(tab)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold capitalize ${createTab === tab ? "border-white bg-white text-black" : "border-[var(--border)] text-[#b9b9b9]"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {createTab === "task" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
                <select className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" value={taskAssigneeId} onChange={(e) => setTaskAssigneeId(e.target.value)}>
                  <option value="">Assignee</option>
                  {developers.map((dev) => <option key={dev.id} value={dev.id}>{dev.name || dev.fullName || dev.email || "Developer"}</option>)}
                </select>
                <textarea className="sm:col-span-2 min-h-[88px] rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Description" value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} />
                <select className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <select className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" value={taskSprintId} onChange={(e) => setTaskSprintId(e.target.value)}>
                  <option value="">Sprint</option>
                  {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
                </select>
                <input className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Story points" type="number" min={0} value={taskPoints} onChange={(e) => setTaskPoints(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
            ) : null}

            {createTab === "sprint" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Name" value={sprintName} onChange={(e) => setSprintName(e.target.value)} />
                <input className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Goal" value={sprintGoal} onChange={(e) => setSprintGoal(e.target.value)} />
                <input className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" type="date" value={sprintStartDate} onChange={(e) => setSprintStartDate(e.target.value)} />
                <input className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" type="date" value={sprintEndDate} onChange={(e) => setSprintEndDate(e.target.value)} />
              </div>
            ) : null}

            {createTab === "page" ? (
              <div className="space-y-3">
                <input className="w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Page title" value={pageTitle} onChange={(e) => setPageTitle(e.target.value)} />
                <textarea className="min-h-[160px] w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 font-mono text-sm text-white" placeholder="# Markdown content" value={pageContent} onChange={(e) => setPageContent(e.target.value)} />
              </div>
            ) : null}

            {createTab === "form" ? (
              <div className="space-y-3">
                <input className="w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Form name" value={formName} onChange={(e) => setFormName(e.target.value)} />
                <textarea className="min-h-[120px] w-full rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-sm text-white" placeholder="Description" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[#ccc]">Cancel</button>
              <button onClick={() => void submitCreate()} disabled={creating} className="rounded-md border border-white bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-60">{creating ? "Creating..." : "Create"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {plansOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-4xl rounded-lg border border-[var(--border)] bg-[#101010] p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Plans</p>
              <button onClick={() => setPlansOpen(false)} className="rounded-md border border-[var(--border)] p-1.5 text-[#bbb]"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <PlanCard title="Free" price="$0" features={["1 project", "Basic board", "Community support"]} />
              <PlanCard title="Pro" price="$29" features={["Unlimited projects", "Automation", "Advanced reporting"]} featured />
              <PlanCard title="Enterprise" price="Custom" features={["SAML/SSO", "Audit logs", "Dedicated support"]} />
            </div>
            <div className="mt-4 overflow-auto rounded-md border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-[var(--bg-surface)] text-[#dfdfdf]"><tr><th className="px-3 py-2">Feature</th><th className="px-3 py-2">Free</th><th className="px-3 py-2">Pro</th><th className="px-3 py-2">Enterprise</th></tr></thead>
                <tbody>
                  <tr className="border-t border-[var(--border)]"><td className="px-3 py-2">Boards</td><td className="px-3 py-2">1</td><td className="px-3 py-2">Unlimited</td><td className="px-3 py-2">Unlimited</td></tr>
                  <tr className="border-t border-[var(--border)]"><td className="px-3 py-2">Automation</td><td className="px-3 py-2">No</td><td className="px-3 py-2">Yes</td><td className="px-3 py-2">Yes</td></tr>
                  <tr className="border-t border-[var(--border)]"><td className="px-3 py-2">Support</td><td className="px-3 py-2">Community</td><td className="px-3 py-2">Priority</td><td className="px-3 py-2">Dedicated</td></tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end"><button onClick={() => router.push("/settings/billing")} className="rounded-md border border-white bg-white px-3 py-2 text-xs font-semibold text-black">Go to billing</button></div>
          </div>
        </div>
      ) : null}

      {shortcutsOpen ? (
        <SimpleModal title="Keyboard Shortcuts" onClose={() => setShortcutsOpen(false)}>
          <table className="min-w-full text-left text-xs">
            <tbody>
              <tr className="border-t border-[var(--border)]"><td className="px-2 py-2 text-[#9f9f9f]">Search</td><td className="px-2 py-2">/</td></tr>
              <tr className="border-t border-[var(--border)]"><td className="px-2 py-2 text-[#9f9f9f]">Open create</td><td className="px-2 py-2">C</td></tr>
              <tr className="border-t border-[var(--border)]"><td className="px-2 py-2 text-[#9f9f9f]">Close dialog</td><td className="px-2 py-2">Esc</td></tr>
              <tr className="border-t border-[var(--border)]"><td className="px-2 py-2 text-[#9f9f9f]">Search navigate</td><td className="px-2 py-2">↑ / ↓ / Enter</td></tr>
            </tbody>
          </table>
        </SimpleModal>
      ) : null}

      {whatsNewOpen ? (
        <SimpleModal title="What's New" onClose={() => setWhatsNewOpen(false)}>
          <div className="space-y-2">
            {changelog.map((item) => (
              <div key={item.id} className="rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2">
                <p className="text-xs font-semibold text-white">{item.title}</p>
                <p className="text-[11px] text-[#9a9a9a]">{item.date}</p>
                <p className="mt-1 text-xs text-[#cccccc]">{item.detail}</p>
              </div>
            ))}
          </div>
        </SimpleModal>
      ) : null}

      {switchProjectOpen ? (
        <SimpleModal title="Switch Project" onClose={() => setSwitchProjectOpen(false)}>
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  setCurrentProjectId(project.id);
                  setSwitchProjectOpen(false);
                  setToast({ text: `Switched to ${project.name}`, type: "success" });
                }}
                className={`block w-full rounded-md border px-3 py-2 text-left text-xs ${String(project.id) === String(currentProjectId) ? "border-white bg-white text-black" : "border-[var(--border)] bg-[#151515] text-white"}`}
              >
                {project.name}
              </button>
            ))}
          </div>
        </SimpleModal>
      ) : null}

      {toast ? (
        <div className={`fixed bottom-5 right-5 z-50 rounded-md border px-3 py-2 text-xs font-semibold ${toast.type === "success" ? "border-[#3c8a56] bg-[#183523] text-[#b5f1c7]" : "border-[#8a3c3c] bg-[#351818] text-[#ffcccc]"}`}>
          {toast.text}
        </div>
      ) : null}
    </>
  );
}

function SearchGroup({
  title,
  icon,
  items,
  activeSearchIndex,
  offset,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  items: SearchItem[];
  activeSearchIndex: number;
  offset: number;
  onClick: (item: SearchItem) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="mb-2">
      <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-[#969696]">{title}</p>
      <div className="space-y-1">
        {items.map((item, index) => {
          const isActive = offset + index === activeSearchIndex;
          return (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => onClick(item)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${isActive ? "bg-[#262626]" : "hover:bg-[var(--bg-card)]"}`}
            >
              <span className="text-[#a5a5a5]">{icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-white">{item.title}</span>
                <span className="text-[11px] text-[#979797]">{item.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SimpleModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[#101010] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-white">{title}</p>
          <button onClick={onClose} className="rounded-md border border-[var(--border)] p-1.5 text-[#bbb]"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PlanCard({ title, price, features, featured = false }: { title: string; price: string; features: string[]; featured?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${featured ? "border-white bg-[#191919]" : "border-[var(--border)] bg-[#151515]"}`}>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xl font-bold text-white">{price}</p>
      <ul className="mt-2 space-y-1 text-xs text-[#c7c7c7]">
        {features.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  );
}
