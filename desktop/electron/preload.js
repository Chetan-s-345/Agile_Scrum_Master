const { contextBridge, ipcRenderer } = require("electron");

const allowedInvokeChannels = new Set([
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
  "system:openExternal",
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
