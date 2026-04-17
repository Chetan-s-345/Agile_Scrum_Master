const { contextBridge, ipcRenderer } = require("electron");

const allowedInvokeChannels = new Set([
  "dashboard:getSummary",
  "dashboard:getRecentActivity",
  "dashboard:getBurndownData",
  "assign:getUnassignedTasks",
  "assign:getDevelopersWithWorkload",
  "assign:assignTask",
  "assign:bulkAssign",
  "admin:getUsers",
  "admin:updateUserRole",
  "admin:removeUser",
  "admin:getAuditLogs",
  "admin:getFeatureFlags",
  "admin:toggleFeatureFlag",
]);

contextBridge.exposeInMainWorld("desktopApi", {
  invoke(channel, payload) {
    if (!allowedInvokeChannels.has(channel)) {
      return Promise.reject(new Error(`IPC channel is not allowed: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
});

contextBridge.exposeInMainWorld("desktopApp", {
  isElectron: true
});
