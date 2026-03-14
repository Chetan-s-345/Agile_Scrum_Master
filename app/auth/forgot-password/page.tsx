"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setSent(false);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email");

    try {
      const resp = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (resp.ok) {
        setSent(true);
      } else {
        alert("Failed to request password reset");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to request password reset");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h1 className="text-[32px] font-bold tracking-tight text-white mb-2">Reset password</h1>
      <p className="text-[#a1a1aa] mb-8 text-[15px]">We’ll email you a reset link if the account exists.</p>

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-zinc-300">
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="Enter your email address"
            className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
          />
        </div>

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="mt-6 w-full rounded-xl bg-white py-3 text-[15px] font-semibold text-black shadow-none hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black transition-all disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? "Sending..." : "Send reset link"}
        </motion.button>

        {sent ? (
          <p className="text-sm text-zinc-300">
            If that email exists, you’ll receive a reset link shortly.
          </p>
        ) : null}
      </form>

      <p className="mt-8 text-center text-sm text-zinc-400">
        Remembered your password?{" "}
        <Link href="/auth/sign-in" className="font-semibold text-purple-500 hover:text-purple-400 transition-colors">
          Sign In
        </Link>
      </p>
    </div>
  );
}
