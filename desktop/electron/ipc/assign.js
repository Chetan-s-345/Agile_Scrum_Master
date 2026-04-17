const CHANNELS = require("./channels");

const developers = [
  { id: "dev-1", name: "Ava Patel", capacity: 24 },
  { id: "dev-2", name: "Noah Kim", capacity: 20 },
  { id: "dev-3", name: "Mia Rivera", capacity: 18 },
  { id: "dev-4", name: "Liam Chen", capacity: 22 },
];

let tasks = [
  {
    id: "task-1",
    sprintId: "sprint-1",
    sprintName: "Sprint 42",
    sprintStatus: "active",
    title: "Implement OAuth callback validation",
    status: "todo",
    storyPoints: 5,
    priority: "high",
    label: "auth",
    techTags: ["node", "security"],
    assignee: null,
  },
  {
    id: "task-2",
    sprintId: "sprint-1",
    sprintName: "Sprint 42",
    sprintStatus: "active",
    title: "Refactor assignment scoring service",
    status: "todo",
    storyPoints: 8,
    priority: "medium",
    label: "backend",
    techTags: ["typescript", "api"],
    assignee: null,
  },
  {
    id: "task-3",
    sprintId: "sprint-2",
    sprintName: "Sprint 43",
    sprintStatus: "planning",
    title: "Add drag-and-drop support for backlog",
    status: "todo",
    storyPoints: 3,
    priority: "low",
    label: "frontend",
    techTags: ["react", "ux"],
    assignee: null,
  },
  {
    id: "task-4",
    sprintId: "sprint-2",
    sprintName: "Sprint 43",
    sprintStatus: "planning",
    title: "Create workload utilization widget",
    status: "todo",
    storyPoints: 5,
    priority: "medium",
    label: "dashboard",
    techTags: ["charts", "recharts"],
    assignee: null,
  },
  {
    id: "task-5",
    sprintId: "sprint-1",
    sprintName: "Sprint 42",
    sprintStatus: "active",
    title: "Fix stale cache invalidation in IPC layer",
    status: "in_progress",
    storyPoints: 5,
    priority: "critical",
    label: "infra",
    techTags: ["electron", "ipc"],
    assignee: { id: "dev-2", name: "Noah Kim" },
  },
  {
    id: "task-6",
    sprintId: "sprint-1",
    sprintName: "Sprint 42",
    sprintStatus: "active",
    title: "Write regression tests for planner",
    status: "in_progress",
    storyPoints: 3,
    priority: "medium",
    label: "qa",
    techTags: ["testing", "vitest"],
    assignee: { id: "dev-1", name: "Ava Patel" },
  },
  {
    id: "task-7",
    sprintId: "sprint-2",
    sprintName: "Sprint 43",
    sprintStatus: "planning",
    title: "Integrate feature flag guard in renderer",
    status: "todo",
    storyPoints: 8,
    priority: "high",
    label: "platform",
    techTags: ["react", "electron"],
    assignee: { id: "dev-4", name: "Liam Chen" },
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

function cloneTask(task) {
  return {
    id: asString(task.id),
    sprintId: asString(task.sprintId),
    sprintName: asString(task.sprintName),
    sprintStatus: asString(task.sprintStatus || "planning"),
    title: asString(task.title || "Untitled Task"),
    status: asString(task.status || "todo"),
    storyPoints: Math.max(0, asNumber(task.storyPoints, 0)),
    priority: asString(task.priority || "medium"),
    label: asString(task.label || "general"),
    techTags: Array.isArray(task.techTags) ? task.techTags.map((tag) => asString(tag)).filter(Boolean) : [],
    assignee: task.assignee?.id
      ? {
          id: asString(task.assignee.id),
          name: asString(task.assignee.name || "Developer"),
        }
      : null,
  };
}

function getDeveloperById(developerId) {
  return developers.find((developer) => asString(developer.id) === asString(developerId)) || null;
}

function getDeveloperWorkloads() {
  return developers.map((developer) => {
    const assignedTasks = tasks.filter((task) => asString(task.assignee?.id) === asString(developer.id));
    const assignedPoints = assignedTasks.reduce((sum, task) => sum + Math.max(0, asNumber(task.storyPoints, 0)), 0);

    return {
      developer: {
        id: asString(developer.id),
        name: asString(developer.name),
      },
      assignedPoints,
      assignedCount: assignedTasks.length,
      capacity: Math.max(1, asNumber(developer.capacity, 20)),
    };
  });
}

function assignTaskInternal(taskId, developerId) {
  const taskIndex = tasks.findIndex((task) => asString(task.id) === asString(taskId));
  if (taskIndex < 0) {
    throw new Error("Task not found");
  }

  const developer = getDeveloperById(developerId);
  if (!developer) {
    throw new Error("Developer not found");
  }

  tasks[taskIndex] = {
    ...tasks[taskIndex],
    assignee: {
      id: asString(developer.id),
      name: asString(developer.name),
    },
  };

  return cloneTask(tasks[taskIndex]);
}

function registerAssignIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.ASSIGN.GET_UNASSIGNED_TASKS, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId || "");
    const items = tasks.filter((task) => {
      const unassigned = !asString(task.assignee?.id || "");
      if (!unassigned) return false;
      if (!sprintId) return true;
      return asString(task.sprintId) === sprintId;
    });

    return items.map(cloneTask);
  });

  ipcMain.handle(CHANNELS.ASSIGN.GET_DEVELOPERS_WITH_WORKLOAD, async () => {
    return getDeveloperWorkloads();
  });

  ipcMain.handle(CHANNELS.ASSIGN.ASSIGN_TASK, async (_event, payload) => {
    const taskId = asString(payload?.taskId || "");
    const developerId = asString(payload?.developerId || "");

    if (!taskId) {
      throw new Error("taskId is required");
    }
    if (!developerId) {
      throw new Error("developerId is required");
    }

    return assignTaskInternal(taskId, developerId);
  });

  ipcMain.handle(CHANNELS.ASSIGN.BULK_ASSIGN, async (_event, payload) => {
    const assignments = Array.isArray(payload?.assignments) ? payload.assignments : [];
    const updated = [];

    for (const assignment of assignments) {
      const taskId = asString(assignment?.taskId || "");
      const developerId = asString(assignment?.developerId || "");
      if (!taskId || !developerId) continue;
      updated.push(assignTaskInternal(taskId, developerId));
    }

    return updated;
  });
}

module.exports = {
  registerAssignIpcHandlers,
};
