const CHANNELS = require("./channels");

function createSummary(payload = {}) {
  const sprintId = String(payload?.sprintId || "active-sprint");
  const sprintName = String(payload?.sprintName || "Active Sprint");
  const projectId = String(payload?.projectId || "").trim() || undefined;

  return {
    activeSprint: {
      id: sprintId,
      projectId,
      name: sprintName,
      progress: 62,
    },
    openTasks: 24,
    blockers: 3,
    velocity: 28,
    upcomingStandups: 2,
  };
}

function createRecentActivity(payload = {}) {
  const userId = String(payload?.userId || "system");
  const now = Date.now();
  const templates = [
    { type: "task.updated", message: "Updated acceptance criteria" },
    { type: "task.moved", message: "Moved task to In Progress" },
    { type: "task.blocked", message: "Marked task as blocked" },
    { type: "task.review", message: "Requested code review" },
    { type: "task.closed", message: "Completed implementation" },
  ];

  return Array.from({ length: 10 }).map((_, index) => {
    const entry = templates[index % templates.length];
    return {
      id: `activity-${index + 1}`,
      type: entry.type,
      message: entry.message,
      timestamp: new Date(now - index * 30 * 60 * 1000).toISOString(),
      userId,
    };
  });
}

function createBurndownData() {
  const points = 10;
  const total = 40;
  const dates = [];
  const ideal = [];
  const actual = [];

  for (let i = 0; i < points; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() - (points - i - 1));
    dates.push(
      date.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
      })
    );

    ideal.push(Math.max(total - (total / (points - 1)) * i, 0));

    const expected = total - (total / (points - 1)) * i;
    const variance = i < 4 ? 3 : i < 7 ? 1 : -2;
    actual.push(Math.max(Math.round(expected + variance), 0));
  }

  return { dates, ideal, actual };
}

function registerDashboardIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.DASHBOARD.GET_SUMMARY, async (_event, payload) => {
    return createSummary(payload);
  });

  ipcMain.handle(CHANNELS.DASHBOARD.GET_RECENT_ACTIVITY, async (_event, payload) => {
    return createRecentActivity(payload);
  });

  ipcMain.handle(CHANNELS.DASHBOARD.GET_BURNDOWN_DATA, async () => {
    return createBurndownData();
  });
}

module.exports = {
  registerDashboardIpcHandlers,
};
