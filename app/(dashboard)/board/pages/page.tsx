"use client";

import { useEffect, useState } from "react";

type WikiPage = { id: string; title: string; content: string };
const LS_KEY = "sprint.board.pages.v1";

export default function PagesTabPage() {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draftTitle, setDraftTitle] = useState("Untitled Page");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      const parsed = raw ? (JSON.parse(raw) as WikiPage[]) : [];
      if (Array.isArray(parsed) && parsed.length) {
        setPages(parsed);
        setSelectedId(parsed[0].id);
      }
    } catch {
      setPages([]);
    }
  }, []);

  function persist(next: WikiPage[]) {
    setPages(next);
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  function addPage() {
    const item: WikiPage = { id: crypto.randomUUID(), title: draftTitle.trim() || "Untitled Page", content: "# New Page\n\nWrite here..." };
    const next = [item, ...pages];
    persist(next);
    setSelectedId(item.id);
  }

  function updateContent(value: string) {
    const next = pages.map((p) => (p.id === selectedId ? { ...p, content: value } : p));
    persist(next);
  }

  function removePage(id: string) {
    const next = pages.filter((p) => p.id !== id);
    persist(next);
    if (selectedId === id) setSelectedId(next[0]?.id || "");
  }

  const selected = pages.find((p) => p.id === selectedId) || null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px,1fr]">
      <aside className="rounded-md border border-[#2a2a2a] bg-[#141414] p-3">
        <p className="mb-2 text-xs text-[#8f8f8f]">[SKIP - no endpoint] using local storage</p>
        <div className="mb-2 flex gap-2">
          <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="w-full rounded border border-[#2a2a2a] bg-[#111] px-2 py-1 text-sm" />
          <button onClick={addPage} className="rounded border border-[#2a2a2a] px-2 py-1 text-sm hover:bg-[#1a1a1a]">New</button>
        </div>
        <div className="space-y-1">
          {pages.map((page) => (
            <div key={page.id} className="flex items-center gap-1">
              <button onClick={() => setSelectedId(page.id)} className={`flex-1 rounded px-2 py-1 text-left text-sm ${selectedId === page.id ? "bg-white text-black" : "hover:bg-[#1a1a1a]"}`}>
                {page.title}
              </button>
              <button onClick={() => removePage(page.id)} className="rounded border border-[#2a2a2a] px-2 py-1 text-xs">X</button>
            </div>
          ))}
        </div>
      </aside>
      <section className="rounded-md border border-[#2a2a2a] bg-[#141414] p-3">
        {selected ? (
          <textarea value={selected.content} onChange={(e) => updateContent(e.target.value)} className="h-[520px] w-full rounded border border-[#2a2a2a] bg-[#111] p-3 text-sm" />
        ) : (
          <p className="text-sm text-[#8f8f8f]">Create a page to start writing docs.</p>
        )}
      </section>
    </div>
  );
}
