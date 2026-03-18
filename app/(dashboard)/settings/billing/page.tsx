"use client";

import { useEffect, useState } from "react";

const FALLBACK_PAID_PLANS: Plan[] = [
  {
    id: "starter-fallback",
    name: "Starter",
    slug: "starter",
    price_monthly: 49,
    price_yearly: 490,
    max_members: 15,
    max_projects: 10,
    ai_requests_per_day: 500,
  },
  {
    id: "pro-fallback",
    name: "Pro",
    slug: "pro",
    price_monthly: 199,
    price_yearly: 1990,
    max_members: 50,
    max_projects: 40,
    ai_requests_per_day: 2500,
  },
  {
    id: "enterprise-fallback",
    name: "Enterprise",
    slug: "enterprise",
    price_monthly: 999,
    price_yearly: 9990,
    max_members: 500,
    max_projects: 500,
    ai_requests_per_day: 20000,
  },
];

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

type PlansResponse = {
  plans?: Plan[];
  coupons?: Array<{
    code: string;
    description?: string;
    discountType?: "percent" | string;
    discountValue?: number;
    applicablePlanSlugs?: string[];
  }>;
};

type ApplyCouponResponse = {
  ok?: boolean;
  plan?: { id?: string; slug?: string; name?: string };
  billingCycle?: "monthly" | "yearly";
  coupon?: CouponValidationResponse["coupon"] | null;
  pricing?: {
    baseAmount: number;
    discountAmount: number;
    finalAmount: number;
    currency?: string;
  };
  valid?: boolean;
  error?: string;
  upstream?: { url?: string; status?: number };
  bodySnippet?: string;
};

type CreateSubscriptionResponse = {
  ok?: boolean;
  requiresPayment?: boolean;
  plan?: { id?: string; slug?: string; name?: string };
  coupon?: CouponValidationResponse["coupon"] | null;
  pricing?: {
    baseAmount: number;
    discountAmount: number;
    finalAmount: number;
    currency?: string;
  };
  subscription?: { id?: string; status?: string };
  payment?: {
    id?: string;
    provider?: string;
    provider_transaction_id?: string;
    payment_status?: string;
    amount?: number;
    currency?: string;
  };
  error?: string;
  upstream?: { url?: string; status?: number };
  bodySnippet?: string;
};

function formatProxyError(
  data: { error?: string; upstream?: { status?: number; url?: string; baseUrl?: string }; bodySnippet?: string } | null,
  fallback: string
) {
  if (!data?.error) return fallback;
  if (data.error !== "Upstream returned non-JSON") return data.error;
  const status = data.upstream?.status;
  const url = data.upstream?.url || data.upstream?.baseUrl;
  const where = url ? `\n\nUpstream URL: ${url}` : "";
  const snippet = data.bodySnippet ? `\n\nUpstream body: ${data.bodySnippet}` : "";
  return `Upstream returned non-JSON${status ? ` (status ${status})` : ""}.${where}${snippet}`;
}

type CouponValidationResponse = {
  valid?: boolean;
  coupon?: {
    code: string;
    description?: string;
    discountType?: "percent" | string;
    discountValue?: number;
    applicablePlanSlugs?: string[];
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

function normalizeCode(value: string): string {
  return String(value || "").trim().toUpperCase();
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);

  const [selectedPlan, setSelectedPlan] = useState("starter");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [couponCode, setCouponCode] = useState("");
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResponse["coupon"] | null>(null);
  const [publicCoupons, setPublicCoupons] = useState<NonNullable<PlansResponse["coupons"]>>([]);
  const [creatingCheckout, setCreatingCheckout] = useState(false);
  const [pricingPreview, setPricingPreview] = useState<ApplyCouponResponse["pricing"] | null>(null);

  const paidPlans = (() => {
    const fromApi = plans.filter((p) => p.slug !== "free");
    if (fromApi.length) return fromApi;
    return FALLBACK_PAID_PLANS;
  })();

  const selectedPlanModel = paidPlans.find((p) => p.slug === selectedPlan) || paidPlans[0] || null;

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

  const finalPriceLocal = (() => {
    if (!appliedCoupon) return basePrice;
    const kind = String(appliedCoupon.discountType || "").toLowerCase();
    const value = Number(appliedCoupon.discountValue || 0);
    if (kind === "percent") {
      return Math.max(0, Math.round(basePrice * (1 - value / 100) * 100) / 100);
    }
    if (kind === "fixed") {
      return Math.max(0, Math.round((basePrice - value) * 100) / 100);
    }
    return basePrice;
  })();

  const basePriceDisplay = typeof pricingPreview?.baseAmount === "number" ? pricingPreview.baseAmount : basePrice;
  const finalPriceDisplay = typeof pricingPreview?.finalAmount === "number" ? pricingPreview.finalAmount : finalPriceLocal;

  useEffect(() => {
    (async () => {
      const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const initialPlan = params?.get("plan")?.toLowerCase() || "";
      const initialCoupon = params?.get("coupon")?.trim() || "";
      const payment = params?.get("payment")?.trim().toLowerCase() || "";
      const returnSessionId = params?.get("session_id")?.trim() || params?.get("providerSessionId")?.trim() || "";
      const returnProviderTransactionId =
        params?.get("providerTransactionId")?.trim() || params?.get("provider_transaction_id")?.trim() || "";

      setLoading(true);
      setError(null);

      // If we returned from checkout (mock or Stripe success), confirm the payment and activate the subscription.
      if ((payment === "mock" || payment === "success") && (returnProviderTransactionId || returnSessionId)) {
        try {
          const confirmResp = await fetch("/api/org/billing/confirm-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: payment === "mock" ? "mock" : "stripe",
              providerTransactionId: returnProviderTransactionId || returnSessionId,
              paymentStatus: payment === "success" || payment === "mock" ? "succeeded" : "cancelled",
            }),
          });

          const confirmData = (await confirmResp.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!confirmResp.ok || !confirmData?.ok) {
            setError(confirmData?.error || `Failed to confirm subscription (${confirmResp.status})`);
          } else {
            // Remove payment params so refresh doesn't re-confirm.
            const next = new URL(window.location.href);
            next.searchParams.delete("payment");
            next.searchParams.delete("session_id");
            next.searchParams.delete("providerSessionId");
            next.searchParams.delete("providerTransactionId");
            next.searchParams.delete("provider_transaction_id");
            window.history.replaceState({}, "", next.toString());
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setError(`Failed to confirm subscription: ${message}`);
        }
      }

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
        setPublicCoupons(Array.isArray(plansResp.data.coupons) ? plansResp.data.coupons : []);
        const paid = nextPlans.filter((p) => p.slug !== "free");
        const firstPaid = paid[0]?.slug || FALLBACK_PAID_PLANS[0].slug;
        const requestedPlanValid = (paid.length ? paid : FALLBACK_PAID_PLANS).some(
          (p) => p.slug === initialPlan && p.slug !== "free"
        );
        setSelectedPlan(requestedPlanValid ? initialPlan : firstPaid);
        if (initialCoupon) setCouponCode(initialCoupon.toUpperCase());
      } else if (!billingResp.ok) {
        setError((prev) => prev || extractError(plansResp.data) || `Failed to load plans (${plansResp.status})`);
      }

      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedPlanModel?.slug) return;
      const code = appliedCoupon?.code ? normalizeCode(appliedCoupon.code) : undefined;
      try {
        const resp = await fetch("/api/org/billing/apply-coupon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planSlug: selectedPlanModel.slug, billingCycle, couponCode: code }),
        });
        const data = (await resp.json().catch(() => null)) as ApplyCouponResponse | null;
        if (cancelled) return;
        if (resp.ok && data?.pricing) {
          setPricingPreview(data.pricing);
        } else {
          setPricingPreview(null);
        }
      } catch {
        if (!cancelled) setPricingPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPlanModel?.slug, billingCycle, appliedCoupon?.code]);

  useEffect(() => {
    setCouponError(null);
    setAppliedCoupon((prev) => {
      if (!prev) return prev;
      const applicable = Array.isArray(prev.applicablePlanSlugs) ? prev.applicablePlanSlugs : [];
      if (!applicable.length) return prev;
      return applicable.includes(selectedPlan) ? prev : null;
    });
  }, [selectedPlan]);

  useEffect(() => {
    if (!paidPlans.length) return;
    if (!paidPlans.some((p) => p.slug === selectedPlan)) {
      setSelectedPlan(paidPlans[0].slug);
    }
  }, [paidPlans, selectedPlan]);

  async function applyCoupon() {
    const normalized = normalizeCode(couponCode);
    let checkoutPlanSlug = selectedPlanModel?.slug || selectedPlan;
    setCouponError(null);
    setAppliedCoupon(null);
    setPricingPreview(null);

    if (!normalized) {
      setCouponError("Enter a coupon code.");
      return;
    }

    const catalogMatch = publicCoupons.find((c) => normalizeCode(String(c.code || "")) === normalized) || null;
    if (catalogMatch) {
      const applicable = Array.isArray(catalogMatch.applicablePlanSlugs) ? catalogMatch.applicablePlanSlugs : [];
      if (applicable.length && !applicable.includes(checkoutPlanSlug)) {
        const inferredPlan = applicable[0];
        setSelectedPlan(inferredPlan);
        checkoutPlanSlug = inferredPlan;
      }
    }

    setValidatingCoupon(true);
    try {
      const resp = await fetch("/api/org/billing/apply-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: checkoutPlanSlug, billingCycle, couponCode: normalized }),
      });

      const data = (await resp.json().catch(() => null)) as ApplyCouponResponse | null;
      if (!resp.ok || !data?.ok || !data?.coupon || !data?.pricing) {
        setCouponError(formatProxyError(data, `Coupon validation failed (${resp.status})`));
        return;
      }

      setAppliedCoupon(data.coupon);
      setPricingPreview(data.pricing);
      setCouponCode(normalized);
    } finally {
      setValidatingCoupon(false);
    }
  }

  async function startCheckout() {
    setCreatingCheckout(true);
    setError(null);

    try {
      let checkoutPlanSlug = selectedPlanModel?.slug || selectedPlan;
      if (!checkoutPlanSlug) {
        setError("Select a valid plan before checkout.");
        return;
      }

      const getBaseForSlug = (slug: string): number => {
        const match = paidPlans.find((p) => p.slug === slug);
        if (match) {
          const listed = Number(billingCycle === "yearly" ? match.price_yearly : match.price_monthly);
          if (Number.isFinite(listed) && listed > 0) return listed;
        }
        if (slug === "enterprise") return billingCycle === "yearly" ? 9990 : 999;
        if (slug === "pro") return billingCycle === "yearly" ? 1990 : 199;
        if (slug === "starter") return billingCycle === "yearly" ? 490 : 49;
        return 0;
      };

      const computeFinal = (base: number, coupon: CouponValidationResponse["coupon"] | null): number => {
        if (!coupon) return base;
        const kind = String(coupon.discountType || "").toLowerCase();
        if (kind === "percent") {
          const pct = Number(coupon.discountValue || 0);
          const discounted = base * (1 - pct / 100);
          return Math.max(0, Math.round(discounted * 100) / 100);
        }
        if (kind === "fixed") {
          const fixed = Number(coupon.discountValue || 0);
          return Math.max(0, Math.round((base - fixed) * 100) / 100);
        }
        return base;
      };

      // If the user typed a coupon but didn't click Apply, validate it here
      // so checkout always gets a consistent couponCode.
      let couponToSend: string | undefined = appliedCoupon?.code || undefined;
      const typedCoupon = normalizeCode(couponCode);
      let couponForPricing: CouponValidationResponse["coupon"] | null = appliedCoupon;
      if (typedCoupon && (!couponToSend || normalizeCode(couponToSend) !== typedCoupon)) {
        const catalogMatch = publicCoupons.find((c) => normalizeCode(String(c.code || "")) === typedCoupon) || null;
        if (catalogMatch) {
          const applicable = Array.isArray(catalogMatch.applicablePlanSlugs) ? catalogMatch.applicablePlanSlugs : [];
          if (applicable.length && !applicable.includes(checkoutPlanSlug)) {
            const inferredPlan = applicable[0];
            setSelectedPlan(inferredPlan);
            checkoutPlanSlug = inferredPlan;
          }
        }

        const validateResp = await fetch("/api/org/billing/apply-coupon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planSlug: checkoutPlanSlug, billingCycle, couponCode: typedCoupon }),
        });

        const validateData = (await validateResp.json().catch(() => null)) as ApplyCouponResponse | null;
        if (!validateResp.ok || !validateData?.ok || !validateData?.coupon) {
          setError(validateData?.error || `Coupon validation failed (${validateResp.status})`);
          return;
        }

        setAppliedCoupon(validateData.coupon);
        setCouponCode(typedCoupon);
        couponToSend = validateData.coupon.code;
        couponForPricing = validateData.coupon;
        if (validateData.pricing) setPricingPreview(validateData.pricing);
      }

      const guardBase = getBaseForSlug(checkoutPlanSlug);
      void computeFinal(guardBase, couponForPricing);

      const resp = await fetch("/api/org/billing/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planSlug: checkoutPlanSlug,
          billingCycle,
          couponCode: couponToSend,
          provider: "mock",
        }),
      });

      const data = (await resp.json().catch(() => null)) as CreateSubscriptionResponse | null;
      if (!resp.ok || !data?.ok || !data?.subscription) {
        setError(formatProxyError(data, `Unable to start subscription (${resp.status})`));
        return;
      }

      // If no payment is required (100% discount), backend activates immediately.
      if (!data.requiresPayment) {
        const billingResp = await fetchJson<BillingResponse>("/api/org/billing");
        if (billingResp.ok) setBilling(billingResp.data);
        return;
      }

      const tx = data.payment?.provider_transaction_id;
      if (!tx) {
        setError("Payment transaction id missing from response.");
        return;
      }

      const redirectParams = new URLSearchParams({
        payment: "mock",
        providerTransactionId: tx,
        plan: checkoutPlanSlug,
        cycle: billingCycle,
      });
      if (couponToSend) redirectParams.set("coupon", couponToSend);
      window.location.href = `/settings/billing?${redirectParams.toString()}`;
    } finally {
      setCreatingCheckout(false);
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

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Upgrade Checkout</div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-sm text-slate-700 dark:text-slate-200">
                  Plan
                  <select
                    value={selectedPlan}
                    onChange={(e) => setSelectedPlan(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                  >
                    {paidPlans.map((plan) => (
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

              <div className="mt-4">
                <label className="text-sm text-slate-700 dark:text-slate-200">
                  Coupon Code
                  <div className="mt-1 flex gap-2">
                    <input
                      value={couponCode}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCouponCode(next);
                        setCouponError(null);
                        if (appliedCoupon && normalizeCode(next) !== normalizeCode(appliedCoupon.code)) {
                          setAppliedCoupon(null);
                        }
                      }}
                      placeholder={selectedPlan === "enterprise" ? "e.g. ENT" : "Enter coupon code"}
                      className="block w-full rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2"
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={validatingCoupon}
                      className="rounded-md border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-60"
                    >
                      {validatingCoupon ? "Applying..." : "Apply"}
                    </button>
                  </div>
                </label>

                {couponError ? (
                  <div className="mt-2 text-sm text-red-700 dark:text-red-300">{couponError}</div>
                ) : null}

                {appliedCoupon ? (
                  <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-900 dark:text-emerald-200">
                    Applied: {appliedCoupon.code}
                    {typeof appliedCoupon.discountValue === "number" && String(appliedCoupon.discountType) === "percent"
                      ? ` (${appliedCoupon.discountValue}% off)`
                      : ""}
                    {appliedCoupon.description ? ` - ${appliedCoupon.description}` : ""}
                  </div>
                ) : null}

                {selectedPlan === "enterprise" ? (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {publicCoupons.some((c) => (c.applicablePlanSlugs || []).includes("enterprise"))
                      ? "Enterprise coupons are available. Apply your code before checkout."
                      : "No public enterprise coupon is currently listed."}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 rounded-md bg-slate-50 dark:bg-black/40 p-3 text-sm text-slate-700 dark:text-slate-200">
                <div>Base Price: ₹{basePriceDisplay.toFixed(2)}</div>
                <div>Final Price: ₹{finalPriceDisplay.toFixed(2)}</div>
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
