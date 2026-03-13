"use client";

import { Download, TrendingUp } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function ReportsPage() {
  const velocityHistory = [
    { sprint: 'Sprint 1', velocity: 28, planned: 30 },
    { sprint: 'Sprint 2', velocity: 32, planned: 30 },
    { sprint: 'Sprint 3', velocity: 35, planned: 35 },
    { sprint: 'Sprint 4', velocity: 38, planned: 35 },
  ];

  const completionHistory = [
    { sprint: 'Sprint 1', completed: 85, bugs: 2 },
    { sprint: 'Sprint 2', completed: 92, bugs: 1 },
    { sprint: 'Sprint 3', completed: 95, bugs: 1 },
    { sprint: 'Sprint 4', completed: 98, bugs: 0 },
  ];

  const skillGaps = [
    { skill: 'Kubernetes', frequency: 8, priority: 'high' },
    { skill: 'GraphQL', frequency: 5, priority: 'medium' },
    { skill: 'WebSockets', frequency: 3, priority: 'low' },
  ];

  const reports = [
    { id: 1, name: 'Sprint 4 Report', date: '2024-01-28', type: 'Sprint Summary' },
    { id: 2, name: 'Team Performance Q1', date: '2024-01-15', type: 'Quarterly' },
    { id: 3, name: 'Skill Gap Analysis', date: '2024-01-01', type: 'Analysis' },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Reports</h1>
            <p className="text-slate-600 dark:text-slate-300">Sprint Analytics & Team Performance</p>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2">
            <Download className="w-5 h-5" />
            Export PDF
          </button>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Avg Velocity</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">33.25</p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-2">↑ +10% vs Q3</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Completion Rate</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">92.5%</p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-2">↑ +7.5% trend</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Team Velocity</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">4.2</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">Points/developer</p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm">Critical Bugs</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">0</p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-2">Zero in Q1 ✅</p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Velocity History */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Velocity Trend
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={velocityHistory}>
                <XAxis dataKey="sprint" stroke="#94a3b8" />
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
                <Line type="monotone" dataKey="velocity" stroke="#10b981" strokeWidth={2} />
                <Line type="monotone" dataKey="planned" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Completion History */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Completion & Quality</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={completionHistory}>
                <XAxis dataKey="sprint" stroke="#94a3b8" />
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
                <Bar dataKey="completed" fill="#3b82f6" />
                <Bar dataKey="bugs" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Skill Gaps */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Skill Gap Analysis</h2>
            <div className="space-y-3">
              {skillGaps.map((gap, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-slate-900 dark:text-white">{gap.skill}</p>
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 mt-1">
                      <div 
                        className={`h-2 rounded-full ${
                          gap.priority === 'high' ? 'bg-red-500' :
                          gap.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${(gap.frequency / 8) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                  <span className={`ml-4 px-2 py-1 rounded text-xs font-medium ${
                    gap.priority === 'high' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                    gap.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                    'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  }`}>
                    {gap.frequency}x
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Reports */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 shadow-md border border-slate-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Recent Reports</h2>
            <div className="space-y-2">
              {reports.map((report) => (
                <div key={report.id} className="p-3 bg-slate-50 dark:bg-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-600 transition cursor-pointer border border-slate-200 dark:border-slate-600">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white text-sm">{report.name}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{report.date} • {report.type}</p>
                    </div>
                    <Download className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
