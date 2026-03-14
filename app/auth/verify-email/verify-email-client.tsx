"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function VerifyEmailClient({ token }: { token: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");

  useEffect(() => {
    const run = async () => {
      if (!token) return;
      setStatus("verifying");
      try {
        const resp = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (resp.ok) {
          setStatus("success");
          setTimeout(() => router.push("/auth/sign-in"), 1200);
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    };

    run();
  }, [token, router]);

  return (
    <div className="w-full">
      <h1 className="text-[32px] font-bold tracking-tight text-white mb-2">Verify email</h1>
      <p className="text-[#a1a1aa] mb-8 text-[15px]">Confirming your email address…</p>

      {!token ? <p className="text-sm text-zinc-300">Missing verification token.</p> : null}
      {status === "verifying" ? <p className="text-sm text-zinc-300">Verifying…</p> : null}
      {status === "success" ? <p className="text-sm text-zinc-300">Email verified. Redirecting to sign in…</p> : null}
      {status === "error" ? <p className="text-sm text-zinc-300">Verification failed or expired.</p> : null}

      <p className="mt-8 text-center text-sm text-zinc-400">
        <Link href="/auth/sign-in" className="font-semibold text-purple-500 hover:text-purple-400 transition-colors">
          Go to Sign In
        </Link>
      </p>
    </div>
  );
}
