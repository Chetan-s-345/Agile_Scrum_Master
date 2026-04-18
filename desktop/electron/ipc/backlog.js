const CHANNELS = require("./channels");
const { gatewayRequest } = require("./gateway");

const developers = [
  { id: "dev-1", name: "Ava Patel" },
  { id: "dev-2", name: "Noah Kim" },
  { id: "dev-3", name: "Mia Rivera" },
  { id: "dev-4", name: "Liam Chen" },
];

const sprints = [
  { id: "sprint-1", name: "Sprint 42", status: "active" },
  { id: "sprint-2", name: "Sprint 43", status: "planning" },
  { id: "sprint-3", name: "Sprint 44", status: "planning" },
];

let backlogItems = [
  {
    id: "bl-1",
    title: "Implement OAuth callback validation",
    type: "story",
    priority: "high",
    points: 5,
    assigneeId: "dev-1",
    sprintId: "sprint-1",
    status: "todo",
    order: 1,
  },
  {
    id: "bl-2",
    title: "Fix stale cache invalidation in IPC layer",
    type: "bug",
    priority: "critical",
    points: 8,
    assigneeId: "dev-2",
    sprintId: "sprint-1",
    status: "in_progress",
    order: 2,
  },
  {
    id: "bl-3",
    title: "Add drag and drop support for backlog rows",
    type: "task",
    priority: "medium",
    points: 3,
    assigneeId: "",
    sprintId: "",
    status: "todo",
    order: 3,
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

function asPriority(value) {
  const normalized = asString(value, "medium").toLowerCase();
  if (["critical", "high", "medium", "low"].includes(normalized)) {
    return normalized;
  }
  return "medium";
}

function asType(value) {
  const normalized = asString(value, "task").toLowerCase();
  if (["story", "bug", "task"].includes(normalized)) {
    return normalized;
  }
  return "task";
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

function getDeveloperById(developerId) {
  return developers.find((developer) => asString(developer.id) === asString(developerId)) || null;
}

function getSprintById(sprintId) {
  return sprints.find((sprint) => asString(sprint.id) === asString(sprintId)) || null;
}

function sortByOrder(items) {
  return [...items].sort((a, b) => asNumber(a.order, 0) - asNumber(b.order, 0));
}

function toBacklogItem(item, index = 0) {
  const sprint = getSprintById(item.sprintId);
  const developer = getDeveloperById(item.assigneeId);

  return {
    id: asString(item.id),
    title: asString(item.title, "Untitled task"),
    type: asType(item.type),
    priority: asPriority(item.priority),
    points: Math.max(0, asNumber(item.points, 0)),
    storyPoints: Math.max(0, asNumber(item.points, 0)),
    status: asString(item.status, "todo"),
    assignee: developer
      ? {
          id: asString(developer.id),
          name: asString(developer.name, "Developer"),
        }
      : null,
    sprintId: asString(item.sprintId),
    sprint: sprint
      ? {
          id: asString(sprint.id),
          name: asString(sprint.name),
          status: asString(sprint.status, "planning"),
        }
      : null,
    order: asNumber(item.order, index + 1),
  };
}

function toBacklogItemFromGateway(task, index = 0) {
  const assignee = task?.assignee && typeof task.assignee === "object"
    ? {
        id: asString(task.assignee.id || task.assignee.userId),
        name: asString(task.assignee.name || task.assignee.fullName || task.assignee.email, "Developer"),
      }
    : null;

  const sprintObj = task?.sprint && typeof task.sprint === "object"
    ? {
        id: asString(task.sprint.id || task.sprint.sprintId),
        name: asString(task.sprint.name || task.sprint.title, "Sprint"),
        status: asString(task.sprint.status, "planning"),
      }
    : null;

  return {
    id: asString(task?.id || task?.taskId),
    title: asString(task?.title, "Untitled task"),
    type: asType(task?.type || task?.taskType || "task"),
    priority: asPriority(task?.priority),
    points: Math.max(0, asNumber(task?.storyPoints ?? task?.points ?? task?.estimate ?? 0, 0)),
    storyPoints: Math.max(0, asNumber(task?.storyPoints ?? task?.points ?? task?.estimate ?? 0, 0)),
    status: asString(task?.status, "todo"),
    assignee,
    sprintId: asString(task?.sprintId || sprintObj?.id),
    sprint: sprintObj,
    order: index + 1,
  };
}

function listItems(filters) {
  const statusFilter = asString(filters?.status || "").toLowerCase();
  const sprintIdFilter = asString(filters?.sprintId || "");
  const assigneeIdFilter = asString(filters?.assigneeId || "");
  const priorityFilter = asPriority(filters?.priority || "medium");
  const usePriorityFilter = Boolean(asString(filters?.priority || ""));

  return sortByOrder(backlogItems)
    .filter((item) => {
      if (statusFilter && asString(item.status).toLowerCase() !== statusFilter) return false;
      if (sprintIdFilter && asString(item.sprintId) !== sprintIdFilter) return false;
      if (assigneeIdFilter && asString(item.assigneeId) !== assigneeIdFilter) return false;
      if (usePriorityFilter && asPriority(item.priority) !== priorityFilter) return false;
      return true;
    })
    .map(toBacklogItem);
}

function updateItemById(itemId, changes) {
  const index = backlogItems.findIndex((item) => asString(item.id) === asString(itemId));
  if (index < 0) {
    throw new Error("Backlog item not found");
  }

  const current = backlogItems[index];
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    next.title = asString(changes.title, current.title);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "type")) {
    next.type = asType(changes.type);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    next.priority = asPriority(changes.priority);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "points")) {
    next.points = Math.max(0, asNumber(changes.points, current.points));
  }
  if (Object.prototype.hasOwnProperty.call(changes, "storyPoints")) {
    next.points = Math.max(0, asNumber(changes.storyPoints, current.points));
  }
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    next.status = asString(changes.status, current.status);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "assigneeId")) {
    next.assigneeId = asString(changes.assigneeId);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "sprintId")) {
    next.sprintId = asString(changes.sprintId);
  }

  backlogItems[index] = next;
  return toBacklogItem(next, index);
}

function reorderItems(orderedIds) {
  const seen = new Set();
  const normalized = [];

  for (const id of orderedIds) {
    const nextId = asString(id);
    if (!nextId || seen.has(nextId)) continue;
    if (!backlogItems.some((item) => asString(item.id) === nextId)) continue;
    seen.add(nextId);
    normalized.push(nextId);
  }

  for (const item of sortByOrder(backlogItems)) {
    const id = asString(item.id);
    if (!seen.has(id)) normalized.push(id);
  }

  backlogItems = normalized.map((id, index) => {
    const item = backlogItems.find((entry) => asString(entry.id) === id);
    return { ...item, order: index + 1 };
  });

  return { success: true };
}

function createItem(payload) {
  const id = `bl-${Date.now()}`;
  const title = asString(payload?.title, "Untitled task");
  const type = asType(payload?.type);
  const priority = asPriority(payload?.priority);
  const points = Math.max(0, asNumber(payload?.points, 0));

  const maxOrder = backlogItems.reduce((max, item) => Math.max(max, asNumber(item.order, 0)), 0);
  const item = {
    id,
    title,
    type,
    priority,
    points,
    assigneeId: "",
    sprintId: "",
    status: "todo",
    order: maxOrder + 1,
  };

  backlogItems.push(item);
  return toBacklogItem(item, backlogItems.length - 1);
}

async function listItemsFromGateway(filters) {
  const query = {
    projectId: asString(filters?.projectId),
    sprintId: asString(filters?.sprintId),
    status: asString(filters?.status),
    priority: asString(filters?.priority),
    assigneeId: asString(filters?.assigneeId),
  };

  const payload = await gatewayRequest("GET", "/api/v1/tasks", { query });
  const rows = firstArray(payload, ["items", "tasks"]);
  return rows.map((task, index) => toBacklogItemFromGateway(task, index));
}

async function createItemFromGateway(payload) {
  const body = {
    title: asString(payload?.title, "Untitled task"),
    type: asType(payload?.type),
    priority: asPriority(payload?.priority),
    storyPoints: Math.max(0, asNumber(payload?.storyPoints ?? payload?.points ?? 0, 0)),
    sprintId: asString(payload?.sprintId),
    projectId: asString(payload?.projectId),
  };

  const response = await gatewayRequest("POST", "/api/v1/tasks", { body });
  const item = response?.task || response?.item || response;
  return toBacklogItemFromGateway(item, 0);
}

async function updateItemFromGateway(id, changes) {
  const body = {
    ...changes,
  };

  if (Object.prototype.hasOwnProperty.call(body, "points") && !Object.prototype.hasOwnProperty.call(body, "storyPoints")) {
    body.storyPoints = body.points;
  }

  const response = await gatewayRequest("PATCH", `/api/v1/tasks/${encodeURIComponent(id)}`, { body });
  const item = response?.task || response?.item || response;
  return toBacklogItemFromGateway(item, 0);
}

async function deleteItemFromGateway(id) {
  await gatewayRequest("DELETE", `/api/v1/tasks/${encodeURIComponent(id)}`);
  return { success: true };
}

function registerBacklogIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.BACKLOG.GET_ITEMS, async (_event, payload) => {
    const filters = payload?.filters || {};
    try {
      return await listItemsFromGateway(filters);
    } catch {
      return listItems(filters);
    }
  });

  ipcMain.handle(CHANNELS.BACKLOG.CREATE_ITEM, async (_event, payload) => {
    if (!asString(payload?.title)) {
      throw new Error("title is required");
    }

    try {
      return await createItemFromGateway(payload || {});
    } catch {
      return createItem(payload || {});
    }
  });

  ipcMain.handle(CHANNELS.BACKLOG.UPDATE_ITEM, async (_event, payload) => {
    const id = asString(payload?.id);
    if (!id) {
      throw new Error("id is required");
    }

    const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : {};
    try {
      return await updateItemFromGateway(id, changes);
    } catch {
      return updateItemById(id, changes);
    }
  });

  ipcMain.handle(CHANNELS.BACKLOG.REORDER_ITEMS, async (_event, payload) => {
    const orderedIds = Array.isArray(payload?.orderedIds) ? payload.orderedIds : [];
    return reorderItems(orderedIds);
  });

  ipcMain.handle(CHANNELS.BACKLOG.ADD_TO_SPRINT, async (_event, payload) => {
    const itemId = asString(payload?.itemId);
    const sprintId = asString(payload?.sprintId);

    if (!itemId) throw new Error("itemId is required");
    if (!sprintId) throw new Error("sprintId is required");

    try {
      return await updateItemFromGateway(itemId, { sprintId });
    } catch {
      return updateItemById(itemId, { sprintId });
    }
  });

  ipcMain.handle(CHANNELS.BACKLOG.BULK_UPDATE, async (_event, payload) => {
    const ids = asArray(payload?.ids).map((id) => asString(id)).filter(Boolean);
    const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : {};

    try {
      const updated = await Promise.all(ids.map((id) => updateItemFromGateway(id, changes)));
      return updated;
    } catch {
      return ids.map((id) => updateItemById(id, changes));
    }
  });

  ipcMain.handle(CHANNELS.BACKLOG.DELETE_ITEM, async (_event, payload) => {
    const id = asString(payload?.id);
    if (!id) {
      throw new Error("id is required");
    }

    try {
      return await deleteItemFromGateway(id);
    } catch {
      const before = backlogItems.length;
      backlogItems = backlogItems.filter((item) => asString(item.id) !== id);
      return { success: backlogItems.length < before };
    }
  });

  ipcMain.handle(CHANNELS.BACKLOG.BULK_DELETE, async (_event, payload) => {
    const ids = asArray(payload?.ids).map((id) => asString(id)).filter(Boolean);

    try {
      await Promise.all(ids.map((id) => deleteItemFromGateway(id)));
      return { success: true };
    } catch {
      const idSet = new Set(ids);
      const before = backlogItems.length;
      backlogItems = backlogItems.filter((item) => !idSet.has(asString(item.id)));
      return { success: backlogItems.length < before };
    }
  });
}

module.exports = {
  registerBacklogIpcHandlers,
};
