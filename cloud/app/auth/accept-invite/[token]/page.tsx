"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleAccept = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) {
      alert("Missing invite token");
      return;
    }

    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const fullName = formData.get("fullName");
    const password = formData.get("password");

    try {
      const resp = await fetch(`/api/invitations/accept/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, password }),
      });

      if (resp.ok) {
        const data = await resp.json();
        localStorage.setItem("user", JSON.stringify(data.user));
        router.push("/dashboard");
      } else {
        const data = await resp.json().catch(() => null);
        alert(data?.error || "Failed to accept invitation");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to accept invitation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h1 className="text-[32px] font-bold tracking-tight text-white mb-2">Accept invitation</h1>
      <p className="text-[#a1a1aa] mb-8 text-[15px]">
        If you don’t have an account yet, create one to join.
      </p>

      <form className="space-y-5" onSubmit={handleAccept}>
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="block text-sm font-medium text-zinc-300">
            Full Name (new users)
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            placeholder="Enter your name"
            className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
            Password (new users)
          </label>
          <div className="relative flex items-center">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Create a password"
              className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] pr-10 text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
          <p className="text-xs text-zinc-500">If you already have an account, you can leave these blank.</p>
        </div>

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="mt-6 w-full rounded-xl bg-white py-3 text-[15px] font-semibold text-black shadow-none hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black transition-all disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? "Accepting..." : "Accept invitation"}
        </motion.button>
      </form>

      <p className="mt-8 text-center text-sm text-zinc-400">
        <Link href="/auth/sign-in" className="font-semibold text-purple-500 hover:text-purple-400 transition-colors">
          Back to Sign In
        </Link>
      </p>
    </div>
  );
}
