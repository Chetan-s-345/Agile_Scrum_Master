"use client";

import { useEffect, useState } from "react";

type Member = { id: string; fullName?: string; email?: string; role?: string };

type MembersResp = { members?: Member[]; error?: string };

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at?: string;
  expires_at?: string;
};

type InvitationsResp = { items?: Invitation[]; error?: string };

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
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

export default function TeamSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviting, setInviting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    const [mResp, iResp] = await Promise.all([
      fetchJson<MembersResp>("/api/org/members?page=1&limit=200"),
      fetchJson<InvitationsResp>("/api/org/invitations"),
    ]);

    if (!mResp.ok) {
      setError(mResp.data?.error || `Failed to load members (${mResp.status})`);
      setMembers([]);
    } else {
      setMembers(Array.isArray(mResp.data?.members) ? mResp.data!.members : []);
    }

    setInvitations(Array.isArray(iResp.data?.items) ? iResp.data!.items : []);

    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);

    const resp = await fetchJson<unknown>("/api/org/members/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });

    setInviting(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Invite failed (${resp.status})`);
      return;
    }

    setEmail("");
    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Team</h1>
        <p className="text-slate-600 dark:text-slate-300">Invite members and review pending invitations.</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="text-lg font-semibold text-slate-900 dark:text-white">Invite member</div>
          <form onSubmit={sendInvite} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <label className="md:col-span-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                placeholder="teammate@company.com"
              />
            </label>

            <label>
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Role</div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={inviting}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {inviting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <div className="text-lg font-semibold text-slate-900 dark:text-white">Members</div>
            {loading ? (
              <div className="mt-3 text-slate-600 dark:text-slate-300">Loading…</div>
            ) : members.length ? (
              <div className="mt-4 divide-y divide-slate-200 dark:divide-zinc-800 rounded-lg border border-slate-200 dark:border-zinc-800 overflow-hidden">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-zinc-900">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{m.fullName || "—"}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-300">{m.email || ""}</div>
                    </div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{m.role || ""}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-slate-600 dark:text-slate-300">No members found.</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
            <div className="text-lg font-semibold text-slate-900 dark:text-white">Pending invitations</div>
            {loading ? (
              <div className="mt-3 text-slate-600 dark:text-slate-300">Loading…</div>
            ) : invitations.length ? (
              <div className="mt-4 space-y-2">
                {invitations.map((inv) => (
                  <div key={inv.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{inv.email}</div>
                      <div className="text-xs rounded-full px-2 py-1 bg-slate-200 dark:bg-zinc-800 text-slate-800 dark:text-slate-200">{inv.status}</div>
                    </div>
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">Role: {inv.role}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-slate-600 dark:text-slate-300">No pending invitations.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
