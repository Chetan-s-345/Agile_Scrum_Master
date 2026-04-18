const CHANNELS = require("./channels");

const sprintSummaries = {
  "sprint-1": {
    sprintId: "sprint-1",
    sprintName: "Sprint 42",
    sprintGoal: "Ship assignment engine and board integrations",
    totalTasks: 34,
    completedPct: 62,
    blockersCount: 3,
    daysRemaining: 4,
  },
  "sprint-2": {
    sprintId: "sprint-2",
    sprintName: "Sprint 43",
    sprintGoal: "Stabilize analytics dashboards",
    totalTasks: 29,
    completedPct: 41,
    blockersCount: 5,
    daysRemaining: 8,
  },
  "sprint-3": {
    sprintId: "sprint-3",
    sprintName: "Sprint 44",
    sprintGoal: "Complete collaboration workflows",
    totalTasks: 31,
    completedPct: 27,
    blockersCount: 2,
    daysRemaining: 11,
  },
};

const burndownBySprint = {
  "sprint-1": {
    dates: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    ideal: [34, 29, 24, 19, 14, 9, 4],
    actual: [34, 31, 28, 22, 17, 14, 13],
  },
  "sprint-2": {
    dates: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    ideal: [29, 25, 21, 17, 13, 9, 5],
    actual: [29, 28, 26, 24, 21, 19, 17],
  },
  "sprint-3": {
    dates: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    ideal: [31, 27, 23, 19, 15, 11, 7],
    actual: [31, 31, 30, 29, 27, 26, 25],
  },
};

const velocityHistory = [
  { sprintId: "sprint-1", sprintName: "Sprint 42", committedPoints: 42, completedPoints: 33 },
  { sprintId: "sprint-2", sprintName: "Sprint 43", committedPoints: 38, completedPoints: 25 },
  { sprintId: "sprint-3", sprintName: "Sprint 44", committedPoints: 40, completedPoints: 19 },
  { sprintId: "sprint-4", sprintName: "Sprint 45", committedPoints: 37, completedPoints: 29 },
  { sprintId: "sprint-5", sprintName: "Sprint 46", committedPoints: 45, completedPoints: 36 },
  { sprintId: "sprint-6", sprintName: "Sprint 47", committedPoints: 43, completedPoints: 34 },
];

const contributorsBySprint = {
  "sprint-1": [
    { developerId: "dev-1", developer: "Ava Patel", tasksCompleted: 7, storyPointsDelivered: 13 },
    { developerId: "dev-2", developer: "Noah Kim", tasksCompleted: 6, storyPointsDelivered: 11 },
    { developerId: "dev-3", developer: "Mia Rivera", tasksCompleted: 4, storyPointsDelivered: 9 },
  ],
  "sprint-2": [
    { developerId: "dev-2", developer: "Noah Kim", tasksCompleted: 5, storyPointsDelivered: 10 },
    { developerId: "dev-4", developer: "Liam Chen", tasksCompleted: 4, storyPointsDelivered: 7 },
    { developerId: "dev-1", developer: "Ava Patel", tasksCompleted: 3, storyPointsDelivered: 6 },
  ],
  "sprint-3": [
    { developerId: "dev-3", developer: "Mia Rivera", tasksCompleted: 3, storyPointsDelivered: 5 },
    { developerId: "dev-4", developer: "Liam Chen", tasksCompleted: 2, storyPointsDelivered: 4 },
    { developerId: "dev-2", developer: "Noah Kim", tasksCompleted: 2, storyPointsDelivered: 3 },
  ],
};

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultSprintId() {
  return velocityHistory[0]?.sprintId || "sprint-1";
}

function getSummary(sprintId) {
  const id = asString(sprintId, getDefaultSprintId());
  return sprintSummaries[id] || sprintSummaries[getDefaultSprintId()];
}

function getBurndown(sprintId) {
  const id = asString(sprintId, getDefaultSprintId());
  return burndownBySprint[id] || burndownBySprint[getDefaultSprintId()];
}

function getVelocity(count) {
  const maxCount = Math.max(1, asNumber(count, 5));
  return velocityHistory.slice(0, maxCount);
}

function getContributors(sprintId) {
  const id = asString(sprintId, getDefaultSprintId());
  return contributorsBySprint[id] || contributorsBySprint[getDefaultSprintId()] || [];
}

function registerSprintIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.SPRINT.GET_SUMMARY, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId);
    return getSummary(sprintId);
  });

  ipcMain.handle(CHANNELS.SPRINT.GET_BURNDOWN, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId);
    return getBurndown(sprintId);
  });

  ipcMain.handle(CHANNELS.SPRINT.GET_VELOCITY_HISTORY, async (_event, payload) => {
    const count = asNumber(payload?.count, 5);
    return getVelocity(count);
  });

  ipcMain.handle(CHANNELS.SPRINT.GET_CONTRIBUTORS, async (_event, payload) => {
    const sprintId = asString(payload?.sprintId);
    return getContributors(sprintId);
  });
}

module.exports = {
  registerSprintIpcHandlers,
};
