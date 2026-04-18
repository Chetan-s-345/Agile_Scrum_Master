import Link from "@/next-shims/link";
import { useEffect, useMemo, useState } from "react";

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  status: "completed" | "pending" | "skipped" | string;
  actionLabel?: string;
};

type OnboardingStatus = {
  steps: OnboardingStep[];
  completedCount: number;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }
  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(asText(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }
  return response as T;
}

export default function OnboardingPage() {
  const [loading, setLoading] = useState(true);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [completedCount, setCompletedCount] = useState(0);

  const totalCount = steps.length;
  const progressPct = useMemo(() => {
    if (!totalCount) return 0;
    return Math.round((completedCount / totalCount) * 100);
  }, [completedCount, totalCount]);

  const allDone = totalCount > 0 && completedCount === totalCount;

  async function loadStatus() {
    setError(null);
    try {
      const data = await invokeDesktop<OnboardingStatus>("onboarding:getStatus");
      const nextSteps = Array.isArray(data?.steps) ? data.steps : [];
      setSteps(nextSteps);
      setCompletedCount(Number(data?.completedCount || 0));
    } catch (err) {
      setSteps([]);
      setCompletedCount(0);
      setError(err instanceof Error ? err.message : "Failed to load onboarding status");
    } finally {
      setLoading(false);
    }
  }

  async function markComplete(stepId: string) {
    setBusyStepId(stepId);
    setError(null);
    try {
      await invokeDesktop<OnboardingStep>("onboarding:markStepComplete", { stepId });
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete step");
    } finally {
      setBusyStepId(null);
    }
  }

  async function skipStep(stepId: string) {
    setBusyStepId(stepId);
    setError(null);
    try {
      await invokeDesktop<OnboardingStep>("onboarding:skipStep", { stepId });
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip step");
    } finally {
      setBusyStepId(null);
    }
  }

  async function resetSteps() {
    setError(null);
    try {
      await invokeDesktop<{ success: boolean }>("onboarding:reset");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset onboarding");
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  const fallbackSteps = [
    "Create Organization",
    "Invite Team",
    "Connect GitHub",
    "Create First Project",
    "Create First Sprint"
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Onboarding</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          UI scaffold for a multi-step onboarding wizard.
        </p>

        <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>Progress</span>
            <span>
              {completedCount}/{totalCount || 5} ({progressPct}%)
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-zinc-800">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          {allDone ? (
            <div className="mt-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
              Celebration: all onboarding steps complete.
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void resetSteps()}
              className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white"
            >
              Reset
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="text-slate-900 dark:text-white font-semibold">Suggested steps</div>
          {loading ? (
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">Loading...</div>
          ) : steps.length > 0 ? (
            <ol className="mt-2 list-decimal pl-5 text-sm text-slate-600 dark:text-slate-300 space-y-3">
              {steps.map((step) => {
                const status = asText(step.status) || "pending";
                const busy = busyStepId === step.id;
                return (
                  <li key={step.id}>
                    <div className="font-semibold text-slate-900 dark:text-white">{step.title}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{step.description}</div>
                    <div className="mt-1 inline-flex rounded-md border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      {status}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void markComplete(step.id)}
                        disabled={busy || status === "completed"}
                        className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-semibold"
                      >
                        {busy ? "Working..." : step.actionLabel || "Complete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void skipStep(step.id)}
                        disabled={busy || status === "completed"}
                        className="rounded-md border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                      >
                        Skip
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <ol className="mt-2 list-decimal pl-5 text-sm text-slate-600 dark:text-slate-300">
              {fallbackSteps.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ol>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/settings/integrations" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold">
              Connect GitHub
            </Link>
            <Link href="/sprint/plan" className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-zinc-800">
              Plan Sprint
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

