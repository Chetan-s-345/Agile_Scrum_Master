const CHANNELS = require("./channels");

let tasks = [
  {
    id: "board-1",
    title: "Implement OAuth callback validation",
    type: "story",
    priority: "high",
    storyPoints: 5,
    status: "todo",
    sprintId: "sprint-1",
    assignee: { id: "dev-1", name: "Ava Patel" },
    techTags: ["auth", "backend"],
    pr: {
      url: "https://github.com/org/agile-scrum-master/pull/124",
      branchName: "feature/oauth-callback-validation",
      prStatus: "open",
      reviewStatus: "changes_requested",
      author: "avapatel",
    },
  },
  {
    id: "board-2",
    title: "Fix stale cache invalidation in IPC layer",
    type: "bug",
    priority: "critical",
    storyPoints: 8,
    status: "todo",
    sprintId: "sprint-1",
    assignee: { id: "dev-2", name: "Noah Kim" },
    techTags: ["ipc", "electron"],
    pr: {
      url: "https://github.com/org/agile-scrum-master/pull/118",
      branchName: "fix/ipc-cache-invalidation",
      prStatus: "merged",
      reviewStatus: "approved",
      author: "noahkim",
    },
  },
  {
    id: "board-3",
    title: "Create burndown anomaly monitor",
    type: "story",
    priority: "medium",
    storyPoints: 3,
    status: "todo",
    sprintId: "sprint-2",
    assignee: { id: "dev-3", name: "Mia Rivera" },
    techTags: ["monitoring", "analytics"],
    pr: null,
  },
  {
    id: "board-4",
    title: "Improve board keyboard shortcuts",
    type: "task",
    priority: "low",
    storyPoints: 2,
    status: "in_progress",
    sprintId: "sprint-2",
    assignee: { id: "dev-4", name: "Liam Chen" },
    techTags: ["ux", "frontend"],
    pr: {
      url: "https://github.com/org/agile-scrum-master/pull/133",
      branchName: "feat/board-keyboard-shortcuts",
      prStatus: "closed",
      reviewStatus: "pending",
      author: "liamchen",
    },
  },
];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function normalizeStatus(value) {
  const status = asString(value, "todo").toLowerCase();
  if (["todo", "in_progress", "in_review", "done"].includes(status)) {
    return status;
  }
  return "todo";
}

function cloneTask(task) {
  return {
    id: asString(task.id),
    title: asString(task.title, "Untitled task"),
    type: asString(task.type, "task"),
    priority: asString(task.priority, "medium"),
    storyPoints: Number.isFinite(Number(task.storyPoints)) ? Number(task.storyPoints) : 0,
    points: Number.isFinite(Number(task.storyPoints)) ? Number(task.storyPoints) : 0,
    status: normalizeStatus(task.status),
    sprintId: asString(task.sprintId),
    assignee: task.assignee?.id
      ? {
          id: asString(task.assignee.id),
          name: asString(task.assignee.name, "Developer"),
        }
      : null,
    techTags: Array.isArray(task.techTags) ? task.techTags.map((tag) => asString(tag)).filter(Boolean) : [],
    pr: task.pr
      ? {
          url: asString(task.pr.url),
          branchName: asString(task.pr.branchName),
          prStatus: asString(task.pr.prStatus, "open"),
          reviewStatus: asString(task.pr.reviewStatus, "pending"),
          author: asString(task.pr.author, "unknown"),
        }
      : null,
  };
}

function toTaskWithPR(task) {
  return {
    task: {
      id: asString(task.id),
      title: asString(task.title, "Untitled task"),
      status: normalizeStatus(task.status),
      sprintId: asString(task.sprintId),
      assignee: task.assignee?.id
        ? {
            id: asString(task.assignee.id),
            name: asString(task.assignee.name, "Developer"),
          }
        : null,
    },
    pr: task.pr
      ? {
          url: asString(task.pr.url),
          branchName: asString(task.pr.branchName),
          prStatus: asString(task.pr.prStatus, "open"),
          reviewStatus: asString(task.pr.reviewStatus, "pending"),
          author: asString(task.pr.author, "unknown"),
        }
      : null,
  };
}

function parseBranchName(prUrl) {
  const parts = asString(prUrl).split("/").filter(Boolean);
  const prNumber = parts[parts.length - 1] || "new";
  return `feature/pr-${prNumber}`;
}

function registerBoardIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.BOARD.GET_SPRINT_BACKLOG, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId);

    const items = tasks.filter((task) => {
      const sprintMatches = sprintId ? asString(task.sprintId) === sprintId : true;
      const notStarted = normalizeStatus(task.status) === "todo";
      return sprintMatches && notStarted;
    });

    return items.map(cloneTask);
  });

  ipcMain.handle(CHANNELS.BOARD.MOVE_TO_BOARD, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    const status = normalizeStatus(payload?.status);

    if (!taskId) {
      throw new Error("taskId is required");
    }

    const index = tasks.findIndex((task) => asString(task.id) === taskId);
    if (index < 0) {
      throw new Error("Task not found");
    }

    tasks[index] = {
      ...tasks[index],
      status,
    };

    return cloneTask(tasks[index]);
  });

  ipcMain.handle(CHANNELS.BOARD.GET_TASKS_WITH_PRS, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId);
    const filtered = tasks.filter((task) => {
      if (!sprintId) return true;
      return asString(task.sprintId) === sprintId;
    });
    return filtered.map(toTaskWithPR);
  });

  ipcMain.handle(CHANNELS.BOARD.LINK_PR, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    const prUrl = asString(payload?.prUrl);

    if (!taskId) throw new Error("taskId is required");
    if (!prUrl) throw new Error("prUrl is required");

    const index = tasks.findIndex((task) => asString(task.id) === taskId);
    if (index < 0) throw new Error("Task not found");

    tasks[index] = {
      ...tasks[index],
      pr: {
        url: prUrl,
        branchName: parseBranchName(prUrl),
        prStatus: "open",
        reviewStatus: "pending",
        author: asString(tasks[index].assignee?.name || "unknown").toLowerCase().replace(/\s+/g, ""),
      },
    };

    return cloneTask(tasks[index]);
  });

  ipcMain.handle(CHANNELS.BOARD.UNLINK_PR, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    if (!taskId) throw new Error("taskId is required");

    const index = tasks.findIndex((task) => asString(task.id) === taskId);
    if (index < 0) throw new Error("Task not found");

    tasks[index] = {
      ...tasks[index],
      pr: null,
    };

    return cloneTask(tasks[index]);
  });
}

module.exports = {
  registerBoardIpcHandlers,
};
