"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

const DEFAULT_CALLBACK_URI = "asmdesktop://auth-callback";

function normalizeDesktopRedirectUri(value: string): string {
  const normalized = String(value || "").trim();
  if (normalized.toLowerCase().startsWith("asmdesktop://")) return normalized;
  return DEFAULT_CALLBACK_URI;
}

function buildDesktopCallbackUrl(redirectUri: string, token: string): string {
  const callback = new URL(redirectUri);
  callback.searchParams.set("token", token);
  return callback.toString();
}

export default function DesktopSignInPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desktopRedirectUri = useMemo(
    () => normalizeDesktopRedirectUri(String(searchParams?.get("desktop_redirect_uri") || "")),
    [searchParams]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");
    const orgSlug = formData.get("orgSlug");

    try {
      const response = await fetch("/api/auth/desktop/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, orgSlug: orgSlug || undefined }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(String(data?.error || "Failed to sign in"));
        return;
      }

      if (data?.requiresOrgSelection) {
        const orgs: Array<{ slug?: string }> = Array.isArray(data.orgs) ? data.orgs : [];
        const hint = orgs.length ? orgs.map((o) => o.slug).filter(Boolean).join(", ") : "";
        setError(`Multiple organizations found. Enter org slug.${hint ? ` Available: ${hint}` : ""}`);
        return;
      }

      const token = String(data?.accessToken || "").trim();
      if (!token) {
        setError("Missing access token from server.");
        return;
      }

      window.location.href = buildDesktopCallbackUrl(desktopRedirectUri, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setLoading(false);
    }
  }

  const signUpHref = `/desktop-auth/sign-up?desktop_redirect_uri=${encodeURIComponent(desktopRedirectUri)}`;

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-12 text-white">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#111111] p-6 shadow-2xl">
        <h1 className="text-2xl font-semibold">Desktop Sign In</h1>
        <p className="mt-2 text-sm text-zinc-400">Sign in from browser. You will be redirected back to desktop automatically.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-zinc-300">Email</label>
            <input id="email" name="email" type="email" required className="w-full rounded-lg border border-zinc-700 bg-[#0d0d0d] px-3 py-2 outline-none focus:border-zinc-400" />
          </div>

          <div>
            <label htmlFor="orgSlug" className="mb-1 block text-sm text-zinc-300">Organization Slug (optional)</label>
            <input id="orgSlug" name="orgSlug" type="text" className="w-full rounded-lg border border-zinc-700 bg-[#0d0d0d] px-3 py-2 outline-none focus:border-zinc-400" />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-zinc-300">Password</label>
            <input id="password" name="password" type="password" required className="w-full rounded-lg border border-zinc-700 bg-[#0d0d0d] px-3 py-2 outline-none focus:border-zinc-400" />
          </div>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}

          <button type="submit" disabled={loading} className="w-full rounded-lg bg-white px-3 py-2 font-medium text-black disabled:opacity-60">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-5 text-sm text-zinc-400">
          Need an account? <Link href={signUpHref} className="text-white underline">Sign up for desktop</Link>
        </p>
      </div>
    </main>
  );
}
