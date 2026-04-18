const { contextBridge, ipcRenderer } = require("electron");

const allowedInvokeChannels = new Set([
  "auth:saveSession",
  "auth:getSession",
  "auth:clearSession",
  "auth:checkSession",
  "auth:validateToken",
  "dashboard:getSummary",
  "dashboard:getRecentActivity",
  "dashboard:getBurndownData",
  "assign:getUnassignedTasks",
  "assign:getDevelopersWithWorkload",
  "assign:assignTask",
  "assign:bulkAssign",
  "assignment:getAllAssignments",
  "assignment:reassignTask",
  "assignment:getSprintList",
  "admin:getUsers",
  "admin:updateUserRole",
  "admin:removeUser",
  "admin:getAuditLogs",
  "admin:getFeatureFlags",
  "admin:toggleFeatureFlag",
  "backlog:getItems",
  "backlog:createItem",
  "backlog:updateItem",
  "backlog:reorderItems",
  "backlog:addToSprint",
  "backlog:bulkUpdate",
  "backlog:deleteItem",
  "backlog:bulkDelete",
  "board:getSprintBacklog",
  "board:moveToBoard",
  "board:getTasksWithPRs",
  "board:linkPR",
  "board:unlinkPR",
  "forms:getTemplates",
  "forms:getTaskForms",
  "forms:submitForm",
  "forms:attachTemplate",
  "pages:getList",
  "pages:getContent",
  "pages:createPage",
  "pages:updatePage",
  "pages:deletePage",
  "sprint:getSummary",
  "sprint:getBurndown",
  "sprint:getVelocityHistory",
  "sprint:getContributors",
  "timeline:getTasks",
  "timeline:updateTaskDates",
  "developers:getAll",
  "developers:invite",
  "developers:search",
  "developers:getById",
  "developers:getStats",
  "developers:getCurrentTasks",
  "developers:getSprintHistory",
  "developers:updateProfile",
  "github:getConnectionStatus",
  "github:getLinkedRepos",
  "github:getRecentPRs",
  "github:syncNow",
  "system:openExternal",
]);

const allowedEventChannels = new Set([
  "auth:sessionUpdated",
  "auth:sessionExpired",
]);

contextBridge.exposeInMainWorld("desktopApi", {
  invoke(channel, payload) {
    if (!allowedInvokeChannels.has(channel)) {
      return Promise.reject(new Error(`IPC channel is not allowed: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, listener) {
    if (!allowedEventChannels.has(channel)) {
      throw new Error(`IPC event channel is not allowed: ${String(channel)}`);
    }
    if (typeof listener !== "function") {
      throw new Error("listener must be a function");
    }

    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrapped);

    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
});

contextBridge.exposeInMainWorld("desktopApp", {
  isElectron: true
});
