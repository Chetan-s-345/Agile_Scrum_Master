const CHANNELS = require("./channels");

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
      { name: "UI Architecture", proficiency: "Advanced" },
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
      { name: "System Design", proficiency: "Advanced" },
    ],
  },
  {
    id: "dev-3",
    name: "Mia Rivera",
    email: "mia.rivera@agilescrum.app",
    role: "QA Engineer",
    team: "Quality",
    avatar: "MR",
    joinedDate: "2024-05-21",
    githubHandle: "miarivera",
    canEditProfile: true,
    skills: [
      { name: "Test Automation", proficiency: "Advanced" },
      { name: "Playwright", proficiency: "Advanced" },
      { name: "API Testing", proficiency: "Intermediate" },
    ],
  },
  {
    id: "dev-4",
    name: "Liam Chen",
    email: "liam.chen@agilescrum.app",
    role: "Full Stack Engineer",
    team: "Growth",
    avatar: "LC",
    joinedDate: "2022-11-03",
    githubHandle: "liamchen",
    canEditProfile: true,
    skills: [
      { name: "React", proficiency: "Advanced" },
      { name: "Node.js", proficiency: "Advanced" },
      { name: "DevOps", proficiency: "Intermediate" },
    ],
  },
  {
    id: "dev-5",
    name: "Emma Davis",
    email: "emma.davis@agilescrum.app",
    role: "Frontend Engineer",
    team: "Platform",
    avatar: "ED",
    joinedDate: "2024-08-14",
    githubHandle: "emmadavis",
    canEditProfile: true,
    skills: [
      { name: "Design Systems", proficiency: "Advanced" },
      { name: "Accessibility", proficiency: "Advanced" },
      { name: "TypeScript", proficiency: "Intermediate" },
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
  "dev-3": {
    tasksCompletedAllTime: 89,
    currentSprintTasks: 2,
    avgStoryPointsPerSprint: 11,
    prMergeRate: 90,
  },
  "dev-4": {
    tasksCompletedAllTime: 172,
    currentSprintTasks: 5,
    avgStoryPointsPerSprint: 24,
    prMergeRate: 88,
  },
  "dev-5": {
    tasksCompletedAllTime: 77,
    currentSprintTasks: 3,
    avgStoryPointsPerSprint: 14,
    prMergeRate: 91,
  },
};

const currentTasksByDeveloper = {
  "dev-1": [
    { id: "task-101", title: "Polish dashboard empty states", status: "in_progress", priority: "medium", dueDate: "2026-04-20", storyPoints: 3 },
    { id: "task-102", title: "Optimize sidebar render performance", status: "todo", priority: "high", dueDate: "2026-04-22", storyPoints: 5 },
    { id: "task-103", title: "Fix timeline drag edge case", status: "in_review", priority: "high", dueDate: "2026-04-19", storyPoints: 3 },
    { id: "task-104", title: "Refactor theme token mapping", status: "todo", priority: "low", dueDate: "2026-04-24", storyPoints: 2 },
  ],
  "dev-2": [
    { id: "task-201", title: "Stabilize IPC validation", status: "in_progress", priority: "critical", dueDate: "2026-04-19", storyPoints: 8 },
    { id: "task-202", title: "Add audit log aggregation", status: "todo", priority: "medium", dueDate: "2026-04-23", storyPoints: 5 },
    { id: "task-203", title: "Improve retry queue telemetry", status: "in_review", priority: "medium", dueDate: "2026-04-21", storyPoints: 3 },
  ],
  "dev-3": [
    { id: "task-301", title: "Expand regression suite for board pages", status: "in_progress", priority: "high", dueDate: "2026-04-20", storyPoints: 5 },
    { id: "task-302", title: "Automate webhook replay tests", status: "todo", priority: "medium", dueDate: "2026-04-25", storyPoints: 3 },
  ],
  "dev-4": [
    { id: "task-401", title: "Ship assignment heuristics v2", status: "in_progress", priority: "high", dueDate: "2026-04-22", storyPoints: 8 },
    { id: "task-402", title: "Implement release checklist automation", status: "todo", priority: "medium", dueDate: "2026-04-24", storyPoints: 5 },
    { id: "task-403", title: "Refine sprint summary chart UX", status: "in_review", priority: "low", dueDate: "2026-04-19", storyPoints: 3 },
    { id: "task-404", title: "Fix stale selection in table", status: "todo", priority: "low", dueDate: "2026-04-26", storyPoints: 2 },
    { id: "task-405", title: "Integrate keyboard shortcuts telemetry", status: "todo", priority: "medium", dueDate: "2026-04-27", storyPoints: 3 },
  ],
  "dev-5": [
    { id: "task-501", title: "Build profile skeleton states", status: "in_progress", priority: "medium", dueDate: "2026-04-20", storyPoints: 3 },
    { id: "task-502", title: "Improve dark mode contrast", status: "todo", priority: "low", dueDate: "2026-04-23", storyPoints: 2 },
    { id: "task-503", title: "Add keyboard nav for filters", status: "in_review", priority: "medium", dueDate: "2026-04-21", storyPoints: 3 },
  ],
};

const sprintHistoryByDeveloper = {
  "dev-1": [
    { sprintId: "sprint-37", sprintName: "Sprint 37", pointsDelivered: 16 },
    { sprintId: "sprint-38", sprintName: "Sprint 38", pointsDelivered: 18 },
    { sprintId: "sprint-39", sprintName: "Sprint 39", pointsDelivered: 19 },
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 20 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 17 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 21 },
  ],
  "dev-2": [
    { sprintId: "sprint-37", sprintName: "Sprint 37", pointsDelivered: 20 },
    { sprintId: "sprint-38", sprintName: "Sprint 38", pointsDelivered: 23 },
    { sprintId: "sprint-39", sprintName: "Sprint 39", pointsDelivered: 21 },
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 24 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 19 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 22 },
  ],
  "dev-3": [
    { sprintId: "sprint-37", sprintName: "Sprint 37", pointsDelivered: 9 },
    { sprintId: "sprint-38", sprintName: "Sprint 38", pointsDelivered: 11 },
    { sprintId: "sprint-39", sprintName: "Sprint 39", pointsDelivered: 10 },
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 12 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 13 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 11 },
  ],
  "dev-4": [
    { sprintId: "sprint-37", sprintName: "Sprint 37", pointsDelivered: 22 },
    { sprintId: "sprint-38", sprintName: "Sprint 38", pointsDelivered: 26 },
    { sprintId: "sprint-39", sprintName: "Sprint 39", pointsDelivered: 24 },
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 25 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 27 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 23 },
  ],
  "dev-5": [
    { sprintId: "sprint-37", sprintName: "Sprint 37", pointsDelivered: 12 },
    { sprintId: "sprint-38", sprintName: "Sprint 38", pointsDelivered: 13 },
    { sprintId: "sprint-39", sprintName: "Sprint 39", pointsDelivered: 15 },
    { sprintId: "sprint-40", sprintName: "Sprint 40", pointsDelivered: 14 },
    { sprintId: "sprint-41", sprintName: "Sprint 41", pointsDelivered: 16 },
    { sprintId: "sprint-42", sprintName: "Sprint 42", pointsDelivered: 14 },
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

function registerDevelopersIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.DEVELOPERS.GET_ALL, async () => {
    return developerProfiles.map(getSummaryDeveloper);
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.SEARCH, async (_event, payload) => {
    const query = asString(payload?.query).toLowerCase();
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
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.INVITE, async (_event, payload) => {
    const email = asString(payload?.email).toLowerCase();
    const role = asString(payload?.role, "Engineer");

    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

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
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_BY_ID, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    if (!developerId) throw new Error("developerId is required");

    const profile = getProfileById(developerId);
    if (!profile) throw new Error("Developer not found");
    return cloneProfile(profile);
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_STATS, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    if (!developerId) throw new Error("developerId is required");

    const profile = getProfileById(developerId);
    if (!profile) throw new Error("Developer not found");

    return cloneStat(developerStats[developerId] || {});
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_CURRENT_TASKS, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    if (!developerId) throw new Error("developerId is required");

    const profile = getProfileById(developerId);
    if (!profile) throw new Error("Developer not found");

    const tasks = asArray(currentTasksByDeveloper[developerId]).map(cloneTask);
    return tasks;
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_SPRINT_HISTORY, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    const count = Math.max(1, Math.min(24, asNumber(payload?.count, 6)));

    if (!developerId) throw new Error("developerId is required");
    const profile = getProfileById(developerId);
    if (!profile) throw new Error("Developer not found");

    const rows = asArray(sprintHistoryByDeveloper[developerId]).map(cloneSprintHistory);
    return rows.slice(Math.max(0, rows.length - count));
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.UPDATE_PROFILE, async (_event, payload) => {
    const developerId = asString(payload?.developerId);
    const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : {};

    if (!developerId) throw new Error("developerId is required");

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
  });
}

module.exports = {
  registerDevelopersIpcHandlers,
};
