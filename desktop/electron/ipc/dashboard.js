const CHANNELS = require("./channels");
const { getStoredSession } = require("./auth");

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getGatewayBaseUrl() {
  const candidate = asString(
    process.env.DESKTOP_API_GATEWAY_URL ||
      process.env.API_GATEWAY_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000"
  );
  return candidate.replace(/\/+$/, "");
}

function getAuthToken() {
  const session = getStoredSession();
  const token = asString(session?.accessToken);
  if (!token) {
    const error = new Error("Desktop session not found. Please sign in.");
    error.code = "DESKTOP_SESSION_MISSING";
    throw error;
  }
  return token;
}

function isMissingSessionError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.code === "DESKTOP_SESSION_MISSING") return true;
  const message = String(error.message || "");
  if (message.includes("Desktop session not found")) return true;
  return message.includes("Gateway request failed (401)");
}

function emptyDashboardPayload() {
  return {
    summary: {
      activeSprint: null,
      openTasks: 0,
      blockers: 0,
      velocity: 0,
      upcomingStandups: 0,
    },
    recentActivity: [],
    burndown: {
      dates: [],
      ideal: [],
      actual: [],
    },
  };
}

async function gatewayGet(pathname, searchParams) {
  const token = getAuthToken();
  const baseUrl = getGatewayBaseUrl();
  const qs = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : "";
  const url = `${baseUrl}${pathname}${qs}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = asString(body?.detail || body?.error || response.statusText);
    throw new Error(`Gateway request failed (${response.status}): ${detail}`);
  }

  return body;
}

function asList(payload, preferredKey) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (preferredKey && Array.isArray(payload[preferredKey])) return payload[preferredKey];
    const firstList = Object.values(payload).find((value) => Array.isArray(value));
    if (Array.isArray(firstList)) return firstList;
  }
  return [];
}

function toDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return asString(value, "");
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function normalizeBurndown(payload) {
  const points = asList(payload, "points");
  if (points.length) {
    return {
      dates: points.map((point) => toDateLabel(point?.date || point?.day || point?.timestamp)),
      ideal: points.map((point) => Math.max(0, asNumber(point?.ideal || point?.idealRemaining || point?.idealPoints, 0))),
      actual: points.map((point) => Math.max(0, asNumber(point?.actual || point?.remaining || point?.remainingPoints, 0))),
    };
  }

  const dates = asList(payload?.dates).map((value) => asString(value));
  const ideal = asList(payload?.ideal).map((value) => Math.max(0, asNumber(value, 0)));
  const actual = asList(payload?.actual).map((value) => Math.max(0, asNumber(value, 0)));
  return { dates, ideal, actual };
}

function findActiveSprint(payload, requestedSprintId) {
  const sprints = asList(payload, "sprints");
  const normalizedRequested = asString(requestedSprintId);

  if (normalizedRequested) {
    const directMatch = sprints.find((item) => asString(item?.id) === normalizedRequested);
    if (directMatch) return directMatch;
  }

  const active = sprints.find((item) => {
    const status = asString(item?.status).toLowerCase();
    return status === "active" || status === "in_progress";
  });

  return active || sprints[0] || null;
}

function normalizeSummaryFromData(sprint, tasks, standups) {
  const normalizedTasks = asList(tasks, "tasks");
  const openTasks = normalizedTasks.filter((task) => {
    const status = asString(task?.status).toLowerCase();
    return status && status !== "done" && status !== "completed" && status !== "closed";
  });

  const blockers = openTasks.filter((task) => {
    const status = asString(task?.status).toLowerCase();
    return status === "blocked" || task?.blocked === true || task?.isBlocked === true;
  });

  const completedPoints = normalizedTasks
    .filter((task) => {
      const status = asString(task?.status).toLowerCase();
      return status === "done" || status === "completed" || status === "closed";
    })
    .reduce((sum, task) => sum + Math.max(0, asNumber(task?.storyPoints || task?.points || 0, 0)), 0);

  const standupList = asList(standups, "standups");

  return {
    activeSprint: sprint
      ? {
          id: asString(sprint.id),
          projectId: asString(sprint.projectId),
          name: asString(sprint.name, "Active Sprint"),
          progress: Math.max(0, Math.min(100, Math.round(asNumber(sprint.progress ?? sprint.completedPct, 0)))),
        }
      : null,
    openTasks: openTasks.length,
    blockers: blockers.length,
    velocity: Math.max(0, Math.round(completedPoints)),
    upcomingStandups: standupList.length,
  };
}

function buildRecentActivityFromTasks(tasks) {
  return asList(tasks, "tasks")
    .map((task) => {
      const status = asString(task?.status, "updated");
      const title = asString(task?.title, "Task updated");
      const updatedAt = asString(task?.updatedAt || task?.modifiedAt || task?.createdAt || new Date().toISOString());
      const assigneeId = asString(task?.assignee?.id || task?.assigneeId || "system");
      const taskId = asString(task?.id || task?.taskId || `${title}-${updatedAt}`);

      return {
        id: `activity-${taskId}`,
        type: `task.${status}`,
        message: title,
        timestamp: updatedAt,
        userId: assigneeId,
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);
}

async function fetchDashboardData(payload = {}) {
  const requestedSprintId = asString(payload?.sprintId);
  const projectId = asString(payload?.projectId);

  const sprintParams = new URLSearchParams();
  if (projectId) sprintParams.set("projectId", projectId);
  if (requestedSprintId) sprintParams.set("sprintId", requestedSprintId);

  const sprintsPayload = await gatewayGet("/api/v1/sprints", sprintParams);
  const activeSprint = findActiveSprint(sprintsPayload, requestedSprintId);

  const sprintId = asString(activeSprint?.id || requestedSprintId);
  if (!sprintId) {
    return {
      summary: {
        activeSprint: null,
        openTasks: 0,
        blockers: 0,
        velocity: 0,
        upcomingStandups: 0,
      },
      recentActivity: [],
      burndown: {
        dates: [],
        ideal: [],
        actual: [],
      },
    };
  }

  const tasksParams = new URLSearchParams({ sprintId });
  const standupParams = new URLSearchParams({ sprintId });
  const burndownParams = new URLSearchParams({ sprintId });
  if (projectId) burndownParams.set("projectId", projectId);

  const [tasksPayload, standupsPayload, burndownPayload] = await Promise.all([
    gatewayGet("/api/v1/tasks", tasksParams),
    gatewayGet("/api/v1/standup", standupParams).catch(() => ({ standups: [] })),
    gatewayGet("/api/v1/metrics/burndown", burndownParams).catch(() => ({ dates: [], ideal: [], actual: [] })),
  ]);

  return {
    summary: normalizeSummaryFromData(activeSprint, tasksPayload, standupsPayload),
    recentActivity: buildRecentActivityFromTasks(tasksPayload),
    burndown: normalizeBurndown(burndownPayload),
  };
}

function registerDashboardIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.DASHBOARD.GET_SUMMARY, async (_event, payload) => {
    try {
      const dashboard = await fetchDashboardData(payload);
      return dashboard.summary;
    } catch (error) {
      if (isMissingSessionError(error)) {
        return emptyDashboardPayload().summary;
      }
      throw error;
    }
  });

  ipcMain.handle(CHANNELS.DASHBOARD.GET_RECENT_ACTIVITY, async (_event, payload) => {
    try {
      const dashboard = await fetchDashboardData(payload);
      return dashboard.recentActivity;
    } catch (error) {
      if (isMissingSessionError(error)) {
        return emptyDashboardPayload().recentActivity;
      }
      throw error;
    }
  });

  ipcMain.handle(CHANNELS.DASHBOARD.GET_BURNDOWN_DATA, async (_event, payload) => {
    try {
      const dashboard = await fetchDashboardData(payload);
      return dashboard.burndown;
    } catch (error) {
      if (isMissingSessionError(error)) {
        return emptyDashboardPayload().burndown;
      }
      throw error;
    }
  });
}

module.exports = {
  registerDashboardIpcHandlers,
};
