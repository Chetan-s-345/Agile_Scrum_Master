const CHANNELS = require("./channels");

let pages = [
  {
    id: "page-1",
    boardId: "default-board",
    title: "Sprint 42 Notes",
    parentId: "",
    taskId: "board-1",
    metadata: {
      author: "Ava Patel",
      updatedAt: new Date().toISOString(),
      taskId: "board-1",
    },
    content: "# Sprint 42 Notes\n\n- Goals\n- Risks\n- Follow ups",
  },
  {
    id: "page-2",
    boardId: "default-board",
    title: "Deployment Checklist",
    parentId: "",
    taskId: "",
    metadata: {
      author: "Noah Kim",
      updatedAt: new Date().toISOString(),
      taskId: "",
    },
    content: "# Deployment Checklist\n\n1. Build artifacts\n2. Verify migrations\n3. Smoke tests",
  },
  {
    id: "page-3",
    boardId: "default-board",
    title: "Rollback Steps",
    parentId: "page-2",
    taskId: "board-2",
    metadata: {
      author: "Noah Kim",
      updatedAt: new Date().toISOString(),
      taskId: "board-2",
    },
    content: "# Rollback Steps\n\nUse previous release and clear stale cache.",
  },
];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function clonePage(page) {
  return {
    id: asString(page.id),
    title: asString(page.title, "Untitled Page"),
    parentId: asString(page.parentId),
    boardId: asString(page.boardId, "default-board"),
    taskId: asString(page.taskId),
    metadata: {
      author: asString(page.metadata?.author, "Unknown"),
      updatedAt: asString(page.metadata?.updatedAt, new Date().toISOString()),
      taskId: asString(page.metadata?.taskId || page.taskId),
    },
  };
}

function findPageIndex(pageId) {
  return pages.findIndex((page) => asString(page.id) === asString(pageId));
}

function buildTree(items, parentId = "") {
  return items
    .filter((item) => asString(item.parentId) === asString(parentId))
    .map((item) => ({
      ...clonePage(item),
      children: buildTree(items, item.id),
    }));
}

function registerPagesIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.PAGES.GET_LIST, async (_event, payload) => {
    const boardId = asString(payload?.boardId, "default-board");
    const scoped = pages.filter((page) => asString(page.boardId, "default-board") === boardId);
    return buildTree(scoped, "");
  });

  ipcMain.handle(CHANNELS.PAGES.GET_CONTENT, async (_event, payload) => {
    const pageId = asString(payload?.pageId);
    if (!pageId) throw new Error("pageId is required");

    const page = pages.find((entry) => asString(entry.id) === pageId);
    if (!page) throw new Error("Page not found");

    return {
      content: asString(page.content),
      metadata: {
        author: asString(page.metadata?.author, "Unknown"),
        updatedAt: asString(page.metadata?.updatedAt, new Date().toISOString()),
        taskId: asString(page.metadata?.taskId || page.taskId),
      },
    };
  });

  ipcMain.handle(CHANNELS.PAGES.CREATE_PAGE, async (_event, payload) => {
    const title = asString(payload?.title, "Untitled Page");
    const content = asString(payload?.content, "# New Page\n\nWrite here...");
    const parentId = asString(payload?.parentId);

    const item = {
      id: `page-${Date.now()}`,
      boardId: "default-board",
      title,
      parentId,
      taskId: "",
      metadata: {
        author: "Scrum Master",
        updatedAt: new Date().toISOString(),
        taskId: "",
      },
      content,
    };

    pages.unshift(item);
    return clonePage(item);
  });

  ipcMain.handle(CHANNELS.PAGES.UPDATE_PAGE, async (_event, payload) => {
    const pageId = asString(payload?.pageId);
    const content = asString(payload?.content);

    if (!pageId) throw new Error("pageId is required");

    const index = findPageIndex(pageId);
    if (index < 0) throw new Error("Page not found");

    pages[index] = {
      ...pages[index],
      content,
      metadata: {
        ...pages[index].metadata,
        updatedAt: new Date().toISOString(),
      },
    };

    return clonePage(pages[index]);
  });

  ipcMain.handle(CHANNELS.PAGES.DELETE_PAGE, async (_event, payload) => {
    const pageId = asString(payload?.pageId);
    if (!pageId) throw new Error("pageId is required");

    const idsToDelete = new Set([pageId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const page of pages) {
        if (idsToDelete.has(asString(page.parentId)) && !idsToDelete.has(asString(page.id))) {
          idsToDelete.add(asString(page.id));
          changed = true;
        }
      }
    }

    const before = pages.length;
    pages = pages.filter((page) => !idsToDelete.has(asString(page.id)));
    return { success: pages.length < before };
  });
}

module.exports = {
  registerPagesIpcHandlers,
};
