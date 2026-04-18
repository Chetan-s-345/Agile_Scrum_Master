"use client";

import { useEffect, useState } from "react";

type Member = {
  id: string;
  name?: string;
  fullName?: string;
  email?: string;
  role?: string;
  teams?: string[];
  lastActive?: string;
  status?: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  status?: string;
  invitedBy?: string;
  createdAt?: string;
  expiresAt?: string;
};

function safe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString();
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(safe(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

export default function DeveloperManagementPage() {
  const [loading, setLoading] = useState(true);
  const [savingRoleFor, setSavingRoleFor] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [revokingInvitationId, setRevokingInvitationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [membersData, invitationsData] = await Promise.all([
        invokeDesktop<Member[]>("developers:getOrgMembers"),
        invokeDesktop<Invitation[]>("developers:getPendingInvitations")
      ]);

      setMembers(Array.isArray(membersData) ? membersData : []);
      setPendingInvitations(Array.isArray(invitationsData) ? invitationsData : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Failed to load developers");
      setMembers([]);
      setPendingInvitations([]);
    } finally {
      setLoading(false);
    }
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

    try {
      await invokeDesktop<Invitation>("developers:inviteToOrg", { email: nextEmail, role });
      setEmail("");
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function removeDeveloper(memberId: string) {
    const confirmed = window.confirm("Remove this developer from organization?");
    if (!confirmed) return;

    setRemovingMemberId(memberId);
    setError(null);
    try {
      const result = await invokeDesktop<{ success?: boolean }>("developers:removeFromOrg", { userId: memberId });
      if (!result?.success) {
        throw new Error("Remove failed");
      }
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Remove failed");
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function updateRole(memberId: string, nextRole: string) {
    setSavingRoleFor(memberId);
    setError(null);
    try {
      const updated = await invokeDesktop<Member>("developers:updateRole", { userId: memberId, role: nextRole });
      setMembers((prev) => prev.map((member) => (member.id === memberId ? { ...member, ...updated } : member)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Role update failed");
      await load();
    } finally {
      setSavingRoleFor(null);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setRevokingInvitationId(invitationId);
    setError(null);
    try {
      const result = await invokeDesktop<{ success?: boolean }>("developers:revokeInvitation", { invitationId });
      if (!result?.success) {
        throw new Error("Revoke failed");
      }
      setPendingInvitations((prev) => prev.filter((inv) => inv.id !== invitationId));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Revoke failed");
    } finally {
      setRevokingInvitationId(null);
    }
  }

  const seatUsed = members.length;
  const seatTotal = Math.max(1, Math.max(20, members.length));
  const nearSeatLimit = seatUsed >= Math.ceil(seatTotal * 0.8);

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
          <div className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Seats</div>
          <div className="text-sm text-slate-700 dark:text-slate-200">
            Used: <span className="font-semibold">{seatUsed}</span> / <span className="font-semibold">{seatTotal}</span>
          </div>
          {nearSeatLimit ? (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">Seat usage is nearing capacity. Consider upgrading your plan.</div>
          ) : null}
        </section>

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
                    <th className="px-4 py-2 text-left">Teams</th>
                    <th className="px-4 py-2 text-left">Last Active</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-slate-100 dark:border-zinc-800">
                      <td className="px-4 py-2">{m.fullName || m.name || "-"}</td>
                      <td className="px-4 py-2">{m.email || "-"}</td>
                      <td className="px-4 py-2">
                        <select
                          value={safe(m.role) || "developer"}
                          onChange={(e) => void updateRole(m.id, e.target.value)}
                          disabled={savingRoleFor === m.id}
                          className="rounded border border-slate-200 dark:border-zinc-700 px-2 py-1 bg-white dark:bg-zinc-950"
                        >
                          <option value="developer">developer</option>
                          <option value="manager">manager</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">{Array.isArray(m.teams) && m.teams.length ? m.teams.join(", ") : "-"}</td>
                      <td className="px-4 py-2">{formatDate(m.lastActive)}</td>
                      <td className="px-4 py-2">{safe(m.status) || "active"}</td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => void removeDeveloper(m.id)}
                          disabled={removingMemberId === m.id}
                          className="rounded border border-red-300 dark:border-red-900 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
                        >
                          {removingMemberId === m.id ? "Removing..." : "Remove"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!members.length ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-600 dark:text-slate-300">No developers found.</td>
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
                    <div className="text-xs text-slate-600 dark:text-slate-300">Invited by: {safe(inv.invitedBy) || "-"}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">Expiry: {formatDate(inv.expiresAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-2 py-1 text-xs font-semibold">
                      Pending
                    </span>
                    <button
                      type="button"
                      onClick={() => void revokeInvitation(inv.id)}
                      disabled={revokingInvitationId === inv.id}
                      className="rounded border border-red-300 dark:border-red-900 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-300"
                    >
                      {revokingInvitationId === inv.id ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
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

