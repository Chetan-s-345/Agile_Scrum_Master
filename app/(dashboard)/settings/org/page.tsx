"use client";

import * as React from "react";
import { Building2, Users, MailPlus } from "lucide-react";
import { createOrg, getMe, inviteMember, listMembers, type MeResponse, type OrgMember } from "@/lib/org-member-auth";

export default function OrgSetupPage() {
  const [me, setMe] = React.useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = React.useState(false);

  const [orgName, setOrgName] = React.useState("");
  const [orgSlug, setOrgSlug] = React.useState("");
  const [tenantDbConnectionString, setTenantDbConnectionString] = React.useState("");

  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const [members, setMembers] = React.useState<OrgMember[]>([]);
  const [membersLoaded, setMembersLoaded] = React.useState(false);

  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("member");
  const [inviting, setInviting] = React.useState(false);
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  const hasOrg = Boolean(Array.isArray(me?.memberships) && me!.memberships!.length);

  const refreshMe = React.useCallback(async () => {
    const data = await getMe();
    setMe(data);
    setMeLoaded(true);
    return data;
  }, []);

  const refreshMembers = React.useCallback(async () => {
    setMembersLoaded(false);
    const data = await listMembers({ page: 1, limit: 200 });
    setMembers(Array.isArray(data?.members) ? data!.members : []);
    setMembersLoaded(true);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await getMe();
      if (cancelled) return;
      setMe(data);
      setMeLoaded(true);

      if (Array.isArray(data?.memberships) && data.memberships.length) {
        const m = await listMembers({ page: 1, limit: 200 });
        if (cancelled) return;
        setMembers(Array.isArray(m?.members) ? m!.members : []);
        setMembersLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const onCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const result = await createOrg({
        orgName,
        orgSlug,
        tenantDbConnectionString: tenantDbConnectionString || undefined,
      });

      if (!result.ok) {
        setCreateError(result.error);
        return;
      }

      const updatedMe = await refreshMe();
      if (Array.isArray(updatedMe?.memberships) && updatedMe.memberships.length) {
        await refreshMembers();
      }
    } finally {
      setCreating(false);
    }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviting(true);

    try {
      const result = await inviteMember({ email: inviteEmail, role: inviteRole });
      if (!result.ok) {
        setInviteError(result.error);
        return;
      }
      setInviteEmail("");
      await refreshMembers();
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
            <Building2 className="w-8 h-8" />
            Organization
          </h1>
          <p className="text-slate-600 dark:text-slate-300">
            Create your organization and invite team members after signing in.
          </p>
        </div>

        {!meLoaded ? (
          <div className="text-slate-600 dark:text-slate-300">Loading…</div>
        ) : !me?.user ? (
          <div className="text-slate-600 dark:text-slate-300">You’re not signed in.</div>
        ) : !hasOrg ? (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-8">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Create Organization</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">
              If the backend is in manual tenant DB mode, provide a per-org Postgres connection string.
            </p>

            <form className="space-y-4" onSubmit={onCreateOrg}>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Organization Name</label>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Acme Inc"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Organization Slug</label>
                <input
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. acme"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Tenant DB Connection String</label>
                <textarea
                  value={tenantDbConnectionString}
                  onChange={(e) => setTenantDbConnectionString(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="postgresql://user:pass@host/db?sslmode=require"
                />
              </div>

              {createError ? (
                <div className="text-sm text-red-600 dark:text-red-400">{createError}</div>
              ) : null}

              <button
                type="submit"
                disabled={creating}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition disabled:opacity-70"
              >
                {creating ? "Creating…" : "Create Organization"}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-8">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
              <Users className="w-6 h-6" />
              Members
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-6">Invite teammates to join your organization.</p>

            <form className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" onSubmit={onInvite}>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Email</label>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  type="email"
                  required
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="teammate@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>

              {inviteError ? (
                <div className="md:col-span-3 text-sm text-red-600 dark:text-red-400">{inviteError}</div>
              ) : null}

              <div className="md:col-span-3">
                <button
                  type="submit"
                  disabled={inviting}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition disabled:opacity-70"
                >
                  <MailPlus className="w-4 h-4" />
                  {inviting ? "Sending…" : "Send Invite"}
                </button>
              </div>
            </form>

            <div className="mt-8">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-3">Current Members</h3>
              {!membersLoaded ? (
                <div className="text-slate-600 dark:text-slate-300">Loading members…</div>
              ) : members.length ? (
                <div className="divide-y divide-slate-200 dark:divide-zinc-800 rounded-lg border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-zinc-950">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">{m.fullName}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-300">{m.email}</div>
                      </div>
                      <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{m.role}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-600 dark:text-slate-300">No members found.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
