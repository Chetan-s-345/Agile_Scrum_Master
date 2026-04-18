"use client";

import { Search, UserPlus, X } from "lucide-react";
import { useRouter } from "@/next-shims/navigation";
import { useEffect, useMemo, useState } from "react";

type Developer = {
  id: string;
  name: string;
  role: string;
  team: string;
  avatar?: string;
  currentSprintTasks: number;
  storyPointsAssigned: number;
};

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function makeSearchQuery(query: string, role: string, team: string): string {
  return [query.trim(), role !== "all" ? role : "", team !== "all" ? team : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export default function DevelopersPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [developers, setDevelopers] = useState<Developer[]>([]);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Engineer");
  const [inviting, setInviting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const items = await invokeDesktop<Developer[]>("developers:getAll");
        if (ignore) return;
        setDevelopers(Array.isArray(items) ? items : []);
      } catch (e) {
        if (!ignore) {
          setError(e instanceof Error ? e.message : "Failed to load developers");
          setDevelopers([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    const timer = window.setTimeout(async () => {
      try {
        setError(null);
        const searchText = makeSearchQuery(query, roleFilter, teamFilter);
        const items = await invokeDesktop<Developer[]>("developers:search", { query: searchText });
        if (ignore) return;
        setDevelopers(Array.isArray(items) ? items : []);
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to search developers");
      }
    }, 180);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [query, roleFilter, teamFilter]);

  const roleOptions = useMemo(() => {
    const roles = new Set<string>();
    developers.forEach((dev) => roles.add(dev.role));
    return ["all", ...Array.from(roles).sort((a, b) => a.localeCompare(b))];
  }, [developers]);

  const teamOptions = useMemo(() => {
    const teams = new Set<string>();
    developers.forEach((dev) => teams.add(dev.team));
    return ["all", ...Array.from(teams).sort((a, b) => a.localeCompare(b))];
  }, [developers]);

  async function inviteDeveloper() {
    const email = inviteEmail.trim();
    if (!email || !inviteRole.trim()) return;

    try {
      setInviting(true);
      setInviteStatus(null);
      const result = await invokeDesktop<{ success: boolean; inviteId: string }>("developers:invite", {
        email,
        role: inviteRole.trim(),
      });

      if (!result?.success) {
        throw new Error("Invite failed");
      }

      setInviteStatus(`Invite sent (${result.inviteId})`);
      setInviteEmail("");
      setShowInviteModal(false);
    } catch (e) {
      setInviteStatus(e instanceof Error ? e.message : "Failed to invite developer");
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Developer Directory</h1>
            <p className="text-slate-600 dark:text-slate-300">Browse team members and current sprint allocation</p>
          </div>

          <button
            type="button"
            onClick={() => {
              setInviteStatus(null);
              setShowInviteModal(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 px-4 py-2 text-sm font-semibold text-white dark:text-black"
          >
            <UserPlus className="h-4 w-4" /> Invite Developer
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="md:col-span-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Search</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, role, team"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-9 py-2 text-sm text-slate-900 dark:text-white outline-none"
                />
              </div>
            </label>

            <label>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Role</div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>{role === "all" ? "All roles" : role}</option>
                ))}
              </select>
            </label>

            <label>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Team</div>
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
              >
                {teamOptions.map((team) => (
                  <option key={team} value={team}>{team === "all" ? "All teams" : team}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {inviteStatus ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {inviteStatus}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 animate-pulse">
                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-zinc-800" />
                <div className="mt-3 h-4 w-32 rounded bg-slate-200 dark:bg-zinc-800" />
                <div className="mt-2 h-4 w-20 rounded bg-slate-200 dark:bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : developers.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {developers.map((dev) => (
              <button
                key={dev.id}
                type="button"
                onClick={() => router.push(`/developers/${encodeURIComponent(dev.id)}`)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-left hover:bg-slate-50 dark:hover:bg-zinc-800/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-white dark:text-black">
                    {(dev.avatar || dev.name || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">{dev.name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">{dev.role}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-slate-200 dark:border-zinc-700 px-2 py-1.5">
                    <div className="text-slate-500 dark:text-slate-400">Current sprint tasks</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{dev.currentSprintTasks}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 dark:border-zinc-700 px-2 py-1.5">
                    <div className="text-slate-500 dark:text-slate-400">Story points assigned</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{dev.storyPointsAssigned}</div>
                  </div>
                </div>

                <div className="mt-3 inline-flex rounded-full bg-slate-100 dark:bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                  {dev.team}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-8 text-center text-sm text-slate-600 dark:text-slate-300">
            No developers found.
          </div>
        )}
      </div>

      {showInviteModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Invite Developer</h2>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="rounded p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <div className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">Email</div>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="developer@company.com"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                />
              </label>

              <label className="block">
                <div className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">Role</div>
                <input
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  placeholder="Engineer"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={inviting}
                onClick={() => void inviteDeveloper()}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black disabled:opacity-60"
              >
                {inviting ? "Inviting..." : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
