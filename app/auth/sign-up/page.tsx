"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Github } from "lucide-react";
import { motion } from "framer-motion";

export default function SignUpPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const fullName = formData.get("name");
    const email = formData.get("email");
    const password = formData.get("password");

    try {
      const response = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fullName, email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.requiresOrgSetup) {
          router.push("/settings/org");
        } else {
          router.push("/dashboard");
        }
      } else {
        const err = await response.json().catch(() => null);
        alert(err?.error || "Failed to sign up");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h1 className="text-[32px] font-bold tracking-tight text-white mb-2">Create Account</h1>
      <p className="text-[#a1a1aa] mb-8 text-[15px]">
        Join us and start organizing your sprints effectively
      </p>

      <form className="space-y-5" onSubmit={handleSignUp}>
        <div className="space-y-1.5">
          <label htmlFor="name" className="block text-sm font-medium text-zinc-300">
            Full Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="Enter your name"
            className="w-full rounded-xl border border-zinc-800 bg-[#121212] px-4 py-3 text-[15px] text-white placeholder:text-zinc-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
          />
        </div>

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

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-zinc-300">
            Password
          </label>
          <div className="relative flex items-center">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
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
        </div>

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="mt-6 w-full rounded-xl bg-white py-3 text-[15px] font-semibold text-black shadow-none hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black transition-all disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? "Creating account..." : "Create Account"}
        </motion.button>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-800"></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[#0a0a0a] px-4 text-zinc-500">or continue with</span>
          </div>
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-transparent py-3 text-[15px] font-semibold text-white hover:bg-zinc-900 transition-all focus:outline-none focus:ring-2 focus:ring-zinc-700 focus:ring-offset-2 focus:ring-offset-black"
        >
          <Github className="size-5" />
          Sign in with GitHub
        </motion.button>
      </form>

      <p className="mt-8 text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="font-semibold text-purple-500 hover:text-purple-400 transition-colors">
          Sign In
        </Link>
      </p>
    </div>
  );
}
