"use client";

import { Users, Check } from 'lucide-react';

export default function SprintPlannerPage() {
  const backlogItems = [
    { id: 1, title: 'Implement Smart Assignment Engine', storyPoints: 13, priority: 'high' },
    { id: 2, title: 'Build Jira Integration Layer', storyPoints: 8, priority: 'high' },
    { id: 3, title: 'Create Dashboard UI Components', storyPoints: 5, priority: 'medium' },
    { id: 4, title: 'Setup PostgreSQL Schema', storyPoints: 5, priority: 'high' },
    { id: 5, title: 'Build Developer Profile APIs', storyPoints: 3, priority: 'medium' },
    { id: 6, title: 'Implement Slack Integration', storyPoints: 3, priority: 'low' },
  ];

  const teamCapacity = [
    { name: 'Alice', available: 40, assigned: 0 },
    { name: 'Bob', available: 40, assigned: 0 },
    { name: 'Charlie', available: 40, assigned: 0 },
    { name: 'Diana', available: 40, assigned: 0 },
  ];

  const getRiskColor = (total: number) => {
    const capacity = 160; // 4 developers * 40 points
    const percentage = (total / capacity) * 100;
    if (percentage < 80) return 'text-green-600 dark:text-green-400';
    if (percentage < 95) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Sprint Planner</h1>
          <p className="text-slate-600 dark:text-slate-300">Plan next sprint from backlog with AI assistance</p>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Backlog Items */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Product Backlog</h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {backlogItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:shadow-md transition cursor-move"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-slate-900 dark:text-white">{item.title}</h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        item.priority === 'high' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                        item.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                        'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                      }`}>
                        {item.priority}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600 dark:text-slate-400">ID: #{item.id}</span>
                      <span className="font-bold text-lg text-blue-600 dark:text-blue-400">{item.storyPoints} pts</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-6 border-t border-slate-200 dark:border-zinc-800">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  💡 Tip: Drag items to the capacity view on the right to plan sprint
                </p>
              </div>
            </div>
          </div>

          {/* Team Capacity */}
          <div className="space-y-6">
            {/* Risk Score Card */}
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Sprint Risk Score</h3>
              <div className={`text-4xl font-bold mb-2 ${getRiskColor(40)}`}>
                4.2
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2 mb-3">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: '55%' }}></div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">Safe capacity remaining</p>
            </div>

            {/* Team Capacity Bars */}
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5" />
                Team Capacity
              </h3>
              <div className="space-y-4">
                {teamCapacity.map((dev) => (
                  <div key={dev.name}>
                    <div className="flex justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{dev.name}</span>
                      <span className="text-sm text-slate-600 dark:text-slate-400">{dev.assigned}/{dev.available}</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                      <div 
                        className="bg-blue-500 h-2 rounded-full transition-all" 
                        style={{ width: `${(dev.assigned / dev.available) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Button */}
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition flex items-center justify-center gap-2">
              <Check className="w-5 h-5" />
              Confirm Sprint Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
