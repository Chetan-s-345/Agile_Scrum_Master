import { desktopGatewayRequest } from "@/lib/desktop-gateway";

export type MeResponse = {
  user?: { id: string; email: string; fullName?: string; emailVerified?: boolean; createdAt?: string };
  tenantProvisioningMode?: "manual" | "neon";
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

export type OrgInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  token?: string;
  created_at?: string;
  expires_at?: string;
};

export type EmailSendResult = {
  sent: boolean;
  provider?: string;
  messageId?: string;
  error?: string;
  message?: string;
  code?: string;
  statusCode?: number | null;
  details?: unknown;
};

export async function getMe(): Promise<MeResponse | null> {
  try {
    const data = await desktopGatewayRequest<MeResponse>("GET", "/api/v1/auth/me");
    return (data || null) as MeResponse | null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<boolean> {
  try {
    if (window.desktopApi?.invoke) {
      await window.desktopApi.invoke("auth:clearSession");
    }
    await desktopGatewayRequest("POST", "/api/v1/auth/logout", {});
    return true;
  } catch {
    return Boolean(window.desktopApi?.invoke);
  }
}

export async function listMembers(params?: { page?: number; limit?: number }): Promise<{ members: OrgMember[] } | null> {
  try {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 200;
    const data = await desktopGatewayRequest<{ members?: OrgMember[] }>("GET", "/api/v1/org/members", undefined, {
      page,
      limit,
    });
    if (!data) return null;
    return { members: Array.isArray(data.members) ? (data.members as OrgMember[]) : [] };
  } catch {
    return null;
  }
}

export async function inviteMember(payload: { email: string; role: string }): Promise<
  | { ok: true; invitation?: OrgInvitation; email?: EmailSendResult }
  | { ok: false; error: string; status: number }
> {
  try {
    const data = await desktopGatewayRequest<{ invitation?: OrgInvitation; invite?: OrgInvitation; email?: EmailSendResult }>(
      "POST",
      "/api/v1/org/members/invite",
      payload
    );
    return {
      ok: true,
      invitation: (data?.invitation || data?.invite || undefined) as OrgInvitation | undefined,
      email: (data?.email || undefined) as EmailSendResult | undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invite failed";
    const status = Number((message.match(/\((\d+)\)/)?.[1] || 500));
    return {
      ok: false,
      status,
      error: message,
    };
  }
}

export async function listInvitations(): Promise<
  | { ok: true; invitations: OrgInvitation[] }
  | { ok: false; error: string; status: number }
> {
  try {
    const data = await desktopGatewayRequest<{ invitations?: OrgInvitation[]; items?: OrgInvitation[] }>(
      "GET",
      "/api/v1/org/invitations"
    );
    const invitations = Array.isArray(data?.invitations)
      ? (data.invitations as OrgInvitation[])
      : Array.isArray(data?.items)
        ? (data.items as OrgInvitation[])
        : [];
    return { ok: true, invitations };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load invitations";
    const status = Number((message.match(/\((\d+)\)/)?.[1] || 500));
    return {
      ok: false,
      status,
      error: message,
    };
  }
}

export async function createOrg(payload: {
  orgName: string;
  orgSlug: string;
  planSlug?: string;
  autoResolveSlugCollision?: boolean;
}): Promise<
  | { ok: true; org: { id: string; name?: string; slug?: string } }
  | { ok: false; error: string; status: number }
> {
  try {
    const data = await desktopGatewayRequest<{ org?: { id: string; name?: string; slug?: string } }>(
      "POST",
      "/api/v1/org",
      payload
    );
    return { ok: true, org: (data?.org || {}) as { id: string; name?: string; slug?: string } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Create org failed";
    const status = Number((message.match(/\((\d+)\)/)?.[1] || 500));
    return {
      ok: false,
      status,
      error: message,
    };
  }
}

export async function provisionOrgDb(payload: {
  tenantDbConnectionString?: string;
  autoProvision?: boolean;
  neonOrgId?: string;
}): Promise<
  | { ok: true; provisioned: boolean; provider?: string }
  | { ok: false; error: string; status: number }
> {
  try {
    const data = await desktopGatewayRequest<{ provisioned?: boolean; ok?: boolean; provider?: string }>(
      "POST",
      "/api/v1/org/provision-db",
      payload
    );
    return {
      ok: true,
      provisioned: Boolean(data?.provisioned ?? data?.ok ?? true),
      provider: typeof data?.provider === "string" ? data.provider : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provision DB failed";
    const status = Number((message.match(/\((\d+)\)/)?.[1] || 500));
    return {
      ok: false,
      status,
      error: message,
    };
  }
}
