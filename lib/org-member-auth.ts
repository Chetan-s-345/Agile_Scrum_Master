export type MeResponse = {
  user?: { id: string; email: string; fullName?: string; emailVerified?: boolean; createdAt?: string };
  activeOrgId?: string | null;
  memberships?: Array<{
    org: { id: string; name?: string; slug?: string };
    role?: string;
    joinedAt?: string;
  }>;
  requiresOrgSetup?: boolean;
};

export type OrgMember = {
  id: string;
  fullName: string;
  email: string;
  role: string;
};

export async function getMe(): Promise<MeResponse | null> {
  const resp = await fetch("/api/auth/me", { cache: "no-store" });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  return (data || null) as MeResponse | null;
}

export async function listMembers(params?: { page?: number; limit?: number }): Promise<{ members: OrgMember[] } | null> {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 200;
  const resp = await fetch(`/api/org/members?page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`,
    { cache: "no-store" }
  );
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  if (!data) return null;
  return { members: Array.isArray(data.members) ? (data.members as OrgMember[]) : [] };
}

export async function inviteMember(payload: { email: string; role: string }): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const resp = await fetch("/api/org/members/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await resp.json().catch(() => null);
  if (resp.ok) return { ok: true };
  return {
    ok: false,
    status: resp.status,
    error: String(data?.error || "Invite failed"),
  };
}

export async function createOrg(payload: {
  orgName: string;
  orgSlug: string;
  planSlug?: string;
  tenantDbConnectionString?: string;
}): Promise<
  | { ok: true; org: { id: string; name?: string; slug?: string } }
  | { ok: false; error: string; status: number }
> {
  const resp = await fetch("/api/org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await resp.json().catch(() => null);
  if (resp.ok) {
    return { ok: true, org: (data?.org || {}) as { id: string; name?: string; slug?: string } };
  }
  return {
    ok: false,
    status: resp.status,
    error: String(data?.error || "Create org failed"),
  };
}
