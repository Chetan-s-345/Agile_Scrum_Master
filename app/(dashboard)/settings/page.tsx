"use client";

import { Settings, Save, AlertCircle } from 'lucide-react';
import { useState } from 'react';

export default function SettingsPage() {
  const [jiraUrl, setJiraUrl] = useState('https://yourcompany.atlassian.net');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
            <Settings className="w-8 h-8" />
            Settings
          </h1>
          <p className="text-slate-600 dark:text-slate-300">Configure project connections and preferences</p>
        </div>

        {/* Jira Configuration */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 flex items-center justify-center text-sm font-bold">1</span>
            Jira Configuration
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Jira Instance URL</label>
              <input
                type="url"
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={jiraUrl}
                onChange={(e) => setJiraUrl(e.target.value)}
                placeholder="https://yourcompany.atlassian.net"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Email</label>
              <input
                type="email"
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">API Token</label>
              <input
                type="password"
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
                placeholder="••••••••••••••••"
              />
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                📌 <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">Generate token</a> from Jira Account Settings
              </p>
            </div>

            <button className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2">
              <Save className="w-4 h-4" />
              Test Connection
            </button>
          </div>
        </div>

        {/* GitHub Integration */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 flex items-center justify-center text-sm font-bold">2</span>
            GitHub Integration
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Repository</label>
              <input
                type="text"
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="org/repo-name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">GitHub Token</label>
              <input
                type="password"
                className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••••••••••"
              />
            </div>

            <button className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2">
              <Save className="w-4 h-4" />
              Configure Webhook
            </button>
          </div>
        </div>

        {/* Slack Configuration */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-pink-100 dark:bg-pink-900 text-pink-800 dark:text-pink-200 flex items-center justify-center text-sm font-bold">3</span>
            Slack Integration
          </h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Bot Token</label>
            <input
              type="password"
              className="w-full px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="xoxb-••••••••••••••••"
            />
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
              💬 Create Slack App at <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">api.slack.com</a>
            </p>
          </div>
        </div>

        {/* Merit Score Configuration */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 flex items-center justify-center text-sm font-bold">4</span>
            Merit Score Weights
          </h2>

          <div className="space-y-4">
            {[
              { label: 'Tech Stack Match', weight: 25 },
              { label: 'Completion Rate', weight: 25 },
              { label: 'Code Quality', weight: 20 },
              { label: 'PR Review Speed', weight: 15 },
              { label: 'Peer Rating', weight: 15 }
            ].map((item, idx) => (
              <div key={idx}>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{item.label}</label>
                  <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{item.weight}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  defaultValue={item.weight}
                  className="w-full"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              ℹ️ Total weights must equal 100% to save configuration
            </p>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-6">
          <h2 className="text-2xl font-bold text-red-900 dark:text-red-200 mb-4 flex items-center gap-2">
            <AlertCircle className="w-6 h-6" />
            Danger Zone
          </h2>
          <p className="text-sm text-red-800 dark:text-red-300 mb-4">
            Warning: These actions can not be undone. Proceed with caution.
          </p>
          <button className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition">
            Clear All Cache
          </button>
        </div>
      </div>
    </div>
  );
}
