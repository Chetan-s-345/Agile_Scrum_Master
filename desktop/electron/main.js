const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { registerDashboardIpcHandlers } = require("./ipc/dashboard");
const { registerAssignIpcHandlers } = require("./ipc/assign");
const { registerAdminIpcHandlers } = require("./ipc/admin");
const { registerBacklogIpcHandlers } = require("./ipc/backlog");
const { registerBoardIpcHandlers } = require("./ipc/board");
const { registerFormsIpcHandlers } = require("./ipc/forms");
const { registerPagesIpcHandlers } = require("./ipc/pages");
const { registerSprintIpcHandlers } = require("./ipc/sprint");
const { registerTimelineIpcHandlers } = require("./ipc/timeline");

app.setName("Agile Scrum Master Desktop");
if (process.platform === "win32") {
  app.setAppUserModelId("com.agilescrummaster.desktop");
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
    return;
  }

  if (!fs.existsSync(rendererIndexPath)) {
    win.loadURL(
      "data:text/html;charset=UTF-8," +
        encodeURIComponent("<h2>Renderer build not found</h2><p>Run: npm run build:frontend</p>")
    );
    return;
  }

  win.loadFile(rendererIndexPath);
}

app.whenReady().then(() => {
  registerDashboardIpcHandlers(ipcMain);
  registerAssignIpcHandlers(ipcMain);
  registerAdminIpcHandlers(ipcMain);
  registerBacklogIpcHandlers(ipcMain);
  registerBoardIpcHandlers(ipcMain);
  registerFormsIpcHandlers(ipcMain);
  registerPagesIpcHandlers(ipcMain);
  registerSprintIpcHandlers(ipcMain);
  registerTimelineIpcHandlers(ipcMain);

  ipcMain.handle("system:openExternal", async (_event, payload) => {
    const raw = String(payload?.url || "").trim();
    if (!raw) throw new Error("url is required");
    await shell.openExternal(raw);
    return { success: true };
  });

  createWindow();

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
