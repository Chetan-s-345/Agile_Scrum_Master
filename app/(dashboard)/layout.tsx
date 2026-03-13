"use client";

import { Navbar } from "@/components/navbar";
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-white dark:bg-black">
      <Sidebar />
      <div className="flex-1 lg:ml-64 w-full">
        <Navbar />
        <div className="w-full bg-white dark:bg-black min-h-[calc(100vh-3.5rem)]">
          {children}
        </div>
      </div>
    </div>
  );
}