"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, RefreshCw, Save, Trash2 } from "lucide-react";

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
  status?: string;
  provisioned?: boolean;
  connected?: boolean;
  projectId?: string | null;
  error?: string;
};

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

export default function OrgSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const confirmSlug = useMemo(() => org?.slug || "", [org?.slug]);
  const [typedSlug, setTypedSlug] = useState("");

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

  async function deleteOrg() {
    if (!org?.slug) return;
    if (typedSlug.trim() !== org.slug) {
      setError(`Type ${org.slug} to confirm deletion.`);
      return;
    }

    setDeleting(true);
    setError(null);
    setSuccess(null);

    const resp = await fetchJson<unknown>("/api/org", { method: "DELETE" });
    setDeleting(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Delete failed (${resp.status})`);
      return;
    }

    window.location.href = "/org";
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
                  Provider: {dbStatus?.provider || "—"} · Connected: {dbStatus?.connected ? "yes" : "no"}
                </div>
              </div>
            </div>

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

            <div className="mt-6 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-6">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-300" />
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold text-red-900 dark:text-red-100">Danger Zone</div>
                  <div className="mt-1 text-sm text-red-800 dark:text-red-200">
                    Delete this organization. This action is not reversible.
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                    <label>
                      <div className="text-sm font-semibold text-red-900 dark:text-red-100 mb-2">Type org slug to confirm</div>
                      <input
                        value={typedSlug}
                        onChange={(e) => setTypedSlug(e.target.value)}
                        className="w-full rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                        placeholder={confirmSlug}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={deleteOrg}
                      disabled={deleting || !confirmSlug}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                    >
                      <Trash2 className="w-4 h-4" /> {deleting ? "Deleting…" : "Delete organization"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
