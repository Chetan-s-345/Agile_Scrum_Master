"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSignIn = pathname === '/auth/sign-in';

  return (
    <AnimatePresence mode="wait">
      <motion.div 
        key={pathname}
        className="flex w-full h-[100dvh] bg-[#0a0a0a] text-white overflow-hidden"
      >
        {/* Left Container */}
        <motion.div 
          className="w-full lg:w-2/5 h-full overflow-y-auto scrollbar-hide relative flex flex-col px-6 sm:px-12 xl:px-24"
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="w-full max-w-[440px] mx-auto py-12 my-auto flex-shrink-0 flex flex-col justify-center min-h-[calc(100vh-6rem)]">
            {children}
          </div>
        </motion.div>

        {/* Right Container */}
        <motion.div 
          className="hidden lg:flex lg:w-3/5 h-full relative bg-gradient-to-br from-[#3b82f6] via-[#6366f1] to-[#a855f7] animate-gradient overflow-hidden items-center justify-center p-12"
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Diagonal textured background overlay */}
          <div 
            className="absolute inset-0 opacity-10 pointer-events-none" 
            style={{ 
              backgroundImage: "repeating-linear-gradient(45deg, #000 0, #000 2px, transparent 2px, transparent 12px)", 
            }}
          />

          {/* Floating container for Testimonial */}
          <motion.div
             animate={{ y: [0, -12, 0] }}
             transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
             className="z-10"
          >
            <div className="bg-[#1e1e1e]/90 backdrop-blur-md p-8 rounded-2xl border border-white/10 shadow-2xl max-w-[480px]">
              {isSignIn ? (
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#b82bb8] flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-purple-500/30">
                      SC
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-base">Sarah Chen</h4>
                      <p className="text-sm text-zinc-400">@sarahdigital</p>
                    </div>
                  </div>
                  <p className="text-zinc-300 text-base leading-relaxed">
                    &quot;Amazing platform! The user experience is seamless and the features are exactly what I needed.&quot;
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-blue-500/30">
                      JD
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-base">John Doe</h4>
                      <p className="text-sm text-zinc-400">@johndoe</p>
                    </div>
                  </div>
                  <p className="text-zinc-300 text-base leading-relaxed">
                    &quot;Signing up was the best decision I made this year. Sprint organization is now effortless.&quot;
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}