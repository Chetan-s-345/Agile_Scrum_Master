"use client";

import { Navbar } from "@/components/navbar";
import { Sidebar } from "@/components/sidebar";
import { useUIStore } from "@/lib/ui-store";
import AgentBubble from "@/components/AgentBubble";
import { useState } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const closeSidebar = useUIStore((state) => state.closeSidebar);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--bg-primary)] font-mono text-[var(--text-primary)]">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeSidebar}
        />
      ) : null}

      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((prev) => !prev)} />
      <div className={`min-h-screen transition-[margin] duration-200 ${collapsed ? "md:ml-[82px]" : "md:ml-[260px]"}`}>
        <Navbar />
        <div className="jira-page-content min-h-[calc(100vh-7rem)] w-full bg-[var(--bg-primary)]">
          {children}
        </div>
      </div>
      <AgentBubble />
    </div>
  );
}
