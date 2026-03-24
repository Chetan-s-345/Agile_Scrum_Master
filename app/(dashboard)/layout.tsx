"use client";

import { Navbar } from "@/components/navbar";
import { Sidebar } from "@/components/sidebar";
import { useState } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#0d0d0d] font-mono text-white">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((prev) => !prev)} />
      <div className={`w-full transition-all duration-200 ${collapsed ? "lg:pl-[82px]" : "lg:pl-[260px]"}`}>
        <Navbar />
        <div className="jira-page-content min-h-[calc(100vh-7rem)] w-full bg-[#0d0d0d]">
          {children}
        </div>
      </div>
    </div>
  );
}