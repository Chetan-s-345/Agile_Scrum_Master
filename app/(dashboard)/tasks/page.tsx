"use client";

import { Plus, Filter } from 'lucide-react';

export default function TaskBoardPage() {
  const tasks = {
    todo: [
      { id: 1, title: 'Setup Docker Compose', storyPoints: 5, assignee: 'Alice', priority: 'high' },
      { id: 2, title: 'Create PostgreSQL Schema', storyPoints: 5, assignee: '', priority: 'high' },
    ],
    inProgress: [
      { id: 3, title: 'Build API Gateway', storyPoints: 8, assignee: 'Bob', priority: 'high' },
      { id: 4, title: 'Implement Auth Routes', storyPoints: 3, assignee: 'Charlie', priority: 'medium' },
    ],
    inReview: [
      { id: 5, title: 'Create Dashboard UI', storyPoints: 5, assignee: 'Diana', priority: 'medium' },
    ],
    done: [
      { id: 6, title: 'Project Setup', storyPoints: 3, assignee: 'Alice', priority: 'low' },
      { id: 7, title: 'Environment Config', storyPoints: 2, assignee: 'Bob', priority: 'low' },
    ]
  };

  const columns = [
    { key: 'todo', title: 'To Do', color: 'bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800' },
    { key: 'inProgress', title: 'In Progress', color: 'bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30' },
    { key: 'inReview', title: 'In Review', color: 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-yellow-900/30' },
    { key: 'done', title: 'Done', color: 'bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/30' },
  ];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200';
      case 'medium':
        return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
      default:
        return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
    }
  };

  const TaskCard = ({ task }: { task: { id: number; title: string; storyPoints: number; assignee: string; priority: string } }) => (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-sm border border-slate-200 dark:border-zinc-800 mb-3 hover:shadow-md transition cursor-pointer">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-medium text-slate-900 dark:text-white text-sm flex-1">{task.title}</h4>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ml-2 ${getPriorityColor(task.priority)}`}>
          {task.priority}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 dark:text-slate-400">#{task.id}</span>
        <span className="font-bold text-blue-600 dark:text-blue-400">{task.storyPoints}pt</span>
      </div>
      {task.assignee && (
        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-zinc-800">
          <p className="text-xs text-slate-600 dark:text-slate-400">👤 {task.assignee}</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Task Board</h1>
            <p className="text-slate-600 dark:text-slate-300">Sprint Planning & Task Tracking</p>
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition flex items-center gap-2">
            <Plus className="w-5 h-5" />
            New Task
          </button>
        </div>

        {/* Filter Bar */}
        <div className="mb-6 flex gap-2">
          <button className="bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>

        {/* Kanban Board */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {columns.map((column) => (
            <div key={column.key} className={`${column.color} rounded-lg p-4 min-h-96`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-slate-900 dark:text-white">{column.title}</h2>
                <span className="bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-white text-xs font-bold px-2 py-1 rounded">
                  {tasks[column.key as keyof typeof tasks].length}
                </span>
              </div>
              <div>
                {tasks[column.key as keyof typeof tasks].map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
              <button className="w-full mt-4 py-2 border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-white hover:dark:bg-slate-700 transition text-sm font-medium">
                + Add Task
              </button>
            </div>
          ))}
        </div>

        {/* Sprint Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Total Tasks</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {Object.values(tasks).flat().length}
            </p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">In Progress</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {tasks.inProgress.length}
            </p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Completed</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
              {tasks.done.length}
            </p>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 border border-slate-200 dark:border-zinc-800">
            <p className="text-slate-600 dark:text-slate-400 text-sm font-medium">Completion</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {Math.round((tasks.done.length / Object.values(tasks).flat().length) * 100)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
