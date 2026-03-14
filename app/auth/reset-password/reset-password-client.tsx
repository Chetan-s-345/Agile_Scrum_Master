"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

export default function ResetPasswordClient({ token }: { token: string | null }) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) {
      alert("Missing reset token");
      return;
    }

    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const newPassword = formData.get("newPassword");

    try {
      const resp = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (resp.ok) {
        alert("Password updated. Please sign in.");
        router.push("/auth/sign-in");
      } else {
        const data = await resp.json().catch(() => null);
        alert(data?.error || "Failed to reset password");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h1 className="text-[32px] font-bold tracking-tight text-white mb-2">Set a new password</h1>
      <p className="text-[#a1a1aa] mb-8 text-[15px]">Choose a strong password (min 8 characters).</p>

      {!token ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">Missing or invalid reset token.</p>
          <Link
            href="/auth/forgot-password"
            className="font-semibold text-purple-500 hover:text-purple-400 transition-colors"
          >
            Request a new reset link
          </Link>
        </div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label htmlFor="newPassword" className="block text-sm font-medium text-zinc-300">
              New Password
            </label>
            <div className="relative flex items-center">
              <input
                id="newPassword"
                name="newPassword"
                type={showPassword ? "text" : "password"}
                required
                placeholder="Enter a new password"
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
          </div>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="mt-6 w-full rounded-xl bg-white py-3 text-[15px] font-semibold text-black shadow-none hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black transition-all disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? "Updating..." : "Update password"}
          </motion.button>
        </form>
      )}

      <p className="mt-8 text-center text-sm text-zinc-400">
        <Link href="/auth/sign-in" className="font-semibold text-purple-500 hover:text-purple-400 transition-colors">
          Back to Sign In
        </Link>
      </p>
    </div>
  );
}
