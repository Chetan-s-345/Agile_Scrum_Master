"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Users, MailPlus } from "lucide-react";
import {
  createOrg,
  getMe,
  inviteMember,
  listMembers,
  provisionOrgDb,
  type MeResponse,
  type OrgMember,
} from "@/lib/org-member-auth";

export default function OrgSetupPage() {
  const router = useRouter();

  const [me, setMe] = React.useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = React.useState(false);

  const [orgName, setOrgName] = React.useState("");
  const [orgSlug, setOrgSlug] = React.useState("");
  const [planSlug, setPlanSlug] = React.useState<"free" | "starter" | "pro" | "enterprise">("free");
  const [dbSetupMode, setDbSetupMode] = React.useState<"manual" | "auto">("manual");
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
  const supportsAutoProvision = planSlug === "pro" || planSlug === "enterprise";

  React.useEffect(() => {
    if (!supportsAutoProvision && dbSetupMode !== "manual") {
      setDbSetupMode("manual");
    }
  }, [supportsAutoProvision, dbSetupMode]);

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

  const onSkip = () => {
    router.push("/");
  };

  const onCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      if (dbSetupMode === "manual" && !tenantDbConnectionString.trim()) {
        setCreateError("Tenant DB connection string is required.");
        return;
      }

      if (!supportsAutoProvision && !tenantDbConnectionString.trim()) {
        setCreateError("Tenant DB connection string is required.");
        return;
      }

      const payload: Parameters<typeof createOrg>[0] = {
        orgName,
        orgSlug,
        planSlug,
      };

      const result = await createOrg(payload);

      if (!result.ok) {
        setCreateError(result.error);
        return;
      }

      const provisionPayload = supportsAutoProvision
        ? dbSetupMode === "manual"
          ? { tenantDbConnectionString: tenantDbConnectionString.trim() }
          : { autoProvision: true }
        : { tenantDbConnectionString: tenantDbConnectionString.trim() };

      const provisionResp = await provisionOrgDb(provisionPayload);
      if (!provisionResp.ok) {
        setCreateError(provisionResp.error);
        return;
      }

      await refreshMe();
      router.push("/settings/org");
      return;
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
    <div className="w-full">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-white mb-2 flex items-center gap-2">
            <Building2 className="size-6" />
            Organization
          </h1>
          <p className="text-[#a1a1aa] text-[15px]">
            Set up your organization now, or skip and continue as a guest.
          </p>
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="shrink-0 rounded-xl border border-zinc-800 bg-transparent px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-900 transition-all"
        >
          Skip
        </button>
      </div>

      {!meLoaded ? (
        <div className="text-zinc-400">Loading…</div>
      ) : !me?.user ? (
        <div className="space-y-4">
          <p className="text-zinc-400">You’re not signed in.</p>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/sign-in"
              className="rounded-xl bg-white py-3 px-5 text-[15px] font-semibold text-black hover:shadow-lg transition-all"
            >
              Sign In
            </Link>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-xl border border-zinc-800 bg-transparent py-3 px-5 text-[15px] font-semibold text-white hover:bg-zinc-900 transition-all"
            >
              Continue as guest
            </button>
          </div>
        </div>
      ) : !hasOrg ? (
        <div className="rounded-2xl border border-zinc-800 bg-[#121212] p-6">
          <h2 className="text-xl font-semibold text-white mb-1">Create Organization</h2>
          <p className="text-sm text-zinc-400 mb-6">Enter organization details to continue.</p>

          <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400">
            Select a plan for your organization. You can upgrade later from Billing.
          </div>

          <form className="space-y-5" onSubmit={onCreateOrg}>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-zinc-300">Organization Name</label>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
                placeholder="e.g. Acme Inc"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-zinc-300">Organization Slug</label>
              <input
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
                placeholder="e.g. acme"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-zinc-300">Plan</label>
              <select
                value={planSlug}
                onChange={(e) => setPlanSlug(e.target.value as "free" | "starter" | "pro" | "enterprise")}
                className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
              >
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            {supportsAutoProvision ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-zinc-300">Database Setup</div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="radio"
                      name="dbSetupMode"
                      value="manual"
                      checked={dbSetupMode === "manual"}
                      onChange={() => setDbSetupMode("manual")}
                    />
                    I have a connection string
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="radio"
                      name="dbSetupMode"
                      value="auto"
                      checked={dbSetupMode === "auto"}
                      onChange={() => setDbSetupMode("auto")}
                    />
                    Create one automatically
                  </label>
                </div>
              </div>
            ) : null}

            {!supportsAutoProvision || dbSetupMode === "manual" ? (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-zinc-300">Tenant DB Connection String</label>
                <textarea
                  value={tenantDbConnectionString}
                  onChange={(e) => setTenantDbConnectionString(e.target.value)}
                  rows={3}
                  required
                  className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
                  placeholder="postgresql://user:pass@host/db?sslmode=require"
                />
                {!supportsAutoProvision ? (
                  <div className="text-xs text-zinc-400">
                    Free plan requires an explicit tenant DB connection string.
                  </div>
                ) : null}
              </div>
            ) : null}

            {createError ? <div className="text-sm text-red-400">{createError}</div> : null}

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-xl bg-white py-3 text-[15px] font-semibold text-black hover:shadow-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {creating ? "Creating…" : "Create Organization"}
            </button>
          </form>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-800 bg-[#121212] p-6">
          <h2 className="text-xl font-semibold text-white mb-1 flex items-center gap-2">
            <Users className="size-5" />
            Members
          </h2>
          <p className="text-sm text-zinc-400 mb-6">Invite teammates to join your organization.</p>

          <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Need more features?</div>
                <div className="text-xs text-zinc-400 mt-1">Upgrade your plan from Billing to unlock advanced limits and enterprise options.</div>
              </div>
              <Link
                href="/settings/billing?plan=pro"
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-700 transition-all"
              >
                Upgrade Plan
              </Link>
            </div>
          </div>

          <form className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" onSubmit={onInvite}>
            <div className="md:col-span-2 space-y-1.5">
              <label className="block text-sm font-medium text-zinc-300">Email</label>
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                type="email"
                required
                className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
                placeholder="teammate@company.com"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-zinc-300">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>

            {inviteError ? <div className="md:col-span-3 text-sm text-red-400">{inviteError}</div> : null}

            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={inviting}
                className="inline-flex items-center gap-2 rounded-xl bg-white py-3 px-5 text-[15px] font-semibold text-black hover:shadow-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <MailPlus className="w-4 h-4" />
                {inviting ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </form>

          <div className="mt-8">
            <h3 className="text-base font-semibold text-white mb-3">Current Members</h3>
            {!membersLoaded ? (
              <div className="text-zinc-400">Loading members…</div>
            ) : members.length ? (
              <div className="divide-y divide-zinc-800 rounded-xl border border-zinc-800 overflow-hidden">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-[#121212]">
                    <div>
                      <div className="font-semibold text-white">{m.fullName}</div>
                      <div className="text-sm text-zinc-400">{m.email}</div>
                    </div>
                    <div className="text-sm font-semibold text-zinc-300">{m.role}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-zinc-400">No members found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
