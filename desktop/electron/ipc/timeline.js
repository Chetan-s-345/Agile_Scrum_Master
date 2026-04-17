const CHANNELS = require("./channels");

let timelineTasks = [
  {
    task: {
      id: "board-1",
      title: "Implement OAuth callback validation",
      status: "in_progress",
      priority: "high",
      storyPoints: 5,
      assignee: { id: "dev-1", name: "Ava Patel" },
      sprintId: "sprint-1",
      sprintName: "Sprint 42",
      sprintStartDate: "2026-04-07",
      sprintEndDate: "2026-04-21",
      epicTitle: "Authentication",
    },
    startDate: "2026-04-09",
    dueDate: "2026-04-15",
  },
  {
    task: {
      id: "board-2",
      title: "Fix stale cache invalidation in IPC layer",
      status: "todo",
      priority: "critical",
      storyPoints: 8,
      assignee: { id: "dev-2", name: "Noah Kim" },
      sprintId: "sprint-1",
      sprintName: "Sprint 42",
      sprintStartDate: "2026-04-07",
      sprintEndDate: "2026-04-21",
      epicTitle: "Infrastructure",
    },
    startDate: "2026-04-10",
    dueDate: "2026-04-18",
  },
  {
    task: {
      id: "board-3",
      title: "Create burndown anomaly monitor",
      status: "blocked",
      priority: "medium",
      storyPoints: 3,
      assignee: { id: "dev-3", name: "Mia Rivera" },
      sprintId: "sprint-2",
      sprintName: "Sprint 43",
      sprintStartDate: "2026-04-22",
      sprintEndDate: "2026-05-06",
      epicTitle: "Analytics",
    },
    startDate: "2026-04-23",
    dueDate: "2026-04-30",
  },
  {
    task: {
      id: "board-4",
      title: "Improve board keyboard shortcuts",
      status: "done",
      priority: "low",
      storyPoints: 2,
      assignee: { id: "dev-4", name: "Liam Chen" },
      sprintId: "sprint-2",
      sprintName: "Sprint 43",
      sprintStartDate: "2026-04-22",
      sprintEndDate: "2026-05-06",
      epicTitle: "UX",
    },
    startDate: "2026-04-24",
    dueDate: "2026-04-28",
  },
];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function cloneRow(row) {
  return {
    task: {
      id: asString(row.task?.id),
      title: asString(row.task?.title, "Untitled task"),
      status: asString(row.task?.status, "todo"),
      priority: asString(row.task?.priority, "medium"),
      storyPoints: Number.isFinite(Number(row.task?.storyPoints)) ? Number(row.task.storyPoints) : 0,
      assignee: row.task?.assignee?.id
        ? {
            id: asString(row.task.assignee.id),
            name: asString(row.task.assignee.name, "Developer"),
          }
        : null,
      sprintId: asString(row.task?.sprintId),
      sprintName: asString(row.task?.sprintName),
      sprintStartDate: asString(row.task?.sprintStartDate),
      sprintEndDate: asString(row.task?.sprintEndDate),
      epicTitle: asString(row.task?.epicTitle),
    },
    startDate: asString(row.startDate),
    dueDate: asString(row.dueDate),
  };
}

function registerTimelineIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.TIMELINE.GET_TASKS, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId);
    const items = sprintId
      ? timelineTasks.filter((row) => asString(row.task?.sprintId) === sprintId)
      : timelineTasks;
    return items.map(cloneRow);
  });

  ipcMain.handle(CHANNELS.TIMELINE.UPDATE_TASK_DATES, async (_event, payload) => {
    const taskId = asString(payload?.taskId);
    const startDate = asString(payload?.startDate);
    const dueDate = asString(payload?.dueDate);

    if (!taskId) throw new Error("taskId is required");
    if (!startDate) throw new Error("startDate is required");
    if (!dueDate) throw new Error("dueDate is required");

    const index = timelineTasks.findIndex((row) => asString(row.task?.id) === taskId);
    if (index < 0) throw new Error("Task not found");

    timelineTasks[index] = {
      ...timelineTasks[index],
      startDate,
      dueDate,
    };

    return cloneRow(timelineTasks[index]).task;
  });
}

module.exports = {
  registerTimelineIpcHandlers,
};
