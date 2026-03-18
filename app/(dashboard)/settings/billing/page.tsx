"use client";

import { useEffect, useState } from "react";

type SubscriptionInfo = {
  status?: string;
  billing_cycle?: string;
  plan_slug?: string;
  plan_name?: string;
  current_period_end?: string;
};

type BillingResponse = {
  subscription?: SubscriptionInfo | null;
  usageMonthToDate?: {
    total_requests?: number;
    total_tokens?: number;
    total_cost_usd?: string;
  } | null;
};

type Plan = {
  id: string;
  name: string;
  slug: string;
  price_monthly: string | number;
  price_yearly: string | number;
  max_members: number;
  max_projects: number;
  ai_requests_per_day: number;
};

type Coupon = {
  code: string;
  description: string;
  discountType: "percent";
  discountValue: number;
  applicablePlanSlugs: string[];
};

type PlansResponse = {
  plans?: Plan[];
  coupons?: Coupon[];
};

type CouponValidationResponse = {
  valid?: boolean;
  coupon?: Coupon;
  error?: string;
};

type CheckoutResponse = {
  checkoutUrl?: string;
  pricing?: {
    baseAmount?: number;
    finalAmount?: number;
    coupon?: Coupon | null;
    billingCycle?: "monthly" | "yearly";
    currency?: string;
  };
  error?: string;
};

async function fetchJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  const resp = await fetch(url, { cache: "no-store" });
  const text = await resp.text().catch(() => "");
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [enterpriseCouponCode, setEnterpriseCouponCode] = useState("ENT-2026-SCALE-40");

  const [selectedPlan, setSelectedPlan] = useState("starter");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [couponCode, setCouponCode] = useState("");
  const [couponStatus, setCouponStatus] = useState<string | null>(null);
  const [validatedCoupon, setValidatedCoupon] = useState<Coupon | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [creatingCheckout, setCreatingCheckout] = useState(false);

  const selectedPlanModel = plans.find((p) => p.slug === selectedPlan) || null;

  const listedBasePrice = selectedPlanModel
    ? Number(billingCycle === "yearly" ? selectedPlanModel.price_yearly : selectedPlanModel.price_monthly)
    : 0;

  const basePrice =
    listedBasePrice > 0
      ? listedBasePrice
      : selectedPlanModel?.slug === "enterprise"
        ? billingCycle === "yearly"
          ? 9990
          : 999
        : 0;

  const finalPrice = validatedCoupon
    ? Math.max(0, Math.round(basePrice * (1 - validatedCoupon.discountValue / 100) * 100) / 100)
    : basePrice;

  useEffect(() => {
    (async () => {
      const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const initialPlan = params?.get("plan")?.toLowerCase() || "";
      const initialCoupon = params?.get("coupon") || "";

      setLoading(true);
      setError(null);
      const [billingResp, plansResp] = await Promise.all([
        fetchJson<BillingResponse>("/api/org/billing"),
        fetchJson<PlansResponse>("/api/org/billing/plans"),
      ]);

      if (!billingResp.ok) {
        setError(extractError(billingResp.data) || `Failed to load billing (${billingResp.status})`);
        setBilling(null);
      } else {
        setBilling(billingResp.data);
      }

      if (plansResp.ok && plansResp.data) {
        const nextPlans = Array.isArray(plansResp.data.plans) ? plansResp.data.plans : [];
        setPlans(nextPlans);
        const firstPaid = nextPlans.find((p) => p.slug !== "free")?.slug || "starter";
        const requestedPlanValid = nextPlans.some((p) => p.slug === initialPlan && p.slug !== "free");
        setSelectedPlan(requestedPlanValid ? initialPlan : firstPaid);

        const enterpriseCoupon = Array.isArray(plansResp.data.coupons)
          ? plansResp.data.coupons.find((c) => c.code.toUpperCase().includes("ENT"))
          : null;
        if (enterpriseCoupon?.code) setEnterpriseCouponCode(enterpriseCoupon.code);

        if (initialCoupon) {
          setCouponCode(initialCoupon);
        }
      } else if (!billingResp.ok) {
        setError((prev) => prev || extractError(plansResp.data) || `Failed to load plans (${plansResp.status})`);
      }

      setLoading(false);
    })();
  }, []);

  async function validateCoupon() {
    if (!couponCode.trim()) {
      setCouponStatus("Enter a coupon code.");
      setValidatedCoupon(null);
      return;
    }

    setCheckingCoupon(true);
    setCouponStatus(null);
    try {
      const resp = await fetch("/api/org/billing/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: selectedPlan, couponCode: couponCode.trim() }),
      });
      const data = (await resp.json().catch(() => null)) as CouponValidationResponse | null;

      if (!resp.ok || !data?.valid || !data.coupon) {
        setValidatedCoupon(null);
        setCouponStatus(data?.error || `Coupon is not valid (${resp.status}).`);
        return;
      }

      setValidatedCoupon(data.coupon);
      setCouponStatus(`Coupon applied: ${data.coupon.discountValue}% off.`);
    } finally {
      setCheckingCoupon(false);
    }
  }

  async function startCheckout() {
    setCreatingCheckout(true);
    setError(null);

    try {
      const origin = window.location.origin;
      const resp = await fetch("/api/org/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planSlug: selectedPlan,
          billingCycle,
          couponCode: validatedCoupon ? validatedCoupon.code : couponCode.trim() || undefined,
          successUrl: `${origin}/settings/billing?payment=success`,
          cancelUrl: `${origin}/settings/billing?payment=cancelled`,
        }),
      });

      const data = (await resp.json().catch(() => null)) as CheckoutResponse | null;
      if (!resp.ok || !data?.checkoutUrl) {
        setError(data?.error || `Unable to start checkout (${resp.status})`);
        return;
      }

      window.location.href = data.checkoutUrl;
    } finally {
      setCreatingCheckout(false);
    }
  }

  function copyEnterpriseCoupon() {
    navigator.clipboard?.writeText(enterpriseCouponCode).catch(() => null);
    setCouponCode(enterpriseCouponCode);
    setCouponStatus(`Enterprise coupon copied: ${enterpriseCouponCode}`);
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Billing</h1>
        <p className="text-slate-600 dark:text-slate-300">Manage plan, coupon, and checkout in one place.</p>

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
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Plan</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {billing?.subscription?.plan_name || "Not set"}
                  </div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Status</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {billing?.subscription?.status || "Unknown"}
                  </div>
                </div>
                <div className="rounded-md bg-slate-50 dark:bg-black/40 p-3">
                  <div className="text-slate-500 dark:text-slate-400">Monthly AI Requests</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {billing?.usageMonthToDate?.total_requests ?? 0}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-5">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">Enterprise Coupon</div>
              <div className="mt-2 text-sm text-amber-800 dark:text-amber-300">
                Use this coupon code for enterprise checkout.
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-black/30 px-3 py-2 font-mono text-sm text-amber-900 dark:text-amber-200">
                  {enterpriseCouponCode}
                </div>
                <button
                  type="button"
                  onClick={copyEnterpriseCoupon}
                  className="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800"
                >
                  Use Coupon
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Upgrade Checkout</div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-sm text-slate-700 dark:text-slate-200">
                  Plan
                  <select
                    value={selectedPlan}
                    onChange={(e) => {
                      setSelectedPlan(e.target.value);
                      setValidatedCoupon(null);
                      setCouponStatus(null);
                    }}
                    className="mt-1 block w-full rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                  >
                    {plans
                      .filter((plan) => plan.slug !== "free")
                      .map((plan) => (
                        <option key={plan.id} value={plan.slug}>
                          {plan.name}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="text-sm text-slate-700 dark:text-slate-200">
                  Billing Cycle
                  <select
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as "monthly" | "yearly")}
                    className="mt-1 block w-full rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Enter coupon code"
                  className="rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={checkingCoupon}
                  onClick={validateCoupon}
                  className="rounded-md border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-zinc-800"
                >
                  {checkingCoupon ? "Checking..." : "Validate Coupon"}
                </button>
              </div>

              {couponStatus ? <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">{couponStatus}</div> : null}

              <div className="mt-4 rounded-md bg-slate-50 dark:bg-black/40 p-3 text-sm text-slate-700 dark:text-slate-200">
                <div>Base Price: ${basePrice.toFixed(2)}</div>
                <div>Final Price: ${finalPrice.toFixed(2)}</div>
              </div>

              <button
                type="button"
                disabled={creatingCheckout}
                onClick={startCheckout}
                className="mt-4 rounded-md bg-slate-900 dark:bg-slate-100 px-4 py-2 text-sm font-semibold text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-60"
              >
                {creatingCheckout ? "Creating checkout..." : "Continue to Payment"}
              </button>

              <div className="mt-4 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-blue-900 dark:text-blue-200">
                For free plan onboarding, paste your tenant database URL in Organization setup.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
