export default function SkillGapPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Skill Gap Analyzer</h1>
        <p className="text-slate-600 dark:text-slate-300">
          UI scaffold. Backend endpoints for skill-gap reporting aren’t present in the gateway yet.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-slate-700 dark:text-slate-200">
          Once the backend endpoint exists, this page can display:
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>Missing skills aggregated from failed assignments</li>
            <li>Impact level + suggested hire/train action</li>
            <li>Weekly report generation</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
