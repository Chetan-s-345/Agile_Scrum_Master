const CHANNELS = require("./channels");
const { gatewayRequest } = require("./gateway");

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
];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeStatus(value) {
  const status = asString(value, "todo").toLowerCase();
  if (["todo", "in_progress", "in_review", "done"].includes(status)) {
    return status;
  }
  return "todo";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstArray(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  const found = Object.values(payload).find((entry) => Array.isArray(entry));
  return Array.isArray(found) ? found : [];
}

function cloneTask(task) {
  return {
    id: asString(task.id),
    title: asString(task.title, "Untitled task"),
    type: asString(task.type, "task"),
    priority: asString(task.priority, "medium"),
    storyPoints: Math.max(0, asNumber(task.storyPoints, 0)),
    points: Math.max(0, asNumber(task.storyPoints, 0)),
    status: normalizeStatus(task.status),
    sprintId: asString(task.sprintId),
    assignee: task.assignee?.id
      ? {
          id: asString(task.assignee.id),
          name: asString(task.assignee.name, "Developer"),
        }
      : null,
    techTags: asArray(task.techTags).map((tag) => asString(tag)).filter(Boolean),
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

function toTaskFromGateway(task) {
  return {
    id: asString(task?.id || task?.taskId),
    title: asString(task?.title, "Untitled task"),
    type: asString(task?.type || task?.taskType || "task"),
    priority: asString(task?.priority, "medium"),
    storyPoints: Math.max(0, asNumber(task?.storyPoints ?? task?.points ?? task?.estimate ?? 0, 0)),
    points: Math.max(0, asNumber(task?.storyPoints ?? task?.points ?? task?.estimate ?? 0, 0)),
    status: normalizeStatus(task?.status),
    sprintId: asString(task?.sprintId || task?.sprint?.id),
    assignee:
      task?.assignee && typeof task.assignee === "object"
        ? {
            id: asString(task.assignee.id || task.assignee.userId),
            name: asString(task.assignee.name || task.assignee.fullName || task.assignee.email, "Developer"),
          }
        : null,
    techTags: asArray(task?.techTags || task?.labels).map((tag) => asString(tag)).filter(Boolean),
    pr:
      task?.pr && typeof task.pr === "object"
        ? {
            url: asString(task.pr.url),
            branchName: asString(task.pr.branchName),
            prStatus: asString(task.pr.prStatus || task.pr.status, "open"),
            reviewStatus: asString(task.pr.reviewStatus || "pending"),
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

function getSprintListFromLocal() {
  const seen = new Set();
  const sprints = [];

  for (const task of tasks) {
    const sprintId = asString(task.sprintId);
    if (!sprintId || seen.has(sprintId)) continue;
    seen.add(sprintId);
    sprints.push({
      id: sprintId,
      name: `Sprint ${sprintId.replace(/[^0-9]/g, "") || sprintId}`,
      status: sprintId === "sprint-1" ? "active" : "planning",
    });
  }

  return sprints;
}

async function getSprintsFromGateway() {
  const payload = await gatewayRequest("GET", "/api/v1/sprints");
  const rows = firstArray(payload, ["items", "sprints"]);
  return rows.map((row) => ({
    id: asString(row?.id || row?.sprintId),
    name: asString(row?.name, "Sprint"),
    status: asString(row?.status, "planning"),
  }));
}

async function getTasksFromGateway(sprintId) {
  const payload = await gatewayRequest("GET", "/api/v1/tasks", {
    query: {
      sprintId: asString(sprintId),
    },
  });

  const rows = firstArray(payload, ["items", "tasks"]);
  return rows.map(toTaskFromGateway);
}

function registerBoardIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.BOARD.GET_ACTIVE_SPRINT, async () => {
    try {
      const sprints = await getSprintsFromGateway();
      return sprints.find((sprint) => asString(sprint.status).toLowerCase() === "active") || sprints[0] || null;
    } catch {
      const active = getSprintListFromLocal().find((sprint) => sprint.status === "active");
      return active || null;
    }
  });

  ipcMain.handle(CHANNELS.BOARD.GET_SPRINTS, async () => {
    try {
      return await getSprintsFromGateway();
    } catch {
      return getSprintListFromLocal();
    }
  });

  ipcMain.handle(CHANNELS.BOARD.GET_TASKS, async (_event, payload = {}) => {
    const sprintId = asString(payload.sprintId);

    try {
      const gatewayTasks = await getTasksFromGateway(sprintId);
      return gatewayTasks;
    } catch {
      const filtered = sprintId ? tasks.filter((task) => asString(task.sprintId) === sprintId) : tasks;
      return filtered.map(cloneTask);
    }
  });

  ipcMain.handle(CHANNELS.BOARD.MOVE_TASK, async (_event, payload = {}) => {
    const taskId = asString(payload.taskId);
    const newStatus = normalizeStatus(payload.newStatus);

    if (!taskId) throw new Error("taskId is required");

    try {
      const response = await gatewayRequest("PATCH", `/api/v1/tasks/${encodeURIComponent(taskId)}/status`, {
        body: { status: newStatus },
      });
      const item = response?.task || response?.item || response;
      return toTaskFromGateway(item);
    } catch {
      try {
        const response = await gatewayRequest("PATCH", `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
          body: { status: newStatus },
        });
        const item = response?.task || response?.item || response;
        return toTaskFromGateway(item);
      } catch {
        const index = tasks.findIndex((task) => asString(task.id) === taskId);
        if (index < 0) throw new Error("Task not found");

        tasks[index] = {
          ...tasks[index],
          status: newStatus,
        };
        return cloneTask(tasks[index]);
      }
    }
  });

  ipcMain.handle(CHANNELS.BOARD.CREATE_TASK, async (_event, payload = {}) => {
    const sprintId = asString(payload.sprintId, "sprint-1");
    const status = normalizeStatus(payload.status);
    const title = asString(payload.title, "New Task");
    const priority = asString(payload.priority, "medium");
    const storyPoints = Math.max(0, asNumber(payload.storyPoints || payload.points || 0));

    try {
      const response = await gatewayRequest("POST", "/api/v1/tasks", {
        body: {
          title,
          type: asString(payload.type, "task"),
          priority,
          storyPoints,
          sprintId,
          status,
          assigneeId: asString(payload.assignee?.id || payload.assigneeId),
          labels: asArray(payload.techTags),
        },
      });
      const item = response?.task || response?.item || response;
      return toTaskFromGateway(item);
    } catch {
      const created = {
        id: `board-${Date.now()}`,
        title,
        type: asString(payload.type, "task"),
        priority,
        storyPoints,
        status,
        sprintId,
        assignee: payload.assignee && typeof payload.assignee === "object"
          ? {
              id: asString(payload.assignee.id),
              name: asString(payload.assignee.name, "Developer"),
            }
          : null,
        techTags: asArray(payload.techTags).map((tag) => asString(tag)).filter(Boolean),
        pr: null,
      };

      tasks.push(created);
      return cloneTask(created);
    }
  });

  ipcMain.handle(CHANNELS.BOARD.GET_SPRINT_BACKLOG, async (_event, payload = {}) => {
    const sprintId = asString(payload.sprintId);
    try {
      const gatewayTasks = await getTasksFromGateway(sprintId);
      return gatewayTasks.filter((task) => normalizeStatus(task.status) === "todo");
    } catch {
      const items = tasks.filter((task) => {
        const sprintMatches = sprintId ? asString(task.sprintId) === sprintId : true;
        const notStarted = normalizeStatus(task.status) === "todo";
        return sprintMatches && notStarted;
      });

      return items.map(cloneTask);
    }
  });

  ipcMain.handle(CHANNELS.BOARD.MOVE_TO_BOARD, async (_event, payload = {}) => {
    const taskId = asString(payload.taskId);
    const status = normalizeStatus(payload.status);

    if (!taskId) throw new Error("taskId is required");

    try {
      const response = await gatewayRequest("PATCH", `/api/v1/tasks/${encodeURIComponent(taskId)}/status`, {
        body: { status },
      });
      const item = response?.task || response?.item || response;
      return toTaskFromGateway(item);
    } catch {
      const index = tasks.findIndex((task) => asString(task.id) === taskId);
      if (index < 0) throw new Error("Task not found");

      tasks[index] = {
        ...tasks[index],
        status,
      };

      return cloneTask(tasks[index]);
    }
  });

  ipcMain.handle(CHANNELS.BOARD.GET_TASKS_WITH_PRS, async (_event, payload = {}) => {
    const sprintId = asString(payload.sprintId);
    try {
      const gatewayTasks = await getTasksFromGateway(sprintId);
      return gatewayTasks.map(toTaskWithPR);
    } catch {
      const filtered = tasks.filter((task) => {
        if (!sprintId) return true;
        return asString(task.sprintId) === sprintId;
      });
      return filtered.map(toTaskWithPR);
    }
  });

  ipcMain.handle(CHANNELS.BOARD.LINK_PR, async (_event, payload = {}) => {
    const taskId = asString(payload.taskId);
    const prUrl = asString(payload.prUrl);

    if (!taskId) throw new Error("taskId is required");
    if (!prUrl) throw new Error("prUrl is required");

    try {
      const response = await gatewayRequest("PATCH", `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        body: {
          prUrl,
        },
      });
      const item = response?.task || response?.item || response;
      return toTaskFromGateway(item);
    } catch {
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
    }
  });

  ipcMain.handle(CHANNELS.BOARD.UNLINK_PR, async (_event, payload = {}) => {
    const taskId = asString(payload.taskId);
    if (!taskId) throw new Error("taskId is required");

    try {
      const response = await gatewayRequest("PATCH", `/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        body: {
          prUrl: null,
        },
      });
      const item = response?.task || response?.item || response;
      return toTaskFromGateway(item);
    } catch {
      const index = tasks.findIndex((task) => asString(task.id) === taskId);
      if (index < 0) throw new Error("Task not found");

      tasks[index] = {
        ...tasks[index],
        pr: null,
      };

      return cloneTask(tasks[index]);
    }
  });
}

module.exports = {
  registerBoardIpcHandlers,
};
