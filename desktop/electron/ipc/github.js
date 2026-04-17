const CHANNELS = require("./channels");

let connectionStatus = {
  connected: true,
  org: "agile-scrum-labs",
  lastSynced: "2026-04-18T09:35:00.000Z",
};

let linkedRepos = [
  {
    id: "repo-1",
    name: "agile-scrum-master",
    fullName: "agile-scrum-labs/agile-scrum-master",
    visibility: "private",
    lastCommit: "2026-04-18T08:47:00.000Z",
    openPrsCount: 4,
    syncStatus: "synced",
  },
  {
    id: "repo-2",
    name: "sprint-insights",
    fullName: "agile-scrum-labs/sprint-insights",
    visibility: "public",
    lastCommit: "2026-04-18T07:22:00.000Z",
    openPrsCount: 2,
    syncStatus: "pending",
  },
  {
    id: "repo-3",
    name: "desktop-ipc-kit",
    fullName: "agile-scrum-labs/desktop-ipc-kit",
    visibility: "private",
    lastCommit: "2026-04-17T23:18:00.000Z",
    openPrsCount: 1,
    syncStatus: "synced",
  },
];

let recentPrs = [
  {
    id: "pr-901",
    number: 901,
    title: "Refactor board summary data selectors",
    author: "Ava Patel",
    status: "open",
    linkedTask: { id: "task-231", title: "Optimize summary calculations" },
    repo: "agile-scrum-master",
    createdAt: "2026-04-18T06:52:00.000Z",
    htmlUrl: "https://github.com/agile-scrum-labs/agile-scrum-master/pull/901",
  },
  {
    id: "pr-902",
    number: 902,
    title: "Add retry telemetry to sync queue",
    author: "Noah Kim",
    status: "merged",
    linkedTask: { id: "task-244", title: "Improve sync observability" },
    repo: "desktop-ipc-kit",
    createdAt: "2026-04-17T19:16:00.000Z",
    htmlUrl: "https://github.com/agile-scrum-labs/desktop-ipc-kit/pull/902",
  },
  {
    id: "pr-903",
    number: 903,
    title: "Fix blocked-state rendering in timeline",
    author: "Liam Chen",
    status: "open",
    linkedTask: { id: "task-255", title: "Timeline blocked-state polish" },
    repo: "agile-scrum-master",
    createdAt: "2026-04-17T15:40:00.000Z",
    htmlUrl: "https://github.com/agile-scrum-labs/agile-scrum-master/pull/903",
  },
  {
    id: "pr-904",
    number: 904,
    title: "Expand QA coverage for webhook retries",
    author: "Mia Rivera",
    status: "closed",
    linkedTask: { id: "task-267", title: "Webhook retry test matrix" },
    repo: "sprint-insights",
    createdAt: "2026-04-16T12:08:00.000Z",
    htmlUrl: "https://github.com/agile-scrum-labs/sprint-insights/pull/904",
  },
];

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function cloneConnectionStatus(status) {
  return {
    connected: Boolean(status?.connected),
    org: asString(status?.org),
    lastSynced: asString(status?.lastSynced),
  };
}

function cloneRepo(repo) {
  return {
    id: asString(repo?.id),
    name: asString(repo?.name),
    fullName: asString(repo?.fullName, asString(repo?.name)),
    visibility: asString(repo?.visibility, "private"),
    lastCommit: asString(repo?.lastCommit),
    openPrsCount: Math.max(0, Number(repo?.openPrsCount || 0)),
    syncStatus: asString(repo?.syncStatus, "synced"),
  };
}

function clonePr(pr) {
  return {
    id: asString(pr?.id),
    number: Math.max(0, Number(pr?.number || 0)),
    title: asString(pr?.title, "Untitled PR"),
    author: asString(pr?.author, "Unknown"),
    status: asString(pr?.status, "open"),
    linkedTask: pr?.linkedTask?.id
      ? {
          id: asString(pr.linkedTask.id),
          title: asString(pr.linkedTask.title, "Linked task"),
        }
      : null,
    repo: asString(pr?.repo),
    createdAt: asString(pr?.createdAt),
    htmlUrl: asString(pr?.htmlUrl),
  };
}

function registerGithubIpcHandlers(ipcMain) {
  ipcMain.handle(CHANNELS.GITHUB.GET_CONNECTION_STATUS, async () => {
    return cloneConnectionStatus(connectionStatus);
  });

  ipcMain.handle(CHANNELS.GITHUB.GET_LINKED_REPOS, async () => {
    return linkedRepos.map(cloneRepo);
  });

  ipcMain.handle(CHANNELS.GITHUB.GET_RECENT_PRS, async () => {
    return recentPrs.map(clonePr);
  });

  ipcMain.handle(CHANNELS.GITHUB.SYNC_NOW, async () => {
    const nowIso = new Date().toISOString();
    connectionStatus = {
      ...connectionStatus,
      connected: true,
      lastSynced: nowIso,
    };

    linkedRepos = linkedRepos.map((repo) => ({
      ...repo,
      syncStatus: "synced",
    }));

    return {
      success: true,
      synced: linkedRepos.length,
    };
  });
}

module.exports = {
  registerGithubIpcHandlers,
};
