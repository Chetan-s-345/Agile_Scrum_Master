"use client";

import { useEffect, useState } from "react";

type BillingPlan = {
  name?: string;
  slug?: string;
  price?: string;
  renewalDate?: string;
  seatsUsed?: number;
  seatsAvailable?: number;
};

type PaymentMethod = {
  brand?: string;
  last4?: string;
  expiry?: string;
};

type Invoice = {
  id?: string;
  date?: string;
  amount?: number;
  status?: string;
  pdfUrl?: string;
};

type UsageStats = {
  seatsUsed?: number;
  apiCallsThisMonth?: number;
  storageUsedGb?: number;
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

function formatMoney(value?: number): string {
  const amount = Number(value || 0);
  return `$${amount.toFixed(2)}`;
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

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [busyPortal, setBusyPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [plan, setPlan] = useState<BillingPlan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [planData, paymentMethodData, invoicesData, usageData] = await Promise.all([
          invokeDesktop<BillingPlan>("billing:getPlan"),
          invokeDesktop<PaymentMethod>("billing:getPaymentMethod"),
          invokeDesktop<Invoice[]>("billing:getInvoices"),
          invokeDesktop<UsageStats>("billing:getUsage")
        ]);

        if (cancelled) return;
        setPlan(planData || null);
        setPaymentMethod(paymentMethodData || null);
        setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
        setUsage(usageData || null);
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setError(message || "Failed to load billing settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function openExternalUrl(url: string) {
    const target = safe(url).trim();
    if (!target) {
      throw new Error("Billing portal URL is missing");
    }

    try {
      await invokeDesktop<{ success?: boolean }>("system:openExternal", { url: target });
    } catch {
      window.open(target, "_blank", "noopener,noreferrer");
    }
  }

  async function handleManageSubscription() {
    setBusyPortal(true);
    setError(null);
    try {
      const portal = await invokeDesktop<{ url?: string }>("billing:getBillingPortalUrl");
      await openExternalUrl(safe(portal?.url));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message || "Failed to open billing portal");
    } finally {
      setBusyPortal(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Billing</h1>
        <p className="text-slate-600 dark:text-slate-300">Manage plan and checkout in one place.</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 text-slate-600 dark:text-slate-300">Loading…</div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Current Subscription</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Plan</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{safe(plan?.name) || "Not set"}</div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Price</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{safe(plan?.price) || "-"}</div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Renewal Date</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{formatDate(plan?.renewalDate)}</div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Seats</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {Number(plan?.seatsUsed || 0)} / {Number(plan?.seatsAvailable || 0)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleManageSubscription}
                disabled={busyPortal}
                className="mt-4 rounded-md bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-semibold text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-60"
              >
                {busyPortal ? "Opening..." : "Manage Subscription"}
              </button>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Payment Method</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Card</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {safe(paymentMethod?.brand) || "Card"} •••• {safe(paymentMethod?.last4) || "----"}
                  </div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Expiry</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{safe(paymentMethod?.expiry) || "-"}</div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3 flex items-end">
                  <button
                    type="button"
                    onClick={handleManageSubscription}
                    className="rounded-md border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-zinc-800"
                  >
                    Update Card
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Invoice History</div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-zinc-800">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Amount</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.length === 0 ? (
                      <tr>
                        <td className="py-3 text-slate-500 dark:text-slate-400" colSpan={4}>No invoices found.</td>
                      </tr>
                    ) : (
                      invoices.map((invoice) => (
                        <tr key={safe(invoice.id) || `${safe(invoice.date)}-${safe(invoice.status)}`} className="border-b border-slate-100 dark:border-zinc-800">
                          <td className="py-2 pr-4 text-slate-900 dark:text-slate-100">{formatDate(invoice.date)}</td>
                          <td className="py-2 pr-4 text-slate-900 dark:text-slate-100">{formatMoney(invoice.amount)}</td>
                          <td className="py-2 pr-4 text-slate-900 dark:text-slate-100">{safe(invoice.status) || "-"}</td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => openExternalUrl(safe(invoice.pdfUrl))}
                              className="rounded-md border border-slate-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-zinc-800"
                            >
                              Download PDF
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Usage Metrics</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Seats Used</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{Number(usage?.seatsUsed || 0)}</div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">API Calls This Month</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{Number(usage?.apiCallsThisMonth || 0)}</div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Storage Used</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{Number(usage?.storageUsedGb || 0).toFixed(1)} GB</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

