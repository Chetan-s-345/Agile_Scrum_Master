"use client";

import Link from "@/next-shims/link";
import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";

type Org = {
  id: string;
  name: string;
  slug: string;
  timezone?: string | null;
  logoUrl?: string | null;
  status?: string | null;
  trialEndsAt?: string | null;
  dbProvisioned?: boolean | null;
};

type CurrentOrgResp = {
  org?: Org;
  plan?: { slug: string; name: string } | null;
  subscription?: Record<string, unknown> | null;
  memberCount?: number;
  error?: string;
};

type DbStatusResp = {
  provider?: string;
  connectionMode?: string;
  status?: string;
  provisioned?: boolean;
  connected?: boolean;
  projectId?: string | null;
  connectionStringMasked?: string | null;
  error?: string;
};

type OrgSettings = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  description?: string | null;
  industry?: string | null;
  size?: string | null;
  ownerId?: string | null;
  plan?: { slug: string; name: string } | null;
  subscription?: Record<string, unknown> | null;
  preferences?: {
    timezone?: string | null;
    notificationSettings?: Record<string, unknown> | null;
    defaultSprintLengthDays?: number;
    workingDays?: string[];
    dbStatus?: DbStatusResp | null;
  } | null;
};

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(wrapped.error?.message || wrapped.error?.detail || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(init.body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function maskConnectionString(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const atIndex = trimmed.indexOf("@");
  const schemeIndex = trimmed.indexOf("://");
  if (atIndex > 0 && schemeIndex >= 0 && atIndex > schemeIndex + 3) {
    return `${trimmed.slice(0, schemeIndex + 3)}***${trimmed.slice(atIndex)}`;
  }
  return `${trimmed.slice(0, 16)}...`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const method = String(init?.method || "GET").toUpperCase();
  const body = parseBody(init);

  try {
    if (url === "/api/org") {
      const [settings, members] = await Promise.all([
        invokeDesktop<OrgSettings>("org:getSettings"),
        invokeDesktop<Array<Record<string, unknown>>>("developers:getOrgMembers").catch(() => []),
      ]);

      const response: CurrentOrgResp = {
        org: {
          id: String(settings?.id || "org-default"),
          name: String(settings?.name || ""),
          slug: String(settings?.slug || ""),
          timezone: String(settings?.preferences?.timezone || "UTC"),
          logoUrl: settings?.logoUrl || null,
          status: settings?.preferences?.dbStatus?.status || null,
          dbProvisioned: Boolean(settings?.preferences?.dbStatus?.provisioned || settings?.preferences?.dbStatus?.connected),
        },
        plan: settings?.plan || null,
        subscription: settings?.subscription || null,
        memberCount: Array.isArray(members) ? members.length : 0,
      };
      return { ok: true, status: 200, data: (response as unknown) as T };
    }

    if (url === "/api/org/db-status") {
      const settings = await invokeDesktop<OrgSettings>("org:getSettings");
      const db = settings?.preferences?.dbStatus || {
        provider: "postgres",
        connectionMode: "manual",
        status: "not_provisioned",
        provisioned: false,
        connected: false,
        projectId: null,
        connectionStringMasked: null,
      };
      return { ok: true, status: 200, data: (db as unknown) as T };
    }

    if (url === "/api/org/settings" && method === "PATCH") {
      const current = await invokeDesktop<OrgSettings>("org:getSettings");
      let nextLogoUrl = String(body.logo_url || "").trim();

      if (nextLogoUrl && nextLogoUrl.startsWith("data:image/")) {
        const uploaded = await invokeDesktop<{ logoUrl: string }>("org:uploadLogo", { base64Image: nextLogoUrl });
        nextLogoUrl = String(uploaded?.logoUrl || "").trim();
      }

      const updated = await invokeDesktop<OrgSettings>("org:update", {
        name: body.name == null ? current?.name : String(body.name || "").trim(),
        description: body.description == null ? current?.description : String(body.description || "").trim(),
        industry: body.industry == null ? current?.industry : String(body.industry || "").trim(),
        size: body.size == null ? current?.size : String(body.size || "").trim(),
        logoUrl: nextLogoUrl || current?.logoUrl || "",
        preferences: {
          ...(current?.preferences || {}),
          timezone:
            body.timezone == null
              ? String(current?.preferences?.timezone || "UTC")
              : String(body.timezone || "UTC").trim(),
          notificationSettings:
            body.notification_settings && typeof body.notification_settings === "object"
              ? body.notification_settings
              : current?.preferences?.notificationSettings || {},
        },
      });

      return { ok: true, status: 200, data: (updated as unknown) as T };
    }

    if (url === "/api/org/provision-db" && method === "POST") {
      const current = await invokeDesktop<OrgSettings>("org:getSettings");
      const autoProvision = Boolean(body.autoProvision);
      const connection = String(body.tenantDbConnectionString || "").trim();
      const dbStatus: DbStatusResp = autoProvision
        ? {
            provider: "neon",
            connectionMode: "auto",
            status: "connected",
            provisioned: true,
            connected: true,
            projectId: `neon-${Date.now()}`,
            connectionStringMasked: "postgres://***@ep-neon/project",
          }
        : {
            provider: "postgres",
            connectionMode: "manual",
            status: connection ? "connected" : "not_provisioned",
            provisioned: Boolean(connection),
            connected: Boolean(connection),
            projectId: null,
            connectionStringMasked: connection ? maskConnectionString(connection) : null,
          };

      const updated = await invokeDesktop<OrgSettings>("org:update", {
        name: current?.name || "Agile Scrum Master",
        description: current?.description || "",
        industry: current?.industry || "",
        size: current?.size || "",
        logoUrl: current?.logoUrl || "",
        preferences: {
          ...(current?.preferences || {}),
          dbStatus,
        },
      });
      return { ok: true, status: 200, data: (updated as unknown) as T };
    }

    if (url === "/api/org/logo" && method === "POST") {
      const base64Image = String(body.base64Image || "").trim();
      const uploaded = await invokeDesktop<{ logoUrl: string }>("org:uploadLogo", { base64Image });
      return { ok: true, status: 200, data: (uploaded as unknown) as T };
    }

    if (url === "/api/org/transfer-ownership" && method === "POST") {
      const result = await invokeDesktop<{ success: boolean }>("org:transferOwnership", {
        newOwnerId: String(body.newOwnerId || "").trim(),
      });
      return { ok: true, status: 200, data: (result as unknown) as T };
    }

    if (url === "/api/org/delete" && method === "POST") {
      const result = await invokeDesktop<{ success: boolean }>("org:delete", {
        confirmName: String(body.confirmName || "").trim(),
      });
      return { ok: true, status: 200, data: (result as unknown) as T };
    }

    return { ok: false, status: 404, data: ({ error: `Unsupported IPC route: ${url}` } as unknown) as T };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      data: ({ error: error instanceof Error ? error.message : "IPC request failed" } as unknown) as T,
    };
  }
}

export default function OrgSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [org, setOrg] = useState<Org | null>(null);
  const [plan, setPlan] = useState<CurrentOrgResp["plan"]>(null);
  const [dbStatus, setDbStatus] = useState<DbStatusResp | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [logoUrl, setLogoUrl] = useState("");
  const [notificationJson, setNotificationJson] = useState("{}\n");
  const [dbSetupMode, setDbSetupMode] = useState<"manual" | "auto">("manual");
  const [tenantDbConnectionString, setTenantDbConnectionString] = useState("");

  const planSlug = String(plan?.slug || "").trim().toLowerCase();
  const supportsAutoProvision = planSlug === "pro" || planSlug === "enterprise";
  const effectiveDbSetupMode: "manual" | "auto" = supportsAutoProvision ? dbSetupMode : "manual";
  const isDbProvisioned = Boolean(dbStatus?.provisioned) || Boolean(dbStatus?.connected);

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const [orgResp, dbResp] = await Promise.all([
      fetchJson<CurrentOrgResp>("/api/org"),
      fetchJson<DbStatusResp>("/api/org/db-status"),
    ]);

    if (!orgResp.ok) {
      setOrg(null);
      setPlan(null);
      setMemberCount(null);
      setDbStatus(dbResp.ok ? dbResp.data : null);
      setError(extractError(orgResp.data) || `Failed to load org (${orgResp.status})`);
      setLoading(false);
      return;
    }

    const nextOrg = orgResp.data?.org ?? null;
    setOrg(nextOrg);
    setPlan(orgResp.data?.plan ?? null);
    setMemberCount(typeof orgResp.data?.memberCount === "number" ? orgResp.data.memberCount : null);
    setDbStatus(dbResp.ok ? dbResp.data : null);

    setName(nextOrg?.name || "");
    setTimezone(nextOrg?.timezone || "UTC");
    setLogoUrl(nextOrg?.logoUrl || "");
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, []);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    let notification_settings: unknown = undefined;
    try {
      notification_settings = notificationJson.trim() ? JSON.parse(notificationJson) : undefined;
    } catch {
      setSaving(false);
      setError("Notification settings must be valid JSON");
      return;
    }

    const resp = await fetchJson<unknown>("/api/org/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        timezone: timezone.trim() || undefined,
        logo_url: logoUrl.trim() || undefined,
        notification_settings,
      }),
    });

    setSaving(false);
    if (!resp.ok) {
      setError(extractError(resp.data) || `Save failed (${resp.status})`);
      return;
    }

    setSuccess("Saved");
    await load();
  }

  async function provisionDatabase(e: React.FormEvent) {
    e.preventDefault();
    setProvisioning(true);
    setError(null);
    setSuccess(null);

    const connection = tenantDbConnectionString.trim();
    if (!supportsAutoProvision && !connection) {
      setProvisioning(false);
      setError("Free plan requires a tenant DB connection string.");
      return;
    }

    if (effectiveDbSetupMode === "manual" && !connection) {
      setProvisioning(false);
      setError("Tenant DB connection string is required for manual setup.");
      return;
    }

    const payload = supportsAutoProvision
      ? effectiveDbSetupMode === "manual"
        ? { tenantDbConnectionString: connection }
        : { autoProvision: true }
      : { tenantDbConnectionString: connection };

    const resp = await fetchJson<unknown>("/api/org/provision-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setProvisioning(false);
    if (!resp.ok) {
      setError(extractError(resp.data) || `Database setup failed (${resp.status})`);
      return;
    }

    setSuccess("Database setup completed.");
    setTenantDbConnectionString("");
    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Organization</h1>
            <p className="text-slate-600 dark:text-slate-300">Update org profile and preferences.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <Link
              href="/settings"
              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
            >
              Back to Settings
            </Link>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="mb-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
            {success}
          </div>
        ) : null}

        {loading ? (
          <div className="text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Plan</div>
                <div className="mt-2 text-slate-900 dark:text-white font-bold">{plan?.name || "—"}</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{plan?.slug || ""}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Members</div>
                <div className="mt-2 text-slate-900 dark:text-white font-bold">{memberCount ?? "—"}</div>
                <Link href="/settings/team" className="mt-2 inline-block text-sm font-semibold text-slate-900 dark:text-slate-200 underline underline-offset-4">
                  Manage team
                </Link>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Database</div>
                <div className="mt-2 text-slate-900 dark:text-white font-bold">{dbStatus?.status || "—"}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Provider: {dbStatus?.provider || "—"} · Mode: {dbStatus?.connectionMode || "—"} · Connected: {dbStatus?.connected ? "yes" : "no"}
                </div>
                {dbStatus?.connectionStringMasked ? (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 break-all">
                    Connection: {dbStatus.connectionStringMasked}
                  </div>
                ) : null}
                {dbStatus?.provider === "neon" && !dbStatus?.connectionStringMasked ? (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Neon auto-provisioning will attach a tenant connection once setup is complete.
                  </div>
                ) : null}
              </div>
            </div>

            {!isDbProvisioned ? (
              <form
                onSubmit={provisionDatabase}
                className="mb-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6"
              >
                <div className="text-lg font-semibold text-slate-900 dark:text-white">Complete Database Setup</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Your organization is created but tenant DB is not provisioned yet. Finish setup to enable all org actions.
                </div>

                {supportsAutoProvision ? (
                  <div className="mt-4 space-y-2">
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Database Setup</div>
                    <div className="flex flex-col gap-2">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <input
                          type="radio"
                          name="dbSetupMode"
                          value="manual"
                          checked={effectiveDbSetupMode === "manual"}
                          onChange={() => setDbSetupMode("manual")}
                        />
                        I have a connection string
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <input
                          type="radio"
                          name="dbSetupMode"
                          value="auto"
                          checked={effectiveDbSetupMode === "auto"}
                          onChange={() => setDbSetupMode("auto")}
                        />
                        Create one automatically (Neon)
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    Free plan requires an explicit tenant DB connection string.
                  </div>
                )}

                {!supportsAutoProvision || effectiveDbSetupMode === "manual" ? (
                  <div className="mt-4">
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                      Tenant DB Connection String
                    </label>
                    <textarea
                      value={tenantDbConnectionString}
                      onChange={(e) => setTenantDbConnectionString(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                      placeholder="postgresql://user:pass@host/db?sslmode=require"
                    />
                  </div>
                ) : null}

                <div className="mt-6 flex gap-2">
                  <button
                    type="submit"
                    disabled={provisioning}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  >
                    {provisioning ? "Setting up…" : "Complete setup"}
                  </button>
                </div>
              </form>
            ) : null}

            <form onSubmit={saveSettings} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-lg font-semibold text-slate-900 dark:text-white">Profile</div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <label>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Name</div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                    placeholder="Acme Inc"
                  />
                </label>
                <label>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Slug</div>
                  <input
                    value={org?.slug || ""}
                    readOnly
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none"
                  />
                </label>
                <label>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Timezone</div>
                  <input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                    placeholder="UTC"
                  />
                </label>
                <label>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Logo URL</div>
                  <input
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                    placeholder="https://..."
                  />
                </label>
              </div>

              <div className="mt-6">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Notification settings (JSON)</div>
                <textarea
                  value={notificationJson}
                  onChange={(e) => setNotificationJson(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none font-mono"
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
                </button>
                <Link
                  href="/settings/integrations"
                  className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
                >
                  Manage integrations
                </Link>
              </div>
            </form>

          </>
        )}
      </div>
    </div>
  );
}

