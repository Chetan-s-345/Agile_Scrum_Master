const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const CHANNELS = require("./channels");
const { gatewayRequest } = require("./gateway");

const DATA_FILE = "navbar.data.db.json";

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function dataFilePath() {
  return path.join(app.getPath("userData"), DATA_FILE);
}

function defaultData() {
  const now = Date.now();
  return {
    notifications: [
      {
        id: "notif-1",
        text: "Sprint Review is scheduled for tomorrow.",
        href: "/sprint",
        createdAt: new Date(now - 30 * 60 * 1000).toISOString(),
        actor: { initials: "SM" },
        read: false,
      },
      {
        id: "notif-2",
        text: "A task was assigned to you.",
        href: "/tasks",
        createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
        actor: { initials: "AS" },
        read: false,
      },
      {
        id: "notif-3",
        text: "Burndown anomaly detected in active sprint.",
        href: "/monitoring",
        createdAt: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
        actor: { initials: "AI" },
        read: true,
      },
    ],
    changelog: [
      {
        id: "chg-1",
        title: "Improved board performance",
        date: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        detail: "Drag-and-drop rendering latency has been reduced.",
      },
      {
        id: "chg-2",
        title: "New admin controls",
        date: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        detail: "Feature flags and audit logs are now available in desktop.",
      },
    ],
  };
}

function readData() {
  try {
    const filePath = dataFilePath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultData();
    return {
      notifications: asArray(parsed?.notifications).length
        ? parsed.notifications
        : defaults.notifications,
      changelog: asArray(parsed?.changelog).length ? parsed.changelog : defaults.changelog,
    };
  } catch {
    return defaultData();
  }
}

function writeData(data) {
  fs.writeFileSync(dataFilePath(), JSON.stringify(data, null, 2), "utf8");
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

function mapTaskSearchItem(task) {
  const id = asString(task?.id || task?.taskId);
  return {
    id,
    type: "task",
    title: asString(task?.title, "Task"),
    subtitle: asString(task?.status || task?.priority || "Task"),
    href: id ? `/tasks/${id}` : "/tasks",
  };
}

function mapSprintSearchItem(sprint) {
  const id = asString(sprint?.id || sprint?.sprintId);
  return {
    id,
    type: "sprint",
    title: asString(sprint?.name, "Sprint"),
    subtitle: asString(sprint?.status || "sprint"),
    href: id ? `/sprints/${id}` : "/sprints",
  };
}

function mapDeveloperSearchItem(developer) {
  const id = asString(developer?.id || developer?.developerId);
  const title = asString(developer?.name || developer?.fullName || "Developer");
  return {
    id,
    type: "developer",
    title,
    subtitle: asString(developer?.role || developer?.email || "developer"),
    href: id ? `/developers/${id}` : "/developers",
  };
}

function textMatch(row, query) {
  const lower = asString(query).toLowerCase();
  if (!lower) return true;
  return JSON.stringify(row || {}).toLowerCase().includes(lower);
}

async function gatewaySearch(query, projectId) {
  const [tasksPayload, sprintsPayload, developersPayload] = await Promise.all([
    gatewayRequest("GET", "/api/v1/tasks", {
      query: {
        q: query,
        projectId: asString(projectId),
      },
    }).catch(() => null),
    gatewayRequest("GET", "/api/v1/sprints", {
      query: {
        projectId: asString(projectId),
      },
    }).catch(() => null),
    gatewayRequest("GET", "/api/v1/developers").catch(() => null),
  ]);

  const tasks = firstArray(tasksPayload, ["items", "tasks"]).filter((row) => textMatch(row, query));
  const sprints = firstArray(sprintsPayload, ["items", "sprints"]).filter((row) => textMatch(row, query));
  const developers = firstArray(developersPayload, ["items", "developers"]).filter((row) => textMatch(row, query));

  return {
    tasks: tasks.slice(0, 8).map(mapTaskSearchItem),
    sprints: sprints.slice(0, 6).map(mapSprintSearchItem),
    developers: developers.slice(0, 6).map(mapDeveloperSearchItem),
    pages: [],
  };
}

function registerNavbarDataIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.SEARCH.QUERY, async (_event, payload = {}) => {
    const q = asString(payload.q || payload.query);
    const projectId = asString(payload.projectId);

    if (q.length < 2) {
      return { tasks: [], sprints: [], developers: [], pages: [] };
    }

    try {
      return await gatewaySearch(q, projectId);
    } catch {
      return { tasks: [], sprints: [], developers: [], pages: [] };
    }
  });

  ipcMain.handle(CHANNELS.IN_APP_NOTIFICATIONS.GET_LIST, async (_event, payload = {}) => {
    const unreadOnly = Boolean(payload.unread || payload.unreadOnly);
    const data = readData();
    const sorted = asArray(data.notifications).sort((a, b) => {
      const aMs = new Date(asString(a?.createdAt)).getTime();
      const bMs = new Date(asString(b?.createdAt)).getTime();
      return bMs - aMs;
    });

    const items = unreadOnly ? sorted.filter((item) => !Boolean(item?.read)) : sorted;
    const unreadCount = sorted.filter((item) => !Boolean(item?.read)).length;
    return { items, unreadCount };
  });

  ipcMain.handle(CHANNELS.IN_APP_NOTIFICATIONS.MARK_READ, async (_event, payload = {}) => {
    const id = asString(payload.id || payload.notificationId);
    if (!id) {
      throw new Error("notification id is required");
    }

    const data = readData();
    data.notifications = asArray(data.notifications).map((item) => {
      if (asString(item?.id) !== id) return item;
      return { ...item, read: true };
    });
    writeData(data);

    return { success: true };
  });

  ipcMain.handle(CHANNELS.IN_APP_NOTIFICATIONS.MARK_ALL_READ, async () => {
    const data = readData();
    data.notifications = asArray(data.notifications).map((item) => ({ ...item, read: true }));
    writeData(data);
    return { success: true };
  });

  ipcMain.handle(CHANNELS.CHANGELOG.GET_ITEMS, async () => {
    const data = readData();
    return { items: asArray(data.changelog) };
  });
}

module.exports = {
  registerNavbarDataIpcHandlers,
};
