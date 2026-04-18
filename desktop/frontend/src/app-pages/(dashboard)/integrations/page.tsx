"use client";

import Link from "@/next-shims/link";
import { useEffect, useMemo, useState } from "react";

type Integration = {
  id: string;
  type: string;
  name: string;
  description: string;
  logo?: string;
  connected: boolean;
  lastSyncAt?: string | null;
  settingsPath?: string;
};

type ConnectModalState = {
  open: boolean;
  integration: Integration | null;
};

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

function formatSyncTime(value?: string | null): string {
  if (!value) return "Never";
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return "Never";
  return new Date(ts).toLocaleString();
}

function statusBadgeClass(connected: boolean): string {
  return connected
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : "border-zinc-600 bg-zinc-800 text-zinc-300";
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});
  const [connectModal, setConnectModal] = useState<ConnectModalState>({ open: false, integration: null });
  const [credentialInput, setCredentialInput] = useState("");

  const connectedCount = useMemo(() => items.filter((item) => item.connected).length, [items]);

  async function loadIntegrations() {
    setLoading(true);
    setError(null);
    try {
      const data = await invokeDesktop<Integration[]>("integrations:getAll");
      setItems(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load integrations");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadIntegrations();
  }, []);

  async function connectIntegration(integration: Integration, credentials?: Record<string, unknown>) {
    setPendingById((prev) => ({ ...prev, [integration.id]: true }));
    setError(null);
    try {
      const result = await invokeDesktop<{ success?: boolean; integration?: Integration }>("integrations:connect", {
        type: integration.type,
        credentials: credentials || {},
      });
      if (!result?.success || !result.integration) {
        throw new Error("Connect failed");
      }
      setItems((prev) => prev.map((item) => (item.id === integration.id ? result.integration! : item)));
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Connect failed");
    } finally {
      setPendingById((prev) => ({ ...prev, [integration.id]: false }));
    }
  }

  async function disconnectIntegration(integrationId: string) {
    setPendingById((prev) => ({ ...prev, [integrationId]: true }));
    setError(null);
    try {
      const result = await invokeDesktop<{ success?: boolean }>("integrations:disconnect", { integrationId });
      if (!result?.success) {
        throw new Error("Disconnect failed");
      }
      setItems((prev) => prev.map((item) => (item.id === integrationId ? { ...item, connected: false, lastSyncAt: null } : item)));
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Disconnect failed");
    } finally {
      setPendingById((prev) => ({ ...prev, [integrationId]: false }));
    }
  }

  async function syncNow(integrationId: string) {
    setPendingById((prev) => ({ ...prev, [integrationId]: true }));
    setError(null);
    try {
      const result = await invokeDesktop<{ success?: boolean }>("integrations:syncNow", { integrationId });
      if (!result?.success) {
        throw new Error("Sync failed");
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === integrationId
            ? { ...item, lastSyncAt: new Date().toISOString() }
            : item
        )
      );
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Sync failed");
    } finally {
      setPendingById((prev) => ({ ...prev, [integrationId]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-app)] px-4 py-6 text-[var(--text-primary)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Integrations</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{connectedCount} connected of {items.length || 0}</p>
          </div>
          <Link href="/settings/integrations" className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-hover)]">
            Global Settings
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                <div className="h-5 w-1/2 animate-pulse rounded bg-[var(--bg-hover)]" />
                <div className="mt-3 h-4 w-full animate-pulse rounded bg-[var(--bg-hover)]" />
                <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-[var(--bg-hover)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((integration) => {
              const pending = Boolean(pendingById[integration.id]);
              return (
                <article key={integration.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-hover)] text-xs font-semibold">
                        {integration.logo || integration.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <h2 className="text-lg font-semibold">{integration.name}</h2>
                      </div>
                    </div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(integration.connected)}`}>
                      {integration.connected ? "Connected" : "Disconnected"}
                    </span>
                  </div>

                  <p className="mt-3 text-sm text-[var(--text-secondary)]">{integration.description}</p>

                  <div className="mt-4 text-xs text-[var(--text-secondary)]">
                    Last sync: {formatSyncTime(integration.lastSyncAt)}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {integration.connected ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void disconnectIntegration(integration.id)}
                          disabled={pending}
                          className="rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--bg-card)] disabled:opacity-60"
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => void syncNow(integration.id)}
                          disabled={pending}
                          className="rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--bg-card)] disabled:opacity-60"
                        >
                          Sync now
                        </button>
                        <Link
                          href={integration.settingsPath || "/settings/integrations"}
                          className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--bg-hover)]"
                        >
                          Settings
                        </Link>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setCredentialInput("");
                          setConnectModal({ open: true, integration });
                        }}
                        disabled={pending}
                        className="rounded-md border border-[var(--text-primary)] bg-[var(--text-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-inverse)] disabled:opacity-60"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {connectModal.open && connectModal.integration ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
            <h3 className="text-lg font-semibold">Connect {connectModal.integration.name}</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Enter credentials or token (optional).</p>
            <textarea
              value={credentialInput}
              onChange={(event) => setCredentialInput(event.target.value)}
              rows={4}
              className="mt-3 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-input)] px-3 py-2 text-sm"
              placeholder='{"token":"..."}'
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConnectModal({ open: false, integration: null })}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const integration = connectModal.integration;
                  if (!integration) return;
                  let credentials: Record<string, unknown> = {};
                  try {
                    credentials = credentialInput.trim() ? (JSON.parse(credentialInput) as Record<string, unknown>) : {};
                  } catch {
                    credentials = { raw: credentialInput };
                  }
                  setConnectModal({ open: false, integration: null });
                  void connectIntegration(integration, credentials);
                }}
                className="rounded-md border border-[var(--text-primary)] bg-[var(--text-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-inverse)]"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
