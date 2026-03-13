"use client";

import { Check } from 'lucide-react';
import { useState } from 'react';

export default function AssignmentEnginePage() {
  const [taskDescription, setTaskDescription] = useState('');

  const matchedDevelopers = [
    { rank: 1, name: 'Charlie Davis', merit: 95, techMatch: 95, load: 60, available: true },
    { rank: 2, name: 'Alice Johnson', merit: 92, techMatch: 85, load: 72, available: true },
    { rank: 3, name: 'Bob Smith', merit: 88, techMatch: 80, load: 75, available: true },
  ];

  const getTechTags = () => {
    if (!taskDescription) return [];
    return ['Node.js', 'PostgreSQL', 'FastAPI'].filter(t => 
      taskDescription.toLowerCase().includes(t.toLowerCase())
    );
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Assignment Engine</h1>
          <p className="text-slate-600 dark:text-slate-300">Smart task-to-developer matching</p>
        </div>

        {/* Task Input */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-8">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Task Description</h2>
          
          <textarea
            className="w-full p-4 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={5}
            placeholder="Describe the task... (e.g., 'Build API endpoints using Node.js and PostgreSQL')"
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
          />

          {/* Tech Tags */}
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Detected Tech Stack</p>
            <div className="flex flex-wrap gap-2">
              {getTechTags().length > 0 ? (
                getTechTags().map(tag => (
                  <span key={tag} className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-500 dark:text-slate-400">No tech stack detected yet</span>
              )}
            </div>
          </div>

          {/* Story Points */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Story Points</label>
            <select className="get-none p-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white">
              <option>1</option>
              <option>2</option>
              <option>3</option>
              <option>5</option>
              <option>8</option>
              <option>13</option>
            </select>
          </div>
        </div>

        {/* Matched Developers */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Matched Developers</h2>

          <div className="space-y-4">
            {matchedDevelopers.map((dev) => (
              <div key={dev.rank} className="border border-slate-200 dark:border-zinc-800 rounded-lg p-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-bold">
                      #{dev.rank}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-white">{dev.name}</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Recommended Match</p>
                    </div>
                  </div>
                  <button className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Assign
                  </button>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-200 dark:border-zinc-800">
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Merit Score</p>
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-bold text-slate-900 dark:text-white">{dev.merit}</span>
                      <span className="text-xs text-green-600 dark:text-green-400">+5%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Tech Match</p>
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full" style={{ width: `${dev.techMatch}%` }}></div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{dev.techMatch}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">Current Load</p>
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${dev.load}%` }}></div>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{dev.load}%</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* No Match Fallback */}
          <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              💡 No developers available? AI can suggest scheduling this task for next sprint or splitting it across multiple developers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
