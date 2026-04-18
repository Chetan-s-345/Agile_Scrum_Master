const CHANNELS = require("./channels");

const VALID_ROLES = new Set(["admin", "member", "viewer"]);

let users = [
  {
    id: "user-1",
    name: "Ava Patel",
    email: "ava.patel@agile.example",
    role: "admin",
    status: "active",
    active: true,
  },
  {
    id: "user-2",
    name: "Noah Kim",
    email: "noah.kim@agile.example",
    role: "member",
    status: "active",
    active: true,
  },
  {
    id: "user-3",
    name: "Mia Rivera",
    email: "mia.rivera@agile.example",
    role: "viewer",
    status: "inactive",
    active: false,
  },
  {
    id: "user-4",
    name: "Liam Chen",
    email: "liam.chen@agile.example",
    role: "member",
    status: "active",
    active: true,
  },
];

let featureFlags = [
  {
    id: "flag-1",
    key: "ai-standup-insights",
    name: "AI Standup Insights",
    enabled: true,
    description: "Enable AI-generated standup insights.",
  },
  {
    id: "flag-2",
    key: "predictive-risk-alerts",
    name: "Predictive Risk Alerts",
    enabled: false,
    description: "Enable predictive sprint risk alerts.",
  },
  {
    id: "flag-3",
    key: "auto-sprint-plan",
    name: "Auto Sprint Plan",
    enabled: true,
    description: "Enable AI-assisted sprint plan suggestions.",
  },
];

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function sanitizeUser(user) {
  return {
    id: String(user.id),
    name: String(user.name || ""),
    email: String(user.email || ""),
    role: VALID_ROLES.has(normalizeRole(user.role)) ? normalizeRole(user.role) : "viewer",
    status: String(user.status || (user.active ? "active" : "inactive")),
    active: Boolean(user.active),
  };
}

function createSeedAuditLogs() {
  const now = Date.now();
  const actors = ["system-admin", "ava.patel", "noah.kim", "automation-bot"];
  const actions = ["USER_ROLE_UPDATED", "FEATURE_FLAG_TOGGLED", "USER_REMOVED", "SETTINGS_UPDATED"];
  const targets = ["user:liam.chen", "flag:ai-standup-insights", "org:default", "user:mia.rivera"];
  const ips = ["10.10.0.15", "10.10.0.24", "10.10.0.31", "10.10.0.42"];

  return Array.from({ length: 60 }).map((_, index) => ({
    id: `audit-${index + 1}`,
    timestamp: toIso(now - index * 45 * 60 * 1000),
    actor: actors[index % actors.length],
    action: actions[index % actions.length],
    target: targets[index % targets.length],
    ipAddress: ips[index % ips.length],
  }));
}

let auditLogs = createSeedAuditLogs();

function prependAuditLog(entry) {
  const id = `audit-${auditLogs.length + 1}`;
  const next = {
    id,
    timestamp: toIso(new Date()),
    actor: String(entry.actor || "system-admin"),
    action: String(entry.action || "UNKNOWN"),
    target: String(entry.target || "unknown"),
    ipAddress: String(entry.ipAddress || "127.0.0.1"),
  };
  auditLogs = [next, ...auditLogs];
}

function parsePage(payload) {
  const page = Math.max(1, Number.parseInt(String(payload?.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(payload?.limit || "10"), 10) || 10));
  return { page, limit };
}

function registerAdminIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.ADMIN.GET_USERS, async () => {
    return users.map(sanitizeUser);
  });

  ipcMain.handle(CHANNELS.ADMIN.UPDATE_USER_ROLE, async (_event, payload) => {
    const userId = String(payload?.userId || "").trim();
    const role = normalizeRole(payload?.role);

    if (!userId) {
      throw new Error("userId is required");
    }
    if (!VALID_ROLES.has(role)) {
      throw new Error("role must be one of: admin, member, viewer");
    }

    const index = users.findIndex((item) => String(item.id) === userId);
    if (index === -1) {
      throw new Error("User not found");
    }

    users[index] = {
      ...users[index],
      role,
    };

    prependAuditLog({
      actor: "system-admin",
      action: "USER_ROLE_UPDATED",
      target: `user:${users[index].email || users[index].id}`,
      ipAddress: "127.0.0.1",
    });

    return sanitizeUser(users[index]);
  });

  ipcMain.handle(CHANNELS.ADMIN.REMOVE_USER, async (_event, payload) => {
    const userId = String(payload?.userId || "").trim();
    if (!userId) {
      throw new Error("userId is required");
    }

    const existing = users.find((item) => String(item.id) === userId);
    const nextUsers = users.filter((item) => String(item.id) !== userId);
    const success = nextUsers.length !== users.length;
    users = nextUsers;

    if (success) {
      prependAuditLog({
        actor: "system-admin",
        action: "USER_REMOVED",
        target: `user:${existing?.email || userId}`,
        ipAddress: "127.0.0.1",
      });
    }

    return { success };
  });

  ipcMain.handle(CHANNELS.ADMIN.GET_AUDIT_LOGS, async (_event, payload) => {
    const { page, limit } = parsePage(payload);
    const total = auditLogs.length;
    const offset = (page - 1) * limit;
    const logs = auditLogs.slice(offset, offset + limit).map((item) => ({ ...item }));

    return {
      logs,
      total,
    };
  });

  ipcMain.handle(CHANNELS.ADMIN.GET_FEATURE_FLAGS, async () => {
    return featureFlags.map((flag) => ({ ...flag }));
  });

  ipcMain.handle(CHANNELS.ADMIN.TOGGLE_FEATURE_FLAG, async (_event, payload) => {
    const flagId = String(payload?.flagId || "").trim();
    if (!flagId) {
      throw new Error("flagId is required");
    }

    const index = featureFlags.findIndex((flag) => String(flag.id) === flagId);
    if (index === -1) {
      throw new Error("Feature flag not found");
    }

    featureFlags[index] = {
      ...featureFlags[index],
      enabled: Boolean(payload?.enabled),
    };

    prependAuditLog({
      actor: "system-admin",
      action: "FEATURE_FLAG_TOGGLED",
      target: `flag:${featureFlags[index].key}`,
      ipAddress: "127.0.0.1",
    });

    return { ...featureFlags[index] };
  });
}

module.exports = {
  registerAdminIpcHandlers,
};
