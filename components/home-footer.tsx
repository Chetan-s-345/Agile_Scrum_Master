import Link from "next/link";

export function HomeFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white/90 dark:border-zinc-800 dark:bg-black/90">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-8 text-sm text-slate-600 dark:text-slate-400 md:flex-row md:items-center md:justify-between">
        <p>© {new Date().getFullYear()} Agile Scrum Master. All rights reserved.</p>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/features" className="hover:text-slate-900 dark:hover:text-white">Features</Link>
          <Link href="/pricing" className="hover:text-slate-900 dark:hover:text-white">Pricing</Link>
          <Link href="/solution" className="hover:text-slate-900 dark:hover:text-white">Solution</Link>
          <Link href="/about" className="hover:text-slate-900 dark:hover:text-white">About</Link>
        </nav>
      </div>
    </footer>
  );
}
