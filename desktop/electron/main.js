const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const CHANNELS = require("./ipc/channels");
const { registerDashboardIpcHandlers } = require("./ipc/dashboard");
const { registerAssignIpcHandlers } = require("./ipc/assign");
const { registerAdminIpcHandlers } = require("./ipc/admin");
const { registerBacklogIpcHandlers } = require("./ipc/backlog");
const { registerBoardIpcHandlers } = require("./ipc/board");
const { registerFormsIpcHandlers } = require("./ipc/forms");
const { registerPagesIpcHandlers } = require("./ipc/pages");
const { registerSprintIpcHandlers } = require("./ipc/sprint");
const { registerTimelineIpcHandlers } = require("./ipc/timeline");
const { registerDevelopersIpcHandlers } = require("./ipc/developers");
const { registerGithubIpcHandlers } = require("./ipc/github");
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
  registerDashboardIpcHandlers(ipcMain);
  registerAssignIpcHandlers(ipcMain);
  registerAdminIpcHandlers(ipcMain);
  registerBacklogIpcHandlers(ipcMain);
  registerBoardIpcHandlers(ipcMain);
  registerFormsIpcHandlers(ipcMain);
  registerPagesIpcHandlers(ipcMain);
  registerSprintIpcHandlers(ipcMain);
  registerTimelineIpcHandlers(ipcMain);
  registerDevelopersIpcHandlers(ipcMain);
  registerGithubIpcHandlers(ipcMain);

  ipcMain.handle("system:openExternal", async (_event, payload) => {
    const raw = String(payload?.url || "").trim();
    if (!raw) throw new Error("url is required");
    await shell.openExternal(raw);
    return { success: true };
  });

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
