"use client";

import { formatDistanceToNow } from "date-fns";
import { BookOpen, Check, Copy, Eye, EyeOff, Link2, Pause, Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApiKey = {
  id: string;
  name: string;
  keyMasked: string;
  fullKey: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "revoked";
};

type DevWebhook = {
  id: string;
  endpointUrl: string;
  events: string[];
  active: boolean;
  lastTriggeredAt: string | null;
};

type Usage = {
  requestsToday: number;
  requestsMonth: number;
  rateLimit: number;
  quotaUsedPct: number;
};

type SummaryResp = {
  apiKeys: ApiKey[];
  webhooks: DevWebhook[];
  usage?: Usage | null;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at?: string;
  expires_at?: string;
};

type InvitationsResp = {
  items?: Invitation[];
  invitations?: Invitation[];
};
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

function rel(value: string | null) {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return formatDistanceToNow(d, { addSuffix: true });
}

function skelRows() {
  return Array.from({ length: 3 }, (_, idx) => (
    <tr key={`api-sk-${idx}`} className="border-b border-slate-200 dark:border-zinc-800 animate-pulse">
      <td className="px-4 py-3"><div className="h-4 w-28 rounded bg-slate-200 dark:bg-zinc-800" /></td>
      <td className="px-4 py-3"><div className="h-4 w-52 rounded bg-slate-200 dark:bg-zinc-800" /></td>
      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-slate-200 dark:bg-zinc-800" /></td>
      <td className="px-4 py-3"><div className="h-4 w-24 rounded bg-slate-200 dark:bg-zinc-800" /></td>
      <td className="px-4 py-3"><div className="h-6 w-16 rounded-full bg-slate-200 dark:bg-zinc-800" /></td>
      <td className="px-4 py-3"><div className="h-7 w-20 rounded bg-slate-200 dark:bg-zinc-800" /></td>
    </tr>
  ));
}

export default function DevelopersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResp>({ apiKeys: [], webhooks: [], usage: null });

  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);

  const [showAddWebhook, setShowAddWebhook] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState("sprint.created,task.updated");
  const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [editWebhookEvents, setEditWebhookEvents] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [resp, invitationsResp] = await Promise.all([
      fetchJson<SummaryResp>("/api/developer-tools"),
      fetchJson<InvitationsResp>("/api/org/invitations"),
    ]);
    if (!resp.ok) {
      setError("Failed to load developer tools (" + resp.status + ")");
      setSummary({ apiKeys: [], webhooks: [], usage: null });
      setLoading(false);
      return;
    }

    const invitations = Array.isArray(invitationsResp.data?.items)
      ? invitationsResp.data.items
      : Array.isArray(invitationsResp.data?.invitations)
      ? invitationsResp.data.invitations
      : [];

    setPendingInvitations(invitations.filter((inv) => String(inv.status || "").toLowerCase() === "pending"));

    setSummary({
      apiKeys: Array.isArray(resp.data?.apiKeys) ? resp.data!.apiKeys : [],
      webhooks: Array.isArray(resp.data?.webhooks) ? resp.data!.webhooks : [],
      usage: resp.data?.usage || null,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const hasUsage = useMemo(() => {
    if (!summary.usage) return false;
    return Number(summary.usage.requestsToday || 0) > 0 || Number(summary.usage.requestsMonth || 0) > 0;
  }, [summary.usage]);

  async function createApiKey() {
    const name = newKeyName.trim();
    if (!name) return;

    const resp = await fetchJson<ApiKey>("/api/developer-tools/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!resp.ok) {
      setError("Failed to create API key");
      return;
    }

    setNewKeyName("");
    setShowCreateKey(false);
    await load();
  }

  async function revokeApiKey(apiKeyId: string) {
    const resp = await fetchJson<{ ok: boolean }>(`/api/developer-tools/api-keys/${encodeURIComponent(apiKeyId)}/revoke`, {
      method: "POST",
    });
    if (!resp.ok) {
      setError("Failed to revoke API key");
      return;
    }

    setRevokeConfirmId(null);
    await load();
  }

  async function copyKey(apiKeyId: string, fullKey: string) {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopiedId(apiKeyId);
      window.setTimeout(() => setCopiedId((id) => (id === apiKeyId ? null : id)), 1200);
    } catch {
      setError("Clipboard copy failed");
    }
  }

  async function addWebhook() {
    const endpointUrl = newWebhookUrl.trim();
    if (!endpointUrl) return;

    const events = newWebhookEvents
      .split(",")
      .map((evt) => evt.trim())
      .filter(Boolean);

    const resp = await fetchJson<DevWebhook>("/api/developer-tools/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpointUrl, events }),
    });

    if (!resp.ok) {
      setError("Failed to create webhook");
      return;
    }

    setNewWebhookUrl("");
    setShowAddWebhook(false);
    await load();
  }

  async function toggleWebhook(hook: DevWebhook) {
    const resp = await fetchJson<DevWebhook>(`/api/developer-tools/webhooks/${encodeURIComponent(hook.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !hook.active }),
    });

    if (!resp.ok) {
      setError("Failed to update webhook status");
      return;
    }

    await load();
  }

  async function saveWebhookEdit(webhookId: string) {
    const endpointUrl = editWebhookUrl.trim();
    const events = editWebhookEvents
      .split(",")
      .map((evt) => evt.trim())
      .filter(Boolean);

    const resp = await fetchJson<DevWebhook>(`/api/developer-tools/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpointUrl, events }),
    });

    if (!resp.ok) {
      setError("Failed to update webhook");
      return;
    }

    setEditingWebhookId(null);
    await load();
  }

  async function deleteWebhook(webhookId: string) {
    const resp = await fetchJson<{ ok: boolean }>(`/api/developer-tools/webhooks/${encodeURIComponent(webhookId)}`, {
      method: "DELETE",
    });

    if (!resp.ok) {
      setError("Failed to delete webhook");
      return;
    }

    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Developers Tools</h1>
            <p className="text-slate-600 dark:text-slate-300">Manage API keys, webhooks, and developer tools</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateKey((s) => !s)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 px-4 py-2 text-sm font-semibold text-white dark:text-black"
          >
            <Plus className="w-4 h-4" /> Create API key
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
            {error}
          </div>
        ) : null}

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="px-5 pt-5 pb-3 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Api Keys</div>

          {showCreateKey ? (
            <div className="mx-5 mb-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 min-w-64">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Key name</div>
                  <input
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Production deploy key"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void createApiKey()}
                  className="rounded-lg border border-slate-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-zinc-800"
                >
                  Create
                </button>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-slate-300">
                  <th className="px-4 py-3 text-left font-semibold">Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Key</th>
                  <th className="px-4 py-3 text-left font-semibold">Created</th>
                  <th className="px-4 py-3 text-left font-semibold">Last used</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  skelRows()
                ) : summary.apiKeys.length ? (
                  summary.apiKeys.map((k) => {
                    const isRevoked = k.status === "revoked";
                    const isReveal = Boolean(reveal[k.id]);
                    return (
                      <tr key={k.id} className="border-b border-slate-200 dark:border-zinc-800">
                        <td className="px-4 py-3 text-slate-900 dark:text-white">{k.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-900 dark:text-slate-100">
                              {isReveal ? k.fullKey : k.keyMasked}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyKey(k.id, k.fullKey)}
                              className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800"
                              title="Copy key"
                            >
                              {copiedId === k.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setReveal((prev) => ({ ...prev, [k.id]: !prev[k.id] }))}
                              className="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-zinc-800"
                              title={isReveal ? "Hide key" : "Reveal key"}
                            >
                              {isReveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{rel(k.createdAt)}</td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{rel(k.lastUsedAt)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              "inline-flex rounded-full px-2 py-1 text-xs font-semibold " +
                              (isRevoked
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200")
                            }
                          >
                            {isRevoked ? "Revoked" : "Active"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {isRevoked ? (
                            <span className="text-xs text-slate-500 dark:text-slate-400">No actions</span>
                          ) : (
                            <div className="relative inline-flex">
                              <button
                                type="button"
                                onClick={() => setRevokeConfirmId((id) => (id === k.id ? null : k.id))}
                                className="rounded-lg border border-slate-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-zinc-800"
                              >
                                Revoke
                              </button>
                              {revokeConfirmId === k.id ? (
                                <div className="absolute left-0 top-full z-20 mt-2 w-44 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 shadow-lg">
                                  <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">Revoke this key now?</div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void revokeApiKey(k.id)}
                                      className="rounded px-2 py-1 text-xs font-semibold bg-slate-900 text-white dark:bg-white dark:text-black"
                                    >
                                      Confirm
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRevokeConfirmId(null)}
                                      className="rounded px-2 py-1 text-xs font-semibold border border-slate-200 dark:border-zinc-700"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      <div className="text-slate-600 dark:text-slate-300">No API keys yet. Create one to start building.</div>
                      <button
                        type="button"
                        onClick={() => setShowCreateKey(true)}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
                      >
                        <Plus className="w-4 h-4" /> Create API key
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Pending Requests</div>
            <a href="/settings/team" className="text-xs font-semibold text-slate-700 dark:text-slate-200 hover:underline">
              Manage team
            </a>
          </div>

          {loading ? (
            <div className="text-sm text-slate-600 dark:text-slate-300">Loading pending requests...</div>
          ) : pendingInvitations.length ? (
            <div className="space-y-2">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{inv.email}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">Role: {inv.role}</div>
                    </div>
                    <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-2 py-1 text-xs font-semibold">
                      Pending
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600 dark:text-slate-300">No pending requests.</div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">Webhooks</div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3">
              {Array.from({ length: 2 }, (_, idx) => (
                <div key={`wh-sk-${idx}`} className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4 animate-pulse">
                  <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-zinc-800 mb-3" />
                  <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          ) : summary.webhooks.length ? (
            <div className="space-y-3">
              {summary.webhooks.map((hook) => (
                <article key={hook.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                  {editingWebhookId === hook.id ? (
                    <div className="space-y-3">
                      <input
                        value={editWebhookUrl}
                        onChange={(e) => setEditWebhookUrl(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                      />
                      <input
                        value={editWebhookEvents}
                        onChange={(e) => setEditWebhookEvents(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveWebhookEdit(hook.id)}
                          className="rounded-lg px-3 py-2 text-sm font-semibold bg-slate-900 text-white dark:bg-white dark:text-black"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWebhookId(null)}
                          className="rounded-lg px-3 py-2 text-sm font-semibold border border-slate-200 dark:border-zinc-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-72 flex-1">
                        <div className="font-mono text-sm text-slate-900 dark:text-white truncate" title={hook.endpointUrl}>{hook.endpointUrl}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {hook.events.length ? hook.events.map((evt) => (
                            <span key={`${hook.id}-${evt}`} className="rounded-full border border-slate-200 dark:border-zinc-700 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200">
                              {evt}
                            </span>
                          )) : <span className="text-xs text-slate-500">No events selected</span>}
                        </div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last triggered {rel(hook.lastTriggeredAt)}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleWebhook(hook)}
                          className={
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold " +
                            (hook.active
                              ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200"
                              : "border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200")
                          }
                        >
                          {hook.active ? <Webhook className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                          {hook.active ? "Active" : "Paused"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingWebhookId(hook.id);
                            setEditWebhookUrl(hook.endpointUrl);
                            setEditWebhookEvents(hook.events.join(","));
                          }}
                          className="rounded p-2 hover:bg-slate-100 dark:hover:bg-zinc-800"
                          title="Edit webhook"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteWebhook(hook.id)}
                          className="rounded p-2 hover:bg-slate-100 dark:hover:bg-zinc-800"
                          title="Delete webhook"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-6 text-center">
              <div className="text-slate-600 dark:text-slate-300">No webhooks configured.</div>
              <button
                type="button"
                onClick={() => setShowAddWebhook(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
              >
                <Plus className="w-4 h-4" /> Add webhook
              </button>
            </div>
          )}

          <div className="mt-4">
            {showAddWebhook ? (
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <input
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                    placeholder="https://your-app.dev/webhook"
                    className="lg:col-span-2 w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
                  />
                  <input
                    value={newWebhookEvents}
                    onChange={(e) => setNewWebhookEvents(e.target.value)}
                    placeholder="sprint.created, task.updated"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void addWebhook()}
                    className="rounded-lg px-3 py-2 text-sm font-semibold bg-slate-900 text-white dark:bg-white dark:text-black"
                  >
                    Save webhook
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddWebhook(false)}
                    className="rounded-lg px-3 py-2 text-sm font-semibold border border-slate-200 dark:border-zinc-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddWebhook(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800"
              >
                <Plus className="w-4 h-4" /> Add webhook
              </button>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">Api Docs & Resources</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <a href="/docs" className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold"><BookOpen className="w-4 h-4" /> API Reference</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Complete endpoint and auth documentation.</p>
              <span className="mt-3 inline-flex text-sm font-semibold text-slate-900 dark:text-slate-200">Open</span>
            </a>
            <a href="/docs" className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold"><Webhook className="w-4 h-4" /> Webhook Events guide</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Learn payloads, retries, and signatures.</p>
              <span className="mt-3 inline-flex text-sm font-semibold text-slate-900 dark:text-slate-200">Open</span>
            </a>
            <a href="/docs" className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4 hover:bg-slate-50 dark:hover:bg-zinc-800/50">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold"><Link2 className="w-4 h-4" /> SDKs & Libraries</div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Get started quickly with official clients.</p>
              <span className="mt-3 inline-flex text-sm font-semibold text-slate-900 dark:text-slate-200">Open</span>
            </a>
          </div>
        </section>

        {hasUsage ? (
          <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-4">Rate Limits & Usage</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">Requests today</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{summary.usage?.requestsToday || 0}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">Requests this month</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{summary.usage?.requestsMonth || 0}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">Rate limit</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{summary.usage?.rateLimit || 0}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                <div className="text-xs text-slate-500 dark:text-slate-400">Quota used %</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{summary.usage?.quotaUsedPct || 0}%</div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
