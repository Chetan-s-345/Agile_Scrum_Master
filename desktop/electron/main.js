const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const CHANNELS = require("./ipc/channels");
const IPCResponse = require("./utils/ipc-response");
const { registerAuthIpcHandlers, processDesktopAuthCallback } = require("./ipc/auth");

const AUTH_PROTOCOL = "asmdesktop";
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;

function normalizeDeepLinkArg(value) {
  return String(value || "").trim().replace(/^"+|"+$/g, "");
}

function isAuthDeepLink(value) {
  const normalized = normalizeDeepLinkArg(value).toLowerCase();
  return normalized.startsWith(`${AUTH_PROTOCOL}://`);
}

const initialDeepLinks = process.argv.filter(isAuthDeepLink).map(normalizeDeepLinkArg);

if (!gotSingleInstanceLock) {
  app.quit();
}

app.setName("Agile Scrum Master Desktop");
if (process.platform === "win32") {
  app.setAppUserModelId("com.agilescrummaster.desktop");
}

function notifySessionUpdated(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHANNELS.EVENTS.SESSION_UPDATED, payload || { authenticated: false });
}

function handleDesktopCallback(rawUrl) {
  const result = processDesktopAuthCallback(rawUrl);
  if (result?.handled) {
    notifySessionUpdated({ authenticated: Boolean(result.authenticated) });
    return true;
  }
  return false;
}

app.on("second-instance", (_event, argv) => {
  const deepLink = argv.find(isAuthDeepLink);
  if (deepLink) {
    handleDesktopCallback(normalizeDeepLinkArg(deepLink));
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDesktopCallback(url);
});

function goalsDbPath() {
  return path.join(app.getPath("userData"), "goals.db.json");
}

function readGoals() {
  try {
    const filePath = goalsDbPath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGoals(goals) {
  const filePath = goalsDbPath();
  fs.writeFileSync(filePath, JSON.stringify(goals, null, 2), "utf8");
}

function toIntPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function computeGoalProgress(keyResults, fallback) {
  if (!Array.isArray(keyResults) || keyResults.length === 0) {
    return toIntPercent(fallback);
  }
  const weighted = keyResults.reduce((sum, item) => sum + toIntPercent(item.progress), 0);
  return toIntPercent(weighted / keyResults.length);
}

function normalizeGoalCreate(payload) {
  const keyResults = Array.isArray(payload.keyResults)
    ? payload.keyResults
        .map((item) => {
          if (typeof item === "string") {
            const text = item.trim();
            if (!text) return null;
            return { id: randomUUID(), title: text, progress: 0 };
          }
          if (!item || typeof item !== "object") return null;
          const title = String(item.title || item.name || "").trim();
          if (!title) return null;
          return {
            id: String(item.id || randomUUID()),
            title,
            progress: toIntPercent(item.progress)
          };
        })
        .filter(Boolean)
    : [];

  const now = new Date().toISOString();
  const progress = computeGoalProgress(keyResults, 0);

  return {
    id: randomUUID(),
    title: String(payload.title || "").trim(),
    description: payload.description ? String(payload.description) : "",
    ownerId: payload.ownerId ? String(payload.ownerId) : "",
    timeframe: payload.timeframe ? String(payload.timeframe) : "quarterly",
    status: "planned",
    priority: "medium",
    quarter: payload.timeframe ? String(payload.timeframe) : "",
    keyResults,
    progress,
    createdAt: now,
    updatedAt: now
  };
}

function registerGoalHandlers() {
  ipcMain.handle(CHANNELS.GOALS.GET_ALL, async (_event, payload = {}) => {
    try {
      const goals = readGoals();
      const timeframe = payload && payload.timeframe ? String(payload.timeframe) : "";
      const ownerId = payload && payload.ownerId ? String(payload.ownerId) : "";

      const filtered = goals.filter((goal) => {
        if (timeframe && String(goal.timeframe || "") !== timeframe) return false;
        if (ownerId && String(goal.ownerId || "") !== ownerId) return false;
        return true;
      });

      return IPCResponse.success(filtered);
    } catch (error) {
      return IPCResponse.internalError("Failed to load goals", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GOALS.CREATE, async (_event, payload = {}) => {
    try {
      const title = String(payload.title || "").trim();
      if (!title) {
        return IPCResponse.validation("title", "Title is required");
      }

      const goals = readGoals();
      const goal = normalizeGoalCreate(payload);
      goals.unshift(goal);
      writeGoals(goals);
      return IPCResponse.success(goal);
    } catch (error) {
      return IPCResponse.internalError("Failed to create goal", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GOALS.UPDATE, async (_event, payload = {}) => {
    try {
      const goalId = String(payload.goalId || "").trim();
      const changes = payload && typeof payload.changes === "object" ? payload.changes : null;
      if (!goalId) {
        return IPCResponse.validation("goalId", "goalId is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const goals = readGoals();
      const index = goals.findIndex((goal) => String(goal.id) === goalId);
      if (index < 0) {
        return IPCResponse.notFound("Goal");
      }

      const current = goals[index];
      const next = {
        ...current,
        ...changes,
        updatedAt: new Date().toISOString()
      };

      if (Object.prototype.hasOwnProperty.call(changes, "progress")) {
        next.progress = toIntPercent(changes.progress);
      }

      if (Array.isArray(next.keyResults)) {
        next.keyResults = next.keyResults.map((item) => {
          if (typeof item === "string") {
            return { id: randomUUID(), title: item, progress: 0 };
          }
          return {
            id: String(item.id || randomUUID()),
            title: String(item.title || item.name || "").trim(),
            progress: toIntPercent(item.progress)
          };
        });
        if (!Object.prototype.hasOwnProperty.call(changes, "progress")) {
          next.progress = computeGoalProgress(next.keyResults, current.progress);
        }
      }

      goals[index] = next;
      writeGoals(goals);
      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to update goal", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GOALS.UPDATE_PROGRESS, async (_event, payload = {}) => {
    try {
      const goalId = String(payload.goalId || "").trim();
      const keyResultId = String(payload.keyResultId || "").trim();
      const progress = toIntPercent(payload.progress);

      if (!goalId) {
        return IPCResponse.validation("goalId", "goalId is required");
      }

      const goals = readGoals();
      const index = goals.findIndex((goal) => String(goal.id) === goalId);
      if (index < 0) {
        return IPCResponse.notFound("Goal");
      }

      const goal = goals[index];

      if (keyResultId === "__overall__" || !keyResultId) {
        goal.progress = progress;
      } else {
        const keyResults = Array.isArray(goal.keyResults) ? goal.keyResults : [];
        const krIndex = keyResults.findIndex((item) => String(item.id) === keyResultId);
        if (krIndex < 0) {
          return IPCResponse.notFound("Key result");
        }
        keyResults[krIndex] = {
          ...keyResults[krIndex],
          progress
        };
        goal.keyResults = keyResults;
        goal.progress = computeGoalProgress(keyResults, goal.progress);
      }

      goal.updatedAt = new Date().toISOString();
      goals[index] = goal;
      writeGoals(goals);
      return IPCResponse.success(goal);
    } catch (error) {
      return IPCResponse.internalError("Failed to update goal progress", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GOALS.DELETE, async (_event, payload = {}) => {
    try {
      const goalId = String(payload.goalId || "").trim();
      if (!goalId) {
        return IPCResponse.validation("goalId", "goalId is required");
      }

      const goals = readGoals();
      const next = goals.filter((goal) => String(goal.id) !== goalId);
      const deleted = next.length !== goals.length;
      if (deleted) {
        writeGoals(next);
      }
      return IPCResponse.success({ success: deleted });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete goal", String(error));
    }
  });
}

function integrationsDbPath() {
  return path.join(app.getPath("userData"), "integrations.db.json");
}

function jiraMappingsDbPath() {
  return path.join(app.getPath("userData"), "jira.project-mappings.db.json");
}

function createWebhookSecret() {
  return randomUUID().replace(/-/g, "");
}

function baseIntegrationConfig(type) {
  const normalizedType = String(type || "").trim().toLowerCase();
  if (normalizedType === "github") {
    return {
      connected: false,
      connectedAccount: "",
      webhookUrl: "",
      webhookSecret: createWebhookSecret(),
      syncFrequency: "hourly",
      githubWebhookRepos: [],
      githubWebhookDeliveries: [],
      publicGatewayUrlConfigured: false,
      webhookConfigured: false,
      lastEventAt: null,
    };
  }
  if (normalizedType === "jira") {
    return {
      connected: false,
      connectedWorkspace: "",
      baseUrl: "",
      email: "",
      projectKey: "",
      boardId: null,
      storyPointsField: "",
      webhookUrl: "",
      webhookSecret: createWebhookSecret(),
      syncFrequency: "daily",
      syncStatus: {
        syncing: false,
        processed: 0,
        total: 0,
        message: null,
      },
      schedule: {
        enabled: false,
        projectKey: null,
        boardId: null,
        mode: "incremental",
        time: "09:00",
        timezone: "UTC",
      },
      webhookLogs: {
        lastEvent: null,
        failures: [],
      },
      totalSynced: 0,
      totalFailed: 0,
      pendingSync: 0,
      lastSyncAt: null,
      lastWebhookReceivedAt: null,
      lastWebhookEvent: null,
      syncError: null,
    };
  }
  if (normalizedType === "slack") {
    return {
      connected: false,
      connectedWorkspace: "",
      syncFrequency: "realtime",
      notificationChannels: {
        taskCreated: "#general",
        taskUpdated: "#general",
        sprintSummary: "#general",
      },
    };
  }
  return {
    connected: false,
    syncFrequency: "manual",
  };
}

function normalizeIntegrationConfig(type, configInput, connectedFallback = false) {
  const normalizedType = String(type || "").trim().toLowerCase();
  const defaults = baseIntegrationConfig(normalizedType);
  const input = configInput && typeof configInput === "object" ? configInput : {};
  const merged = {
    ...defaults,
    ...input,
  };

  if ((normalizedType === "jira" || normalizedType === "github") && !String(merged.webhookSecret || "").trim()) {
    merged.webhookSecret = createWebhookSecret();
  }

  if (normalizedType === "jira") {
    const webhookLogs = merged.webhookLogs && typeof merged.webhookLogs === "object" ? merged.webhookLogs : {};
    merged.webhookLogs = {
      lastEvent: webhookLogs.lastEvent || null,
      failures: Array.isArray(webhookLogs.failures) ? webhookLogs.failures : [],
    };
    const schedule = merged.schedule && typeof merged.schedule === "object" ? merged.schedule : {};
    merged.schedule = {
      ...defaults.schedule,
      ...schedule,
    };
    const syncStatus = merged.syncStatus && typeof merged.syncStatus === "object" ? merged.syncStatus : {};
    merged.syncStatus = {
      ...defaults.syncStatus,
      ...syncStatus,
    };
  }

  if (normalizedType === "slack") {
    merged.notificationChannels =
      merged.notificationChannels && typeof merged.notificationChannels === "object"
        ? merged.notificationChannels
        : defaults.notificationChannels;
  }

  const explicitConnected = typeof merged.connected === "boolean" ? merged.connected : null;
  merged.connected = explicitConnected == null ? Boolean(connectedFallback) : explicitConnected;
  return merged;
}

function readJiraProjectMappings() {
  try {
    const filePath = jiraMappingsDbPath();
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), "utf8");
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        const jiraProjectId = String(item?.jiraProjectId || "").trim();
        const internalProjectId = String(item?.internalProjectId || "").trim();
        if (!jiraProjectId || !internalProjectId) {
          return null;
        }
        return {
          id: String(item?.id || randomUUID()),
          jiraProjectId,
          internalProjectId,
          updatedAt: item?.updatedAt || new Date().toISOString(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeJiraProjectMappings(mappings) {
  fs.writeFileSync(jiraMappingsDbPath(), JSON.stringify(mappings, null, 2), "utf8");
}

function defaultIntegrations() {
  return [
    {
      id: "integration-github",
      type: "github",
      name: "GitHub",
      description: "Code repositories, pull requests, and issue linking.",
      logo: "GH",
      connected: false,
      config: baseIntegrationConfig("github"),
      lastSyncAt: null,
      settingsPath: "/settings/integrations"
    },
    {
      id: "integration-jira",
      type: "jira",
      name: "Jira",
      description: "Sprint sync, issues, and webhook event processing.",
      logo: "JI",
      connected: false,
      config: baseIntegrationConfig("jira"),
      lastSyncAt: null,
      settingsPath: "/settings/integrations"
    },
    {
      id: "integration-slack",
      type: "slack",
      name: "Slack",
      description: "Channel notifications and standup summaries.",
      logo: "SL",
      connected: false,
      config: baseIntegrationConfig("slack"),
      lastSyncAt: null,
      settingsPath: "/settings/integrations"
    },
    {
      id: "integration-notion",
      type: "notion",
      name: "Notion",
      description: "Documentation and sprint wiki sync.",
      logo: "NO",
      connected: false,
      config: baseIntegrationConfig("notion"),
      lastSyncAt: null,
      settingsPath: "/settings/integrations"
    },
    {
      id: "integration-linear",
      type: "linear",
      name: "Linear",
      description: "Issue sync and roadmap alignment.",
      logo: "LI",
      connected: false,
      config: baseIntegrationConfig("linear"),
      lastSyncAt: null,
      settingsPath: "/settings/integrations"
    }
  ];
}

function readIntegrations() {
  try {
    const filePath = integrationsDbPath();
    if (!fs.existsSync(filePath)) {
      const seeded = defaultIntegrations();
      fs.writeFileSync(filePath, JSON.stringify(seeded, null, 2), "utf8");
      return seeded;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      return defaultIntegrations();
    }
    const byType = new Map(parsed.map((item) => [String(item.type || ""), item]));
    return defaultIntegrations().map((seed) => {
      const existing = byType.get(seed.type);
      const merged = existing ? { ...seed, ...existing } : seed;
      return {
        ...merged,
        config: normalizeIntegrationConfig(merged.type, merged.config, merged.connected),
      };
    });
  } catch {
    return defaultIntegrations();
  }
}

function writeIntegrations(integrations) {
  fs.writeFileSync(integrationsDbPath(), JSON.stringify(integrations, null, 2), "utf8");
}

function registerIntegrationHandlers() {
  ipcMain.handle(CHANNELS.INTEGRATIONS.GET_ALL, async () => {
    try {
      const integrations = readIntegrations();
      return IPCResponse.success(integrations);
    } catch (error) {
      return IPCResponse.internalError("Failed to load integrations", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.CONNECT, async (_event, payload = {}) => {
    try {
      const type = String(payload.type || "").trim().toLowerCase();
      if (!type) {
        return IPCResponse.validation("type", "type is required");
      }

      const integrations = readIntegrations();
      const index = integrations.findIndex((item) => String(item.type) === type);
      if (index < 0) {
        return IPCResponse.notFound("Integration");
      }

      const integration = {
        ...integrations[index],
        connected: true,
        credentials: payload.credentials && typeof payload.credentials === "object" ? payload.credentials : {},
        config: normalizeIntegrationConfig(
          type,
          {
            ...integrations[index].config,
            ...(payload.config && typeof payload.config === "object" ? payload.config : {}),
            connected: true,
          },
          true
        ),
        updatedAt: new Date().toISOString()
      };
      integrations[index] = integration;
      writeIntegrations(integrations);

      return IPCResponse.success({ success: true, integration });
    } catch (error) {
      return IPCResponse.internalError("Failed to connect integration", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.DISCONNECT, async (_event, payload = {}) => {
    try {
      const integrationId = String(payload.integrationId || "").trim();
      if (!integrationId) {
        return IPCResponse.validation("integrationId", "integrationId is required");
      }

      const integrations = readIntegrations();
      const index = integrations.findIndex((item) => String(item.id) === integrationId);
      if (index < 0) {
        return IPCResponse.notFound("Integration");
      }

      integrations[index] = {
        ...integrations[index],
        connected: false,
        config: normalizeIntegrationConfig(
          integrations[index].type,
          {
            ...integrations[index].config,
            connected: false,
          },
          false
        ),
        lastSyncAt: null,
        updatedAt: new Date().toISOString()
      };
      writeIntegrations(integrations);

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to disconnect integration", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.SYNC_NOW, async (_event, payload = {}) => {
    try {
      const integrationId = String(payload.integrationId || "").trim();
      if (!integrationId) {
        return IPCResponse.validation("integrationId", "integrationId is required");
      }

      const integrations = readIntegrations();
      const index = integrations.findIndex((item) => String(item.id) === integrationId);
      if (index < 0) {
        return IPCResponse.notFound("Integration");
      }

      if (!integrations[index].connected) {
        return IPCResponse.success({ success: false });
      }

      integrations[index] = {
        ...integrations[index],
        config: normalizeIntegrationConfig(
          integrations[index].type,
          {
            ...integrations[index].config,
            lastSyncAt: new Date().toISOString(),
          },
          integrations[index].connected
        ),
        lastSyncAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      writeIntegrations(integrations);

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to run integration sync", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.GET_CONFIG, async (_event, payload = {}) => {
    try {
      const type = String(payload.type || "").trim().toLowerCase();
      if (!type) {
        return IPCResponse.validation("type", "type is required");
      }

      const integrations = readIntegrations();
      const integration = integrations.find((item) => String(item.type || "") === type);
      if (!integration) {
        return IPCResponse.notFound("Integration config");
      }

      const config = normalizeIntegrationConfig(type, integration.config, integration.connected);
      return IPCResponse.success(config);
    } catch (error) {
      return IPCResponse.internalError("Failed to load integration config", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.UPDATE_CONFIG, async (_event, payload = {}) => {
    try {
      const type = String(payload.type || "").trim().toLowerCase();
      if (!type) {
        return IPCResponse.validation("type", "type is required");
      }
      if (!payload.config || typeof payload.config !== "object") {
        return IPCResponse.validation("config", "config must be an object");
      }

      const integrations = readIntegrations();
      const index = integrations.findIndex((item) => String(item.type || "") === type);
      if (index < 0) {
        return IPCResponse.notFound("Integration config");
      }

      const mergedConfig = normalizeIntegrationConfig(
        type,
        {
          ...integrations[index].config,
          ...payload.config,
        },
        integrations[index].connected
      );

      integrations[index] = {
        ...integrations[index],
        connected: Boolean(mergedConfig.connected),
        config: mergedConfig,
        updatedAt: new Date().toISOString(),
      };

      if (type === "jira" && Array.isArray(payload.config.projectMappings)) {
        const nextMappings = payload.config.projectMappings
          .map((item) => ({
            id: String(item?.id || randomUUID()),
            jiraProjectId: String(item?.jiraProjectId || "").trim(),
            internalProjectId: String(item?.internalProjectId || "").trim(),
            updatedAt: new Date().toISOString(),
          }))
          .filter((item) => item.jiraProjectId && item.internalProjectId);
        writeJiraProjectMappings(nextMappings);
      }

      writeIntegrations(integrations);
      return IPCResponse.success(mergedConfig);
    } catch (error) {
      return IPCResponse.internalError("Failed to update integration config", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.REGENERATE_WEBHOOK_SECRET, async (_event, payload = {}) => {
    try {
      const type = String(payload.type || "").trim().toLowerCase();
      if (!type) {
        return IPCResponse.validation("type", "type is required");
      }

      const integrations = readIntegrations();
      const index = integrations.findIndex((item) => String(item.type || "") === type);
      if (index < 0) {
        return IPCResponse.notFound("Integration config");
      }

      const secret = createWebhookSecret();
      const nextConfig = normalizeIntegrationConfig(
        type,
        {
          ...integrations[index].config,
          webhookSecret: secret,
        },
        integrations[index].connected
      );

      integrations[index] = {
        ...integrations[index],
        config: nextConfig,
        updatedAt: new Date().toISOString(),
      };
      writeIntegrations(integrations);

      return IPCResponse.success({ secret });
    } catch (error) {
      return IPCResponse.internalError("Failed to regenerate webhook secret", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.GET_JIRA_PROJECT_MAPPINGS, async () => {
    try {
      return IPCResponse.success(readJiraProjectMappings());
    } catch (error) {
      return IPCResponse.internalError("Failed to load Jira project mappings", String(error));
    }
  });

  ipcMain.handle(CHANNELS.INTEGRATIONS.SAVE_JIRA_MAPPING, async (_event, payload = {}) => {
    try {
      const jiraProjectId = String(payload.jiraProjectId || "").trim();
      const internalProjectId = String(payload.internalProjectId || "").trim();

      if (!jiraProjectId) {
        return IPCResponse.validation("jiraProjectId", "jiraProjectId is required");
      }
      if (!internalProjectId) {
        return IPCResponse.validation("internalProjectId", "internalProjectId is required");
      }

      const mappings = readJiraProjectMappings();
      const index = mappings.findIndex((item) => String(item.jiraProjectId) === jiraProjectId);
      const next = {
        id: index >= 0 ? String(mappings[index].id) : randomUUID(),
        jiraProjectId,
        internalProjectId,
        updatedAt: new Date().toISOString(),
      };

      if (index >= 0) {
        mappings[index] = next;
      } else {
        mappings.push(next);
      }

      writeJiraProjectMappings(mappings);
      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to save Jira project mapping", String(error));
    }
  });
}

function githubReposDbPath() {
  return path.join(app.getPath("userData"), "github.repos.db.json");
}

function defaultGithubRepoData() {
  const now = new Date().toISOString();
  return {
    availableRepos: [
      {
        id: "gh-repo-1",
        name: "agile-scrum-master",
        fullName: "agile-org/agile-scrum-master",
        private: true,
        language: "TypeScript",
        defaultBranch: "main",
        updatedAt: now,
        hasWebhook: true,
        openPRs: 4
      },
      {
        id: "gh-repo-2",
        name: "product-portal",
        fullName: "agile-org/product-portal",
        private: false,
        language: "JavaScript",
        defaultBranch: "main",
        updatedAt: now,
        hasWebhook: false,
        openPRs: 2
      },
      {
        id: "gh-repo-3",
        name: "platform-api",
        fullName: "agile-org/platform-api",
        private: true,
        language: "Go",
        defaultBranch: "main",
        updatedAt: now,
        hasWebhook: false,
        openPRs: 1
      },
      {
        id: "gh-repo-4",
        name: "mobile-client",
        fullName: "agile-org/mobile-client",
        private: false,
        language: "Rust",
        defaultBranch: "develop",
        updatedAt: now,
        hasWebhook: false,
        openPRs: 0
      }
    ],
    linkedRepos: [
      {
        repoId: "agile-org/agile-scrum-master",
        enabled: true,
        projectId: "agile-scrum-master",
        linkedAt: now,
        openPRs: 4
      }
    ]
  };
}

function readGithubRepoData() {
  try {
    const filePath = githubReposDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultGithubRepoData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const base = defaultGithubRepoData();
    return {
      availableRepos: Array.isArray(parsed?.availableRepos) ? parsed.availableRepos : base.availableRepos,
      linkedRepos: Array.isArray(parsed?.linkedRepos) ? parsed.linkedRepos : base.linkedRepos
    };
  } catch {
    return defaultGithubRepoData();
  }
}

function writeGithubRepoData(data) {
  fs.writeFileSync(githubReposDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function toRepoKey(repo) {
  if (!repo || typeof repo !== "object") return "";
  return String(repo.fullName || repo.id || "").trim();
}

function applyToggleState(data, repoId, enabled) {
  const normalizedId = String(repoId || "").trim();
  if (!normalizedId) return null;

  const now = new Date().toISOString();
  const repoIndex = data.availableRepos.findIndex((repo) => {
    const key = toRepoKey(repo);
    return key === normalizedId || String(repo.id || "") === normalizedId;
  });

  if (repoIndex >= 0) {
    data.availableRepos[repoIndex] = {
      ...data.availableRepos[repoIndex],
      hasWebhook: Boolean(enabled),
      updatedAt: now
    };
  }

  const linkedIndex = data.linkedRepos.findIndex((entry) => String(entry.repoId || "") === normalizedId);
  const baseEntry = {
    repoId: normalizedId,
    enabled: Boolean(enabled),
    projectId: null,
    linkedAt: now,
    openPRs: 0
  };

  if (linkedIndex >= 0) {
    data.linkedRepos[linkedIndex] = {
      ...data.linkedRepos[linkedIndex],
      enabled: Boolean(enabled),
      updatedAt: now
    };
    return data.linkedRepos[linkedIndex];
  }

  data.linkedRepos.push(baseEntry);
  return baseEntry;
}

function registerGithubRepoHandlers() {
  ipcMain.handle(CHANNELS.GITHUB.GET_AVAILABLE_REPOS, async (_event, payload = {}) => {
    try {
      const data = readGithubRepoData();
      const query = String(payload.query || "").trim().toLowerCase();

      const linkedByRepoId = new Map(
        data.linkedRepos.map((entry) => [String(entry.repoId || ""), Boolean(entry.enabled)])
      );

      const repos = data.availableRepos
        .map((repo) => {
          const repoId = toRepoKey(repo);
          return {
            ...repo,
            hasWebhook: linkedByRepoId.has(repoId) ? linkedByRepoId.get(repoId) : Boolean(repo.hasWebhook)
          };
        })
        .filter((repo) => {
          if (!query) return true;
          const name = String(repo.name || "").toLowerCase();
          const fullName = String(repo.fullName || "").toLowerCase();
          const language = String(repo.language || "").toLowerCase();
          return name.includes(query) || fullName.includes(query) || language.includes(query);
        });

      return IPCResponse.success(repos);
    } catch (error) {
      return IPCResponse.internalError("Failed to load available GitHub repositories", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GITHUB.GET_LINKED_REPOS, async () => {
    try {
      const data = readGithubRepoData();
      return IPCResponse.success(data.linkedRepos);
    } catch (error) {
      return IPCResponse.internalError("Failed to load linked GitHub repositories", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GITHUB.TOGGLE_REPO_SYNC, async (_event, payload = {}) => {
    try {
      const repoId = String(payload.repoId || "").trim();
      if (!repoId) {
        return IPCResponse.validation("repoId", "repoId is required");
      }

      const enabled = Boolean(payload.enabled);
      const data = readGithubRepoData();
      const updated = applyToggleState(data, repoId, enabled);
      writeGithubRepoData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to toggle repository sync", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GITHUB.LINK_REPO_TO_PROJECT, async (_event, payload = {}) => {
    try {
      const repoId = String(payload.repoId || "").trim();
      const projectId = String(payload.projectId || "").trim();

      if (!repoId) {
        return IPCResponse.validation("repoId", "repoId is required");
      }
      if (!projectId) {
        return IPCResponse.validation("projectId", "projectId is required");
      }

      const data = readGithubRepoData();
      const linked = applyToggleState(data, repoId, true);
      if (linked) {
        linked.projectId = projectId;
        linked.updatedAt = new Date().toISOString();
      }

      writeGithubRepoData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to link repository to project", String(error));
    }
  });

  ipcMain.handle(CHANNELS.GITHUB.BULK_TOGGLE, async (_event, payload = {}) => {
    try {
      const repoIds = Array.isArray(payload.repoIds) ? payload.repoIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
      if (repoIds.length === 0) {
        return IPCResponse.validation("repoIds", "repoIds must contain at least one repository id");
      }

      const enabled = Boolean(payload.enabled);
      const data = readGithubRepoData();
      const updated = repoIds.map((repoId) => applyToggleState(data, repoId, enabled)).filter(Boolean);
      writeGithubRepoData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to bulk toggle repository sync", String(error));
    }
  });
}

function monitoringDbPath() {
  return path.join(app.getPath("userData"), "monitoring.db.json");
}

function defaultMonitoringData() {
  const now = new Date();
  const nowIso = now.toISOString();
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000).toISOString();

  return {
    healthStatus: [
      { id: "api", service: "API Server", status: "Healthy", latencyMs: 84, lastCheckedAt: nowIso },
      { id: "database", service: "Database", status: "Healthy", latencyMs: 31, lastCheckedAt: nowIso },
      { id: "jobs", service: "Background Jobs", status: "Degraded", latencyMs: 212, lastCheckedAt: nowIso },
      { id: "webhooks", service: "Webhook Queue", status: "Healthy", latencyMs: 58, lastCheckedAt: nowIso }
    ],
    errorLogs: [
      {
        id: "err-1",
        timestamp: twoMinutesAgo,
        service: "Background Jobs",
        message: "Retry worker lag exceeded threshold",
        severity: "warning",
        status: "open"
      },
      {
        id: "err-2",
        timestamp: sixMinutesAgo,
        service: "Webhook Queue",
        message: "GitHub delivery retried after transient 502",
        severity: "info",
        status: "resolved"
      }
    ],
    webhookDlq: [
      {
        id: "dlq-1",
        source: "github",
        event_type: "pull_request",
        payload: { action: "opened", repository: "agile-org/agile-scrum-master" },
        processed: false,
        processed_at: null,
        processing_error: "Upstream timeout while processing webhook",
        retry_count: 3,
        max_retries: 3,
        next_retry_at: null,
        dlq: true,
        created_at: twoMinutesAgo
      }
    ],
    jiraSyncLogs: [
      {
        id: "jira-sync-1",
        timestamp: nowIso,
        action: "task_update",
        taskId: "SCRUM-77F621",
        jiraIssueKey: "ASM-142",
        status: "success",
        errorMessage: null,
        requestPayload: { status: "in_progress" },
        responsePayload: { ok: true }
      },
      {
        id: "jira-sync-2",
        timestamp: twoMinutesAgo,
        action: "comment_create",
        taskId: "SCRUM-15997C",
        jiraIssueKey: "ASM-155",
        status: "failed",
        errorMessage: "Jira API rate limit reached",
        requestPayload: { text: "Working on implementation" },
        responsePayload: { status: 429 }
      }
    ]
  };
}

function readMonitoringData() {
  try {
    const filePath = monitoringDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultMonitoringData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultMonitoringData();
    return {
      healthStatus: Array.isArray(parsed?.healthStatus) ? parsed.healthStatus : defaults.healthStatus,
      errorLogs: Array.isArray(parsed?.errorLogs) ? parsed.errorLogs : defaults.errorLogs,
      webhookDlq: Array.isArray(parsed?.webhookDlq) ? parsed.webhookDlq : defaults.webhookDlq,
      jiraSyncLogs: Array.isArray(parsed?.jiraSyncLogs) ? parsed.jiraSyncLogs : defaults.jiraSyncLogs
    };
  } catch {
    return defaultMonitoringData();
  }
}

function writeMonitoringData(data) {
  fs.writeFileSync(monitoringDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function registerMonitoringHandlers() {
  ipcMain.handle(CHANNELS.MONITORING.GET_HEALTH_STATUS, async () => {
    try {
      const data = readMonitoringData();
      const next = data.healthStatus.map((item) => ({
        ...item,
        lastCheckedAt: new Date().toISOString()
      }));
      data.healthStatus = next;
      writeMonitoringData(data);
      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to load service health status", String(error));
    }
  });

  ipcMain.handle(CHANNELS.MONITORING.GET_ERROR_LOGS, async (_event, payload = {}) => {
    try {
      const data = readMonitoringData();
      const limit = Math.max(1, Math.min(500, Number(payload.limit || 50)));
      const severity = String(payload.severity || "").trim().toLowerCase();

      const filtered = data.errorLogs
        .filter((entry) => {
          if (!severity) return true;
          return String(entry.severity || "").toLowerCase() === severity;
        })
        .sort((a, b) => new Date(String(b.timestamp || 0)).getTime() - new Date(String(a.timestamp || 0)).getTime())
        .slice(0, limit);

      return IPCResponse.success(filtered);
    } catch (error) {
      return IPCResponse.internalError("Failed to load monitoring error logs", String(error));
    }
  });

  ipcMain.handle(CHANNELS.MONITORING.GET_WEBHOOK_DLQ, async () => {
    try {
      const data = readMonitoringData();
      return IPCResponse.success(data.webhookDlq);
    } catch (error) {
      return IPCResponse.internalError("Failed to load webhook DLQ", String(error));
    }
  });

  ipcMain.handle(CHANNELS.MONITORING.RETRY_WEBHOOK, async (_event, payload = {}) => {
    try {
      const webhookId = String(payload.webhookId || "").trim();
      if (!webhookId) {
        return IPCResponse.validation("webhookId", "webhookId is required");
      }

      const data = readMonitoringData();
      const index = data.webhookDlq.findIndex((item) => String(item.id) === webhookId);
      if (index < 0) {
        return IPCResponse.notFound("Webhook DLQ item");
      }

      const item = data.webhookDlq[index];
      item.processed = true;
      item.processed_at = new Date().toISOString();
      item.processing_error = null;
      item.dlq = false;
      item.retry_count = Math.min(Number(item.max_retries || 0), Number(item.retry_count || 0) + 1);

      data.webhookDlq.splice(index, 1);
      writeMonitoringData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to retry webhook", String(error));
    }
  });

  ipcMain.handle(CHANNELS.MONITORING.GET_JIRA_SYNC_LOGS, async () => {
    try {
      const data = readMonitoringData();
      const sorted = [...data.jiraSyncLogs].sort(
        (a, b) => new Date(String(b.timestamp || 0)).getTime() - new Date(String(a.timestamp || 0)).getTime()
      );
      return IPCResponse.success(sorted);
    } catch (error) {
      return IPCResponse.internalError("Failed to load Jira sync logs", String(error));
    }
  });
}

function onboardingDbPath() {
  return path.join(app.getPath("userData"), "onboarding.db.json");
}

function defaultOnboardingSteps() {
  return [
    {
      id: "create-organization",
      title: "Create Organization",
      description: "Set up your organization profile and workspace settings.",
      status: "pending",
      actionLabel: "Create"
    },
    {
      id: "invite-team",
      title: "Invite Team",
      description: "Invite teammates and assign initial roles.",
      status: "pending",
      actionLabel: "Invite"
    },
    {
      id: "connect-github",
      title: "Connect GitHub",
      description: "Authorize GitHub to sync repositories and PR activity.",
      status: "pending",
      actionLabel: "Connect"
    },
    {
      id: "create-first-project",
      title: "Create First Project",
      description: "Create your first project and configure basic metadata.",
      status: "pending",
      actionLabel: "Create"
    },
    {
      id: "create-first-sprint",
      title: "Create First Sprint",
      description: "Create a sprint and add backlog items to get started.",
      status: "pending",
      actionLabel: "Create"
    }
  ];
}

function readOnboardingData() {
  try {
    const filePath = onboardingDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = { steps: defaultOnboardingSteps() };
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const seedSteps = defaultOnboardingSteps();
    const storedSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];

    const byId = new Map(storedSteps.map((step) => [String(step.id || ""), step]));
    return {
      steps: seedSteps.map((seed) => {
        const existing = byId.get(seed.id);
        return existing ? { ...seed, ...existing } : seed;
      })
    };
  } catch {
    return { steps: defaultOnboardingSteps() };
  }
}

function writeOnboardingData(data) {
  fs.writeFileSync(onboardingDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function registerOnboardingHandlers() {
  ipcMain.handle(CHANNELS.ONBOARDING.GET_STATUS, async () => {
    try {
      const data = readOnboardingData();
      const completedCount = data.steps.filter((step) => String(step.status) === "completed").length;
      return IPCResponse.success({ steps: data.steps, completedCount });
    } catch (error) {
      return IPCResponse.internalError("Failed to load onboarding status", String(error));
    }
  });

  ipcMain.handle(CHANNELS.ONBOARDING.MARK_STEP_COMPLETE, async (_event, payload = {}) => {
    try {
      const stepId = String(payload.stepId || "").trim();
      if (!stepId) {
        return IPCResponse.validation("stepId", "stepId is required");
      }

      const data = readOnboardingData();
      const index = data.steps.findIndex((step) => String(step.id) === stepId);
      if (index < 0) {
        return IPCResponse.notFound("Onboarding step");
      }

      const updatedStep = {
        ...data.steps[index],
        status: "completed",
        updatedAt: new Date().toISOString()
      };

      data.steps[index] = updatedStep;
      writeOnboardingData(data);
      return IPCResponse.success(updatedStep);
    } catch (error) {
      return IPCResponse.internalError("Failed to complete onboarding step", String(error));
    }
  });

  ipcMain.handle(CHANNELS.ONBOARDING.SKIP_STEP, async (_event, payload = {}) => {
    try {
      const stepId = String(payload.stepId || "").trim();
      if (!stepId) {
        return IPCResponse.validation("stepId", "stepId is required");
      }

      const data = readOnboardingData();
      const index = data.steps.findIndex((step) => String(step.id) === stepId);
      if (index < 0) {
        return IPCResponse.notFound("Onboarding step");
      }

      const updatedStep = {
        ...data.steps[index],
        status: "skipped",
        updatedAt: new Date().toISOString()
      };

      data.steps[index] = updatedStep;
      writeOnboardingData(data);
      return IPCResponse.success(updatedStep);
    } catch (error) {
      return IPCResponse.internalError("Failed to skip onboarding step", String(error));
    }
  });

  ipcMain.handle(CHANNELS.ONBOARDING.RESET, async () => {
    try {
      const data = { steps: defaultOnboardingSteps() };
      writeOnboardingData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to reset onboarding", String(error));
    }
  });
}

function profileDbPath() {
  return path.join(app.getPath("userData"), "profile.db.json");
}

function defaultProfileData() {
  return {
    userProfile: {
      id: "user-1",
      name: "Demo User",
      email: "demo@agilescrummaster.dev",
      role: "member",
      bio: "Scrum practitioner focused on team flow and delivery quality.",
      timezone: "UTC",
      githubUsername: "demo-user",
      slack: "@demo-user",
      avatarUrl: null,
      notifications: {
        emailDailyDigest: true,
        sprintAlerts: true,
        standupReminders: true
      }
    },
    activityStats: {
      tasksCompleted: 42,
      prsReviewed: 17,
      standupsAttended: 29
    },
    passwordHashHint: "desktop-local"
  };
}

function readProfileData() {
  try {
    const filePath = profileDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultProfileData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultProfileData();
    return {
      userProfile: {
        ...defaults.userProfile,
        ...(parsed?.userProfile && typeof parsed.userProfile === "object" ? parsed.userProfile : {})
      },
      activityStats: {
        ...defaults.activityStats,
        ...(parsed?.activityStats && typeof parsed.activityStats === "object" ? parsed.activityStats : {})
      },
      passwordHashHint: parsed?.passwordHashHint || defaults.passwordHashHint
    };
  } catch {
    return defaultProfileData();
  }
}

function writeProfileData(data) {
  fs.writeFileSync(profileDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function registerProfileHandlers() {
  ipcMain.handle(CHANNELS.PROFILE.GET_CURRENT, async () => {
    try {
      const data = readProfileData();
      return IPCResponse.success(data.userProfile);
    } catch (error) {
      return IPCResponse.internalError("Failed to load profile", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.UPDATE, async (_event, payload = {}) => {
    try {
      const data = readProfileData();
      const changes = payload && typeof payload === "object" ? payload : {};

      data.userProfile = {
        ...data.userProfile,
        name: String(changes.name || data.userProfile.name),
        bio: String(changes.bio || data.userProfile.bio || ""),
        timezone: String(changes.timezone || data.userProfile.timezone || "UTC"),
        notifications:
          changes.notifications && typeof changes.notifications === "object"
            ? { ...data.userProfile.notifications, ...changes.notifications }
            : data.userProfile.notifications,
        updatedAt: new Date().toISOString()
      };

      writeProfileData(data);
      return IPCResponse.success(data.userProfile);
    } catch (error) {
      return IPCResponse.internalError("Failed to update profile", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.CHANGE_PASSWORD, async (_event, payload = {}) => {
    try {
      const currentPassword = String(payload.currentPassword || "");
      const newPassword = String(payload.newPassword || "");

      if (!currentPassword) {
        return IPCResponse.validation("currentPassword", "currentPassword is required");
      }
      if (!newPassword || newPassword.length < 6) {
        return IPCResponse.validation("newPassword", "newPassword must be at least 6 characters");
      }

      const data = readProfileData();
      data.passwordHashHint = `changed-${new Date().toISOString()}`;
      writeProfileData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to change password", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.UPLOAD_AVATAR, async (_event, payload = {}) => {
    try {
      const base64Image = String(payload.base64Image || "").trim();
      if (!base64Image) {
        return IPCResponse.validation("base64Image", "base64Image is required");
      }

      const data = readProfileData();
      data.userProfile.avatarUrl = base64Image;
      data.userProfile.updatedAt = new Date().toISOString();
      writeProfileData(data);
      return IPCResponse.success({ avatarUrl: base64Image });
    } catch (error) {
      return IPCResponse.internalError("Failed to upload avatar", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.GET_ACTIVITY_STATS, async () => {
    try {
      const data = readProfileData();
      return IPCResponse.success(data.activityStats);
    } catch (error) {
      return IPCResponse.internalError("Failed to load profile activity stats", String(error));
    }
  });
}

function projectsDbPath() {
  return path.join(app.getPath("userData"), "projects.db.json");
}

function defaultProjectsData() {
  return {
    projects: [
      {
        id: "agile-scrum-master",
        name: "Agile Scrum Master",
        slug: "agile-scrum-master",
        description: "Desktop orchestration workspace for agile delivery teams.",
        status: "active",
        owner: "Demo User",
        startDate: "2026-01-15",
        endDate: null,
        linkedRepos: ["agile-org/agile-scrum-master"],
        github_repo: "agile-org/agile-scrum-master",
        jira_project_key: "ASM",
        tech_stack: ["TypeScript", "React", "Electron"],
        stats: { totalTasks: 84, openTasks: 19, completedTasks: 65 },
        activityFeed: [
          { id: "act-1", message: "Sprint backlog refined", timestamp: "2026-04-14T09:20:00.000Z" },
          { id: "act-2", message: "Release branch synced", timestamp: "2026-04-13T14:05:00.000Z" }
        ],
        archived: false
      }
    ],
    sprintsByProject: {
      "agile-scrum-master": [
        { id: "sprint-24", name: "Sprint 24", status: "active", startDate: "2026-04-01", endDate: "2026-04-15" },
        { id: "sprint-23", name: "Sprint 23", status: "completed", startDate: "2026-03-15", endDate: "2026-03-31" }
      ]
    },
    membersByProject: {
      "agile-scrum-master": [
        { memberId: "user-1", fullName: "Demo User", email: "demo@agilescrummaster.dev", role: "owner" },
        { memberId: "user-2", fullName: "Sprint Lead", email: "lead@agilescrummaster.dev", role: "scrum_master" }
      ]
    }
  };
}

function readProjectsData() {
  try {
    const filePath = projectsDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultProjectsData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultProjectsData();
    return {
      projects: Array.isArray(parsed?.projects) ? parsed.projects : defaults.projects,
      sprintsByProject:
        parsed?.sprintsByProject && typeof parsed.sprintsByProject === "object"
          ? parsed.sprintsByProject
          : defaults.sprintsByProject,
      membersByProject:
        parsed?.membersByProject && typeof parsed.membersByProject === "object"
          ? parsed.membersByProject
          : defaults.membersByProject
    };
  } catch {
    return defaultProjectsData();
  }
}

function writeProjectsData(data) {
  fs.writeFileSync(projectsDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function resolveProjectId(data, projectId) {
  const normalized = String(projectId || "").trim();
  if (!normalized) return "";
  const found = data.projects.find(
    (project) => String(project.id || "") === normalized || String(project.slug || "") === normalized
  );
  return found ? String(found.id) : "";
}

function registerProjectHandlers() {
  ipcMain.handle(CHANNELS.PROJECTS.GET_BY_ID, async (_event, payload = {}) => {
    try {
      const data = readProjectsData();
      const requested = String(payload.projectId || "").trim();
      if (!requested) {
        return IPCResponse.validation("projectId", "projectId is required");
      }

      const resolvedId = resolveProjectId(data, requested);
      if (!resolvedId) {
        return IPCResponse.notFound("Project");
      }

      const project = data.projects.find((item) => String(item.id) === resolvedId);
      return IPCResponse.success(project);
    } catch (error) {
      return IPCResponse.internalError("Failed to load project", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROJECTS.GET_SPRINTS, async (_event, payload = {}) => {
    try {
      const data = readProjectsData();
      const requested = String(payload.projectId || "").trim();
      if (!requested) {
        return IPCResponse.validation("projectId", "projectId is required");
      }

      const resolvedId = resolveProjectId(data, requested);
      if (!resolvedId) {
        return IPCResponse.notFound("Project");
      }

      const sprints = Array.isArray(data.sprintsByProject?.[resolvedId]) ? data.sprintsByProject[resolvedId] : [];
      return IPCResponse.success(sprints);
    } catch (error) {
      return IPCResponse.internalError("Failed to load project sprints", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROJECTS.GET_MEMBERS, async (_event, payload = {}) => {
    try {
      const data = readProjectsData();
      const requested = String(payload.projectId || "").trim();
      if (!requested) {
        return IPCResponse.validation("projectId", "projectId is required");
      }

      const resolvedId = resolveProjectId(data, requested);
      if (!resolvedId) {
        return IPCResponse.notFound("Project");
      }

      const members = Array.isArray(data.membersByProject?.[resolvedId]) ? data.membersByProject[resolvedId] : [];
      return IPCResponse.success(members);
    } catch (error) {
      return IPCResponse.internalError("Failed to load project members", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROJECTS.ADD_MEMBER, async (_event, payload = {}) => {
    try {
      const data = readProjectsData();
      const requested = String(payload.projectId || "").trim();
      const userId = String(payload.userId || "").trim();
      const role = String(payload.role || "member").trim();
      if (!requested) {
        return IPCResponse.validation("projectId", "projectId is required");
      }
      if (!userId) {
        return IPCResponse.validation("userId", "userId is required");
      }

      const resolvedId = resolveProjectId(data, requested);
      if (!resolvedId) {
        return IPCResponse.notFound("Project");
      }

      const members = Array.isArray(data.membersByProject?.[resolvedId]) ? data.membersByProject[resolvedId] : [];
      const existingIndex = members.findIndex((member) => String(member.memberId) === userId);
      const nextMember = {
        memberId: userId,
        fullName: String(payload.fullName || `User ${userId}`),
        email: String(payload.email || `${userId}@example.dev`),
        role
      };

      if (existingIndex >= 0) {
        members[existingIndex] = { ...members[existingIndex], ...nextMember };
      } else {
        members.push(nextMember);
      }

      data.membersByProject[resolvedId] = members;
      writeProjectsData(data);
      return IPCResponse.success(nextMember);
    } catch (error) {
      return IPCResponse.internalError("Failed to add project member", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROJECTS.UPDATE, async (_event, payload = {}) => {
    try {
      const data = readProjectsData();
      const requested = String(payload.projectId || "").trim();
      const changes = payload && typeof payload.changes === "object" ? payload.changes : null;
      if (!requested) {
        return IPCResponse.validation("projectId", "projectId is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const resolvedId = resolveProjectId(data, requested);
      if (!resolvedId) {
        return IPCResponse.notFound("Project");
      }

      const index = data.projects.findIndex((project) => String(project.id) === resolvedId);
      if (index < 0) {
        return IPCResponse.notFound("Project");
      }

      const nextProject = {
        ...data.projects[index],
        ...changes,
        updatedAt: new Date().toISOString()
      };

      data.projects[index] = nextProject;
      writeProjectsData(data);
      return IPCResponse.success(nextProject);
    } catch (error) {
      return IPCResponse.internalError("Failed to update project", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROJECTS.ARCHIVE, async (_event, payload = {}) => {
    try {
      const data = readProjectsData();
      const requested = String(payload.projectId || "").trim();
      if (!requested) {
        return IPCResponse.validation("projectId", "projectId is required");
      }

      const resolvedId = resolveProjectId(data, requested);
      if (!resolvedId) {
        return IPCResponse.notFound("Project");
      }

      const index = data.projects.findIndex((project) => String(project.id) === resolvedId);
      if (index < 0) {
        return IPCResponse.notFound("Project");
      }

      data.projects[index] = {
        ...data.projects[index],
        archived: true,
        status: "archived",
        updatedAt: new Date().toISOString()
      };

      writeProjectsData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to archive project", String(error));
    }
  });
}

function reportsDbPath() {
  return path.join(app.getPath("userData"), "reports.db.json");
}

function defaultReportsData() {
  return {
    reports: [
      {
        id: "report-sprint-24",
        sprintId: "sprint-24",
        sprintName: "Sprint 24",
        projectId: "agile-scrum-master",
        startDate: "2026-04-01",
        endDate: "2026-04-15",
        velocity: 34,
        completionPct: 92,
        generatedAt: "2026-04-15T18:20:00.000Z",
        name: "Sprint 24 Report",
        date: "2026-04-15T18:20:00.000Z",
        type: "Sprint"
      },
      {
        id: "report-sprint-23",
        sprintId: "sprint-23",
        sprintName: "Sprint 23",
        projectId: "agile-scrum-master",
        startDate: "2026-03-15",
        endDate: "2026-03-31",
        velocity: 31,
        completionPct: 88,
        generatedAt: "2026-03-31T17:30:00.000Z",
        name: "Sprint 23 Report",
        date: "2026-03-31T17:30:00.000Z",
        type: "Sprint"
      }
    ],
    velocityHistory: [
      { sprintId: "sprint-19", sprint: "Sprint 19", status: "completed", startDate: "2026-01-16", endDate: "2026-01-31", planned: 34, velocity: 29, completionPct: 85, projectId: "agile-scrum-master" },
      { sprintId: "sprint-20", sprint: "Sprint 20", status: "completed", startDate: "2026-02-01", endDate: "2026-02-14", planned: 35, velocity: 30, completionPct: 86, projectId: "agile-scrum-master" },
      { sprintId: "sprint-21", sprint: "Sprint 21", status: "completed", startDate: "2026-02-15", endDate: "2026-02-28", planned: 33, velocity: 31, completionPct: 94, projectId: "agile-scrum-master" },
      { sprintId: "sprint-22", sprint: "Sprint 22", status: "completed", startDate: "2026-03-01", endDate: "2026-03-14", planned: 36, velocity: 33, completionPct: 92, projectId: "agile-scrum-master" },
      { sprintId: "sprint-23", sprint: "Sprint 23", status: "completed", startDate: "2026-03-15", endDate: "2026-03-31", planned: 35, velocity: 31, completionPct: 88, projectId: "agile-scrum-master" },
      { sprintId: "sprint-24", sprint: "Sprint 24", status: "completed", startDate: "2026-04-01", endDate: "2026-04-15", planned: 37, velocity: 34, completionPct: 92, projectId: "agile-scrum-master" }
    ],
    sprintReports: {
      "sprint-24": {
        sprintId: "sprint-24",
        sprintName: "Sprint 24",
        projectId: "agile-scrum-master",
        goal: "Stabilize release workflow and reduce defect leakage.",
        status: "completed",
        startDate: "2026-04-01",
        endDate: "2026-04-15",
        generatedAt: "2026-04-15T18:20:00.000Z",
        currentUserRole: "scrum_master",
        stats: {
          totalTasks: 42,
          completedTasks: 38,
          carriedOverTasks: 3,
          addedMidSprintTasks: 5,
          plannedPoints: 37,
          completedPoints: 34
        },
        burndown: {
          dates: ["2026-04-01", "2026-04-03", "2026-04-05", "2026-04-07", "2026-04-09", "2026-04-11", "2026-04-13", "2026-04-15"],
          ideal: [37, 32, 27, 22, 17, 12, 7, 0],
          actual: [37, 34, 30, 26, 21, 15, 9, 3]
        },
        teamPerformance: [
          { developer: "Demo User", tasksCompleted: 12, storyPoints: 11, prCount: 5 },
          { developer: "Sprint Lead", tasksCompleted: 10, storyPoints: 9, prCount: 4 },
          { developer: "QA Partner", tasksCompleted: 8, storyPoints: 7, prCount: 3 }
        ],
        blockersAndRisks: [
          { id: "risk-1", title: "CI queue saturation", resolutionNotes: "Scaled runners and added parallel test matrix." },
          { id: "risk-2", title: "Late API contract changes", resolutionNotes: "Locked schema by day 3 and enforced review gate." }
        ],
        retrospectiveNotes: "What went well: pair reviews reduced escaped defects. Improve next sprint: split large stories earlier."
      }
    }
  };
}

function readReportsData() {
  try {
    const filePath = reportsDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultReportsData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultReportsData();
    return {
      reports: Array.isArray(parsed?.reports) ? parsed.reports : defaults.reports,
      velocityHistory: Array.isArray(parsed?.velocityHistory) ? parsed.velocityHistory : defaults.velocityHistory,
      sprintReports:
        parsed?.sprintReports && typeof parsed.sprintReports === "object"
          ? parsed.sprintReports
          : defaults.sprintReports
    };
  } catch {
    return defaultReportsData();
  }
}

function writeReportsData(data) {
  fs.writeFileSync(reportsDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function normalizeDateRange(input) {
  if (!input) return null;
  if (typeof input === "string") {
    const parts = input.split("..").map((part) => part.trim());
    return { startDate: parts[0] || "", endDate: parts[1] || "" };
  }
  if (typeof input !== "object") return null;
  return {
    startDate: String(input.startDate || input.from || "").trim(),
    endDate: String(input.endDate || input.to || "").trim()
  };
}

function inDateRange(dateValue, dateRange) {
  if (!dateRange) return true;
  const valueMs = new Date(String(dateValue || "")).getTime();
  if (!Number.isFinite(valueMs)) return true;

  const startMs = dateRange.startDate ? new Date(dateRange.startDate).getTime() : NaN;
  const endMs = dateRange.endDate ? new Date(dateRange.endDate).getTime() : NaN;

  if (Number.isFinite(startMs) && valueMs < startMs) return false;
  if (Number.isFinite(endMs) && valueMs > endMs) return false;
  return true;
}

function buildFallbackSprintReport(sprintId, data) {
  const reportRow = data.reports.find((row) => String(row.sprintId || row.id || "") === sprintId) || null;
  const velocityRow = data.velocityHistory.find((row) => String(row.sprintId || "") === sprintId) || null;
  const sprintName =
    String((reportRow && reportRow.sprintName) || (reportRow && reportRow.name) || (velocityRow && velocityRow.sprint) || `Sprint ${sprintId}`);
  const startDate = String((reportRow && reportRow.startDate) || (velocityRow && velocityRow.startDate) || "");
  const endDate = String((reportRow && reportRow.endDate) || (velocityRow && velocityRow.endDate) || "");
  const plannedPoints = Math.max(0, Number((velocityRow && velocityRow.planned) || 0));
  const completedPoints = Math.max(0, Number((reportRow && reportRow.velocity) || (velocityRow && velocityRow.velocity) || 0));

  return {
    sprintId,
    sprintName,
    projectId: String((reportRow && reportRow.projectId) || (velocityRow && velocityRow.projectId) || "agile-scrum-master"),
    goal: "Improve sprint flow and delivery predictability.",
    status: String((velocityRow && velocityRow.status) || "completed"),
    startDate,
    endDate,
    generatedAt: String((reportRow && reportRow.generatedAt) || (reportRow && reportRow.date) || new Date().toISOString()),
    currentUserRole: "scrum_master",
    stats: {
      totalTasks: 0,
      completedTasks: 0,
      carriedOverTasks: 0,
      addedMidSprintTasks: 0,
      plannedPoints,
      completedPoints
    },
    burndown: { dates: [], ideal: [], actual: [] },
    teamPerformance: [],
    blockersAndRisks: [],
    retrospectiveNotes: ""
  };
}

function registerReportsHandlers() {
  ipcMain.handle(CHANNELS.REPORTS.GET_ALL, async (_event, payload = {}) => {
    try {
      const data = readReportsData();
      const projectId = String(payload.projectId || "").trim();
      const dateRange = normalizeDateRange(payload.dateRange);

      const reports = data.reports
        .filter((report) => {
          if (projectId && String(report.projectId || "") !== projectId) {
            return false;
          }
          return inDateRange(report.generatedAt || report.date || report.endDate, dateRange);
        })
        .sort((a, b) => new Date(String(b.generatedAt || b.date || 0)).getTime() - new Date(String(a.generatedAt || a.date || 0)).getTime());

      return IPCResponse.success(reports);
    } catch (error) {
      return IPCResponse.internalError("Failed to load reports", String(error));
    }
  });

  ipcMain.handle(CHANNELS.REPORTS.GET_VELOCITY_HISTORY, async (_event, payload = {}) => {
    try {
      const data = readReportsData();
      const count = Math.max(1, Math.min(24, Number(payload.count || 6)));
      const projectId = String(payload.projectId || "").trim();

      const history = data.velocityHistory
        .filter((entry) => {
          if (!projectId) return true;
          return String(entry.projectId || "") === projectId;
        })
        .sort((a, b) => new Date(String(a.endDate || 0)).getTime() - new Date(String(b.endDate || 0)).getTime())
        .slice(-count);

      return IPCResponse.success(history);
    } catch (error) {
      return IPCResponse.internalError("Failed to load velocity history", String(error));
    }
  });

  ipcMain.handle(CHANNELS.REPORTS.GENERATE, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const data = readReportsData();
      const now = new Date().toISOString();
      const existing = data.reports.find((report) => String(report.sprintId || report.id || "") === sprintId);

      if (existing) {
        return IPCResponse.success(existing);
      }

      const generated = {
        id: `report-${sprintId}-${Date.now()}`,
        sprintId,
        sprintName: String(payload.sprintName || `Sprint ${sprintId}`),
        projectId: String(payload.projectId || "agile-scrum-master"),
        startDate: String(payload.startDate || ""),
        endDate: String(payload.endDate || ""),
        velocity: Math.max(0, Number(payload.velocity || 0)),
        completionPct:
          payload.completionPct === null || payload.completionPct === undefined
            ? null
            : Math.max(0, Math.min(100, Number(payload.completionPct))),
        generatedAt: now,
        name: String(payload.name || `${String(payload.sprintName || `Sprint ${sprintId}`)} Report`),
        date: now,
        type: String(payload.type || "Sprint")
      };

      data.reports.unshift(generated);
      writeReportsData(data);
      return IPCResponse.success(generated);
    } catch (error) {
      return IPCResponse.internalError("Failed to generate report", String(error));
    }
  });

  ipcMain.handle(CHANNELS.REPORTS.GET_BY_SPRINT_ID, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const data = readReportsData();
      const existing =
        data.sprintReports && typeof data.sprintReports === "object"
          ? data.sprintReports[sprintId]
          : null;

      if (existing) {
        return IPCResponse.success(existing);
      }

      const fallback = buildFallbackSprintReport(sprintId, data);
      if (!data.sprintReports || typeof data.sprintReports !== "object") {
        data.sprintReports = {};
      }
      data.sprintReports[sprintId] = fallback;
      writeReportsData(data);
      return IPCResponse.success(fallback);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint report", String(error));
    }
  });

  ipcMain.handle(CHANNELS.REPORTS.UPDATE_RETRO_NOTES, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      const notes = String(payload.notes || "");
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const data = readReportsData();
      if (!data.sprintReports || typeof data.sprintReports !== "object") {
        data.sprintReports = {};
      }

      const existing = data.sprintReports[sprintId] || buildFallbackSprintReport(sprintId, data);
      data.sprintReports[sprintId] = {
        ...existing,
        retrospectiveNotes: notes,
        updatedAt: new Date().toISOString()
      };

      writeReportsData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to update retrospective notes", String(error));
    }
  });

  ipcMain.handle(CHANNELS.REPORTS.EXPORT_PDF, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const data = readReportsData();
      const report =
        data.sprintReports && typeof data.sprintReports === "object"
          ? data.sprintReports[sprintId] || buildFallbackSprintReport(sprintId, data)
          : buildFallbackSprintReport(sprintId, data);

      const exportDir = path.join(app.getPath("userData"), "exports");
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const filePath = path.join(exportDir, `sprint-report-${sprintId}.pdf`);
      const summary = [
        `Sprint Report: ${String(report.sprintName || sprintId)}`,
        `Sprint ID: ${sprintId}`,
        `Status: ${String(report.status || "")}`,
        `Goal: ${String(report.goal || "")}`,
        `Dates: ${String(report.startDate || "")} to ${String(report.endDate || "")}`,
        "",
        `Retrospective Notes:\n${String(report.retrospectiveNotes || "")}`
      ].join("\n");

      fs.writeFileSync(filePath, summary, "utf8");
      return IPCResponse.success({ filePath });
    } catch (error) {
      return IPCResponse.internalError("Failed to export report PDF", String(error));
    }
  });
}

function scrumMasterDbPath() {
  return path.join(app.getPath("userData"), "scrum-master.db.json");
}

function defaultScrumMasterData() {
  const now = Date.now();
  return {
    agenda: [
      { id: "ag-1", title: "Daily standup", type: "standup", scheduledAt: new Date(now + 30 * 60000).toISOString() },
      { id: "ag-2", title: "Sprint review prep", type: "review", scheduledAt: new Date(now + 3 * 60 * 60000).toISOString() },
      { id: "ag-3", title: "Retro facilitation", type: "retro", scheduledAt: new Date(now + 7 * 60 * 60000).toISOString() }
    ],
    impediments: [
      {
        id: "imp-1",
        taskTitle: "Stabilize CI pipeline",
        blockerDescription: "Intermittent integration test failures are blocking merges.",
        raisedBy: "Sprint Lead",
        daysBlocked: 2,
        resolved: false,
        createdAt: new Date(now - 2 * 24 * 60 * 60000).toISOString(),
        resolvedAt: null
      },
      {
        id: "imp-2",
        taskTitle: "Finalize API contract",
        blockerDescription: "Pending schema approval from platform team.",
        raisedBy: "Demo User",
        daysBlocked: 1,
        resolved: false,
        createdAt: new Date(now - 1 * 24 * 60 * 60000).toISOString(),
        resolvedAt: null
      }
    ],
    sprintHealth: {
      compositeScore: 82,
      velocityScore: 79,
      completionScore: 88,
      sentimentScore: 80,
      velocity: 34,
      completionPct: 92,
      teamSentiment: "positive",
      updatedAt: new Date(now - 10 * 60000).toISOString()
    },
    recentAgentActivity: [
      {
        id: "act-1",
        action: "run_daily_analysis",
        summary: "Analyzed sprint flow and highlighted two risk clusters.",
        createdAt: new Date(now - 40 * 60000).toISOString()
      },
      {
        id: "act-2",
        action: "detect_blockers",
        summary: "Detected unresolved CI and API dependency blockers.",
        createdAt: new Date(now - 22 * 60000).toISOString()
      }
    ]
  };
}

function readScrumMasterData() {
  try {
    const filePath = scrumMasterDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultScrumMasterData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultScrumMasterData();
    return {
      agenda: Array.isArray(parsed?.agenda) ? parsed.agenda : defaults.agenda,
      impediments: Array.isArray(parsed?.impediments) ? parsed.impediments : defaults.impediments,
      sprintHealth:
        parsed?.sprintHealth && typeof parsed.sprintHealth === "object"
          ? { ...defaults.sprintHealth, ...parsed.sprintHealth }
          : defaults.sprintHealth,
      recentAgentActivity: Array.isArray(parsed?.recentAgentActivity)
        ? parsed.recentAgentActivity
        : defaults.recentAgentActivity
    };
  } catch {
    return defaultScrumMasterData();
  }
}

function writeScrumMasterData(data) {
  fs.writeFileSync(scrumMasterDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function actionSummary(action) {
  const normalized = String(action || "").toLowerCase();
  if (normalized === "run_daily_analysis") {
    return "Daily analysis complete: velocity trend stable, blockers monitored.";
  }
  if (normalized === "detect_blockers") {
    return "Blocker detection complete: flagged unresolved dependencies and CI instability.";
  }
  if (normalized === "generate_standup_summary") {
    return "Standup summary generated for current team updates and risks.";
  }
  return "Agent action completed.";
}

function registerScrumMasterHandlers() {
  ipcMain.handle(CHANNELS.SCRUM_MASTER.GET_AGENDA, async () => {
    try {
      const data = readScrumMasterData();
      const agenda = [...data.agenda].sort(
        (a, b) => new Date(String(a.scheduledAt || 0)).getTime() - new Date(String(b.scheduledAt || 0)).getTime()
      );
      return IPCResponse.success(agenda);
    } catch (error) {
      return IPCResponse.internalError("Failed to load agenda", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SCRUM_MASTER.GET_IMPEDIMENTS, async () => {
    try {
      const data = readScrumMasterData();
      const active = data.impediments.filter((item) => !Boolean(item.resolved));
      return IPCResponse.success(active);
    } catch (error) {
      return IPCResponse.internalError("Failed to load impediments", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SCRUM_MASTER.RESOLVE_IMPEDIMENT, async (_event, payload = {}) => {
    try {
      const impedimentId = String(payload.impedimentId || "").trim();
      if (!impedimentId) {
        return IPCResponse.validation("impedimentId", "impedimentId is required");
      }

      const data = readScrumMasterData();
      const index = data.impediments.findIndex((item) => String(item.id || "") === impedimentId);
      if (index < 0) {
        return IPCResponse.notFound("Impediment");
      }

      const updated = {
        ...data.impediments[index],
        resolved: true,
        resolvedAt: new Date().toISOString()
      };

      data.impediments[index] = updated;
      writeScrumMasterData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to resolve impediment", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SCRUM_MASTER.GET_SPRINT_HEALTH, async () => {
    try {
      const data = readScrumMasterData();
      return IPCResponse.success({
        ...data.sprintHealth,
        recentAgentActivity: data.recentAgentActivity
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint health", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SCRUM_MASTER.RUN_AGENT_ACTION, async (_event, payload = {}) => {
    try {
      const action = String(payload.action || "").trim();
      if (!action) {
        return IPCResponse.validation("action", "action is required");
      }

      const data = readScrumMasterData();
      const result = {
        id: `sm-act-${Date.now()}`,
        action,
        summary: actionSummary(action),
        status: "completed",
        createdAt: new Date().toISOString()
      };

      data.recentAgentActivity = [result, ...data.recentAgentActivity].slice(0, 20);
      writeScrumMasterData(data);
      return IPCResponse.success(result);
    } catch (error) {
      return IPCResponse.internalError("Failed to run agent action", String(error));
    }
  });
}

function tasksDbPath() {
  return path.join(app.getPath("userData"), "tasks.db.json");
}

function defaultTasksData() {
  const now = Date.now();
  const createdAt = new Date(now - 3 * 24 * 60 * 60000).toISOString();
  const updatedAt = new Date(now - 30 * 60000).toISOString();

  return {
    tasks: [
      {
        id: "task-1",
        title: "Harden desktop IPC task flows",
        description: "Ensure task deep-dive workflow uses desktop IPC handlers and local persistence.",
        status: "in_progress",
        assignee: { id: "user-2", name: "Sprint Lead" },
        sprint: "Sprint 24",
        sprintId: "sprint-24",
        priority: "high",
        storyPoints: 8,
        acceptanceCriteria: "Task detail page reads/writes task actions exclusively through IPC.",
        blockers: [
          {
            id: "blk-1",
            description: "Need product confirmation for final risk thresholds.",
            createdAt: new Date(now - 18 * 60 * 60000).toISOString()
          }
        ],
        comments: [
          {
            id: "cmt-1",
            content: "Started mapping deep-dive task actions to renderer-safe IPC calls.",
            created_at: new Date(now - 85 * 60000).toISOString(),
            author_name: "Sprint Lead",
            replies: []
          }
        ],
        relatedTasks: [
          { id: "task-2", title: "Validate prompt 26 wiring", status: "todo", relation: "linked" },
          { id: "task-3", title: "Review task risk thresholds", status: "in_review", relation: "blocked-by" }
        ],
        createdAt,
        updatedAt
      }
    ],
    activityByTask: {
      "task-1": [
        {
          id: "evt-1",
          type: "created",
          title: "Task created",
          detail: "Task was added to Sprint 24 backlog.",
          status: "created",
          time: createdAt
        },
        {
          id: "evt-2",
          type: "assigned",
          title: "Task assigned",
          detail: "Assigned to Sprint Lead.",
          status: "assigned",
          time: new Date(now - 40 * 60 * 60000).toISOString()
        },
        {
          id: "evt-3",
          type: "status_change",
          title: "Status changed",
          detail: "Moved from todo to in_progress.",
          status: "in_progress",
          time: updatedAt
        }
      ]
    }
  };
}

function readTasksData() {
  try {
    const filePath = tasksDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultTasksData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultTasksData();
    return {
      tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : defaults.tasks,
      activityByTask:
        parsed?.activityByTask && typeof parsed.activityByTask === "object"
          ? parsed.activityByTask
          : defaults.activityByTask
    };
  } catch {
    return defaultTasksData();
  }
}

function writeTasksData(data) {
  fs.writeFileSync(tasksDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function ensureTask(taskId, data) {
  const id = String(taskId || "").trim();
  const existingIndex = data.tasks.findIndex((item) => String(item.id || "") === id);
  if (existingIndex >= 0) {
    return { task: data.tasks[existingIndex], index: existingIndex };
  }

  const fallback = {
    id,
    title: `Task ${id}`,
    description: "No description available yet.",
    status: "todo",
    assignee: null,
    sprint: "Unscheduled",
    sprintId: "",
    priority: "medium",
    storyPoints: 3,
    acceptanceCriteria: "",
    blockers: [],
    comments: [],
    relatedTasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.tasks.push(fallback);
  if (!data.activityByTask[id]) {
    data.activityByTask[id] = [
      {
        id: `evt-${randomUUID()}`,
        type: "created",
        title: "Task created",
        detail: "Task initialized in desktop local store.",
        status: "created",
        time: new Date().toISOString()
      }
    ];
  }

  return { task: fallback, index: data.tasks.length - 1 };
}

function appendTaskEvent(data, taskId, event) {
  const id = String(taskId || "").trim();
  const list = Array.isArray(data.activityByTask[id]) ? data.activityByTask[id] : [];
  data.activityByTask[id] = [event, ...list].slice(0, 100);
}

function buildTaskAnalysis(task, events) {
  const points = Number(task.storyPoints || 0);
  const blockers = Array.isArray(task.blockers) ? task.blockers.length : 0;
  const velocityRisk = String(task.priority || "").toLowerCase() === "high" ? 18 : 9;
  const blockerRisk = blockers * 14;
  const churnRisk = Math.min(events.length, 20);
  const complexityScore = Math.max(10, Math.min(100, points * 9 + blockerRisk + churnRisk));
  const riskFlags = [];

  if (blockers > 0) riskFlags.push(`${blockers} active blocker${blockers === 1 ? "" : "s"}`);
  if (velocityRisk >= 18) riskFlags.push("High priority may impact sprint predictability");
  if (events.length > 8) riskFlags.push("Frequent activity changes detected");

  const suggestedActions = [
    blockers > 0 ? "Escalate blockers in daily standup" : "No blocker escalation needed",
    "Validate acceptance criteria before review",
    "Post end-of-day progress comment"
  ];

  return {
    complexityScore,
    riskFlags,
    suggestedActions,
    generatedAt: new Date().toISOString()
  };
}

function registerTaskHandlers() {
  ipcMain.handle(CHANNELS.TASKS.GET_BY_ID, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }

      const data = readTasksData();
      const { task } = ensureTask(taskId, data);
      writeTasksData(data);
      return IPCResponse.success(task);
    } catch (error) {
      return IPCResponse.internalError("Failed to load task", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.GET_ACTIVITY_LOG, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }

      const data = readTasksData();
      const { task } = ensureTask(taskId, data);
      const base = Array.isArray(data.activityByTask[taskId]) ? data.activityByTask[taskId] : [];
      const commentEvents = Array.isArray(task.comments)
        ? task.comments.map((comment) => ({
            id: `evt-comment-${String(comment.id || randomUUID())}`,
            type: "comment",
            title: "Comment added",
            detail: String(comment.content || ""),
            status: "commented",
            time: String(comment.created_at || new Date().toISOString())
          }))
        : [];

      const merged = [...base, ...commentEvents].sort(
        (a, b) => new Date(String(b.time || 0)).getTime() - new Date(String(a.time || 0)).getTime()
      );

      writeTasksData(data);
      return IPCResponse.success(merged);
    } catch (error) {
      return IPCResponse.internalError("Failed to load task activity", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.ADD_BLOCKER, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      const description = String(payload.description || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }
      if (!description) {
        return IPCResponse.validation("description", "description is required");
      }

      const data = readTasksData();
      const { task, index } = ensureTask(taskId, data);
      const blocker = {
        id: `blk-${randomUUID()}`,
        description,
        createdAt: new Date().toISOString()
      };

      const next = {
        ...task,
        blockers: [...(Array.isArray(task.blockers) ? task.blockers : []), blocker],
        updatedAt: new Date().toISOString()
      };

      data.tasks[index] = next;
      appendTaskEvent(data, taskId, {
        id: `evt-${randomUUID()}`,
        type: "blocker_added",
        title: "Blocker added",
        detail: description,
        status: "blocked",
        time: new Date().toISOString()
      });

      writeTasksData(data);
      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to add blocker", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.REMOVE_BLOCKER, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      const blockerId = String(payload.blockerId || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }
      if (!blockerId) {
        return IPCResponse.validation("blockerId", "blockerId is required");
      }

      const data = readTasksData();
      const { task, index } = ensureTask(taskId, data);
      const blockers = Array.isArray(task.blockers) ? task.blockers : [];
      const removed = blockers.find((item) => String(item.id || "") === blockerId);
      const next = {
        ...task,
        blockers: blockers.filter((item) => String(item.id || "") !== blockerId),
        updatedAt: new Date().toISOString()
      };

      data.tasks[index] = next;
      appendTaskEvent(data, taskId, {
        id: `evt-${randomUUID()}`,
        type: "blocker_removed",
        title: "Blocker removed",
        detail: removed ? String(removed.description || "") : "A blocker was removed",
        status: "updated",
        time: new Date().toISOString()
      });

      writeTasksData(data);
      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to remove blocker", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.ADD_COMMENT, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      const content = String(payload.content || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }
      if (!content) {
        return IPCResponse.validation("content", "content is required");
      }

      const data = readTasksData();
      const { task, index } = ensureTask(taskId, data);
      const comment = {
        id: `cmt-${randomUUID()}`,
        content,
        created_at: new Date().toISOString(),
        author_name: "Scrum Master",
        replies: []
      };

      const next = {
        ...task,
        comments: [comment, ...(Array.isArray(task.comments) ? task.comments : [])],
        updatedAt: new Date().toISOString()
      };

      data.tasks[index] = next;
      appendTaskEvent(data, taskId, {
        id: `evt-${randomUUID()}`,
        type: "comment",
        title: "Comment added",
        detail: content,
        status: "commented",
        time: comment.created_at
      });

      writeTasksData(data);
      return IPCResponse.success(comment);
    } catch (error) {
      return IPCResponse.internalError("Failed to add comment", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SCRUM_MASTER.ANALYZE_TASK, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }

      const data = readTasksData();
      const { task } = ensureTask(taskId, data);
      const events = Array.isArray(data.activityByTask[taskId]) ? data.activityByTask[taskId] : [];
      const analysis = buildTaskAnalysis(task, events);
      writeTasksData(data);
      return IPCResponse.success(analysis);
    } catch (error) {
      return IPCResponse.internalError("Failed to analyze task", String(error));
    }
  });
}

function agentsDbPath() {
  return path.join(app.getPath("userData"), "agents.db.json");
}

function defaultAgentsData() {
  const now = Date.now();
  return {
    agents: [
      {
        id: "agent-1",
        name: "Sprint Copilot",
        type: "scrum-assistant",
        status: "idle",
        running: false,
        lastRunAt: new Date(now - 20 * 60000).toISOString(),
        config: {
          trigger_settings: { event: "manual" },
          autonomy_level: 2,
          constraints: {
            ragEnabled: true,
            status: "active",
            model: "gpt-5.3-codex",
            toolsEnabled: ["tasks", "comments", "monitoring"],
            memory: "project"
          },
          context_memo: "Prioritize blockers and provide concise standup-ready updates."
        },
        stats: {
          aiServiceConfigured: true,
          inngestConfigured: false,
          ragEnabled: true,
          promptTemplateDefined: true,
          totalActions: 6,
          failedActions: 0,
          totalDecisions: 5,
          executedDecisions: 5,
          failedDecisions: 0
        }
      }
    ],
    conversations: {
      "agent-1": [
        {
          id: "msg-1",
          role: "assistant",
          content: "I can analyze blockers, summarize standups, and suggest assignment actions.",
          createdAt: new Date(now - 90 * 60000).toISOString()
        }
      ]
    },
    actionLogs: {
      "agent-1": [
        {
          id: "act-1",
          action_description: "Updated blocker triage summary",
          status: "completed",
          confidence: 0.92,
          created_at: new Date(now - 55 * 60000).toISOString(),
          type: "task_updated"
        },
        {
          id: "act-2",
          action_description: "Posted sprint risk comment",
          status: "completed",
          confidence: 0.88,
          created_at: new Date(now - 35 * 60000).toISOString(),
          type: "comment_posted"
        }
      ]
    }
  };
}

function readAgentsData() {
  try {
    const filePath = agentsDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultAgentsData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultAgentsData();
    return {
      agents: Array.isArray(parsed?.agents) ? parsed.agents : defaults.agents,
      conversations:
        parsed?.conversations && typeof parsed.conversations === "object"
          ? parsed.conversations
          : defaults.conversations,
      actionLogs:
        parsed?.actionLogs && typeof parsed.actionLogs === "object"
          ? parsed.actionLogs
          : defaults.actionLogs
    };
  } catch {
    return defaultAgentsData();
  }
}

function writeAgentsData(data) {
  fs.writeFileSync(agentsDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function ensureAgent(data, agentId) {
  const id = String(agentId || "").trim();
  let index = data.agents.findIndex((item) => String(item.id || "") === id);
  if (index < 0) {
    const fallback = {
      id,
      name: `Agent ${id}`,
      type: "custom",
      status: "idle",
      running: false,
      lastRunAt: "",
      config: {
        trigger_settings: { event: "manual" },
        autonomy_level: 2,
        constraints: {
          ragEnabled: false,
          status: "active",
          model: "gpt-5.3-codex",
          toolsEnabled: ["tasks"],
          memory: "project"
        },
        context_memo: ""
      },
      stats: {
        aiServiceConfigured: true,
        inngestConfigured: false,
        ragEnabled: false,
        promptTemplateDefined: false,
        totalActions: 0,
        failedActions: 0,
        totalDecisions: 0,
        executedDecisions: 0,
        failedDecisions: 0
      }
    };
    data.agents.push(fallback);
    index = data.agents.length - 1;
  }

  if (!Array.isArray(data.conversations[id])) {
    data.conversations[id] = [];
  }
  if (!Array.isArray(data.actionLogs[id])) {
    data.actionLogs[id] = [];
  }

  return { agent: data.agents[index], index };
}

function registerAgentHandlers() {
  ipcMain.handle(CHANNELS.AGENT.GET_BY_ID, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }

      const data = readAgentsData();
      const { agent } = ensureAgent(data, agentId);
      writeAgentsData(data);
      return IPCResponse.success(agent);
    } catch (error) {
      return IPCResponse.internalError("Failed to load agent", String(error));
    }
  });

  ipcMain.handle(CHANNELS.AGENT.GET_CONVERSATION, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }

      const data = readAgentsData();
      ensureAgent(data, agentId);
      const conversation = Array.isArray(data.conversations[agentId]) ? data.conversations[agentId] : [];
      writeAgentsData(data);
      return IPCResponse.success(conversation);
    } catch (error) {
      return IPCResponse.internalError("Failed to load conversation", String(error));
    }
  });

  ipcMain.handle(CHANNELS.AGENT.SEND_MESSAGE, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      const content = String(payload.content || "").trim();
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }
      if (!content) {
        return IPCResponse.validation("content", "content is required");
      }

      const data = readAgentsData();
      const { agent, index } = ensureAgent(data, agentId);
      const userMessage = {
        id: `msg-${randomUUID()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString()
      };
      const assistantMessage = {
        id: `msg-${randomUUID()}`,
        role: "assistant",
        content: "Instruction received. I will analyze and append actionable updates to the task stream.",
        createdAt: new Date().toISOString()
      };

      data.conversations[agentId] = [assistantMessage, userMessage, ...(data.conversations[agentId] || [])].slice(0, 100);
      data.actionLogs[agentId] = [
        {
          id: `act-${randomUUID()}`,
          action_description: "Instruction received via agent chat",
          status: "completed",
          confidence: 0.9,
          created_at: new Date().toISOString(),
          type: "message_received"
        },
        ...(data.actionLogs[agentId] || [])
      ].slice(0, 100);

      data.agents[index] = {
        ...agent,
        lastRunAt: new Date().toISOString(),
        stats: {
          ...(agent.stats || {}),
          totalActions: Number(agent.stats?.totalActions || 0) + 1,
          totalDecisions: Number(agent.stats?.totalDecisions || 0) + 1,
          executedDecisions: Number(agent.stats?.executedDecisions || 0) + 1
        }
      };

      writeAgentsData(data);
      return IPCResponse.success(userMessage);
    } catch (error) {
      return IPCResponse.internalError("Failed to send agent message", String(error));
    }
  });

  ipcMain.handle(CHANNELS.AGENT.GET_ACTION_LOG, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }

      const data = readAgentsData();
      ensureAgent(data, agentId);
      const rows = Array.isArray(data.actionLogs[agentId]) ? data.actionLogs[agentId] : [];
      writeAgentsData(data);
      return IPCResponse.success(rows);
    } catch (error) {
      return IPCResponse.internalError("Failed to load agent action log", String(error));
    }
  });

  ipcMain.handle(CHANNELS.AGENT.TOGGLE_RUN, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }

      const running = Boolean(payload.running);
      const data = readAgentsData();
      const { agent, index } = ensureAgent(data, agentId);
      const updated = {
        ...agent,
        running,
        status: running ? "running" : "idle",
        lastRunAt: new Date().toISOString(),
        config: {
          ...(agent.config || {}),
          constraints: {
            ...((agent.config && agent.config.constraints) || {}),
            status: running ? "active" : "paused"
          }
        }
      };

      data.agents[index] = updated;
      writeAgentsData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to toggle agent run state", String(error));
    }
  });

  ipcMain.handle(CHANNELS.AGENT.UPDATE_CONFIG, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      const config = payload && typeof payload.config === "object" ? payload.config : null;
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }
      if (!config) {
        return IPCResponse.validation("config", "config is required");
      }

      const data = readAgentsData();
      const { agent, index } = ensureAgent(data, agentId);
      const updated = {
        ...agent,
        config: {
          ...(agent.config || {}),
          ...config
        },
        stats: {
          ...(agent.stats || {}),
          ragEnabled: Boolean(config?.constraints?.ragEnabled),
          promptTemplateDefined: Boolean(String(config?.context_memo || "").trim())
        }
      };

      data.agents[index] = updated;
      writeAgentsData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to update agent config", String(error));
    }
  });

  ipcMain.handle(CHANNELS.AGENT.DELETE, async (_event, payload = {}) => {
    try {
      const agentId = String(payload.agentId || "").trim();
      if (!agentId) {
        return IPCResponse.validation("agentId", "agentId is required");
      }

      const data = readAgentsData();
      const before = data.agents.length;
      data.agents = data.agents.filter((agent) => String(agent.id || "") !== agentId);
      delete data.conversations[agentId];
      delete data.actionLogs[agentId];
      writeAgentsData(data);
      return IPCResponse.success({ success: data.agents.length < before });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete agent", String(error));
    }
  });
}

function billingDbPath() {
  return path.join(app.getPath("userData"), "billing.db.json");
}

function defaultBillingData() {
  const now = new Date();
  const renewalDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    plan: {
      name: "Pro",
      slug: "pro",
      price: "$79/mo",
      renewalDate,
      seatsUsed: 12,
      seatsAvailable: 20
    },
    paymentMethod: {
      brand: "Visa",
      last4: "4242",
      expiry: "12/28"
    },
    invoices: [
      {
        id: "inv-2026-03",
        date: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        amount: 79,
        status: "paid",
        pdfUrl: "https://billing.agilescrummaster.local/invoices/inv-2026-03.pdf"
      },
      {
        id: "inv-2026-02",
        date: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString(),
        amount: 79,
        status: "paid",
        pdfUrl: "https://billing.agilescrummaster.local/invoices/inv-2026-02.pdf"
      },
      {
        id: "inv-2026-01",
        date: new Date(now.getTime() - 75 * 24 * 60 * 60 * 1000).toISOString(),
        amount: 79,
        status: "failed",
        pdfUrl: "https://billing.agilescrummaster.local/invoices/inv-2026-01.pdf"
      }
    ],
    usage: {
      seatsUsed: 12,
      apiCallsThisMonth: 18437,
      storageUsedGb: 32.4
    },
    billingPortalUrl: "https://billing.stripe.com/p/login/test_portal"
  };
}

function readBillingData() {
  try {
    const filePath = billingDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultBillingData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultBillingData();
    return {
      plan: parsed?.plan && typeof parsed.plan === "object" ? { ...defaults.plan, ...parsed.plan } : defaults.plan,
      paymentMethod:
        parsed?.paymentMethod && typeof parsed.paymentMethod === "object"
          ? { ...defaults.paymentMethod, ...parsed.paymentMethod }
          : defaults.paymentMethod,
      invoices: Array.isArray(parsed?.invoices) ? parsed.invoices : defaults.invoices,
      usage: parsed?.usage && typeof parsed.usage === "object" ? { ...defaults.usage, ...parsed.usage } : defaults.usage,
      billingPortalUrl:
        parsed?.billingPortalUrl && String(parsed.billingPortalUrl).trim()
          ? String(parsed.billingPortalUrl)
          : defaults.billingPortalUrl
    };
  } catch {
    return defaultBillingData();
  }
}

function registerBillingHandlers() {
  ipcMain.handle(CHANNELS.BILLING.GET_PLAN, async () => {
    try {
      const data = readBillingData();
      return IPCResponse.success(data.plan);
    } catch (error) {
      return IPCResponse.internalError("Failed to load billing plan", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_PAYMENT_METHOD, async () => {
    try {
      const data = readBillingData();
      return IPCResponse.success(data.paymentMethod);
    } catch (error) {
      return IPCResponse.internalError("Failed to load payment method", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_INVOICES, async () => {
    try {
      const data = readBillingData();
      return IPCResponse.success(data.invoices);
    } catch (error) {
      return IPCResponse.internalError("Failed to load invoices", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_USAGE, async () => {
    try {
      const data = readBillingData();
      return IPCResponse.success(data.usage);
    } catch (error) {
      return IPCResponse.internalError("Failed to load usage metrics", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_BILLING_PORTAL_URL, async () => {
    try {
      const data = readBillingData();
      return IPCResponse.success({ url: data.billingPortalUrl });
    } catch (error) {
      return IPCResponse.internalError("Failed to get billing portal URL", String(error));
    }
  });
}

function developersDbPath() {
  return path.join(app.getPath("userData"), "developers.org.db.json");
}

function defaultDevelopersData() {
  const now = new Date();
  return {
    seatLimit: 20,
    members: [
      {
        id: "user-1",
        name: "Demo User",
        email: "demo@agilescrummaster.dev",
        role: "admin",
        teams: ["Platform"],
        lastActive: now.toISOString(),
        status: "active"
      },
      {
        id: "user-2",
        name: "Sprint Lead",
        email: "lead@agilescrummaster.dev",
        role: "manager",
        teams: ["Core Scrum"],
        lastActive: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
        status: "active"
      },
      {
        id: "user-3",
        name: "Frontend Engineer",
        email: "frontend@agilescrummaster.dev",
        role: "developer",
        teams: ["Web"],
        lastActive: new Date(now.getTime() - 9 * 60 * 60 * 1000).toISOString(),
        status: "active"
      }
    ],
    invitations: [
      {
        id: "inv-dev-1",
        email: "newhire@agilescrummaster.dev",
        role: "developer",
        invitedBy: "Demo User",
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        status: "pending"
      }
    ]
  };
}

function readDevelopersData() {
  try {
    const filePath = developersDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultDevelopersData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultDevelopersData();
    return {
      seatLimit: Math.max(1, Number(parsed?.seatLimit || defaults.seatLimit)),
      members: Array.isArray(parsed?.members) ? parsed.members : defaults.members,
      invitations: Array.isArray(parsed?.invitations) ? parsed.invitations : defaults.invitations
    };
  } catch {
    return defaultDevelopersData();
  }
}

function writeDevelopersData(data) {
  fs.writeFileSync(developersDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function registerDevelopersHandlers() {
  ipcMain.handle(CHANNELS.DEVELOPERS.GET_ORG_MEMBERS, async () => {
    try {
      const data = readDevelopersData();
      return IPCResponse.success(data.members);
    } catch (error) {
      return IPCResponse.internalError("Failed to load org members", String(error));
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.UPDATE_ROLE, async (_event, payload = {}) => {
    try {
      const userId = String(payload.userId || "").trim();
      const role = String(payload.role || "").trim();
      if (!userId) {
        return IPCResponse.validation("userId", "userId is required");
      }
      if (!role) {
        return IPCResponse.validation("role", "role is required");
      }

      const data = readDevelopersData();
      const index = data.members.findIndex((member) => String(member.id || "") === userId);
      if (index < 0) {
        return IPCResponse.notFound("Org member");
      }

      const updated = {
        ...data.members[index],
        role,
        updatedAt: new Date().toISOString()
      };
      data.members[index] = updated;
      writeDevelopersData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to update org member role", String(error));
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.REMOVE_FROM_ORG, async (_event, payload = {}) => {
    try {
      const userId = String(payload.userId || "").trim();
      if (!userId) {
        return IPCResponse.validation("userId", "userId is required");
      }

      const data = readDevelopersData();
      const before = data.members.length;
      data.members = data.members.filter((member) => String(member.id || "") !== userId);
      const removed = data.members.length < before;
      if (removed) {
        writeDevelopersData(data);
      }
      return IPCResponse.success({ success: removed });
    } catch (error) {
      return IPCResponse.internalError("Failed to remove org member", String(error));
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.INVITE_TO_ORG, async (_event, payload = {}) => {
    try {
      const email = String(payload.email || "").trim().toLowerCase();
      const role = String(payload.role || "developer").trim() || "developer";
      if (!email) {
        return IPCResponse.validation("email", "email is required");
      }

      const data = readDevelopersData();
      const existingPending = data.invitations.find(
        (inv) => String(inv.email || "").toLowerCase() === email && String(inv.status || "").toLowerCase() === "pending"
      );
      if (existingPending) {
        return IPCResponse.success(existingPending);
      }

      const invitation = {
        id: `inv-${randomUUID()}`,
        email,
        role,
        invitedBy: "Demo User",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: "pending"
      };

      data.invitations.unshift(invitation);
      writeDevelopersData(data);
      return IPCResponse.success(invitation);
    } catch (error) {
      return IPCResponse.internalError("Failed to invite org member", String(error));
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_PENDING_INVITATIONS, async () => {
    try {
      const data = readDevelopersData();
      const pending = data.invitations.filter((inv) => String(inv.status || "").toLowerCase() === "pending");
      return IPCResponse.success(pending);
    } catch (error) {
      return IPCResponse.internalError("Failed to load pending invitations", String(error));
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.REVOKE_INVITATION, async (_event, payload = {}) => {
    try {
      const invitationId = String(payload.invitationId || "").trim();
      if (!invitationId) {
        return IPCResponse.validation("invitationId", "invitationId is required");
      }

      const data = readDevelopersData();
      const index = data.invitations.findIndex((inv) => String(inv.id || "") === invitationId);
      if (index < 0) {
        return IPCResponse.notFound("Invitation");
      }

      data.invitations[index] = {
        ...data.invitations[index],
        status: "revoked",
        revokedAt: new Date().toISOString()
      };
      writeDevelopersData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to revoke invitation", String(error));
    }
  });
}

function registerSystemHandlers() {
  ipcMain.handle(CHANNELS.SYSTEM.OPEN_EXTERNAL, async (_event, payload = {}) => {
    try {
      const url = String(payload.url || "").trim();
      if (!url) {
        return IPCResponse.validation("url", "url is required");
      }
      await shell.openExternal(url);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to open external URL", String(error));
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    title: "Agile Scrum Master Desktop",
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const startUrl = process.env.ELECTRON_START_URL;
  const rendererIndexPath = path.join(__dirname, "..", "frontend", "dist", "index.html");

  if (startUrl) {
    win.loadURL(startUrl);
    mainWindow = win;
    return;
  }

  if (!fs.existsSync(rendererIndexPath)) {
    win.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent("<h2>Renderer build not found</h2><p>Run: npm run build:frontend</p>")
    );
    mainWindow = win;
    return;
  }

  win.loadFile(rendererIndexPath);
  mainWindow = win;
}

app.whenReady().then(() => {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
  }

  registerAuthIpcHandlers(ipcMain);
  registerSystemHandlers();
  registerGoalHandlers();
  registerIntegrationHandlers();
  registerGithubRepoHandlers();
  registerMonitoringHandlers();
  registerOnboardingHandlers();
  registerProfileHandlers();
  registerProjectHandlers();
  registerReportsHandlers();
  registerScrumMasterHandlers();
  registerTaskHandlers();
  registerAgentHandlers();
  registerBillingHandlers();
  registerDevelopersHandlers();
  createWindow();

  for (const deepLink of initialDeepLinks) {
    handleDesktopCallback(deepLink);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
