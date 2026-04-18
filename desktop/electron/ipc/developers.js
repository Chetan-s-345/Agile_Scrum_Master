const CHANNELS = require("./channels");
const { gatewayRequest } = require("./gateway");

let developerProfiles = [
  {
    id: "dev-1",
    name: "Ava Patel",
    email: "ava.patel@agilescrum.app",
    role: "Frontend Engineer",
    team: "Platform",
    avatar: "AP",
    joinedDate: "2024-02-12",
    githubHandle: "avapatel",
    canEditProfile: true,
    skills: [
      { name: "React", proficiency: "Expert" },
      { name: "TypeScript", proficiency: "Advanced" },
    ],
  },
  {
    id: "dev-2",
    name: "Noah Kim",
    email: "noah.kim@agilescrum.app",
    role: "Backend Engineer",
    team: "Infrastructure",
    avatar: "NK",
    joinedDate: "2023-09-08",
    githubHandle: "noahkdev",
    canEditProfile: true,
    skills: [
      { name: "Node.js", proficiency: "Expert" },
      { name: "PostgreSQL", proficiency: "Advanced" },
    ],
  },
];

const developerStats = {
  "dev-1": {
    tasksCompletedAllTime: 128,
    currentSprintTasks: 4,
    avgStoryPointsPerSprint: 18,
    prMergeRate: 92,
  },
  "dev-2": {
    tasksCompletedAllTime: 141,
    currentSprintTasks: 3,
    avgStoryPointsPerSprint: 21,
    prMergeRate: 95,
  },
};

const currentTasksByDeveloper = {
  "dev-1": [
    { id: "task-101", title: "Polish dashboard empty states", status: "in_progress", priority: "medium", dueDate: "2026-04-20", storyPoints: 3 },
  ],
  "dev-2": [
    { id: "task-201", title: "Stabilize IPC validation", status: "in_progress", priority: "critical", dueDate: "2026-04-19", storyPoints: 8 },
  ],
};

const sprintHistoryByDeveloper = {
  "dev-1": [
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 20 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 17 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 21 },
  ],
  "dev-2": [
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 24 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 19 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 22 },
  ],
};

const invites = [];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function cloneSkill(skill) {
  return {
    name: asString(skill?.name, "General"),
    proficiency: asString(skill?.proficiency, "Intermediate"),
  };
}

function cloneProfile(profile) {
  return {
    id: asString(profile.id),
    name: asString(profile.name, "Developer"),
    email: asString(profile.email),
    role: asString(profile.role, "Engineer"),
    team: asString(profile.team, "General"),
    avatar: asString(profile.avatar).toUpperCase().slice(0, 2),
    joinedDate: asString(profile.joinedDate),
    githubHandle: asString(profile.githubHandle),
    canEditProfile: Boolean(profile.canEditProfile),
    skills: asArray(profile.skills).map(cloneSkill),
  };
}

function cloneStat(stats) {
  return {
    tasksCompletedAllTime: Math.max(0, asNumber(stats?.tasksCompletedAllTime, 0)),
    currentSprintTasks: Math.max(0, asNumber(stats?.currentSprintTasks, 0)),
    avgStoryPointsPerSprint: Math.max(0, asNumber(stats?.avgStoryPointsPerSprint, 0)),
    prMergeRate: Math.max(0, Math.min(100, asNumber(stats?.prMergeRate, 0))),
  };
}

function cloneTask(task) {
  return {
    id: asString(task?.id),
    title: asString(task?.title, "Untitled task"),
    status: asString(task?.status, "todo"),
    priority: asString(task?.priority, "medium"),
    dueDate: asString(task?.dueDate),
    storyPoints: Math.max(0, asNumber(task?.storyPoints, 0)),
  };
}

function cloneSprintHistory(item) {
  return {
    sprintId: asString(item?.sprintId),
    sprintName: asString(item?.sprintName, asString(item?.sprintId)),
    pointsDelivered: Math.max(0, asNumber(item?.pointsDelivered, 0)),
  };
}

function getProfileById(developerId) {
  return developerProfiles.find((profile) => asString(profile.id) === asString(developerId)) || null;
}

function getSummaryDeveloper(profile) {
  const profileId = asString(profile.id);
  const tasks = asArray(currentTasksByDeveloper[profileId]).map(cloneTask);
  const summaryStoryPoints = tasks.reduce((sum, task) => sum + Math.max(0, asNumber(task.storyPoints, 0)), 0);

  return {
    id: profileId,
    name: asString(profile.name, "Developer"),
    role: asString(profile.role, "Engineer"),
    team: asString(profile.team, "General"),
    avatar: asString(profile.avatar).toUpperCase().slice(0, 2),
    currentSprintTasks: tasks.length,
    storyPointsAssigned: summaryStoryPoints,
  };
}

function toSummaryFromGateway(row) {
  return {
    id: asString(row?.id || row?.developerId),
    name: asString(row?.name || row?.fullName || row?.email, "Developer"),
    role: asString(row?.role, "developer"),
    team: asString(row?.team, "General"),
    avatar: asString(row?.avatar || row?.initials || "DV").toUpperCase().slice(0, 2),
    currentSprintTasks: Math.max(0, asNumber(row?.currentSprintTasks, 0)),
    storyPointsAssigned: Math.max(0, asNumber(row?.storyPointsAssigned || row?.assignedPoints, 0)),
  };
}

function toProfileFromGateway(row) {
  const fullName = asString(row?.name || row?.fullName || row?.email, "Developer");
  return {
    id: asString(row?.id || row?.developerId),
    name: fullName,
    email: asString(row?.email),
    role: asString(row?.role, "developer"),
    team: asString(row?.team, "General"),
    avatar: asString(row?.avatar || fullName.slice(0, 2), "DV").toUpperCase().slice(0, 2),
    joinedDate: asString(row?.joinedDate || row?.createdAt),
    githubHandle: asString(row?.githubHandle || row?.githubUsername),
    canEditProfile: true,
    skills: asArray(row?.skills).map(cloneSkill),
  };
}

function toStatFromGateway(row) {
  return {
    tasksCompletedAllTime: Math.max(0, asNumber(row?.tasksCompletedAllTime || row?.tasksCompleted, 0)),
    currentSprintTasks: Math.max(0, asNumber(row?.currentSprintTasks, 0)),
    avgStoryPointsPerSprint: Math.max(0, asNumber(row?.avgStoryPointsPerSprint || row?.avgPointsPerSprint, 0)),
    prMergeRate: Math.max(0, Math.min(100, asNumber(row?.prMergeRate || row?.mergeRate, 0))),
  };
}

async function getAllFromGateway() {
  const payload = await gatewayRequest("GET", "/api/v1/developers");
  const rows = firstArray(payload, ["items", "developers"]);
  return rows.map(toSummaryFromGateway);
}

async function getByIdFromGateway(developerId) {
  const payload = await gatewayRequest("GET", `/api/v1/developers/${encodeURIComponent(developerId)}`);
  const row = payload?.developer || payload?.item || payload;
  return toProfileFromGateway(row);
}

async function getStatsFromGateway(developerId) {
  const payload = await gatewayRequest("GET", `/api/v1/developers/${encodeURIComponent(developerId)}/performance`);
  const row = payload?.stats || payload?.item || payload;
  return toStatFromGateway(row);
}

async function getCurrentTasksFromGateway(developerId) {
  const payload = await gatewayRequest("GET", "/api/v1/tasks", {
    query: {
      assigneeId: developerId,
    },
  });
  const rows = firstArray(payload, ["items", "tasks"]);
  return rows.map((task) => ({
    id: asString(task?.id || task?.taskId),
    title: asString(task?.title, "Untitled task"),
    status: asString(task?.status, "todo"),
    priority: asString(task?.priority, "medium"),
    dueDate: asString(task?.dueDate || task?.due_at),
    storyPoints: Math.max(0, asNumber(task?.storyPoints ?? task?.points ?? 0, 0)),
  }));
}

async function updateProfileInGateway(developerId, changes) {
  const payload = await gatewayRequest("PATCH", `/api/v1/developers/${encodeURIComponent(developerId)}`, {
    body: changes,
  });
  const row = payload?.developer || payload?.item || payload;
  return toProfileFromGateway(row);
}

function registerDevelopersIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.DEVELOPERS.GET_ALL, async () => {
    try {
      return await getAllFromGateway();
    } catch {
      return developerProfiles.map(getSummaryDeveloper);
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.SEARCH, async (_event, payload) => {
    const query = asString(payload?.query).toLowerCase();

    try {
      const all = await getAllFromGateway();
      if (!query) return all;
      return all.filter((profile) => JSON.stringify(profile).toLowerCase().includes(query));
    } catch {
      if (!query) return developerProfiles.map(getSummaryDeveloper);

      return developerProfiles
        .filter((profile) => {
          const haystack = [
            asString(profile.name),
            asString(profile.role),
            asString(profile.team),
            asString(profile.id),
            asString(profile.email),
            asString(profile.githubHandle),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
        .map(getSummaryDeveloper);
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.INVITE, async (_event, payload) => {
    const email = asString(payload?.email).toLowerCase();
    const role = asString(payload?.role, "developer");

    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

    try {
      const response = await gatewayRequest("POST", "/api/v1/org/members/invite", {
        body: { email, role },
      });
      const invitation = response?.invitation || response?.invite || response;
      return {
        success: true,
        inviteId: asString(invitation?.id || invitation?.inviteId || `inv-${Date.now()}`),
      };
    } catch {
      const inviteId = `inv-${Date.now()}`;
      invites.push({
        inviteId,
        email,
        role,
        createdAt: new Date().toISOString(),
      });

      return {
        success: true,
        inviteId,
      };
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_BY_ID, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    if (!developerId) throw new Error("developerId is required");

    try {
      return await getByIdFromGateway(developerId);
    } catch {
      const profile = getProfileById(developerId);
      if (!profile) throw new Error("Developer not found");
      return cloneProfile(profile);
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_STATS, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    if (!developerId) throw new Error("developerId is required");

    try {
      return await getStatsFromGateway(developerId);
    } catch {
      const profile = getProfileById(developerId);
      if (!profile) throw new Error("Developer not found");
      return cloneStat(developerStats[developerId] || {});
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_CURRENT_TASKS, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    if (!developerId) throw new Error("developerId is required");

    try {
      return await getCurrentTasksFromGateway(developerId);
    } catch {
      const profile = getProfileById(developerId);
      if (!profile) throw new Error("Developer not found");
      return asArray(currentTasksByDeveloper[developerId]).map(cloneTask);
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_SPRINT_HISTORY, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    const count = Math.max(1, Math.min(24, asNumber(payload?.count, 6)));

    if (!developerId) throw new Error("developerId is required");

    const profile = getProfileById(developerId);
    if (!profile) {
      try {
        const remoteProfile = await getByIdFromGateway(developerId);
        if (!remoteProfile?.id) throw new Error("Developer not found");
      } catch {
        throw new Error("Developer not found");
      }
    }

    const rows = asArray(sprintHistoryByDeveloper[developerId]).map(cloneSprintHistory);
    return rows.slice(Math.max(0, rows.length - count));
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.UPDATE_PROFILE, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : {};

    if (!developerId) throw new Error("developerId is required");

    try {
      return await updateProfileInGateway(developerId, changes);
    } catch {
      const index = developerProfiles.findIndex((profile) => asString(profile.id) === developerId);
      if (index < 0) throw new Error("Developer not found");

      const current = developerProfiles[index];
      const next = {
        ...current,
      };

      if (Object.prototype.hasOwnProperty.call(changes, "name")) {
        next.name = asString(changes.name, current.name);
      }
      if (Object.prototype.hasOwnProperty.call(changes, "email")) {
        next.email = asString(changes.email, current.email);
      }
      if (Object.prototype.hasOwnProperty.call(changes, "role")) {
        next.role = asString(changes.role, current.role);
      }
      if (Object.prototype.hasOwnProperty.call(changes, "joinedDate")) {
        next.joinedDate = asString(changes.joinedDate, current.joinedDate);
      }
      if (Object.prototype.hasOwnProperty.call(changes, "githubHandle")) {
        next.githubHandle = asString(changes.githubHandle, current.githubHandle);
      }
      if (Object.prototype.hasOwnProperty.call(changes, "skills")) {
        next.skills = asArray(changes.skills).map(cloneSkill);
      }

      developerProfiles[index] = next;
      return cloneProfile(next);
    }
  });
}

module.exports = {
  registerDevelopersIpcHandlers,
};
