import { BoardTabs } from "@/components/board-tabs";

export default function BoardTabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="space-y-4 p-4 sm:p-5">
      <div className="text-sm text-[#a6a6a6]">Spaces</div>
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <header className="mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
          <span className="h-6 w-6 rounded-sm bg-[#57a7ff]" />
          <h1 className="text-[34px] font-semibold leading-9">My Software Team</h1>
        </header>
        <BoardTabs />
        {children}
      </section>
    </main>
  );
}
