"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertCircle, TrendingUp, Users, CheckCircle, Clock } from 'lucide-react';
import { getMe } from "@/lib/org-member-auth";

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await getMe();
      if (cancelled) return;
      const hasOrg = Boolean(Array.isArray(me?.memberships) && me!.memberships!.length);
      if (me?.user && !hasOrg) {
        router.replace('/settings/org');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Mock data
  const sprintData = [
    { week: 'W1', velocity: 24, required: 30 },
    { week: 'W2', velocity: 28, required: 30 },
    { week: 'W3', velocity: 35, required: 30 },
    { week: 'W4', velocity: 32, required: 30 },
  ];

  const burndownData = [
    { day: 'Day 1', remaining: 100 },
    { day: 'Day 2', remaining: 85 },
    { day: 'Day 3', remaining: 70 },
    { day: 'Day 4', remaining: 65 },
    { day: 'Day 5', remaining: 50 },
    { day: 'Day 6', remaining: 40 },
    { day: 'Day 7', remaining: 20 },
    { day: 'Day 8', remaining: 0 },
  ];

  const teamCapacity = [
    { name: 'Alice', capacity: 90, used: 72 },
    { name: 'Bob', capacity: 85, used: 75 },
    { name: 'Charlie', capacity: 80, used: 60 },
    { name: 'Diana', capacity: 90, used: 85 },
  ];

  const statsCards = [
    {
      title: 'Sprint Progress',
      value: '75%',
      icon: TrendingUp,
      color: 'bg-blue-500'
    },
    {
      title: 'Completed Tasks',
      value: '32',
      icon: CheckCircle,
      color: 'bg-green-500'
    },
    {
      title: 'Team Capacity',
      value: '78%',
      icon: Users,
      color: 'bg-purple-500'
    },
    {
      title: 'Avg Task Time',
      value: '4.2d',
      icon: Clock,
      color: 'bg-orange-500'
    }
  ];

  const marketingCards = [
    {
      title: "Features",
      description: "Explore agile capabilities and automation tools.",
      href: "/dashboard/features",
    },
    {
      title: "Pricing",
      description: "Compare plans for teams of every size.",
      href: "/dashboard/pricing",
    },
    {
      title: "Solution",
      description: "See how the platform fits your workflow.",
      href: "/dashboard/solution",
    },
    {
      title: "About",
      description: "Learn our mission, story, and values.",
      href: "/dashboard/about",
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Dashboard</h1>
          <p className="text-slate-600 dark:text-slate-400">Active Sprint Overview & Team Metrics</p>
        </div>

        {/* Learn More */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {marketingCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm transition hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {card.title}
                </h3>
                <span className="text-sm text-blue-600 dark:text-blue-400 group-hover:underline">
                  Open
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {card.description}
              </p>
            </Link>
          ))}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statsCards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <div key={idx} className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800 hover:shadow-lg transition">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-slate-600 dark:text-slate-300 font-medium">{card.title}</h3>
                  <div className={`${card.color} p-2 rounded-lg`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-slate-900 dark:text-white">{card.value}</p>
              </div>
            );
          })}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Velocity Trend */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Velocity Trend</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={sprintData}>
                <XAxis dataKey="week" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line type="monotone" dataKey="velocity" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="required" stroke="#f97316" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Burndown Chart */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Sprint Burndown</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={burndownData}>
                <XAxis dataKey="day" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line type="monotone" dataKey="remaining" stroke="#ef4444" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Team Capacity & Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Team Capacity Bar */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Team Capacity Utilization</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={teamCapacity}>
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #475569',
                    borderRadius: '8px'
                  }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Bar dataKey="capacity" fill="#cbd5e1" />
                <Bar dataKey="used" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Active Alerts */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Active Alerts
            </h2>
            <div className="space-y-3">
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-3">
                <p className="font-medium text-red-900 dark:text-red-200 text-sm">Critical: Sprint at Risk</p>
                <p className="text-xs text-red-700 dark:text-red-300">Velocity trending below required</p>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded p-3">
                <p className="font-medium text-yellow-900 dark:text-yellow-200 text-sm">Warning: Developer Overload</p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300">Diana at 95% capacity</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3">
                <p className="font-medium text-blue-900 dark:text-blue-200 text-sm">Info: Sprint Ends Soon</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">2 days remaining in sprint</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
