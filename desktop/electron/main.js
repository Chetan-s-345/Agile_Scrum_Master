require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.production") });

const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const CHANNELS = require("./ipc/channels");
const IPCResponse = require("./utils/ipc-response");
const { registerAdminIpcHandlers } = require("./ipc/admin");
const { registerAssignIpcHandlers } = require("./ipc/assign");
const { registerBacklogIpcHandlers } = require("./ipc/backlog");
const { registerBoardIpcHandlers } = require("./ipc/board");
const { registerDashboardIpcHandlers } = require("./ipc/dashboard");
const { registerDevelopersIpcHandlers: registerDirectoryDevelopersIpcHandlers } = require("./ipc/developers");
const { registerFormsIpcHandlers } = require("./ipc/forms");
const { registerNavbarDataIpcHandlers } = require("./ipc/navbar-data");
const { registerPagesIpcHandlers } = require("./ipc/pages");
const { registerTimelineIpcHandlers } = require("./ipc/timeline");
const { registerAuthIpcHandlers, processDesktopAuthCallback, getStoredSession } = require("./ipc/auth");

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
  function getLinkedReposWithMetadata(data) {
    const availableByKey = new Map();
    for (const repo of data.availableRepos) {
      const key = toRepoKey(repo);
      if (key) availableByKey.set(key, repo);
      const id = String(repo.id || "").trim();
      if (id && !availableByKey.has(id)) {
        availableByKey.set(id, repo);
      }
    }

    return data.linkedRepos.map((entry) => {
      const repoId = String(entry.repoId || "").trim();
      const repo = availableByKey.get(repoId) || null;
      const fullName = String(repo?.fullName || repoId || repo?.name || "").trim();
      const name = String(repo?.name || fullName.split("/").pop() || fullName || "Repository").trim();
      const lastCommit = String(repo?.updatedAt || entry.updatedAt || entry.linkedAt || new Date().toISOString());
      const openPrsCount = Math.max(0, Number(repo?.openPRs ?? entry.openPRs ?? 0));

      return {
        repoId,
        enabled: Boolean(entry.enabled),
        projectId: entry.projectId || null,
        linkedAt: String(entry.linkedAt || ""),
        id: String(repo?.id || repoId || fullName),
        name,
        fullName,
        visibility: repo?.private ? "private" : "public",
        lastCommit,
        openPrsCount,
        syncStatus: Boolean(entry.enabled) ? "synced" : "paused",
      };
    });
  }

  ipcMain.handle(CHANNELS.GITHUB.GET_AVAILABLE_REPOS, async (_event, payload = {}) => {
    const data = readGithubRepoData();
    const query = String(payload.query || "").trim().toLowerCase();

    const linkedByRepoId = new Map(
      data.linkedRepos.map((entry) => [String(entry.repoId || ""), Boolean(entry.enabled)])
    );

    return data.availableRepos
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
  });

  ipcMain.handle(CHANNELS.GITHUB.GET_CONNECTION_STATUS, async () => {
    const data = readGithubRepoData();
    const linkedRepos = getLinkedReposWithMetadata(data);
    const connected = linkedRepos.some((repo) => repo.enabled);

    let org = "agile-org";
    const firstRepoWithOrg = linkedRepos.find((repo) => String(repo.fullName || "").includes("/"));
    if (firstRepoWithOrg) {
      org = String(firstRepoWithOrg.fullName).split("/")[0] || org;
    }

    const latestTimestamp = linkedRepos
      .map((repo) => new Date(repo.lastCommit).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];

    return {
      connected,
      org,
      lastSynced: Number.isFinite(latestTimestamp) ? new Date(latestTimestamp).toISOString() : new Date().toISOString(),
    };
  });

  ipcMain.handle(CHANNELS.GITHUB.GET_LINKED_REPOS, async () => {
    const data = readGithubRepoData();
    return getLinkedReposWithMetadata(data);
  });

  ipcMain.handle(CHANNELS.GITHUB.GET_RECENT_PRS, async () => {
    const data = readGithubRepoData();
    const linkedRepos = getLinkedReposWithMetadata(data).filter((repo) => repo.enabled);
    const now = Date.now();

    return linkedRepos
      .slice(0, 10)
      .map((repo, index) => ({
        id: `pr-${index + 1}`,
        title: `Sync update for ${repo.name}`,
        author: "automation-bot",
        status: index % 3 === 0 ? "merged" : "open",
        linkedTask: null,
        repo: repo.fullName,
        createdAt: new Date(now - index * 90 * 60 * 1000).toISOString(),
        htmlUrl: `https://github.com/${repo.fullName}/pull/${100 + index}`,
      }));
  });

  ipcMain.handle(CHANNELS.GITHUB.TOGGLE_REPO_SYNC, async (_event, payload = {}) => {
    const repoId = String(payload.repoId || "").trim();
    if (!repoId) {
      throw new Error("repoId is required");
    }

    const enabled = Boolean(payload.enabled);
    const data = readGithubRepoData();
    const updated = applyToggleState(data, repoId, enabled);
    writeGithubRepoData(data);
    return updated;
  });

  ipcMain.handle(CHANNELS.GITHUB.SYNC_NOW, async () => {
    const data = readGithubRepoData();
    const now = new Date().toISOString();

    data.availableRepos = data.availableRepos.map((repo) => ({
      ...repo,
      updatedAt: now,
      hasWebhook: Boolean(repo.hasWebhook),
    }));
    data.linkedRepos = data.linkedRepos.map((repo) => ({
      ...repo,
      updatedAt: now,
    }));

    writeGithubRepoData(data);
    return {
      success: true,
      synced: data.linkedRepos.filter((repo) => Boolean(repo.enabled)).length,
    };
  });

  ipcMain.handle(CHANNELS.GITHUB.LINK_REPO_TO_PROJECT, async (_event, payload = {}) => {
    const repoId = String(payload.repoId || "").trim();
    const projectId = String(payload.projectId || "").trim();

    if (!repoId) {
      throw new Error("repoId is required");
    }
    if (!projectId) {
      throw new Error("projectId is required");
    }

    const data = readGithubRepoData();
    const linked = applyToggleState(data, repoId, true);
    if (linked) {
      linked.projectId = projectId;
      linked.updatedAt = new Date().toISOString();
    }

    writeGithubRepoData(data);
    return { success: true };
  });

  ipcMain.handle(CHANNELS.GITHUB.BULK_TOGGLE, async (_event, payload = {}) => {
    const repoIds = Array.isArray(payload.repoIds) ? payload.repoIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
    if (repoIds.length === 0) {
      throw new Error("repoIds must contain at least one repository id");
    }

    const enabled = Boolean(payload.enabled);
    const data = readGithubRepoData();
    const updated = repoIds.map((repoId) => applyToggleState(data, repoId, enabled)).filter(Boolean);
    writeGithubRepoData(data);
    return updated;
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

function webhooksDbPath() {
  return path.join(app.getPath("userData"), "webhooks.db.json");
}

function defaultWebhookData() {
  const now = new Date().toISOString();
  const previous = new Date(Date.now() - 6 * 60 * 1000).toISOString();

  return {
    webhooks: [
      {
        id: "webhook-1",
        url: "https://hooks.example.com/agile/events",
        events: ["task.updated", "sprint.completed"],
        status: "active",
        secret: "whsec_demo_123",
        lastTriggered: previous,
        successRate: 100,
        createdAt: previous,
        updatedAt: previous
      }
    ],
    deliveries: [
      {
        id: "delivery-1",
        webhookId: "webhook-1",
        eventType: "task.updated",
        status: "success",
        responseCode: 200,
        requestBody: { id: "task-1", status: "in_progress" },
        responseBody: { ok: true },
        triggeredAt: previous,
        attempts: 1
      },
      {
        id: "delivery-2",
        webhookId: "webhook-1",
        eventType: "sprint.completed",
        status: "failed",
        responseCode: 502,
        requestBody: { id: "sprint-24", outcome: "completed" },
        responseBody: { error: "Bad gateway" },
        triggeredAt: now,
        attempts: 1
      }
    ]
  };
}

function normalizeWebhookStatus(value) {
  return String(value || "active").trim().toLowerCase() === "inactive" ? "inactive" : "active";
}

function normalizeWebhookRecord(value) {
  return {
    id: String(value?.id || `webhook-${randomUUID()}`),
    url: String(value?.url || "").trim(),
    events: Array.isArray(value?.events) ? value.events.map((event) => String(event || "").trim()).filter(Boolean) : [],
    status: normalizeWebhookStatus(value?.status),
    secret: String(value?.secret || "").trim(),
    lastTriggered: value?.lastTriggered ? String(value.lastTriggered) : null,
    successRate: Math.max(0, Math.min(100, Number(value?.successRate || 0))),
    createdAt: String(value?.createdAt || new Date().toISOString()),
    updatedAt: String(value?.updatedAt || new Date().toISOString())
  };
}

function normalizeDeliveryRecord(value) {
  return {
    id: String(value?.id || `delivery-${randomUUID()}`),
    webhookId: String(value?.webhookId || "").trim(),
    eventType: String(value?.eventType || "manual"),
    status: String(value?.status || "success"),
    responseCode: Number(value?.responseCode || 0),
    requestBody: value?.requestBody || {},
    responseBody: value?.responseBody || {},
    triggeredAt: String(value?.triggeredAt || new Date().toISOString()),
    attempts: Math.max(1, Number(value?.attempts || 1))
  };
}

function readWebhooksData() {
  try {
    const filePath = webhooksDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultWebhookData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultWebhookData();
    return {
      webhooks: Array.isArray(parsed?.webhooks) ? parsed.webhooks.map((item) => normalizeWebhookRecord(item)) : defaults.webhooks,
      deliveries: Array.isArray(parsed?.deliveries) ? parsed.deliveries.map((item) => normalizeDeliveryRecord(item)) : defaults.deliveries
    };
  } catch {
    return defaultWebhookData();
  }
}

function writeWebhooksData(data) {
  fs.writeFileSync(webhooksDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function computeWebhookSuccessRate(webhookId, deliveries) {
  const items = deliveries.filter((entry) => String(entry.webhookId || "") === String(webhookId || ""));
  if (!items.length) return 0;
  const successCount = items.filter((entry) => String(entry.status || "") === "success").length;
  return Math.round((successCount / items.length) * 100);
}

function mapWebhookView(webhook, deliveries) {
  const last = deliveries
    .filter((entry) => String(entry.webhookId || "") === String(webhook.id || ""))
    .sort((a, b) => new Date(String(b.triggeredAt || 0)).getTime() - new Date(String(a.triggeredAt || 0)).getTime())[0];

  return {
    ...webhook,
    lastTriggered: webhook.lastTriggered || last?.triggeredAt || null,
    successRate: computeWebhookSuccessRate(webhook.id, deliveries)
  };
}

function isValidWebhookUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function retryDeliveryInStores(deliveryId) {
  const id = String(deliveryId || "").trim();
  if (!id) return false;

  const webhookData = readWebhooksData();
  const deliveryIndex = webhookData.deliveries.findIndex((entry) => String(entry.id || "") === id);
  if (deliveryIndex >= 0) {
    const now = new Date().toISOString();
    const current = webhookData.deliveries[deliveryIndex];
    webhookData.deliveries[deliveryIndex] = {
      ...current,
      status: "success",
      responseCode: 200,
      responseBody: { ok: true, retried: true },
      triggeredAt: now,
      attempts: Number(current.attempts || 1) + 1
    };

    const webhookIndex = webhookData.webhooks.findIndex((entry) => String(entry.id || "") === String(current.webhookId || ""));
    if (webhookIndex >= 0) {
      webhookData.webhooks[webhookIndex] = {
        ...webhookData.webhooks[webhookIndex],
        lastTriggered: now,
        updatedAt: now
      };
    }

    writeWebhooksData(webhookData);
    return true;
  }

  const monitoringData = readMonitoringData();
  const dlqIndex = monitoringData.webhookDlq.findIndex((entry) => String(entry.id || "") === id);
  if (dlqIndex >= 0) {
    monitoringData.webhookDlq.splice(dlqIndex, 1);
    writeMonitoringData(monitoringData);
    return true;
  }

  return false;
}

function registerWebhookHandlers() {
  ipcMain.handle(CHANNELS.WEBHOOKS.GET_ALL, async () => {
    try {
      const data = readWebhooksData();
      const items = data.webhooks
        .map((webhook) => mapWebhookView(webhook, data.deliveries))
        .sort((a, b) => new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime());
      return IPCResponse.success(items);
    } catch (error) {
      return IPCResponse.internalError("Failed to load webhooks", String(error));
    }
  });

  ipcMain.handle(CHANNELS.WEBHOOKS.CREATE, async (_event, payload = {}) => {
    try {
      const url = String(payload.url || "").trim();
      const events = Array.isArray(payload.events) ? payload.events.map((event) => String(event || "").trim()).filter(Boolean) : [];
      const secret = String(payload.secret || "").trim();

      if (!url) return IPCResponse.validation("url", "url is required");
      if (!isValidWebhookUrl(url)) return IPCResponse.validation("url", "url must be a valid HTTP(S) URL");
      if (!events.length) return IPCResponse.validation("events", "events must include at least one event");

      const data = readWebhooksData();
      const now = new Date().toISOString();
      const created = normalizeWebhookRecord({
        id: `webhook-${randomUUID()}`,
        url,
        events,
        secret,
        status: "active",
        lastTriggered: null,
        successRate: 0,
        createdAt: now,
        updatedAt: now
      });

      data.webhooks.unshift(created);
      writeWebhooksData(data);
      return IPCResponse.success(mapWebhookView(created, data.deliveries));
    } catch (error) {
      return IPCResponse.internalError("Failed to create webhook", String(error));
    }
  });

  ipcMain.handle(CHANNELS.WEBHOOKS.UPDATE, async (_event, payload = {}) => {
    try {
      const webhookId = String(payload.webhookId || "").trim();
      const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : null;
      if (!webhookId) return IPCResponse.validation("webhookId", "webhookId is required");
      if (!changes) return IPCResponse.validation("changes", "changes is required");

      const data = readWebhooksData();
      const index = data.webhooks.findIndex((entry) => String(entry.id || "") === webhookId);
      if (index < 0) return IPCResponse.notFound("Webhook");

      const current = data.webhooks[index];
      const nextUrl = Object.prototype.hasOwnProperty.call(changes, "url") ? String(changes.url || "").trim() : current.url;
      if (!nextUrl || !isValidWebhookUrl(nextUrl)) {
        return IPCResponse.validation("url", "url must be a valid HTTP(S) URL");
      }

      const updated = normalizeWebhookRecord({
        ...current,
        ...changes,
        url: nextUrl,
        events: Object.prototype.hasOwnProperty.call(changes, "events") ? changes.events : current.events,
        status: Object.prototype.hasOwnProperty.call(changes, "status") ? changes.status : current.status,
        updatedAt: new Date().toISOString()
      });

      data.webhooks[index] = updated;
      writeWebhooksData(data);
      return IPCResponse.success(mapWebhookView(updated, data.deliveries));
    } catch (error) {
      return IPCResponse.internalError("Failed to update webhook", String(error));
    }
  });

  ipcMain.handle(CHANNELS.WEBHOOKS.DELETE, async (_event, payload = {}) => {
    try {
      const webhookId = String(payload.webhookId || "").trim();
      if (!webhookId) return IPCResponse.validation("webhookId", "webhookId is required");

      const data = readWebhooksData();
      const before = data.webhooks.length;
      data.webhooks = data.webhooks.filter((entry) => String(entry.id || "") !== webhookId);
      if (data.webhooks.length === before) return IPCResponse.notFound("Webhook");

      data.deliveries = data.deliveries.filter((entry) => String(entry.webhookId || "") !== webhookId);
      writeWebhooksData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete webhook", String(error));
    }
  });

  ipcMain.handle(CHANNELS.WEBHOOKS.TEST, async (_event, payload = {}) => {
    try {
      const webhookId = String(payload.webhookId || "").trim();
      if (!webhookId) return IPCResponse.validation("webhookId", "webhookId is required");

      const data = readWebhooksData();
      const index = data.webhooks.findIndex((entry) => String(entry.id || "") === webhookId);
      if (index < 0) return IPCResponse.notFound("Webhook");

      const now = new Date().toISOString();
      const delivery = normalizeDeliveryRecord({
        id: `delivery-${randomUUID()}`,
        webhookId,
        eventType: "webhook.test",
        status: "success",
        responseCode: 200,
        requestBody: { webhookId, test: true },
        responseBody: { ok: true },
        triggeredAt: now,
        attempts: 1
      });

      data.deliveries.unshift(delivery);
      data.webhooks[index] = normalizeWebhookRecord({
        ...data.webhooks[index],
        lastTriggered: now,
        updatedAt: now
      });

      writeWebhooksData(data);
      return IPCResponse.success({ success: true, responseCode: 200 });
    } catch (error) {
      return IPCResponse.internalError("Failed to test webhook", String(error));
    }
  });

  ipcMain.handle(CHANNELS.WEBHOOKS.GET_DELIVERY_LOG, async (_event, payload = {}) => {
    try {
      const webhookId = String(payload.webhookId || "").trim();
      if (!webhookId) return IPCResponse.validation("webhookId", "webhookId is required");

      const data = readWebhooksData();
      const rows = data.deliveries
        .filter((entry) => String(entry.webhookId || "") === webhookId)
        .sort((a, b) => new Date(String(b.triggeredAt || 0)).getTime() - new Date(String(a.triggeredAt || 0)).getTime());
      return IPCResponse.success(rows);
    } catch (error) {
      return IPCResponse.internalError("Failed to load webhook delivery log", String(error));
    }
  });

  ipcMain.handle(CHANNELS.WEBHOOKS.RETRY_DELIVERY, async (_event, payload = {}) => {
    try {
      const deliveryId = String(payload.deliveryId || "").trim();
      if (!deliveryId) return IPCResponse.validation("deliveryId", "deliveryId is required");

      const retried = retryDeliveryInStores(deliveryId);
      if (!retried) return IPCResponse.notFound("Delivery");
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to retry webhook delivery", String(error));
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
      id: "",
      displayName: "",
      name: "",
      email: "",
      role: "",
      title: "",
      phone: "",
      bio: "",
      timezone: "UTC",
      githubUsername: "",
      slack: "",
      ssoProviders: [],
      twoFactorEnabled: false,
      twoFactorQrCodeUrl: null,
      avatarUrl: null,
      notifications: {
        emailDailyDigest: true,
        sprintAlerts: true,
        standupReminders: true
      }
    },
    sessions: [],
    activityStats: {
      tasksCompleted: 0,
      prsReviewed: 0,
      standupsAttended: 0
    },
    passwordHashHint: ""
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
    const merged = {
      userProfile: {
        ...defaults.userProfile,
        ...(parsed?.userProfile && typeof parsed.userProfile === "object" ? parsed.userProfile : {}),
        displayName: String(
          parsed?.userProfile?.displayName || parsed?.userProfile?.name || defaults.userProfile.displayName
        ),
        name: String(parsed?.userProfile?.name || parsed?.userProfile?.displayName || defaults.userProfile.name),
        title: String(parsed?.userProfile?.title || defaults.userProfile.title),
        phone: String(parsed?.userProfile?.phone || defaults.userProfile.phone),
        ssoProviders: Array.isArray(parsed?.userProfile?.ssoProviders)
          ? parsed.userProfile.ssoProviders
          : defaults.userProfile.ssoProviders,
        twoFactorEnabled: Boolean(parsed?.userProfile?.twoFactorEnabled),
        twoFactorQrCodeUrl: parsed?.userProfile?.twoFactorQrCodeUrl || null,
      },
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : defaults.sessions,
      activityStats: {
        ...defaults.activityStats,
        ...(parsed?.activityStats && typeof parsed.activityStats === "object" ? parsed.activityStats : {})
      },
      passwordHashHint: parsed?.passwordHashHint || defaults.passwordHashHint
    };

    const normalizedEmail = String(merged?.userProfile?.email || "").trim().toLowerCase();
    if (normalizedEmail === "demo@agilescrummaster.dev") {
      merged.userProfile = {
        ...defaults.userProfile,
        notifications: {
          ...defaults.userProfile.notifications,
          ...(merged?.userProfile?.notifications && typeof merged.userProfile.notifications === "object"
            ? merged.userProfile.notifications
            : {}),
        },
      };
      merged.sessions = [];
      writeProfileData(merged);
    }

    return merged;
  } catch {
    return defaultProfileData();
  }
}

function writeProfileData(data) {
  fs.writeFileSync(profileDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function getDesktopGatewayBaseUrl() {
  const candidate = String(
    process.env.DESKTOP_API_GATEWAY_URL ||
      process.env.API_GATEWAY_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000"
  ).trim();

  const normalized = candidate.replace(/\/+$/, "").replace(/\/api(?:\/v1)?$/i, "");
  console.log("[GATEWAY] Base URL resolved:", normalized, {
    DESKTOP_API_GATEWAY_URL: process.env.DESKTOP_API_GATEWAY_URL,
    API_GATEWAY_URL: process.env.API_GATEWAY_URL
  });
  return normalized;
}

function getDesktopSessionToken() {
  const session = getStoredSession();
  const token = String(session?.accessToken || "").trim();
  if (!token) {
    throw new Error("Desktop session not found. Please sign in.");
  }
  return token;
}

async function desktopGatewayRequest(method, pathname, body) {
  console.log("[GATEWAY] Request:", { method, pathname });
  
  try {
    const token = getDesktopSessionToken();
    console.log("[GATEWAY] Token found:", token.substring(0, 20) + "...");
  } catch (tokenError) {
    console.log("[GATEWAY] Token error:", String(tokenError));
    throw tokenError;
  }

  const token = getDesktopSessionToken();
  const baseUrl = getDesktopGatewayBaseUrl();
  const url = `${baseUrl}${pathname}`;
  console.log("[GATEWAY] Fetching:", url);
  
  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });
    console.log("[GATEWAY] Response status:", response.status);
  } catch (error) {
    console.log("[GATEWAY] Fetch error:", String(error));
    const detail = String(error instanceof Error ? error.message : error).trim();
    const lowered = detail.toLowerCase();
    const timedOut = lowered.includes("abort") || lowered.includes("timeout");
    throw new Error(
      timedOut
        ? `Gateway timeout after ${Math.round(timeoutMs / 1000)}s. Ensure API gateway is reachable at ${baseUrl}.`
        : `Unable to reach API gateway at ${baseUrl}. ${detail}`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.log("[GATEWAY] Error response:", { status: response.status, payload });
    const detail = String(payload?.detail || payload?.error || response.statusText || "Request failed").trim();
    throw new Error(`Gateway request failed (${response.status}): ${detail}`);
  }

  console.log("[GATEWAY] Success");
  return payload;
}

function firstArray(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) return payload[key];
  }

  const found = Object.values(payload).find((value) => Array.isArray(value));
  return Array.isArray(found) ? found : [];
}

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "owner" || role === "admin" || role === "member" || role === "viewer") {
    return role;
  }
  return "member";
}

function sessionUserFallback() {
  const session = getStoredSession();
  const user = session?.user && typeof session.user === "object" ? session.user : {};
  return {
    id: String(user?.id || "").trim(),
    name: String(user?.fullName || user?.name || user?.email || "").trim(),
    email: String(user?.email || "").trim(),
  };
}

function buildProfileFromLocalAndIdentity(identity, localProfile, timezone) {
  const displayName = String(identity?.name || localProfile?.displayName || localProfile?.name || identity?.email || "").trim();
  const email = String(identity?.email || localProfile?.email || "").trim();

  return {
    id: String(identity?.id || localProfile?.id || "").trim(),
    name: displayName,
    displayName,
    email,
    role: normalizeRole(identity?.role || localProfile?.role),
    title: String(localProfile?.title || "").trim(),
    bio: String(localProfile?.bio || "").trim(),
    phone: String(localProfile?.phone || "").trim(),
    timezone: String(timezone || localProfile?.timezone || "UTC").trim() || "UTC",
    githubUsername: String(localProfile?.githubUsername || "").trim(),
    slack: String(localProfile?.slack || "").trim(),
    avatarUrl: localProfile?.avatarUrl || null,
    notifications:
      localProfile?.notifications && typeof localProfile.notifications === "object"
        ? {
            emailDailyDigest: Boolean(localProfile.notifications.emailDailyDigest),
            sprintAlerts: Boolean(localProfile.notifications.sprintAlerts),
            standupReminders: Boolean(localProfile.notifications.standupReminders),
          }
        : {
            emailDailyDigest: true,
            sprintAlerts: true,
            standupReminders: true,
          },
  };
}

async function resolveCurrentProfile() {
  const localData = readProfileData();
  const localProfile = localData?.userProfile && typeof localData.userProfile === "object" ? localData.userProfile : {};

  try {
    const [mePayload, orgPayload] = await Promise.all([
      desktopGatewayRequest("GET", "/api/v1/auth/me"),
      desktopGatewayRequest("GET", "/api/v1/org").catch(() => null)
    ]);

    const user = mePayload?.user && typeof mePayload.user === "object" ? mePayload.user : {};
    const memberships = Array.isArray(mePayload?.memberships) ? mePayload.memberships : [];
    const activeOrgId = String(mePayload?.activeOrgId || "").trim();
    const activeMembership =
      memberships.find((item) => String(item?.org?.id || "") === activeOrgId) ||
      memberships[0] ||
      null;

    const identity = {
      id: String(user?.id || "").trim(),
      name: String(user?.fullName || user?.name || user?.email || "").trim(),
      email: String(user?.email || "").trim(),
      role: normalizeRole(activeMembership?.role),
    };

    return buildProfileFromLocalAndIdentity(identity, localProfile, String(orgPayload?.org?.timezone || "UTC").trim());
  } catch {
    const fallbackIdentity = sessionUserFallback();
    if (!fallbackIdentity.id && !fallbackIdentity.email) {
      throw new Error("Desktop session not found. Please sign in.");
    }
    return buildProfileFromLocalAndIdentity(fallbackIdentity, localProfile, String(localProfile?.timezone || "UTC").trim());
  }
}

function registerProfileHandlers() {
  ipcMain.handle(CHANNELS.PROFILE.GET, async () => {
    try {
      const profile = await resolveCurrentProfile();
      return IPCResponse.success(profile);
    } catch (error) {
      return IPCResponse.internalError("Failed to load profile", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.GET_CURRENT, async () => {
    try {
      const profile = await resolveCurrentProfile();
      return IPCResponse.success(profile);
    } catch (error) {
      return IPCResponse.internalError("Failed to load profile", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.UPDATE, async (_event, payload = {}) => {
    try {
      const data = readProfileData();
      const changes = payload && typeof payload === "object" ? payload : {};

      const nextDisplayName = String(changes.displayName || changes.name || data.userProfile.displayName || data.userProfile.name);

      data.userProfile = {
        ...data.userProfile,
        displayName: nextDisplayName,
        name: nextDisplayName,
        title: String(changes.title || data.userProfile.title || ""),
        bio: String(changes.bio || data.userProfile.bio || ""),
        phone: String(changes.phone || data.userProfile.phone || ""),
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
      return IPCResponse.internalError("Profile update is not available in API yet", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.CHANGE_EMAIL, async (_event, payload = {}) => {
    try {
      const newEmail = String(payload.newEmail || "").trim().toLowerCase();
      const password = String(payload.password || "");

      if (!newEmail || !newEmail.includes("@")) {
        return IPCResponse.validation("newEmail", "newEmail must be a valid email");
      }
      if (!password) {
        return IPCResponse.validation("password", "password is required");
      }

      const data = readProfileData();
      data.userProfile.email = newEmail;
      data.userProfile.updatedAt = new Date().toISOString();
      writeProfileData(data);

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to change email", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.CHANGE_PASSWORD, async (_event, payload = {}) => {
    try {
      return IPCResponse.validation(
        "currentPassword",
        "Password change endpoint is not exposed by API. Use forgot/reset password flow."
      );
    } catch (error) {
      return IPCResponse.internalError("Failed to change password", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.UPLOAD_AVATAR, async (_event, payload = {}) => {
    try {
      return IPCResponse.validation("base64Image", "Avatar update endpoint is not exposed by API yet.");
    } catch (error) {
      return IPCResponse.internalError("Failed to upload avatar", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.GET_ACTIVITY_STATS, async () => {
    try {
      const [tasksPayload, standupsPayload] = await Promise.all([
        desktopGatewayRequest("GET", "/api/v1/tasks").catch(() => ({ items: [] })),
        desktopGatewayRequest("GET", "/api/v1/standup").catch(() => ({ items: [] }))
      ]);

      const tasks = firstArray(tasksPayload, ["items", "tasks"]);
      const standups = firstArray(standupsPayload, ["items", "standups"]);

      const tasksCompleted = tasks.filter((task) => {
        const status = String(task?.status || "").trim().toLowerCase();
        return status === "done" || status === "completed" || status === "closed";
      }).length;

      return IPCResponse.success({
        tasksCompleted,
        prsReviewed: 0,
        standupsAttended: standups.length
      });
    } catch (error) {
      try {
        const data = readProfileData();
        return IPCResponse.success(data?.activityStats || defaultProfileData().activityStats);
      } catch {
        return IPCResponse.internalError("Failed to load profile activity stats", String(error));
      }
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.GET_SESSIONS, async () => {
    try {
      const data = readProfileData();
      const session = getStoredSession();
      const currentSession = {
        sessionId: "session-current",
        device: `Desktop App (${process.platform})`,
        ipAddress: "127.0.0.1",
        lastActiveAt: new Date().toISOString(),
        current: true,
      };

      const historicalSessions = Array.isArray(data.sessions)
        ? data.sessions.filter((item) => !Boolean(item?.current))
        : [];

      if (!session?.accessToken) {
        return IPCResponse.success([]);
      }

      return IPCResponse.success([currentSession, ...historicalSessions]);
    } catch (error) {
      return IPCResponse.internalError("Failed to load active sessions", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.REVOKE_SESSION, async (_event, payload = {}) => {
    try {
      const sessionId = String(payload.sessionId || "").trim();
      if (!sessionId) {
        return IPCResponse.validation("sessionId", "sessionId is required");
      }

      const data = readProfileData();
      const index = (Array.isArray(data.sessions) ? data.sessions : []).findIndex(
        (session) => String(session.sessionId || "") === sessionId
      );
      if (index < 0) {
        return IPCResponse.notFound("Session");
      }

      if (Boolean(data.sessions[index]?.current)) {
        return IPCResponse.validation("sessionId", "current session cannot be revoked");
      }

      data.sessions.splice(index, 1);
      writeProfileData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to revoke session", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROFILE.TOGGLE_2FA, async (_event, payload = {}) => {
    try {
      const enabled = Boolean(payload.enabled);
      const data = readProfileData();

      data.userProfile.twoFactorEnabled = enabled;
      data.userProfile.twoFactorQrCodeUrl = enabled
        ? `otpauth://totp/AgileScrumMaster:${encodeURIComponent(String(data.userProfile.email || "user"))}?secret=ASM${Math.random().toString(36).slice(2, 12).toUpperCase()}&issuer=AgileScrumMaster`
        : null;
      data.userProfile.updatedAt = new Date().toISOString();
      writeProfileData(data);

      return IPCResponse.success({
        success: true,
        qrCodeUrl: data.userProfile.twoFactorQrCodeUrl || undefined,
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to toggle 2FA", String(error));
    }
  });
}

function standupDbPath() {
  return path.join(app.getPath("userData"), "standup.db.json");
}

function defaultStandupData() {
  return {
    entries: []
  };
}

function readStandupData() {
  try {
    const filePath = standupDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultStandupData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      entries: Array.isArray(parsed?.entries) ? parsed.entries : []
    };
  } catch {
    return defaultStandupData();
  }
}

function writeStandupData(data) {
  fs.writeFileSync(standupDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function standupDateKey(dateInput) {
  const raw = String(dateInput || "").trim();
  if (raw) {
    const dt = new Date(raw);
    if (Number.isFinite(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function standupSummaryText(entries, date) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    return `Standup summary for ${date}: No updates submitted.`;
  }

  const lines = [`Standup summary for ${date}`];
  for (const row of rows) {
    const name = String(row.userName || row.userId || "Team member");
    const yesterday = String(row.yesterday || "No update").trim();
    const today = String(row.today || "No update").trim();
    const blockers = String(row.blockers || "None").trim();
    lines.push(`- ${name}: Yesterday ${yesterday}; Today ${today}; Blockers ${blockers}.`);
  }
  return lines.join("\n");
}

function registerStandupHandlers() {
  ipcMain.handle(CHANNELS.STANDUP.GET_TODAY, async () => {
    try {
      const date = standupDateKey();
      const data = readStandupData();
      const items = data.entries.filter((entry) => String(entry.date || "") === date);
      return IPCResponse.success(items);
    } catch (error) {
      return IPCResponse.internalError("Failed to load today's standup entries", String(error));
    }
  });

  ipcMain.handle(CHANNELS.STANDUP.SUBMIT, async (_event, payload = {}) => {
    try {
      const userId = String(payload.userId || "").trim();
      const yesterday = String(payload.yesterday || "").trim();
      const today = String(payload.today || "").trim();
      const blockers = String(payload.blockers || "").trim();

      if (!userId) return IPCResponse.validation("userId", "userId is required");
      if (!yesterday && !today && !blockers) {
        return IPCResponse.validation("today", "At least one standup field is required");
      }

      const profile = readProfileData();
      const date = standupDateKey();
      const data = readStandupData();
      const idx = data.entries.findIndex((entry) => String(entry.userId || "") === userId && String(entry.date || "") === date);
      const userName = String(profile?.userProfile?.displayName || profile?.userProfile?.name || userId);

      const nextEntry = {
        id: idx >= 0 ? String(data.entries[idx].id || `standup-${Date.now()}`) : `standup-${Date.now()}`,
        date,
        userId,
        userName,
        yesterday,
        today,
        blockers,
        submittedAt: new Date().toISOString()
      };

      if (idx >= 0) {
        data.entries[idx] = nextEntry;
      } else {
        data.entries.push(nextEntry);
      }
      writeStandupData(data);
      return IPCResponse.success(nextEntry);
    } catch (error) {
      return IPCResponse.internalError("Failed to submit standup", String(error));
    }
  });

  ipcMain.handle(CHANNELS.STANDUP.GET_HISTORY, async (_event, payload = {}) => {
    try {
      const date = standupDateKey(payload.date);
      const data = readStandupData();
      const items = data.entries.filter((entry) => String(entry.date || "") === date);
      return IPCResponse.success(items);
    } catch (error) {
      return IPCResponse.internalError("Failed to load standup history", String(error));
    }
  });

  ipcMain.handle(CHANNELS.STANDUP.GENERATE_SUMMARY, async (_event, payload = {}) => {
    try {
      const date = standupDateKey(payload.date);
      const data = readStandupData();
      const items = data.entries.filter((entry) => String(entry.date || "") === date);
      const summary = standupSummaryText(items, date);
      return IPCResponse.success({ summary });
    } catch (error) {
      return IPCResponse.internalError("Failed to generate standup summary", String(error));
    }
  });
}

function sprintOverviewDbPath() {
  return path.join(app.getPath("userData"), "sprint.overview.db.json");
}

function defaultSprintOverviewData() {
  return {
    currentSprintId: "sprint-24",
    sprints: {
      "sprint-24": {
        id: "sprint-24",
        name: "Sprint 24",
        goal: "Stabilize desktop IPC wiring for settings and sprint workflows.",
        startDate: "2026-04-01",
        endDate: "2026-04-15",
        status: "active",
      },
    },
    tasksBySprint: {
      "sprint-24": [
        { id: "sp24-1", title: "Wire settings profile IPC", status: "done", assignee: "Demo User" },
        { id: "sp24-2", title: "Wire settings team IPC", status: "in_progress", assignee: "Sprint Lead" },
        { id: "sp24-3", title: "Wire skill-gap IPC", status: "blocked", assignee: "Frontend Engineer" },
        { id: "sp24-4", title: "Validate sprint overview flow", status: "todo", assignee: "Demo User" },
      ],
    },
    eventsBySprint: {
      "sprint-24": [
        { id: "sp24-ev-1", type: "review", title: "Sprint Review", scheduledAt: "2026-04-16T14:00:00.000Z" },
        { id: "sp24-ev-2", type: "retro", title: "Sprint Retrospective", scheduledAt: "2026-04-17T14:00:00.000Z" },
      ],
    },
  };
}

function readSprintOverviewData() {
  try {
    const filePath = sprintOverviewDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultSprintOverviewData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultSprintOverviewData();
    return {
      currentSprintId: String(parsed?.currentSprintId || defaults.currentSprintId),
      sprints: parsed?.sprints && typeof parsed.sprints === "object" ? parsed.sprints : defaults.sprints,
      tasksBySprint:
        parsed?.tasksBySprint && typeof parsed.tasksBySprint === "object"
          ? parsed.tasksBySprint
          : defaults.tasksBySprint,
      eventsBySprint:
        parsed?.eventsBySprint && typeof parsed.eventsBySprint === "object"
          ? parsed.eventsBySprint
          : defaults.eventsBySprint,
    };
  } catch {
    return defaultSprintOverviewData();
  }
}

function writeSprintOverviewData(data) {
  fs.writeFileSync(sprintOverviewDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function resolveSprintRecord(data, sprintId) {
  const requested = String(sprintId || "").trim();
  const byRequested = requested ? data.sprints?.[requested] : null;
  const byCurrent = data.sprints?.[String(data.currentSprintId || "")] || null;
  return byRequested || byCurrent || null;
}

function applySprintChanges(current, changes) {
  const source = changes && typeof changes === "object" ? changes : {};
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(source, "name")) {
    next.name = String(source.name || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, "goal")) {
    next.goal = String(source.goal || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, "startDate")) {
    next.startDate = String(source.startDate || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, "endDate")) {
    next.endDate = String(source.endDate || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(source, "status")) {
    next.status = String(source.status || "").trim().toLowerCase();
  }
  if (Object.prototype.hasOwnProperty.call(source, "plannedPoints")) {
    next.plannedPoints = Number(source.plannedPoints || 0);
  }
  if (Object.prototype.hasOwnProperty.call(source, "completedPoints")) {
    next.completedPoints = Number(source.completedPoints || 0);
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function registerSprintHandlers() {
  ipcMain.handle(CHANNELS.SPRINT.GET_BY_ID, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const data = readSprintOverviewData();
      const sprint = data.sprints?.[sprintId] || null;
      if (!sprint) {
        return IPCResponse.notFound("Sprint");
      }
      return IPCResponse.success(sprint);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint by id", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT.GET_CURRENT, async (_event, payload = {}) => {
    try {
      const data = readSprintOverviewData();
      const sprint = resolveSprintRecord(data, payload.sprintId);
      if (!sprint) {
        return IPCResponse.notFound("Sprint");
      }
      return IPCResponse.success(sprint);
    } catch (error) {
      return IPCResponse.internalError("Failed to load current sprint", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT.GET_TASKS, async (_event, payload = {}) => {
    try {
      const data = readSprintOverviewData();
      const sprint = resolveSprintRecord(data, payload.sprintId);
      if (!sprint) {
        return IPCResponse.notFound("Sprint");
      }
      const tasks = Array.isArray(data.tasksBySprint?.[String(sprint.id || "")])
        ? data.tasksBySprint[String(sprint.id || "")]
        : [];
      return IPCResponse.success(tasks);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint tasks", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT.UPDATE, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : null;

      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const data = readSprintOverviewData();
      const current = data.sprints?.[sprintId] || null;
      if (!current) {
        return IPCResponse.notFound("Sprint");
      }

      const next = applySprintChanges(current, changes);
      const status = String(next.status || "").trim().toLowerCase();
      if (status && !["planning", "active", "completed", "cancelled"].includes(status)) {
        return IPCResponse.validation("status", "status must be planning|active|completed|cancelled");
      }
      if (!String(next.name || "").trim()) {
        return IPCResponse.validation("name", "name cannot be empty");
      }

      data.sprints[sprintId] = next;
      if (!data.currentSprintId) {
        data.currentSprintId = sprintId;
      }
      writeSprintOverviewData(data);
      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to update sprint", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT.UPDATE_STATUS, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      const status = String(payload.status || "").trim().toLowerCase();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }
      if (!["planning", "active", "completed", "cancelled"].includes(status)) {
        return IPCResponse.validation("status", "status must be planning|active|completed|cancelled");
      }

      const data = readSprintOverviewData();
      const current = data.sprints?.[sprintId] || null;
      if (!current) {
        return IPCResponse.notFound("Sprint");
      }

      const updated = applySprintChanges(current, { status });
      data.sprints[sprintId] = updated;
      if (!data.currentSprintId) {
        data.currentSprintId = sprintId;
      }
      writeSprintOverviewData(data);
      return IPCResponse.success(updated);
    } catch (error) {
      return IPCResponse.internalError("Failed to update sprint status", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT.DELETE, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const data = readSprintOverviewData();
      if (!data.sprints?.[sprintId]) {
        return IPCResponse.notFound("Sprint");
      }

      delete data.sprints[sprintId];
      delete data.tasksBySprint[sprintId];
      delete data.eventsBySprint[sprintId];

      if (String(data.currentSprintId || "") === sprintId) {
        const remainingIds = Object.keys(data.sprints || {});
        data.currentSprintId = remainingIds.length ? remainingIds[0] : "";
      }

      writeSprintOverviewData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete sprint", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT.GET_EVENTS, async (_event, payload = {}) => {
    try {
      const data = readSprintOverviewData();
      const sprint = resolveSprintRecord(data, payload.sprintId);
      if (!sprint) {
        return IPCResponse.notFound("Sprint");
      }
      const events = Array.isArray(data.eventsBySprint?.[String(sprint.id || "")])
        ? data.eventsBySprint[String(sprint.id || "")]
        : [];
      return IPCResponse.success(events);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint events", String(error));
    }
  });
}

function registerSprintsHandlers() {
  function getSprintProjectMaps() {
    const projects = readProjectsData();
    const projectNameById = new Map((Array.isArray(projects.projects) ? projects.projects : []).map((p) => [String(p.id || ""), String(p.name || "")]));
    const projectBySprintId = new Map();
    for (const [projectId, list] of Object.entries(projects.sprintsByProject || {})) {
      const rows = Array.isArray(list) ? list : [];
      for (const item of rows) {
        const sprintId = String(item?.id || "").trim();
        if (sprintId) {
          projectBySprintId.set(sprintId, String(projectId || ""));
        }
      }
    }
    return { projects, projectBySprintId, projectNameById };
  }

  ipcMain.handle(CHANNELS.SPRINTS.GET_ALL, async (_event, payload = {}) => {
    try {
      const statusFilter = String(payload.status || "").trim().toLowerCase();
      const projectFilter = String(payload.projectId || "").trim();
      const startFilter = String(payload.startDate || "").trim();
      const endFilter = String(payload.endDate || "").trim();

      const overview = readSprintOverviewData();
      const { projectBySprintId, projectNameById } = getSprintProjectMaps();

      const startMs = startFilter ? new Date(startFilter).getTime() : NaN;
      const endMs = endFilter ? new Date(endFilter).getTime() : NaN;

      const items = Object.values(overview.sprints || {})
        .map((row) => {
          const id = String(row?.id || "");
          const projectId = String(projectBySprintId.get(id) || "");
          const plannedPoints = Math.max(0, Number(row?.plannedPoints || 0));
          const completedPoints = Math.max(0, Number(row?.completedPoints || 0));
          const completionPct = plannedPoints > 0 ? Math.round((completedPoints / plannedPoints) * 100) : 0;
          return {
            ...row,
            projectId,
            projectName: projectNameById.get(projectId) || "",
            plannedPoints,
            completedPoints,
            velocity: completedPoints,
            completionPct
          };
        })
        .filter((row) => {
          if (statusFilter && String(row.status || "").toLowerCase() !== statusFilter) {
            return false;
          }
          if (projectFilter && String(row.projectId || "") !== projectFilter) {
            return false;
          }

          const sprintStartMs = row.startDate ? new Date(String(row.startDate)).getTime() : NaN;
          const sprintEndMs = row.endDate ? new Date(String(row.endDate)).getTime() : NaN;
          if (Number.isFinite(startMs) && Number.isFinite(sprintEndMs) && sprintEndMs < startMs) {
            return false;
          }
          if (Number.isFinite(endMs) && Number.isFinite(sprintStartMs) && sprintStartMs > endMs) {
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          const priority = { active: 0, planning: 1, completed: 2, cancelled: 3 };
          const aPriority = priority[String(a.status || "").toLowerCase()] ?? 9;
          const bPriority = priority[String(b.status || "").toLowerCase()] ?? 9;
          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }
          const aStart = new Date(String(a.startDate || 0)).getTime();
          const bStart = new Date(String(b.startDate || 0)).getTime();
          return bStart - aStart;
        });

      return IPCResponse.success(items);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprints", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.GET_BY_ID, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const overview = readSprintOverviewData();
      const sprint = overview.sprints?.[sprintId] || null;
      if (!sprint) {
        return IPCResponse.notFound("Sprint");
      }

      const { projectBySprintId, projectNameById } = getSprintProjectMaps();
      const projectId = String(projectBySprintId.get(sprintId) || "");

      return IPCResponse.success({
        ...sprint,
        projectId,
        projectName: projectNameById.get(projectId) || ""
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint by id", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.GET_TASKS, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const overview = readSprintOverviewData();
      if (!overview.sprints?.[sprintId]) {
        return IPCResponse.notFound("Sprint");
      }

      const tasks = Array.isArray(overview.tasksBySprint?.[sprintId]) ? overview.tasksBySprint[sprintId] : [];
      return IPCResponse.success(tasks);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint tasks", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.GET_SUMMARY, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const overview = readSprintOverviewData();
      const sprint = overview.sprints?.[sprintId] || null;
      if (!sprint) {
        return IPCResponse.notFound("Sprint");
      }

      const tasks = Array.isArray(overview.tasksBySprint?.[sprintId]) ? overview.tasksBySprint[sprintId] : [];
      const done = tasks.filter((task) => {
        const normalized = String(task.status || "").trim().toLowerCase();
        return normalized === "done" || normalized === "completed";
      }).length;
      const total = tasks.length;
      const plannedPoints = Math.max(0, Number(sprint.plannedPoints || 0));
      const completedPoints = Math.max(0, Number(sprint.completedPoints || 0));
      const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;
      const eventRows = Array.isArray(overview.eventsBySprint?.[sprintId]) ? overview.eventsBySprint[sprintId] : [];

      return IPCResponse.success({
        sprintId,
        totalTasks: total,
        completedTasks: done,
        blockedTasks: tasks.filter((task) => String(task.status || "").toLowerCase() === "blocked").length,
        plannedPoints,
        completedPoints,
        velocity: completedPoints,
        completionPct,
        burndown: {
          idealRemaining: Math.max(0, total - done),
          actualRemaining: Math.max(0, total - done)
        },
        upcomingEvents: eventRows
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint summary", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.GET_CONTRIBUTIONS, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const overview = readSprintOverviewData();
      if (!overview.sprints?.[sprintId]) {
        return IPCResponse.notFound("Sprint");
      }

      const tasks = Array.isArray(overview.tasksBySprint?.[sprintId]) ? overview.tasksBySprint[sprintId] : [];
      const byMember = new Map();
      for (const task of tasks) {
        const memberName = String(task.assignee || "Unassigned");
        const current = byMember.get(memberName) || {
          memberId: memberName.toLowerCase().replace(/\s+/g, "-"),
          name: memberName,
          tasksCompleted: 0,
          totalTasks: 0,
          pointsCompleted: 0
        };
        current.totalTasks += 1;
        const status = String(task.status || "").toLowerCase();
        if (status === "done" || status === "completed") {
          current.tasksCompleted += 1;
          current.pointsCompleted += Math.max(0, Number(task.story_points || 0));
        }
        byMember.set(memberName, current);
      }

      return IPCResponse.success(Array.from(byMember.values()));
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint contributions", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.UPDATE, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : null;
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const overview = readSprintOverviewData();
      const current = overview.sprints?.[sprintId] || null;
      if (!current) {
        return IPCResponse.notFound("Sprint");
      }

      const next = applySprintChanges(current, changes);
      const status = String(next.status || "").trim().toLowerCase();
      if (status && !["planning", "active", "completed", "cancelled"].includes(status)) {
        return IPCResponse.validation("status", "status must be planning|active|completed|cancelled");
      }
      if (!String(next.name || "").trim()) {
        return IPCResponse.validation("name", "name cannot be empty");
      }

      overview.sprints[sprintId] = next;
      writeSprintOverviewData(overview);

      const projects = readProjectsData();
      for (const [projectId, list] of Object.entries(projects.sprintsByProject || {})) {
        const rows = Array.isArray(list) ? list : [];
        const rowIndex = rows.findIndex((row) => String(row?.id || "") === sprintId);
        if (rowIndex >= 0) {
          rows[rowIndex] = {
            ...rows[rowIndex],
            id: sprintId,
            name: String(next.name || ""),
            status: String(next.status || "planning"),
            startDate: String(next.startDate || ""),
            endDate: String(next.endDate || "")
          };
          projects.sprintsByProject[projectId] = rows;
          break;
        }
      }
      writeProjectsData(projects);

      return IPCResponse.success(next);
    } catch (error) {
      return IPCResponse.internalError("Failed to update sprint", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.DELETE, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "").trim();
      if (!sprintId) {
        return IPCResponse.validation("sprintId", "sprintId is required");
      }

      const overview = readSprintOverviewData();
      if (!overview.sprints?.[sprintId]) {
        return IPCResponse.notFound("Sprint");
      }
      delete overview.sprints[sprintId];
      delete overview.tasksBySprint[sprintId];
      delete overview.eventsBySprint[sprintId];
      if (String(overview.currentSprintId || "") === sprintId) {
        const remainingIds = Object.keys(overview.sprints || {});
        overview.currentSprintId = remainingIds.length ? remainingIds[0] : "";
      }
      writeSprintOverviewData(overview);

      const projects = readProjectsData();
      for (const [projectId, list] of Object.entries(projects.sprintsByProject || {})) {
        const rows = Array.isArray(list) ? list : [];
        projects.sprintsByProject[projectId] = rows.filter((row) => String(row?.id || "") !== sprintId);
      }
      writeProjectsData(projects);

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete sprint", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINTS.CREATE, async (_event, payload = {}) => {
    try {
      const name = String(payload.name || "").trim();
      const goal = String(payload.goal || "").trim();
      const startDate = String(payload.startDate || "").trim();
      const endDate = String(payload.endDate || "").trim();
      const projectId = String(payload.projectId || "").trim();

      if (!name) return IPCResponse.validation("name", "name is required");
      if (!startDate) return IPCResponse.validation("startDate", "startDate is required");
      if (!endDate) return IPCResponse.validation("endDate", "endDate is required");
      if (!projectId) return IPCResponse.validation("projectId", "projectId is required");

      const sprintId = `sprint-${Date.now()}`;
      const overview = readSprintOverviewData();
      overview.sprints[sprintId] = {
        id: sprintId,
        name,
        goal,
        startDate,
        endDate,
        status: "planning",
        plannedPoints: 0,
        completedPoints: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      overview.tasksBySprint[sprintId] = [];
      overview.eventsBySprint[sprintId] = [];
      writeSprintOverviewData(overview);

      const projects = readProjectsData();
      const rows = Array.isArray(projects.sprintsByProject?.[projectId]) ? projects.sprintsByProject[projectId] : [];
      projects.sprintsByProject[projectId] = [
        ...rows,
        { id: sprintId, name, status: "planning", startDate, endDate }
      ];
      writeProjectsData(projects);

      return IPCResponse.success({
        id: sprintId,
        name,
        goal,
        startDate,
        endDate,
        status: "planning",
        projectId,
        plannedPoints: 0,
        completedPoints: 0,
        velocity: 0,
        completionPct: 0
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to create sprint", String(error));
    }
  });
}

function sprintPlanDbPath() {
  return path.join(app.getPath("userData"), "sprint.plan.db.json");
}

function defaultSprintPlanData() {
  return {
    backlog: [
      { id: "bl-101", title: "Harden auth refresh flow", story_points: 5, priority: "high", tech_tags: ["auth", "backend"], project_id: "agile-scrum-master", status: "ready" },
      { id: "bl-102", title: "Improve board loading states", story_points: 3, priority: "medium", tech_tags: ["frontend"], project_id: "agile-scrum-master", status: "ready" },
      { id: "bl-103", title: "Add webhook retry policy", story_points: 8, priority: "high", tech_tags: ["integrations"], project_id: "agile-scrum-master", status: "ready" },
      { id: "bl-104", title: "Refine sprint report export", story_points: 5, priority: "medium", tech_tags: ["reports"], project_id: "agile-scrum-master", status: "ready" },
      { id: "bl-105", title: "Stabilize desktop session restore", story_points: 8, priority: "high", tech_tags: ["electron"], project_id: "agile-scrum-master", status: "ready" },
      { id: "bl-106", title: "Add roadmap filtering", story_points: 2, priority: "low", tech_tags: ["ui"], project_id: "agile-scrum-master", status: "ready" }
    ]
  };
}

function readSprintPlanData() {
  try {
    const filePath = sprintPlanDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultSprintPlanData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultSprintPlanData();
    return {
      backlog: Array.isArray(parsed?.backlog) ? parsed.backlog : defaults.backlog
    };
  } catch {
    return defaultSprintPlanData();
  }
}

function writeSprintPlanData(data) {
  fs.writeFileSync(sprintPlanDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function sprintPlanPriorityValue(priority) {
  const normalized = String(priority || "").trim().toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  return 1;
}

function sprintLengthInDays(startDate, endDate) {
  const startMs = new Date(String(startDate || "")).getTime();
  const endMs = new Date(String(endDate || "")).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 10;
  }
  return Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1);
}

function registerSprintPlanHandlers() {
  ipcMain.handle(CHANNELS.SPRINT_PLAN.GET_BACKLOG, async () => {
    try {
      const data = readSprintPlanData();
      const items = Array.isArray(data.backlog) ? data.backlog : [];
      return IPCResponse.success(items);
    } catch (error) {
      return IPCResponse.internalError("Failed to load sprint backlog", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT_PLAN.GET_TEAM_CAPACITY, async (_event, payload = {}) => {
    try {
      const startDate = String(payload.startDate || "").trim();
      const endDate = String(payload.endDate || "").trim();
      const lengthDays = sprintLengthInDays(startDate, endDate);
      const developers = readDevelopersData();
      const members = (Array.isArray(developers.members) ? developers.members : [])
        .filter((member) => String(member.status || "active") === "active")
        .map((member) => {
          const maxCapacity = Math.max(2, Math.round(lengthDays * 1.5));
          return {
            developerId: String(member.id || ""),
            name: String(member.name || "Unknown"),
            availabilityStatus: "available",
            maxCapacity,
            currentLoad: 0,
            availableCapacity: maxCapacity
          };
        });

      const totalPoints = members.reduce((sum, member) => sum + Number(member.availableCapacity || 0), 0);
      return IPCResponse.success({ totalPoints, members });
    } catch (error) {
      return IPCResponse.internalError("Failed to load team capacity", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT_PLAN.AI_SUGGEST, async (_event, payload = {}) => {
    try {
      const capacity = Math.max(1, Number(payload.capacity || 0));
      const sprintLength = Math.max(1, Number(payload.sprintLength || 10));
      const data = readSprintPlanData();
      const readyBacklog = (Array.isArray(data.backlog) ? data.backlog : [])
        .filter((item) => String(item.status || "ready").toLowerCase() === "ready")
        .sort((a, b) => {
          const byPriority = sprintPlanPriorityValue(b.priority) - sprintPlanPriorityValue(a.priority);
          if (byPriority !== 0) return byPriority;
          return Number(a.story_points || 0) - Number(b.story_points || 0);
        });

      const normalizedCapacity = Math.max(capacity, Math.round(sprintLength * 2));
      const selected = [];
      let usedPoints = 0;
      for (const item of readyBacklog) {
        const points = Math.max(0, Number(item.story_points || 0));
        if (selected.length > 0 && usedPoints + points > normalizedCapacity) {
          continue;
        }
        selected.push(item);
        usedPoints += points;
        if (usedPoints >= normalizedCapacity) {
          break;
        }
      }

      return IPCResponse.success(selected);
    } catch (error) {
      return IPCResponse.internalError("Failed to generate AI sprint suggestion", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SPRINT_PLAN.SAVE_PLAN, async (_event, payload = {}) => {
    try {
      const name = String(payload.name || "").trim();
      const goal = String(payload.goal || "").trim();
      const startDate = String(payload.startDate || "").trim();
      const endDate = String(payload.endDate || "").trim();
      const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.map((id) => String(id || "").trim()).filter(Boolean) : [];

      if (!name) return IPCResponse.validation("name", "name is required");
      if (!startDate) return IPCResponse.validation("startDate", "startDate is required");
      if (!endDate) return IPCResponse.validation("endDate", "endDate is required");

      const sprintId = `sprint-${Date.now()}`;
      const sprintData = readSprintOverviewData();
      const planData = readSprintPlanData();

      const createdSprint = {
        id: sprintId,
        name,
        goal,
        startDate,
        endDate,
        status: "planning",
        createdAt: new Date().toISOString(),
        plannedPoints: 0,
        completedPoints: 0
      };

      sprintData.sprints[sprintId] = createdSprint;
      sprintData.currentSprintId = sprintData.currentSprintId || sprintId;

      const selectedBacklog = (Array.isArray(planData.backlog) ? planData.backlog : []).filter((item) => taskIds.includes(String(item.id || "")));
      sprintData.tasksBySprint[sprintId] = selectedBacklog.map((item) => ({
        id: String(item.id),
        title: String(item.title || "Task"),
        status: "todo",
        assignee: "Unassigned",
        story_points: Number(item.story_points || 0),
        priority: String(item.priority || "medium")
      }));

      createdSprint.plannedPoints = sprintData.tasksBySprint[sprintId].reduce((sum, task) => sum + Number(task.story_points || 0), 0);
      sprintData.eventsBySprint[sprintId] = [
        { id: `${sprintId}-ev-review`, type: "review", title: "Sprint Review", scheduledAt: `${endDate}T14:00:00.000Z` },
        { id: `${sprintId}-ev-retro`, type: "retro", title: "Sprint Retrospective", scheduledAt: `${endDate}T15:00:00.000Z` }
      ];
      writeSprintOverviewData(sprintData);

      const projectsData = readProjectsData();
      const projectId = String(payload.projectId || projectsData.projects?.[0]?.id || "agile-scrum-master");
      const existingSprints = Array.isArray(projectsData.sprintsByProject?.[projectId]) ? projectsData.sprintsByProject[projectId] : [];
      projectsData.sprintsByProject[projectId] = [
        ...existingSprints,
        { id: sprintId, name, status: "planning", startDate, endDate }
      ];
      writeProjectsData(projectsData);

      const usedTaskIds = new Set(taskIds);
      const remainingBacklog = (Array.isArray(planData.backlog) ? planData.backlog : []).map((item) => {
        if (usedTaskIds.has(String(item.id || ""))) {
          return { ...item, status: "planned", sprint_id: sprintId };
        }
        return item;
      });
      writeSprintPlanData({ backlog: remainingBacklog });

      return IPCResponse.success(createdSprint);
    } catch (error) {
      return IPCResponse.internalError("Failed to save sprint plan", String(error));
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
  ipcMain.handle(CHANNELS.PROJECTS.GET_ALL, async () => {
    try {
      const data = readProjectsData();
      return IPCResponse.success(Array.isArray(data.projects) ? data.projects : []);
    } catch (error) {
      return IPCResponse.internalError("Failed to load projects", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PROJECTS.CREATE, async (_event, payload = {}) => {
    try {
      const name = String(payload.name || "").trim();
      const description = String(payload.description || "").trim();
      if (!name) {
        return IPCResponse.validation("name", "name is required");
      }

      const data = readProjectsData();
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `project-${Date.now()}`;
      const projectId = `project-${Date.now()}`;
      const project = {
        id: projectId,
        name,
        slug,
        description,
        status: "active",
        owner: "Demo User",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: null,
        linkedRepos: [],
        github_repo: "",
        jira_project_key: "",
        tech_stack: [],
        stats: { totalTasks: 0, openTasks: 0, completedTasks: 0 },
        activityFeed: [],
        archived: false,
        createdAt: new Date().toISOString()
      };

      data.projects = [...(Array.isArray(data.projects) ? data.projects : []), project];
      data.sprintsByProject[projectId] = [];
      data.membersByProject[projectId] = [];
      writeProjectsData(data);
      return IPCResponse.success(project);
    } catch (error) {
      return IPCResponse.internalError("Failed to create project", String(error));
    }
  });

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
        attachments: [
          {
            id: "att-1",
            fileName: "task-note.txt",
            filePath: "C:/attachments/task-note.txt",
            createdAt
          }
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
    attachments: [],
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

function normalizeTaskStatus(value) {
  const raw = String(value || "todo").trim().toLowerCase();
  const aliases = {
    "to do": "todo",
    doing: "in_progress",
    "in progress": "in_progress",
    "in-progress": "in_progress",
    "in review": "in_review",
    "in-review": "in_review"
  };
  const normalized = aliases[raw] || raw;
  const allowed = new Set(["todo", "in_progress", "in_review", "blocked", "done", "archived"]);
  return allowed.has(normalized) ? normalized : "todo";
}

function normalizeTaskPriority(value, fallback = "medium") {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return fallback;
}

function normalizeTaskLabels(task) {
  if (Array.isArray(task.labels)) {
    return task.labels.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (Array.isArray(task.techTags)) {
    return task.techTags.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return [];
}

function normalizeStoryPoints(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.round(parsed);
  }
  return 0;
}

function resolveAssigneeById(assigneeId) {
  const id = String(assigneeId || "").trim();
  if (!id) return null;

  const developers = readDevelopersData();
  const person = Array.isArray(developers?.developers)
    ? developers.developers.find((item) => String(item.id || "") === id)
    : null;

  return {
    id,
    name: String(person?.name || person?.full_name || `Member ${id}`)
  };
}

function resolveSprintContext(sprintId) {
  const normalizedSprintId = String(sprintId || "").trim();
  if (!normalizedSprintId) {
    return { sprintId: "", sprintName: "Unscheduled", projectId: "" };
  }

  const projectsData = readProjectsData();
  const sprintsByProject =
    projectsData?.sprintsByProject && typeof projectsData.sprintsByProject === "object"
      ? projectsData.sprintsByProject
      : {};

  for (const [projectId, sprints] of Object.entries(sprintsByProject)) {
    const found = Array.isArray(sprints)
      ? sprints.find((item) => String(item?.id || "") === normalizedSprintId)
      : null;
    if (found) {
      return {
        sprintId: normalizedSprintId,
        sprintName: String(found.name || `Sprint ${normalizedSprintId}`),
        projectId: String(projectId || "")
      };
    }
  }

  return {
    sprintId: normalizedSprintId,
    sprintName: `Sprint ${normalizedSprintId}`,
    projectId: ""
  };
}

function toBoardTask(task, index) {
  const labels = normalizeTaskLabels(task);
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const doneCount = subtasks.filter((item) => normalizeTaskStatus(item?.status) === "done").length;
  const assignee = task?.assignee && typeof task.assignee === "object"
    ? {
        id: String(task.assignee.id || ""),
        name: String(task.assignee.name || "Unassigned")
      }
    : null;

  return {
    ...task,
    id: String(task.id || `task-${index + 1}`),
    taskKey: String(task.taskKey || `TSK-${index + 1}`),
    title: String(task.title || "Untitled task"),
    description: String(task.description || ""),
    status: normalizeTaskStatus(task.status),
    priority: normalizeTaskPriority(task.priority),
    storyPoints: normalizeStoryPoints(task.storyPoints ?? task.points),
    techTags: labels,
    labels,
    aiRiskScore: Number.isFinite(Number(task.aiRiskScore)) ? Number(task.aiRiskScore) : null,
    subtaskProgress: {
      done: doneCount,
      total: subtasks.length
    },
    assignee
  };
}

function taskMatchesFilters(task, filters) {
  const sprintId = String(filters?.sprintId || "").trim();
  const status = String(filters?.status || "").trim();
  const assigneeId = String(filters?.assigneeId || "").trim();
  const priority = String(filters?.priority || "").trim().toLowerCase();
  const query = String(filters?.query || filters?.q || "").trim().toLowerCase();

  if (sprintId && String(task.sprintId || "") !== sprintId) return false;
  if (status && normalizeTaskStatus(task.status) !== normalizeTaskStatus(status)) return false;
  if (assigneeId && String(task.assignee?.id || "") !== assigneeId) return false;
  if (priority && normalizeTaskPriority(task.priority) !== normalizeTaskPriority(priority)) return false;

  if (query) {
    const haystack = [
      String(task.title || ""),
      String(task.description || ""),
      String(task.assignee?.name || ""),
      ...normalizeTaskLabels(task)
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (Boolean(filters?.riskOnly)) {
    const score = Number(task.aiRiskScore || 0);
    if (!Number.isFinite(score) || score < 70) return false;
  }

  return true;
}

function syncParentSubtaskStatus(data, task) {
  const parentId = String(task?.parentTaskId || "").trim();
  if (!parentId) return;

  const parentIndex = data.tasks.findIndex((item) => String(item.id || "") === parentId);
  if (parentIndex < 0) return;

  const parent = data.tasks[parentIndex];
  const subtasks = Array.isArray(parent.subtasks) ? parent.subtasks : [];
  const nextSubtasks = subtasks.map((item) => {
    if (String(item.id || "") !== String(task.id || "")) return item;
    return {
      ...item,
      status: normalizeTaskStatus(task.status),
      title: String(task.title || item.title || "Untitled subtask"),
      assignee: task.assignee || item.assignee || null
    };
  });

  data.tasks[parentIndex] = {
    ...parent,
    subtasks: nextSubtasks,
    updatedAt: new Date().toISOString()
  };
}

function buildTaskWithRelations(task, data) {
  const relatedTasks = Array.isArray(task.relatedTasks) ? task.relatedTasks : [];
  const parentTaskId = String(task.parentTaskId || "").trim();
  const parentTask = parentTaskId
    ? data.tasks.find((item) => String(item.id || "") === parentTaskId) || null
    : null;

  return {
    ...task,
    comments: Array.isArray(task.comments) ? task.comments : [],
    blockers: Array.isArray(task.blockers) ? task.blockers : [],
    attachments: Array.isArray(task.attachments) ? task.attachments : [],
    labels: normalizeTaskLabels(task),
    techTags: normalizeTaskLabels(task),
    relatedTasks,
    blockedByTasks: relatedTasks.filter((item) => String(item?.relation || "") === "blocked-by"),
    parentTask: parentTask
      ? {
          id: String(parentTask.id || ""),
          title: String(parentTask.title || ""),
          status: normalizeTaskStatus(parentTask.status)
        }
      : null
  };
}

function applyTaskChanges(task, changes) {
  const next = { ...task };

  if (Object.prototype.hasOwnProperty.call(changes, "title")) {
    next.title = String(changes.title || "").trim() || next.title;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "description")) {
    next.description = String(changes.description || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "acceptanceCriteria")) {
    next.acceptanceCriteria = String(changes.acceptanceCriteria || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "status")) {
    next.status = normalizeTaskStatus(changes.status);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    next.priority = normalizeTaskPriority(changes.priority, normalizeTaskPriority(next.priority));
  }
  if (Object.prototype.hasOwnProperty.call(changes, "dueDate")) {
    next.dueDate = String(changes.dueDate || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(changes, "points") || Object.prototype.hasOwnProperty.call(changes, "storyPoints")) {
    next.storyPoints = normalizeStoryPoints(changes.points ?? changes.storyPoints);
    next.points = next.storyPoints;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "labels")) {
    const labels = Array.isArray(changes.labels)
      ? changes.labels.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    next.labels = labels;
    next.techTags = labels;
  }

  if (Object.prototype.hasOwnProperty.call(changes, "assigneeId")) {
    next.assignee = resolveAssigneeById(changes.assigneeId);
    next.assigneeId = String(next.assignee?.id || "");
  }
  if (Object.prototype.hasOwnProperty.call(changes, "projectId")) {
    next.projectId = String(changes.projectId || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(changes, "sprintId")) {
    const sprintContext = resolveSprintContext(changes.sprintId);
    next.sprintId = sprintContext.sprintId;
    next.sprint = sprintContext.sprintName;
    next.projectId = String(next.projectId || sprintContext.projectId || "");
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function removeTaskReferences(data, deletedTaskId) {
  data.tasks = data.tasks.map((task) => {
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const relatedTasks = Array.isArray(task.relatedTasks) ? task.relatedTasks : [];
    const nextParentTaskId = String(task.parentTaskId || "") === deletedTaskId ? "" : task.parentTaskId;

    return {
      ...task,
      parentTaskId: nextParentTaskId,
      subtasks: subtasks.filter((item) => String(item?.id || "") !== deletedTaskId),
      relatedTasks: relatedTasks.filter((item) => String(item?.id || "") !== deletedTaskId)
    };
  });
}

function deleteCommentById(data, commentId) {
  for (let i = 0; i < data.tasks.length; i += 1) {
    const task = data.tasks[i];
    const comments = Array.isArray(task.comments) ? task.comments : [];
    const index = comments.findIndex((comment) => String(comment.id || "") === commentId);
    if (index < 0) continue;

    const [removed] = comments.splice(index, 1);
    data.tasks[i] = {
      ...task,
      comments,
      updatedAt: new Date().toISOString()
    };

    appendTaskEvent(data, String(task.id || ""), {
      id: `evt-${randomUUID()}`,
      type: "comment_removed",
      title: "Comment deleted",
      detail: String(removed?.content || "Comment removed"),
      status: "updated",
      time: new Date().toISOString()
    });

    return true;
  }

  return false;
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
  ipcMain.handle(CHANNELS.TASKS.GET_ALL, async (_event, payload = {}) => {
    try {
      const filters =
        payload?.filters && typeof payload.filters === "object"
          ? payload.filters
          : payload && typeof payload === "object"
            ? payload
            : {};

      const data = readTasksData();
      const normalized = data.tasks.map((task, index) => toBoardTask(task, index));
      const filtered = normalized.filter((task) => taskMatchesFilters(task, filters));

      return IPCResponse.success({
        items: filtered,
        total: filtered.length
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load tasks", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.CREATE, async (_event, payload = {}) => {
    try {
      const title = String(payload.title || "").trim();
      if (!title) {
        return IPCResponse.validation("title", "title is required");
      }

      const now = new Date().toISOString();
      const assignee = resolveAssigneeById(payload.assigneeId);
      const sprintContext = resolveSprintContext(payload.sprintId);
      const taskId = `task-${randomUUID()}`;
      const priority = normalizeTaskPriority(payload.priority);
      const points = normalizeStoryPoints(payload.points ?? payload.storyPoints);
      const labels = Array.isArray(payload.labels)
        ? payload.labels.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const parentTaskId = String(payload.parentTaskId || "").trim();
      const data = readTasksData();

      const created = {
        id: taskId,
        taskKey: `TSK-${data.tasks.length + 1}`,
        title,
        description: String(payload.description || "").trim(),
        status: normalizeTaskStatus(payload.status || "todo"),
        priority,
        storyPoints: points,
        points,
        labels,
        techTags: labels,
        aiRiskScore: priority === "high" ? 78 : priority === "medium" ? 52 : 24,
        assignee,
        assigneeId: assignee?.id || "",
        projectId: String(payload.projectId || sprintContext.projectId || "").trim(),
        sprintId: String(payload.sprintId || sprintContext.sprintId || "").trim(),
        sprint: String(payload.sprint || sprintContext.sprintName || "Unscheduled"),
        parentTaskId,
        subtasks: [],
        blockers: [],
        comments: [],
        relatedTasks: [],
        attachments: [],
        createdAt: now,
        updatedAt: now
      };

      data.tasks.push(created);

      if (parentTaskId) {
        const parentIndex = data.tasks.findIndex((item) => String(item.id || "") === parentTaskId);
        if (parentIndex >= 0) {
          const parent = data.tasks[parentIndex];
          const parentSubtasks = Array.isArray(parent.subtasks) ? parent.subtasks : [];
          data.tasks[parentIndex] = {
            ...parent,
            subtasks: [
              ...parentSubtasks,
              {
                id: created.id,
                title: created.title,
                status: created.status,
                taskKey: created.taskKey,
                assignee: created.assignee
              }
            ],
            updatedAt: now
          };
        }
      }

      appendTaskEvent(data, created.id, {
        id: `evt-${randomUUID()}`,
        type: "created",
        title: "Task created",
        detail: `Task ${created.title} created via desktop board`,
        status: "created",
        time: now
      });

      writeTasksData(data);
      return IPCResponse.success(toBoardTask(created, data.tasks.length - 1));
    } catch (error) {
      return IPCResponse.internalError("Failed to create task", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.BULK_UPDATE, async (_event, payload = {}) => {
    try {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : null;

      if (!ids.length) {
        return IPCResponse.validation("ids", "ids is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const now = new Date().toISOString();
      const data = readTasksData();
      const updatedTasks = [];

      for (const id of ids) {
        const index = data.tasks.findIndex((item) => String(item.id || "") === id);
        if (index < 0) continue;

        const current = data.tasks[index];
        const next = { ...current };

        if (Object.prototype.hasOwnProperty.call(changes, "title")) {
          next.title = String(changes.title || "").trim() || next.title;
        }
        if (Object.prototype.hasOwnProperty.call(changes, "description")) {
          next.description = String(changes.description || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(changes, "status")) {
          next.status = normalizeTaskStatus(changes.status);
        }
        if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
          next.priority = normalizeTaskPriority(changes.priority, normalizeTaskPriority(next.priority));
        }
        if (Object.prototype.hasOwnProperty.call(changes, "points") || Object.prototype.hasOwnProperty.call(changes, "storyPoints")) {
          next.storyPoints = normalizeStoryPoints(changes.points ?? changes.storyPoints);
        }
        if (Object.prototype.hasOwnProperty.call(changes, "sprintId")) {
          const sprintContext = resolveSprintContext(changes.sprintId);
          next.sprintId = sprintContext.sprintId;
          next.sprint = sprintContext.sprintName;
          next.projectId = String(next.projectId || sprintContext.projectId || "");
        }
        if (Object.prototype.hasOwnProperty.call(changes, "projectId")) {
          next.projectId = String(changes.projectId || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(changes, "assigneeId")) {
          next.assignee = resolveAssigneeById(changes.assigneeId);
          next.assigneeId = String(next.assignee?.id || "");
        }
        if (Object.prototype.hasOwnProperty.call(changes, "labels")) {
          const labels = Array.isArray(changes.labels)
            ? changes.labels.map((item) => String(item || "").trim()).filter(Boolean)
            : [];
          next.labels = labels;
          next.techTags = labels;
        }

        next.updatedAt = now;
        data.tasks[index] = next;
        syncParentSubtaskStatus(data, next);

        appendTaskEvent(data, id, {
          id: `evt-${randomUUID()}`,
          type: "updated",
          title: "Task updated",
          detail: "Task fields updated from board action",
          status: normalizeTaskStatus(next.status),
          time: now
        });

        updatedTasks.push(toBoardTask(next, index));
      }

      writeTasksData(data);
      return IPCResponse.success({
        updated: updatedTasks,
        count: updatedTasks.length
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to update tasks", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.BULK_DELETE, async (_event, payload = {}) => {
    try {
      const ids = Array.isArray(payload.ids)
        ? payload.ids.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      if (!ids.length) {
        return IPCResponse.validation("ids", "ids is required");
      }

      const idSet = new Set(ids);
      const data = readTasksData();

      data.tasks = data.tasks
        .filter((task) => !idSet.has(String(task.id || "")))
        .map((task) => {
          const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
          return {
            ...task,
            subtasks: subtasks.filter((item) => !idSet.has(String(item?.id || "")))
          };
        });

      for (const id of ids) {
        delete data.activityByTask[id];
      }

      writeTasksData(data);
      return IPCResponse.success({
        deletedIds: ids,
        count: ids.length
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete tasks", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.UPDATE, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : null;
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const data = readTasksData();
      const { task, index } = ensureTask(taskId, data);
      const updated = applyTaskChanges(task, changes);
      data.tasks[index] = updated;
      syncParentSubtaskStatus(data, updated);

      appendTaskEvent(data, taskId, {
        id: `evt-${randomUUID()}`,
        type: "updated",
        title: "Task updated",
        detail: "Task edited from detail page",
        status: normalizeTaskStatus(updated.status),
        time: new Date().toISOString()
      });

      writeTasksData(data);
      return IPCResponse.success(buildTaskWithRelations(updated, data));
    } catch (error) {
      return IPCResponse.internalError("Failed to update task", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.DELETE_COMMENT, async (_event, payload = {}) => {
    try {
      const commentId = String(payload.commentId || "").trim();
      if (!commentId) {
        return IPCResponse.validation("commentId", "commentId is required");
      }

      const data = readTasksData();
      const removed = deleteCommentById(data, commentId);
      if (!removed) {
        return IPCResponse.notFound("Comment");
      }

      writeTasksData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete comment", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.ADD_ATTACHMENT, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      const filePath = String(payload.filePath || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }
      if (!filePath) {
        return IPCResponse.validation("filePath", "filePath is required");
      }

      const data = readTasksData();
      const { task, index } = ensureTask(taskId, data);
      const attachment = {
        id: `att-${randomUUID()}`,
        fileName: path.basename(filePath),
        filePath,
        createdAt: new Date().toISOString()
      };

      data.tasks[index] = {
        ...task,
        attachments: [...(Array.isArray(task.attachments) ? task.attachments : []), attachment],
        updatedAt: new Date().toISOString()
      };

      appendTaskEvent(data, taskId, {
        id: `evt-${randomUUID()}`,
        type: "attachment_added",
        title: "Attachment added",
        detail: attachment.fileName,
        status: "updated",
        time: attachment.createdAt
      });

      writeTasksData(data);
      return IPCResponse.success(attachment);
    } catch (error) {
      return IPCResponse.internalError("Failed to add attachment", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.LINK_TASK, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      const targetId = String(payload.targetId || "").trim();
      const linkType = String(payload.linkType || "linked").trim() || "linked";
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }
      if (!targetId) {
        return IPCResponse.validation("targetId", "targetId is required");
      }

      const data = readTasksData();
      const { task, index } = ensureTask(taskId, data);
      const { task: targetTask } = ensureTask(targetId, data);

      const link = {
        id: String(targetTask.id || targetId),
        title: String(targetTask.title || `Task ${targetId}`),
        status: normalizeTaskStatus(targetTask.status),
        relation: linkType
      };

      const relatedTasks = Array.isArray(task.relatedTasks) ? task.relatedTasks : [];
      const deduped = relatedTasks.filter(
        (item) => !(String(item?.id || "") === link.id && String(item?.relation || "") === link.relation)
      );

      data.tasks[index] = {
        ...task,
        relatedTasks: [link, ...deduped],
        updatedAt: new Date().toISOString()
      };

      appendTaskEvent(data, taskId, {
        id: `evt-${randomUUID()}`,
        type: "task_linked",
        title: "Task linked",
        detail: `${link.relation}: ${link.title}`,
        status: "updated",
        time: new Date().toISOString()
      });

      writeTasksData(data);
      return IPCResponse.success(link);
    } catch (error) {
      return IPCResponse.internalError("Failed to link task", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.DELETE, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }

      const data = readTasksData();
      const existingIndex = data.tasks.findIndex((item) => String(item.id || "") === taskId);
      if (existingIndex < 0) {
        return IPCResponse.notFound("Task");
      }

      data.tasks.splice(existingIndex, 1);
      delete data.activityByTask[taskId];
      removeTaskReferences(data, taskId);
      writeTasksData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete task", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TASKS.GET_BY_ID, async (_event, payload = {}) => {
    try {
      const taskId = String(payload.taskId || "").trim();
      if (!taskId) {
        return IPCResponse.validation("taskId", "taskId is required");
      }

      const data = readTasksData();
      const { task } = ensureTask(taskId, data);
      writeTasksData(data);
      return IPCResponse.success(buildTaskWithRelations(task, data));
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
      const [billingPayload, membersPayload] = await Promise.all([
        desktopGatewayRequest("GET", "/api/v1/org/billing"),
        desktopGatewayRequest("GET", "/api/v1/org/members").catch(() => ({ members: [] }))
      ]);

      const subscription =
        billingPayload?.subscription && typeof billingPayload.subscription === "object"
          ? billingPayload.subscription
          : null;

      const seatsUsed = Array.isArray(membersPayload?.members) ? membersPayload.members.length : 0;
      const maxMembers = Number(subscription?.max_members || 0);

      return IPCResponse.success({
        name: String(subscription?.plan_name || "Free"),
        slug: String(subscription?.plan_slug || "free"),
        price: subscription?.billing_cycle === "yearly" ? "Yearly" : "Monthly",
        renewalDate: String(subscription?.current_period_end || subscription?.trial_end || ""),
        seatsUsed,
        seatsAvailable: maxMembers > 0 ? maxMembers : seatsUsed
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load billing plan", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_PAYMENT_METHOD, async () => {
    try {
      return IPCResponse.success({});
    } catch (error) {
      return IPCResponse.internalError("Failed to load payment method", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_INVOICES, async () => {
    try {
      return IPCResponse.success([]);
    } catch (error) {
      return IPCResponse.internalError("Failed to load invoices", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_USAGE, async () => {
    try {
      const billingPayload = await desktopGatewayRequest("GET", "/api/v1/org/billing");
      const usage =
        billingPayload?.usageMonthToDate && typeof billingPayload.usageMonthToDate === "object"
          ? billingPayload.usageMonthToDate
          : {};

      return IPCResponse.success({
        seatsUsed: 0,
        apiCallsThisMonth: Number(usage.total_requests || 0),
        storageUsedGb: 0
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load usage metrics", String(error));
    }
  });

  ipcMain.handle(CHANNELS.BILLING.GET_BILLING_PORTAL_URL, async () => {
    try {
      const frontendBase = String(process.env.FRONTEND_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
      return IPCResponse.success({ url: `${frontendBase}/settings/billing` });
    } catch (error) {
      return IPCResponse.internalError("Failed to get billing portal URL", String(error));
    }
  });
}

function teamsDbPath() {
  return path.join(app.getPath("userData"), "teams.db.json");
}

function defaultTeamsData() {
  return {
    teams: [
      {
        id: "team-1",
        name: "Platform",
        description: "Build and maintain the core platform.",
        leadId: "user-1",
        projectIds: ["project-1", "project-2"],
        memberIds: ["user-1", "user-2"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "team-2",
        name: "Web",
        description: "Deliver dashboard and web experiences.",
        leadId: "user-3",
        projectIds: ["project-3"],
        memberIds: ["user-3"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function normalizeTeamRecord(input) {
  return {
    id: String(input?.id || randomUUID()),
    name: String(input?.name || "").trim(),
    description: String(input?.description || "").trim(),
    leadId: String(input?.leadId || "").trim(),
    projectIds: Array.isArray(input?.projectIds)
      ? input.projectIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [],
    memberIds: Array.isArray(input?.memberIds)
      ? input.memberIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [],
    createdAt: String(input?.createdAt || new Date().toISOString()),
    updatedAt: String(input?.updatedAt || new Date().toISOString()),
  };
}

function readTeamsData() {
  try {
    const filePath = teamsDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultTeamsData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const seeded = defaultTeamsData();
    return {
      teams: Array.isArray(parsed?.teams)
        ? parsed.teams.map((team) => normalizeTeamRecord(team)).filter((team) => Boolean(team.name))
        : seeded.teams,
    };
  } catch {
    return defaultTeamsData();
  }
}

function writeTeamsData(data) {
  fs.writeFileSync(teamsDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function buildTeamView(team, members) {
  const memberLookup = new Map(members.map((member) => [String(member.id || ""), member]));
  const normalizedMemberIds = Array.isArray(team.memberIds)
    ? team.memberIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  return {
    id: String(team.id || ""),
    name: String(team.name || ""),
    description: String(team.description || ""),
    leadId: String(team.leadId || ""),
    lead:
      memberLookup.has(String(team.leadId || ""))
        ? {
            id: String(memberLookup.get(String(team.leadId || ""))?.id || ""),
            fullName: String(
              memberLookup.get(String(team.leadId || ""))?.fullName ||
                memberLookup.get(String(team.leadId || ""))?.name ||
                ""
            ),
            email: String(memberLookup.get(String(team.leadId || ""))?.email || ""),
          }
        : null,
    membersCount: normalizedMemberIds.length,
    projectsCount: Array.isArray(team.projectIds) ? team.projectIds.length : 0,
    members: normalizedMemberIds.map((memberId) => {
      const member = memberLookup.get(memberId) || {};
      return {
        id: memberId,
        fullName: String(member.fullName || member.name || ""),
        email: String(member.email || ""),
        role: String(member.role || "member"),
      };
    }),
    projectIds: Array.isArray(team.projectIds) ? team.projectIds : [],
    createdAt: String(team.createdAt || ""),
    updatedAt: String(team.updatedAt || ""),
  };
}

function registerTeamsHandlers() {
  ipcMain.handle(CHANNELS.TEAMS.GET_ALL, async () => {
    try {
      const data = readTeamsData();
      const developers = readDevelopersData();
      const teams = data.teams.map((team) => buildTeamView(team, developers.members));
      return IPCResponse.success(teams);
    } catch (error) {
      return IPCResponse.internalError("Failed to load teams", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TEAMS.GET_DETAIL, async (_event, payload = {}) => {
    try {
      const teamId = String(payload.teamId || "").trim();
      if (!teamId) {
        return IPCResponse.validation("teamId", "teamId is required");
      }

      const data = readTeamsData();
      const developers = readDevelopersData();
      const team = data.teams.find((item) => String(item.id || "") === teamId);
      if (!team) {
        return IPCResponse.notFound("Team");
      }

      const teamView = buildTeamView(team, developers.members);
      const members = Array.isArray(teamView.members)
        ? teamView.members.map((member) => ({
            id: String(member.id || ""),
            fullName: String(member.fullName || ""),
            email: String(member.email || ""),
            role: String(member.role || "developer")
          }))
        : [];

      const memberIdSet = new Set(members.map((member) => String(member.id || "")).filter(Boolean));
      const tasksData = readTasksData();
      const currentTasks = Array.isArray(tasksData?.tasks)
        ? tasksData.tasks
            .filter((task) => {
              const assigneeId = String(task?.assignee?.id || task?.assigneeId || "").trim();
              return Boolean(assigneeId) && memberIdSet.has(assigneeId);
            })
            .map((task, index) => toBoardTask(task, index))
        : [];

      const velocity = Array.from({ length: 6 }, (_item, index) => {
        const sprintLabel = `S-${index + 1}`;
        const completed = currentTasks.filter((task) => String(task.status || "") === "done").length;
        const points = currentTasks.reduce((sum, task) => sum + Number(task.storyPoints || 0), 0);
        return {
          sprint: sprintLabel,
          completedTasks: Math.max(0, completed - (5 - index)),
          velocity: Math.max(0, Math.round(points / Math.max(1, members.length)) - (5 - index))
        };
      });

      return IPCResponse.success({
        team: teamView,
        members,
        currentTasks,
        velocity
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load team detail", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TEAMS.CREATE, async (_event, payload = {}) => {
    try {
      const name = String(payload.name || "").trim();
      const description = String(payload.description || "").trim();
      const leadId = String(payload.leadId || "").trim();

      if (!name) {
        return IPCResponse.validation("name", "name is required");
      }

      const developers = readDevelopersData();
      if (leadId && !developers.members.some((member) => String(member.id || "") === leadId)) {
        return IPCResponse.validation("leadId", "leadId must be an existing org member");
      }

      const data = readTeamsData();
      const next = normalizeTeamRecord({
        id: randomUUID(),
        name,
        description,
        leadId,
        projectIds: [],
        memberIds: leadId ? [leadId] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      data.teams.unshift(next);
      writeTeamsData(data);

      return IPCResponse.success(buildTeamView(next, developers.members));
    } catch (error) {
      return IPCResponse.internalError("Failed to create team", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TEAMS.UPDATE, async (_event, payload = {}) => {
    try {
      const teamId = String(payload.teamId || "").trim();
      const changes = payload?.changes && typeof payload.changes === "object" ? payload.changes : null;
      if (!teamId) {
        return IPCResponse.validation("teamId", "teamId is required");
      }
      if (!changes) {
        return IPCResponse.validation("changes", "changes is required");
      }

      const data = readTeamsData();
      const index = data.teams.findIndex((team) => String(team.id || "") === teamId);
      if (index < 0) {
        return IPCResponse.notFound("Team");
      }

      const developers = readDevelopersData();
      const current = data.teams[index];
      const nextName =
        Object.prototype.hasOwnProperty.call(changes, "name")
          ? String(changes.name || "").trim()
          : current.name;

      if (!nextName) {
        return IPCResponse.validation("name", "name cannot be empty");
      }

      const nextLeadId =
        Object.prototype.hasOwnProperty.call(changes, "leadId")
          ? String(changes.leadId || "").trim()
          : String(current.leadId || "").trim();

      if (nextLeadId && !developers.members.some((member) => String(member.id || "") === nextLeadId)) {
        return IPCResponse.validation("leadId", "leadId must be an existing org member");
      }

      let nextMemberIds = Array.isArray(current.memberIds)
        ? current.memberIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      if (nextLeadId && !nextMemberIds.includes(nextLeadId)) {
        nextMemberIds = [nextLeadId, ...nextMemberIds];
      }

      const updated = normalizeTeamRecord({
        ...current,
        name: nextName,
        description:
          Object.prototype.hasOwnProperty.call(changes, "description")
            ? String(changes.description || "").trim()
            : String(current.description || ""),
        leadId: nextLeadId,
        memberIds: nextMemberIds,
        updatedAt: new Date().toISOString(),
      });

      data.teams[index] = updated;
      writeTeamsData(data);

      return IPCResponse.success(buildTeamView(updated, developers.members));
    } catch (error) {
      return IPCResponse.internalError("Failed to update team", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TEAMS.DELETE, async (_event, payload = {}) => {
    try {
      const teamId = String(payload.teamId || "").trim();
      if (!teamId) {
        return IPCResponse.validation("teamId", "teamId is required");
      }

      const data = readTeamsData();
      const before = data.teams.length;
      data.teams = data.teams.filter((team) => String(team.id || "") !== teamId);
      const deleted = data.teams.length < before;
      if (!deleted) {
        return IPCResponse.notFound("Team");
      }

      writeTeamsData(data);
      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete team", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TEAMS.ADD_MEMBER, async (_event, payload = {}) => {
    try {
      const teamId = String(payload.teamId || "").trim();
      const userId = String(payload.userId || "").trim();
      if (!teamId) {
        return IPCResponse.validation("teamId", "teamId is required");
      }
      if (!userId) {
        return IPCResponse.validation("userId", "userId is required");
      }

      const developers = readDevelopersData();
      if (!developers.members.some((member) => String(member.id || "") === userId)) {
        return IPCResponse.validation("userId", "userId must be an existing org member");
      }

      const data = readTeamsData();
      const index = data.teams.findIndex((team) => String(team.id || "") === teamId);
      if (index < 0) {
        return IPCResponse.notFound("Team");
      }

      const current = data.teams[index];
      const nextMemberIds = Array.isArray(current.memberIds)
        ? current.memberIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      if (!nextMemberIds.includes(userId)) {
        nextMemberIds.push(userId);
      }

      const updated = normalizeTeamRecord({
        ...current,
        memberIds: nextMemberIds,
        updatedAt: new Date().toISOString(),
      });
      data.teams[index] = updated;
      writeTeamsData(data);

      return IPCResponse.success(buildTeamView(updated, developers.members));
    } catch (error) {
      return IPCResponse.internalError("Failed to add team member", String(error));
    }
  });

  ipcMain.handle(CHANNELS.TEAMS.REMOVE_MEMBER, async (_event, payload = {}) => {
    try {
      const teamId = String(payload.teamId || "").trim();
      const userId = String(payload.userId || "").trim();
      if (!teamId) {
        return IPCResponse.validation("teamId", "teamId is required");
      }
      if (!userId) {
        return IPCResponse.validation("userId", "userId is required");
      }

      const developers = readDevelopersData();
      const data = readTeamsData();
      const index = data.teams.findIndex((team) => String(team.id || "") === teamId);
      if (index < 0) {
        return IPCResponse.notFound("Team");
      }

      const current = data.teams[index];
      const nextMemberIds = (Array.isArray(current.memberIds) ? current.memberIds : [])
        .map((id) => String(id || "").trim())
        .filter((id) => Boolean(id) && id !== userId);

      if (String(current.leadId || "") === userId) {
        return IPCResponse.validation("userId", "cannot remove team lead; set a different lead first");
      }

      const updated = normalizeTeamRecord({
        ...current,
        memberIds: nextMemberIds,
        updatedAt: new Date().toISOString(),
      });
      data.teams[index] = updated;
      writeTeamsData(data);

      return IPCResponse.success(buildTeamView(updated, developers.members));
    } catch (error) {
      return IPCResponse.internalError("Failed to remove team member", String(error));
    }
  });
}

function skillGapDbPath() {
  return path.join(app.getPath("userData"), "skill-gap.db.json");
}

function defaultSkillGapData() {
  return {
    skills: [
      { id: "skill-frontend", name: "Frontend", category: "Frontend", importance: 5, defaultLevel: 2 },
      { id: "skill-backend", name: "Backend", category: "Backend", importance: 5, defaultLevel: 2 },
      { id: "skill-devops", name: "DevOps", category: "DevOps", importance: 4, defaultLevel: 2 },
      { id: "skill-testing", name: "Testing", category: "Testing", importance: 5, defaultLevel: 2 },
      { id: "skill-database", name: "Database", category: "Backend", importance: 4, defaultLevel: 2 },
      { id: "skill-security", name: "Security", category: "Platform", importance: 4, defaultLevel: 2 },
    ],
    matrixByMember: {},
    trainingAssignments: [],
  };
}

function clampSkillLevel(value) {
  return Math.max(1, Math.min(5, Number(value || 1)));
}

function normalizeSkillGapData(input) {
  const defaults = defaultSkillGapData();
  const source = input && typeof input === "object" ? input : {};
  const normalizedSkills = Array.isArray(source.skills)
    ? source.skills
        .map((skill) => ({
          id: String(skill?.id || "").trim(),
          name: String(skill?.name || "").trim(),
          category: String(skill?.category || "General").trim(),
          importance: Math.max(1, Math.min(5, Number(skill?.importance || 3))),
          defaultLevel: clampSkillLevel(skill?.defaultLevel || 2),
        }))
        .filter((skill) => Boolean(skill.id) && Boolean(skill.name))
    : defaults.skills;

  const matrixByMember =
    source.matrixByMember && typeof source.matrixByMember === "object" ? source.matrixByMember : {};

  return {
    skills: normalizedSkills.length ? normalizedSkills : defaults.skills,
    matrixByMember,
    trainingAssignments: Array.isArray(source.trainingAssignments)
      ? source.trainingAssignments
      : defaults.trainingAssignments,
  };
}

function readSkillGapData() {
  try {
    const filePath = skillGapDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultSkillGapData();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeSkillGapData(parsed);
  } catch {
    return defaultSkillGapData();
  }
}

function writeSkillGapData(data) {
  fs.writeFileSync(skillGapDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function mapSkillGapMembers(developers) {
  return developers.map((member) => ({
    id: String(member.id || ""),
    fullName: String(member.fullName || member.name || ""),
    email: String(member.email || ""),
    role: String(member.role || "developer"),
  }));
}

function buildSkillGapMatrix(members, skills, matrixByMember) {
  return members.map((member) =>
    skills.map((skill) =>
      clampSkillLevel(matrixByMember?.[String(member.id || "")]?.[String(skill.id || "")] ?? skill.defaultLevel ?? 2)
    )
  );
}

function detectRequiredSkills(sprintId, skills, members, matrix) {
  const labelMap = {
    "ui": ["skill-frontend", "skill-testing"],
    "frontend": ["skill-frontend", "skill-testing"],
    "api": ["skill-backend", "skill-database", "skill-testing"],
    "backend": ["skill-backend", "skill-database"],
    "devops": ["skill-devops", "skill-security"],
    "infra": ["skill-devops", "skill-security"],
    "qa": ["skill-testing"],
    "security": ["skill-security", "skill-backend"],
  };

  const sprintKey = String(sprintId || "").toLowerCase();
  const upcomingLabels = sprintKey.includes("24")
    ? ["frontend", "api", "qa", "devops"]
    : sprintKey.includes("23")
      ? ["backend", "security", "qa"]
      : ["frontend", "backend", "qa"];

  const pressureBySkill = new Map();
  upcomingLabels.forEach((label) => {
    const skillsForLabel = Array.isArray(labelMap[label]) ? labelMap[label] : [];
    skillsForLabel.forEach((skillId) => {
      pressureBySkill.set(skillId, Number(pressureBySkill.get(skillId) || 0) + 1);
    });
  });

  const skillIndex = new Map(skills.map((skill, index) => [String(skill.id || ""), index]));
  const required = skills
    .filter((skill) => pressureBySkill.has(String(skill.id || "")))
    .map((skill) => {
      const skillId = String(skill.id || "");
      const col = Number(skillIndex.get(skillId));
      const demand = Number(pressureBySkill.get(skillId) || 0);
      const availability = matrix.reduce(
        (count, row) => count + (Number(row[col] || 0) >= 3 ? 1 : 0),
        0
      );
      const importance = Math.max(1, Math.min(5, Number(skill.importance || 3)));
      const gapScore = Math.max(0, demand + importance - availability);

      return {
        skillId,
        name: String(skill.name || ""),
        category: String(skill.category || "General"),
        demand,
        importance,
        availability,
        gapScore,
        membersCount: members.length,
      };
    })
    .sort((a, b) => {
      if (b.gapScore !== a.gapScore) return b.gapScore - a.gapScore;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return a.name.localeCompare(b.name);
    });

  return required;
}

function registerSkillGapHandlers() {
  ipcMain.handle(CHANNELS.SKILL_GAP.GET_MATRIX, async () => {
    try {
      const data = readSkillGapData();
      const developers = readDevelopersData();
      const members = mapSkillGapMembers(developers.members);
      const matrix = buildSkillGapMatrix(members, data.skills, data.matrixByMember);

      return IPCResponse.success({
        members,
        skills: data.skills,
        matrix,
      });
    } catch (error) {
      return IPCResponse.internalError("Failed to load skill-gap matrix", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SKILL_GAP.UPDATE_SKILL_LEVEL, async (_event, payload = {}) => {
    try {
      const memberId = String(payload.memberId || "").trim();
      const skillId = String(payload.skillId || "").trim();
      const level = clampSkillLevel(payload.level);

      if (!memberId) {
        return IPCResponse.validation("memberId", "memberId is required");
      }
      if (!skillId) {
        return IPCResponse.validation("skillId", "skillId is required");
      }

      const developers = readDevelopersData();
      const memberExists = developers.members.some((member) => String(member.id || "") === memberId);
      if (!memberExists) {
        return IPCResponse.notFound("Member");
      }

      const data = readSkillGapData();
      const skillExists = data.skills.some((skill) => String(skill.id || "") === skillId);
      if (!skillExists) {
        return IPCResponse.notFound("Skill");
      }

      if (!data.matrixByMember || typeof data.matrixByMember !== "object") {
        data.matrixByMember = {};
      }
      if (!data.matrixByMember[memberId] || typeof data.matrixByMember[memberId] !== "object") {
        data.matrixByMember[memberId] = {};
      }

      data.matrixByMember[memberId][skillId] = level;
      writeSkillGapData(data);

      const row = data.skills.map((skill) =>
        clampSkillLevel(data.matrixByMember?.[memberId]?.[String(skill.id || "")] ?? skill.defaultLevel ?? 2)
      );

      return IPCResponse.success(row);
    } catch (error) {
      return IPCResponse.internalError("Failed to update skill level", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SKILL_GAP.GET_REQUIRED_SKILLS, async (_event, payload = {}) => {
    try {
      const sprintId = String(payload.sprintId || "sprint-24").trim();
      const data = readSkillGapData();
      const developers = readDevelopersData();
      const members = mapSkillGapMembers(developers.members);
      const matrix = buildSkillGapMatrix(members, data.skills, data.matrixByMember);
      const required = detectRequiredSkills(sprintId, data.skills, members, matrix);
      return IPCResponse.success(required);
    } catch (error) {
      return IPCResponse.internalError("Failed to load required skills", String(error));
    }
  });

  ipcMain.handle(CHANNELS.SKILL_GAP.ASSIGN_TRAINING, async (_event, payload = {}) => {
    try {
      const memberId = String(payload.memberId || "").trim();
      const skillId = String(payload.skillId || "").trim();
      const resourceUrl = String(payload.resourceUrl || "").trim();

      if (!memberId) {
        return IPCResponse.validation("memberId", "memberId is required");
      }
      if (!skillId) {
        return IPCResponse.validation("skillId", "skillId is required");
      }
      if (!resourceUrl || !/^https?:\/\//i.test(resourceUrl)) {
        return IPCResponse.validation("resourceUrl", "resourceUrl must be a valid http(s) url");
      }

      const developers = readDevelopersData();
      const memberExists = developers.members.some((member) => String(member.id || "") === memberId);
      if (!memberExists) {
        return IPCResponse.notFound("Member");
      }

      const data = readSkillGapData();
      const skillExists = data.skills.some((skill) => String(skill.id || "") === skillId);
      if (!skillExists) {
        return IPCResponse.notFound("Skill");
      }

      const assignment = {
        id: `training-${randomUUID()}`,
        memberId,
        skillId,
        resourceUrl,
        assignedAt: new Date().toISOString(),
      };

      data.trainingAssignments = [
        assignment,
        ...(Array.isArray(data.trainingAssignments) ? data.trainingAssignments : []).filter(
          (item) => !(String(item.memberId || "") === memberId && String(item.skillId || "") === skillId)
        ),
      ];
      writeSkillGapData(data);

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to assign training", String(error));
    }
  });
}

function developersDbPath() {
  return path.join(app.getPath("userData"), "developers.org.db.json");
}

function defaultDevelopersData() {
  return {
    seatLimit: 20,
    members: [],
    invitations: []
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
    const merged = {
      seatLimit: Math.max(1, Number(parsed?.seatLimit || defaults.seatLimit)),
      members: Array.isArray(parsed?.members) ? parsed.members : defaults.members,
      invitations: Array.isArray(parsed?.invitations) ? parsed.invitations : defaults.invitations
    };

    const filteredMembers = merged.members.filter((member) => {
      const email = String(member?.email || "").trim().toLowerCase();
      return email !== "demo@agilescrummaster.dev";
    });

    if (filteredMembers.length !== merged.members.length) {
      merged.members = filteredMembers;
      writeDevelopersData(merged);
    }

    return merged;
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
      const payload = await desktopGatewayRequest("GET", "/api/v1/org/members");
      const members = firstArray(payload, ["members", "items"]).map((member) => ({
        id: String(member?.id || member?.memberId || member?.userId || ""),
        name: String(member?.name || member?.fullName || member?.email || "Member"),
        email: String(member?.email || ""),
        role: String(member?.role || "member"),
        teams: Array.isArray(member?.teams) ? member.teams : [],
        lastActive: String(member?.lastActive || member?.updatedAt || ""),
        status: String(member?.status || "active"),
      }));
      return IPCResponse.success(members);
    } catch (error) {
      try {
        const data = readDevelopersData();
        return IPCResponse.success(data.members);
      } catch {
        return IPCResponse.internalError("Failed to load org members", String(error));
      }
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

      try {
        const updated = await desktopGatewayRequest(
          "PATCH",
          `/api/v1/org/members/${encodeURIComponent(userId)}/role`,
          { role }
        );
        return IPCResponse.success(updated?.member || updated?.user || updated);
      } catch {
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
      }
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

      try {
        await desktopGatewayRequest("DELETE", `/api/v1/org/members/${encodeURIComponent(userId)}`);
        return IPCResponse.success({ success: true });
      } catch {
        const data = readDevelopersData();
        const before = data.members.length;
        data.members = data.members.filter((member) => String(member.id || "") !== userId);
        const removed = data.members.length < before;
        if (removed) {
          writeDevelopersData(data);
        }
        return IPCResponse.success({ success: removed });
      }
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

      try {
        const response = await desktopGatewayRequest("POST", "/api/v1/org/members/invite", { email, role });
        const invitation = response?.invitation || response?.invite || response;
        return IPCResponse.success({
          id: String(invitation?.id || invitation?.inviteId || `inv-${Date.now()}`),
          email,
          role,
          invitedBy: String(invitation?.invitedBy || ""),
          createdAt: String(invitation?.createdAt || new Date().toISOString()),
          expiresAt: String(invitation?.expiresAt || ""),
          status: String(invitation?.status || "pending"),
        });
      } catch {
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
          invitedBy: String(sessionUserFallback()?.name || sessionUserFallback()?.email || "Workspace Admin"),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: "pending"
        };

        data.invitations.unshift(invitation);
        writeDevelopersData(data);
        return IPCResponse.success(invitation);
      }
    } catch (error) {
      return IPCResponse.internalError("Failed to invite org member", String(error));
    }
  });

  ipcMain.handle(CHANNELS.DEVELOPERS.GET_PENDING_INVITATIONS, async () => {
    try {
      try {
        const payload = await desktopGatewayRequest("GET", "/api/v1/org/invitations");
        const invitations = firstArray(payload, ["invitations", "items"]).filter(
          (inv) => String(inv?.status || "pending").toLowerCase() === "pending"
        );
        return IPCResponse.success(invitations);
      } catch {
        const data = readDevelopersData();
        const pending = data.invitations.filter((inv) => String(inv.status || "").toLowerCase() === "pending");
        return IPCResponse.success(pending);
      }
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

      try {
        await desktopGatewayRequest("DELETE", `/api/v1/org/invitations/${encodeURIComponent(invitationId)}`);
        return IPCResponse.success({ success: true });
      } catch {
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
      }
    } catch (error) {
      return IPCResponse.internalError("Failed to revoke invitation", String(error));
    }
  });
}

function orgSettingsDbPath() {
  return path.join(app.getPath("userData"), "org.settings.db.json");
}

function defaultOrgSettings() {
  const now = new Date().toISOString();
  return {
    id: "org-default",
    name: "Agile Scrum Master",
    slug: "agile-scrum-master",
    logoUrl: "",
    description: "",
    industry: "Software",
    size: "1-10",
    ownerId: "user-1",
    preferences: {
      defaultSprintLengthDays: 14,
      workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      timezone: "UTC",
      notificationSettings: {},
      dbStatus: {
        provider: "postgres",
        connectionMode: "manual",
        status: "not_provisioned",
        provisioned: false,
        connected: false,
        projectId: null,
        connectionStringMasked: null,
      },
    },
    plan: {
      slug: "free",
      name: "Free",
    },
    subscription: null,
    createdAt: now,
    updatedAt: now,
  };
}

function readOrgSettings() {
  try {
    const filePath = orgSettingsDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = defaultOrgSettings();
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const defaults = defaultOrgSettings();
    const preferences = parsed?.preferences && typeof parsed.preferences === "object" ? parsed.preferences : {};

    return {
      ...defaults,
      ...parsed,
      preferences: {
        ...defaults.preferences,
        ...preferences,
      },
    };
  } catch {
    return defaultOrgSettings();
  }
}

function writeOrgSettings(settings) {
  fs.writeFileSync(orgSettingsDbPath(), JSON.stringify(settings, null, 2), "utf8");
}

function registerOrgHandlers() {
  ipcMain.handle(CHANNELS.ORG.GET_SETTINGS, async () => {
    try {
      const payload = await desktopGatewayRequest("GET", "/api/v1/org");
      const org = payload?.org && typeof payload.org === "object" ? payload.org : payload;
      return IPCResponse.success({
        id: String(org?.id || "org-default"),
        name: String(org?.name || ""),
        slug: String(org?.slug || ""),
        logoUrl: String(org?.logoUrl || ""),
        description: String(org?.description || ""),
        industry: String(org?.industry || ""),
        size: String(org?.size || ""),
        ownerId: String(org?.ownerId || ""),
        preferences: org?.preferences && typeof org.preferences === "object" ? org.preferences : {},
      });
    } catch (error) {
      try {
        const settings = readOrgSettings();
        return IPCResponse.success(settings);
      } catch {
        return IPCResponse.internalError("Failed to load org settings", String(error));
      }
    }
  });

  ipcMain.handle(CHANNELS.ORG.UPDATE, async (_event, payload = {}) => {
    try {
      const current = readOrgSettings();
      const nextName = payload.name == null ? current.name : String(payload.name || "").trim();

      if (!nextName) {
        return IPCResponse.validation("name", "name cannot be empty");
      }

      const incomingPreferences = payload.preferences && typeof payload.preferences === "object" ? payload.preferences : {};
      try {
        const updated = await desktopGatewayRequest("PATCH", "/api/v1/org/settings", {
          name: nextName,
          description:
            payload.description == null ? current.description : String(payload.description || "").trim(),
          industry: payload.industry == null ? current.industry : String(payload.industry || "").trim(),
          size: payload.size == null ? current.size : String(payload.size || "").trim(),
          preferences: {
            ...current.preferences,
            ...incomingPreferences,
          },
        });
        return IPCResponse.success(updated?.org || updated?.settings || updated);
      } catch {
        const next = {
          ...current,
          name: nextName,
          logoUrl: payload.logoUrl == null ? current.logoUrl : String(payload.logoUrl || "").trim(),
          description:
            payload.description == null ? current.description : String(payload.description || "").trim(),
          industry: payload.industry == null ? current.industry : String(payload.industry || "").trim(),
          size: payload.size == null ? current.size : String(payload.size || "").trim(),
          preferences: {
            ...current.preferences,
            ...incomingPreferences,
          },
          updatedAt: new Date().toISOString(),
        };

        writeOrgSettings(next);
        return IPCResponse.success(next);
      }
    } catch (error) {
      return IPCResponse.internalError("Failed to update org settings", String(error));
    }
  });

  ipcMain.handle(CHANNELS.ORG.UPLOAD_LOGO, async (_event, payload = {}) => {
    try {
      const base64Image = String(payload.base64Image || "").trim();
      if (!base64Image) {
        return IPCResponse.validation("base64Image", "base64Image is required");
      }

      const logoUrl = base64Image.startsWith("data:image/")
        ? base64Image
        : `data:image/png;base64,${base64Image}`;

      const current = readOrgSettings();
      const next = {
        ...current,
        logoUrl,
        updatedAt: new Date().toISOString(),
      };
      writeOrgSettings(next);

      return IPCResponse.success({ logoUrl });
    } catch (error) {
      return IPCResponse.internalError("Failed to upload org logo", String(error));
    }
  });

  ipcMain.handle(CHANNELS.ORG.TRANSFER_OWNERSHIP, async (_event, payload = {}) => {
    try {
      const newOwnerId = String(payload.newOwnerId || "").trim();
      if (!newOwnerId) {
        return IPCResponse.validation("newOwnerId", "newOwnerId is required");
      }

      const developers = readDevelopersData();
      const exists = developers.members.some((member) => String(member.id || "") === newOwnerId);
      if (!exists) {
        return IPCResponse.notFound("New owner");
      }

      const current = readOrgSettings();
      const next = {
        ...current,
        ownerId: newOwnerId,
        updatedAt: new Date().toISOString(),
      };
      writeOrgSettings(next);

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to transfer ownership", String(error));
    }
  });

  ipcMain.handle(CHANNELS.ORG.DELETE, async (_event, payload = {}) => {
    try {
      const confirmName = String(payload.confirmName || "").trim();
      const current = readOrgSettings();

      if (!confirmName) {
        return IPCResponse.validation("confirmName", "confirmName is required");
      }
      if (confirmName !== String(current.name || "")) {
        return IPCResponse.validation("confirmName", "confirmName does not match organization name");
      }

      try {
        await desktopGatewayRequest("DELETE", "/api/v1/org");
      } catch {
        const filePath = orgSettingsDbPath();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      return IPCResponse.success({ success: true });
    } catch (error) {
      return IPCResponse.internalError("Failed to delete organization", String(error));
    }
  });
}

function preferencesDbPath() {
  return path.join(app.getPath("userData"), "preferences.db.json");
}

function defaultUserPreferences() {
  return {
    theme: "system",
    language: "en",
    notifications: {
      email: {
        sprintAlerts: true,
        digestEmail: true,
        assignmentAlerts: true,
      },
      inApp: {
        sprintAlerts: true,
        digestEmail: true,
        assignmentAlerts: true,
      },
    },
  };
}

function defaultAutoTaskRules() {
  return [
    { id: "createFromIssues", category: "toggle", enabled: true },
    { id: "createFromUnlinkedPrs", category: "toggle", enabled: true },
    { id: "sprintReadyLabel", category: "setting", value: "sprint-ready" },
    { id: "label:bug", category: "labelMapping", label: "bug", taskType: "bug" },
    { id: "label:enhancement", category: "labelMapping", label: "enhancement", taskType: "story" },
    { id: "label:task", category: "labelMapping", label: "task", taskType: "task" },
  ];
}

function normalizePreferences(input) {
  const defaults = defaultUserPreferences();
  const source = input && typeof input === "object" ? input : {};
  const notifications = source.notifications && typeof source.notifications === "object" ? source.notifications : {};
  const email = notifications.email && typeof notifications.email === "object" ? notifications.email : {};
  const inApp = notifications.inApp && typeof notifications.inApp === "object" ? notifications.inApp : {};
  const theme = String(source.theme || defaults.theme).toLowerCase();

  return {
    theme: theme === "dark" || theme === "light" || theme === "system" ? theme : defaults.theme,
    language: String(source.language || defaults.language || "en"),
    notifications: {
      email: {
        sprintAlerts: Boolean(email.sprintAlerts ?? defaults.notifications.email.sprintAlerts),
        digestEmail: Boolean(email.digestEmail ?? defaults.notifications.email.digestEmail),
        assignmentAlerts: Boolean(email.assignmentAlerts ?? defaults.notifications.email.assignmentAlerts),
      },
      inApp: {
        sprintAlerts: Boolean(inApp.sprintAlerts ?? defaults.notifications.inApp.sprintAlerts),
        digestEmail: Boolean(inApp.digestEmail ?? defaults.notifications.inApp.digestEmail),
        assignmentAlerts: Boolean(inApp.assignmentAlerts ?? defaults.notifications.inApp.assignmentAlerts),
      },
    },
  };
}

function normalizeAutoTaskRules(rulesInput) {
  const allowedTypes = new Set(["task", "story", "bug"]);
  const fallback = defaultAutoTaskRules();
  if (!Array.isArray(rulesInput) || !rulesInput.length) {
    return fallback;
  }

  return rulesInput
    .map((rule) => {
      if (!rule || typeof rule !== "object") {
        return null;
      }

      const category = String(rule.category || "").trim();
      const id = String(rule.id || "").trim();
      if (!category || !id) {
        return null;
      }

      if (category === "toggle") {
        return { id, category, enabled: Boolean(rule.enabled) };
      }

      if (category === "setting") {
        return { id, category, value: String(rule.value || "").trim() };
      }

      if (category === "labelMapping") {
        const label = String(rule.label || "").trim().toLowerCase();
        const taskType = String(rule.taskType || "task").trim().toLowerCase();
        if (!label || !allowedTypes.has(taskType)) {
          return null;
        }
        return { id, category, label, taskType };
      }

      return null;
    })
    .filter(Boolean);
}

function readPreferencesData() {
  try {
    const filePath = preferencesDbPath();
    if (!fs.existsSync(filePath)) {
      const seed = {
        userPreferences: defaultUserPreferences(),
        autoTaskRules: defaultAutoTaskRules(),
      };
      fs.writeFileSync(filePath, JSON.stringify(seed, null, 2), "utf8");
      return seed;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      userPreferences: normalizePreferences(parsed?.userPreferences),
      autoTaskRules: normalizeAutoTaskRules(parsed?.autoTaskRules),
    };
  } catch {
    return {
      userPreferences: defaultUserPreferences(),
      autoTaskRules: defaultAutoTaskRules(),
    };
  }
}

function writePreferencesData(data) {
  fs.writeFileSync(preferencesDbPath(), JSON.stringify(data, null, 2), "utf8");
}

function registerPreferencesHandlers() {
  ipcMain.handle(CHANNELS.PREFERENCES.GET, async () => {
    try {
      const data = readPreferencesData();
      return IPCResponse.success(data.userPreferences);
    } catch (error) {
      return IPCResponse.internalError("Failed to load user preferences", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PREFERENCES.UPDATE, async (_event, payload = {}) => {
    try {
      const current = readPreferencesData();
      const incoming = {
        ...current.userPreferences,
        theme: payload.theme ?? current.userPreferences.theme,
        language: payload.language ?? current.userPreferences.language,
        notifications:
          payload.notifications && typeof payload.notifications === "object"
            ? {
                ...current.userPreferences.notifications,
                ...payload.notifications,
              }
            : current.userPreferences.notifications,
      };
      const normalized = normalizePreferences(incoming);

      writePreferencesData({
        ...current,
        userPreferences: normalized,
      });

      return IPCResponse.success(normalized);
    } catch (error) {
      return IPCResponse.internalError("Failed to update user preferences", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PREFERENCES.GET_AUTO_TASK_RULES, async () => {
    try {
      const data = readPreferencesData();
      return IPCResponse.success(data.autoTaskRules);
    } catch (error) {
      return IPCResponse.internalError("Failed to load auto-task rules", String(error));
    }
  });

  ipcMain.handle(CHANNELS.PREFERENCES.SAVE_AUTO_TASK_RULES, async (_event, payload = {}) => {
    try {
      const current = readPreferencesData();
      if (!Array.isArray(payload.rules)) {
        return IPCResponse.validation("rules", "rules must be an array");
      }

      const nextRules = normalizeAutoTaskRules(payload.rules);
      writePreferencesData({
        ...current,
        autoTaskRules: nextRules,
      });

      return IPCResponse.success(nextRules);
    } catch (error) {
      return IPCResponse.internalError("Failed to save auto-task rules", String(error));
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

  ipcMain.handle(CHANNELS.SYSTEM.GATEWAY_REQUEST, async (_event, payload = {}) => {
    try {
      const method = String(payload.method || "GET").trim().toUpperCase();
      const path = String(payload.path || payload.pathname || "").trim();
      const supportedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

      console.log("[IPC] system:gatewayRequest:", { method, path });

      if (!supportedMethods.has(method)) {
        console.log("[IPC] Invalid method:", method);
        return IPCResponse.validation("method", "method must be GET|POST|PUT|PATCH|DELETE");
      }

      if (!path || !path.startsWith("/api/")) {
        console.log("[IPC] Invalid path:", path, "Must start with /api/");
        return IPCResponse.validation("path", "path must start with /api/");
      }

      const requestBody = method === "GET" || method === "DELETE"
        ? undefined
        : payload.body;

      const data = await desktopGatewayRequest(method, path, requestBody);
      console.log("[IPC] Success");
      return IPCResponse.success(data);
    } catch (error) {
      console.log("[IPC] Error:", String(error));
      return IPCResponse.internalError("Failed to execute gateway request", String(error));
    }
  });
}

function createWindow() {
  const windowIconPath = path.join(__dirname, "assets", "sprint.ico");
  const win = new BrowserWindow({
    title: "Agile Scrum Master Desktop",
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: windowIconPath,
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

  registerAuthIpcHandlers(ipcMain, { onSessionChanged: notifySessionUpdated });
  registerSystemHandlers();
  registerAdminIpcHandlers(ipcMain);
  registerAssignIpcHandlers(ipcMain);
  registerBacklogIpcHandlers(ipcMain);
  registerBoardIpcHandlers(ipcMain);
  registerDashboardIpcHandlers(ipcMain);
  registerDirectoryDevelopersIpcHandlers(ipcMain);
  registerFormsIpcHandlers(ipcMain);
  registerNavbarDataIpcHandlers(ipcMain);
  registerGoalHandlers();
  registerIntegrationHandlers();
  registerGithubRepoHandlers();
  registerMonitoringHandlers();
  registerWebhookHandlers();
  registerOnboardingHandlers();
  registerProfileHandlers();
  registerStandupHandlers();
  registerSprintHandlers();
  registerSprintsHandlers();
  registerSprintPlanHandlers();
  registerProjectHandlers();
  registerReportsHandlers();
  registerScrumMasterHandlers();
  registerTaskHandlers();
  registerAgentHandlers();
  registerBillingHandlers();
  registerPagesIpcHandlers(ipcMain);
  registerTeamsHandlers();
  registerTimelineIpcHandlers(ipcMain);
  registerSkillGapHandlers();
  registerDevelopersHandlers();
  registerOrgHandlers();
  registerPreferencesHandlers();
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
