"use client";

import { useEffect, useState } from "react";

type Member = { id: string; fullName?: string; email?: string; role?: string };
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at?: string;
  expires_at?: string;
};
type InvitationsResp = { items?: Invitation[]; invitations?: Invitation[]; error?: string };

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

export default function DeveloperManagementPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");

  async function load() {
    setLoading(true);
    setError(null);
    const [resp, invitationsResp] = await Promise.all([
      fetchJson<{ members?: Member[] }>("/api/org/members?page=1&limit=200"),
      fetchJson<InvitationsResp>("/api/org/invitations"),
    ]);

    if (!resp.ok) {
      setError(`Failed to load developers (${resp.status})`);
      setMembers([]);
      setPendingInvitations([]);
      setLoading(false);
      return;
    }

    const invitations = Array.isArray(invitationsResp.data?.items)
      ? invitationsResp.data.items
      : Array.isArray(invitationsResp.data?.invitations)
      ? invitationsResp.data.invitations
      : [];

    setMembers(Array.isArray(resp.data?.members) ? resp.data.members : []);
    setPendingInvitations(invitations.filter((inv) => String(inv.status || "").toLowerCase() === "pending"));
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function inviteDeveloper() {
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail) return;

    setInviting(true);
    setError(null);

    const resp = await fetchJson<{ error?: string }>("/api/org/members/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: nextEmail, role }),
    });

    setInviting(false);
    if (!resp.ok) {
      setError(resp.data?.error || "Invite failed");
      return;
    }

    setEmail("");
    await load();
  }

  async function removeDeveloper(memberId: string) {
    const confirmed = window.confirm("Remove this developer from organization?");
    if (!confirmed) return;

    const resp = await fetchJson<{ error?: string }>(`/api/org/members/${encodeURIComponent(memberId)}`, {
      method: "DELETE",
    });

    if (!resp.ok) {
      setError(resp.data?.error || "Remove failed");
      return;
    }

    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Developer Management</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-300">List, add, and remove developers with role visibility.</p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : null}

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Add Developer</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="developer@company.com"
              className="md:col-span-2 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
            >
              <option value="developer">developer</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void inviteDeveloper()}
            disabled={inviting}
            className="mt-3 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black px-3 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {inviting ? "Sending invite..." : "Invite developer"}
          </button>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 text-sm font-semibold text-slate-900 dark:text-white">Developers</div>
          {loading ? (
            <div className="px-4 py-6 text-sm text-slate-600 dark:text-slate-300">Loading developers...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300">
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Email</th>
                    <th className="px-4 py-2 text-left">Role</th>
                    <th className="px-4 py-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 dark:border-zinc-800">
                      <td className="px-4 py-2">{m.fullName || "-"}</td>
                      <td className="px-4 py-2">{m.email || "-"}</td>
                      <td className="px-4 py-2">{m.role || "developer"}</td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => void removeDeveloper(m.id)}
                          className="rounded border border-red-300 dark:border-red-900 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!members.length ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-600 dark:text-slate-300">No developers found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 text-sm font-semibold text-slate-900 dark:text-white">Pending Requests</div>
          {loading ? (
            <div className="px-4 py-6 text-sm text-slate-600 dark:text-slate-300">Loading pending requests...</div>
          ) : pendingInvitations.length ? (
            <div className="divide-y divide-slate-100 dark:divide-zinc-800">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">{inv.email}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">Role: {inv.role}</div>
                  </div>
                  <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-2 py-1 text-xs font-semibold">
                    Pending
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-slate-600 dark:text-slate-300">No pending requests.</div>
          )}
        </section>
      </div>
    </div>
  );
}

