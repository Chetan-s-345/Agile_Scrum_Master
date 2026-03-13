"use client";

import { TrendingUp, AlertTriangle } from 'lucide-react';

export default function DevelopersPage() {
  const developers = [
    { id: 1, name: 'Alice Johnson', role: 'Senior Engineer', merit: 92, skills: ['React', 'Node.js', 'Python'], capacity: 72, burnout: false },
    { id: 2, name: 'Bob Smith', role: 'Full Stack', merit: 88, skills: ['React', 'Express', 'PostgreSQL'], capacity: 75, burnout: false },
    { id: 3, name: 'Charlie Davis', role: 'Backend Lead', merit: 95, skills: ['Node.js', 'PostgreSQL', 'FastAPI'], capacity: 60, burnout: false },
    { id: 4, name: 'Diana Wilson', role: 'Frontend Specialist', merit: 85, skills: ['React', 'Tailwind', 'TypeScript'], capacity: 95, burnout: true },
    { id: 5, name: 'Eve Martinez', role: 'DevOps Engineer', merit: 90, skills: ['Docker', 'Kubernetes', 'AWS'], capacity: 50, burnout: false },
  ];

  const getMeritColor = (merit: number) => {
    if (merit >= 90) return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
    if (merit >= 80) return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
    return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
  };

  const getCapacityColor = (capacity: number) => {
    if (capacity < 75) return 'text-green-600 dark:text-green-400';
    if (capacity < 90) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Developer Hub</h1>
          <p className="text-slate-600 dark:text-slate-300">Team Performance & Merit Leaderboard</p>
        </div>

        {/* Leaderboard Table */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-slate-700">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Rank</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Developer</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Skills</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Merit Score</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Capacity</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Status</th>
                </tr>
              </thead>
              <tbody>
                {developers.map((dev, idx) => (
                  <tr key={dev.id} className="border-b border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-bold text-sm">
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{dev.name}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{dev.role}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {dev.skills.map((skill) => (
                          <span key={skill} className="px-2 py-1 bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs rounded">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`inline-block px-3 py-1 rounded-full font-bold text-sm ${getMeritColor(dev.merit)}`}>
                        {dev.merit}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="w-32 bg-slate-200 dark:bg-slate-600 rounded-full h-2 mb-1">
                          <div 
                            className="bg-blue-500 h-2 rounded-full" 
                            style={{ width: `${dev.capacity}%` }}
                          ></div>
                        </div>
                        <span className={`text-xs font-semibold ${getCapacityColor(dev.capacity)}`}>
                          {dev.capacity}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {dev.burnout ? (
                        <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-xs font-medium">Burnout Risk</span>
                        </div>
                      ) : (
                        <span className="inline-block px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-xs rounded font-medium">
                          Healthy
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Developer Cards */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Team Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {developers.map((dev) => (
              <div key={dev.id} className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800 hover:shadow-lg transition">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm">{dev.name.split(' ')[0]}</h3>
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Merit Score</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{dev.merit}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Load</p>
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full ${dev.burnout ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${dev.capacity}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
