"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Github } from "lucide-react";
import { motion } from "framer-motion";

export default function SignInPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("user", JSON.stringify(data.user));
        router.push("/dashboard");
      } else {
        alert("Failed to sign in");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <h1 className="text-[32px] font-bold tracking-tight text-white mb-2">Welcome</h1>
      <p className="text-[#a1a1aa] mb-8 text-[15px]">
        Access your account and continue your journey with us
      </p>

      <form className="space-y-5" onSubmit={handleSignIn}>
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
          <div className="relative flex items-center group">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              placeholder="Enter your password"
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

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <input
              id="remember-me"
              name="remember-me"
              type="checkbox"
              className="size-4 rounded-full border-zinc-700 bg-transparent text-purple-500 focus:ring-purple-500 focus:ring-offset-0 appearance-none default:ring-0 checked:bg-white transition-all cursor-pointer"
              style={{ border: '1.5px solid #52525b' }}
            />
            <label htmlFor="remember-me" className="text-sm font-medium text-white cursor-pointer select-none">
              Keep me signed in
            </label>
          </div>
          <Link href="#" className="text-sm font-medium text-purple-500 hover:text-purple-400 transition-colors">
            Reset password
          </Link>
        </div>

        <motion.button
          type="submit"
          disabled={loading}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          className="mt-6 w-full rounded-xl bg-white py-3 text-[15px] font-semibold text-black shadow-none hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black transition-all disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? "Signing in..." : "Sign In"}
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
        New to our platform?{" "}
        <Link href="/auth/sign-up" className="font-semibold text-purple-500 hover:text-purple-400 transition-colors">
          Create Account
        </Link>
      </p>
    </div>
  );
}
