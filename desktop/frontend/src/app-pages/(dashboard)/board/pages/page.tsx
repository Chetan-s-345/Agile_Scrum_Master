"use client";

import { useEffect, useMemo, useState } from "react";

type PageMeta = {
  author?: string;
  updatedAt?: string;
  taskId?: string;
};

type WikiPage = {
  id: string;
  title: string;
  parentId?: string;
  taskId?: string;
  metadata?: PageMeta;
  children?: WikiPage[];
};

type PageFlat = WikiPage & { depth: number };

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (typeof window === "undefined" || !window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge is unavailable");
  }
  return window.desktopApi.invoke<T>(channel, payload);
}

function asString(value: unknown, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function flattenPages(items: WikiPage[], depth = 0): PageFlat[] {
  const rows: PageFlat[] = [];
  items.forEach((item) => {
    rows.push({ ...item, depth });
    if (Array.isArray(item.children) && item.children.length) {
      rows.push(...flattenPages(item.children, depth + 1));
    }
  });
  return rows;
}

export default function PagesTabPage() {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draftTitle, setDraftTitle] = useState("Untitled Page");
  const [contentByPageId, setContentByPageId] = useState<Record<string, string>>({});
  const [metadataByPageId, setMetadataByPageId] = useState<Record<string, PageMeta>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flatPages = useMemo(() => flattenPages(pages), [pages]);

  async function loadPages(nextSelectedId?: string) {
    setLoading(true);
    setError(null);
    try {
      const tree = await invokeDesktop<WikiPage[]>("pages:getList", { boardId: "default-board" });
      setPages(Array.isArray(tree) ? tree : []);

      const nextFlat = flattenPages(Array.isArray(tree) ? tree : []);
      const fallbackSelectedId = nextSelectedId || selectedId;
      const selectedExists = nextFlat.some((page) => page.id === fallbackSelectedId);
      const resolvedId = selectedExists ? fallbackSelectedId : (nextFlat[0]?.id || "");
      setSelectedId(resolvedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pages");
    } finally {
      setLoading(false);
    }
  }

  async function loadPageContent(pageId: string) {
    if (!pageId) return;
    try {
      const response = await invokeDesktop<{ content: string; metadata: PageMeta }>("pages:getContent", { pageId });
      setContentByPageId((prev) => ({ ...prev, [pageId]: asString(response?.content) }));
      setMetadataByPageId((prev) => ({ ...prev, [pageId]: response?.metadata || {} }));
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to load page content");
    }
  }

  async function addPage() {
    try {
      const created = await invokeDesktop<WikiPage>("pages:createPage", {
        title: draftTitle.trim() || "Untitled Page",
        content: "# New Page\n\nWrite here...",
      });
      const createdId = asString(created?.id);
      await loadPages(createdId);
      if (createdId) {
        await loadPageContent(createdId);
      }
      setToast("Page created");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to create page");
    }
  }

  async function updateContent(value: string) {
    if (!selectedId) return;
    setContentByPageId((prev) => ({ ...prev, [selectedId]: value }));
    try {
      await invokeDesktop("pages:updatePage", {
        pageId: selectedId,
        content: value,
      });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to update page");
    }
  }

  async function removePage(id: string) {
    try {
      await invokeDesktop("pages:deletePage", { pageId: id });
      await loadPages(id === selectedId ? "" : selectedId);
      setToast("Page deleted");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to delete page");
    }
  }

  const selected = flatPages.find((p) => p.id === selectedId) || null;
  const selectedContent = selectedId ? (contentByPageId[selectedId] || "") : "";
  const selectedMetadata = selectedId ? (metadataByPageId[selectedId] || {}) : {};

  useEffect(() => {
    void loadPages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (Object.prototype.hasOwnProperty.call(contentByPageId, selectedId)) return;
    void loadPageContent(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px,1fr]">
      <aside className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
        <div className="mb-2 flex gap-2">
          <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="w-full rounded border border-[var(--border)] bg-[#111] px-2 py-1 text-sm" />
          <button onClick={() => void addPage()} className="rounded border border-[var(--border)] px-2 py-1 text-sm hover:bg-[var(--bg-card)]">New</button>
        </div>
        {loading ? <p className="mb-2 text-xs text-[#8f8f8f]">Loading...</p> : null}
        {error ? <p className="mb-2 text-xs text-[#ffc4c4]">{error}</p> : null}
        <div className="space-y-1">
          {flatPages.map((page) => (
            <div key={page.id} className="flex items-center gap-1">
              <button onClick={() => setSelectedId(page.id)} className={`flex-1 rounded px-2 py-1 text-left text-sm ${selectedId === page.id ? "bg-white text-black" : "hover:bg-[var(--bg-card)]"}`} style={{ paddingLeft: `${page.depth * 12 + 8}px` }}>
                <span className="inline-flex items-center gap-2">
                  <span>{page.title}</span>
                  {asString(page.taskId || page.metadata?.taskId) ? <span className="rounded border border-[var(--border)] px-1 py-0 text-[10px]">Task</span> : null}
                </span>
              </button>
              <button onClick={() => void removePage(page.id)} className="rounded border border-[var(--border)] px-2 py-1 text-xs">X</button>
            </div>
          ))}
        </div>
      </aside>
      <section className="rounded-md border border-[var(--border)] bg-[#141414] p-3">
        {selected ? (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8f8f8f]">
              <span>{selectedMetadata.author || "Unknown"}</span>
              <span>{selectedMetadata.updatedAt || ""}</span>
            </div>
            <textarea value={selectedContent} onChange={(e) => void updateContent(e.target.value)} className="h-[520px] w-full rounded border border-[var(--border)] bg-[#111] p-3 text-sm" />
          </>
        ) : (
          <p className="text-sm text-[#8f8f8f]">Create a page to start writing docs.</p>
        )}
      </section>

      {toast ? <div className="fixed bottom-4 right-4 z-20 rounded-md border border-[var(--border)] bg-[#151515] px-3 py-2 text-xs text-white">{toast}</div> : null}
    </div>
  );
}

