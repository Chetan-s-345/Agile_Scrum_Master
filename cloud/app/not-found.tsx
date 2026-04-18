import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-app)] px-6 py-16 text-white">
      <div className="mx-auto max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-8">
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-[#b0b0b0]">
          The route you requested does not exist.
        </p>
        <Link
          href="/board"
          className="mt-6 inline-flex rounded-md border border-white bg-white px-4 py-2 text-sm font-semibold text-black"
        >
          Go to board
        </Link>
      </div>
    </main>
  );
}
