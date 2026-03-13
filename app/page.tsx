export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-20 text-slate-900">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-cyan-700">
          Automated Agile Sprint Manager
        </p>
        <h1 className="text-4xl font-bold leading-tight">
          Plan, run, and improve every sprint automatically.
        </h1>
        <p className="text-lg leading-8 text-slate-600">
          This app helps Scrum teams streamline backlog refinement, sprint
          planning, daily updates, and retrospectives with smart automation.
        </p>

        <div className="grid gap-4 pt-2 sm:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold">Sprint Planning</h2>
            <p className="mt-2 text-sm text-slate-600">
              Turn backlog items into realistic sprint goals based on team
              capacity.
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold">Daily Tracking</h2>
            <p className="mt-2 text-sm text-slate-600">
              Monitor progress, blockers, and burndown trends in real time.
            </p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-base font-semibold">Retrospectives</h2>
            <p className="mt-2 text-sm text-slate-600">
              Capture insights and automatically generate action items for the
              next sprint.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
