/**
 * IPC Channel Constants
 * Centralized namespace for all IPC communication between renderer and main process
 */

const CHANNELS = {
  // Dashboard overview channels
  DASHBOARD: {
    GET_SUMMARY: "dashboard:getSummary",
    GET_RECENT_ACTIVITY: "dashboard:getRecentActivity",
    GET_BURNDOWN_DATA: "dashboard:getBurndownData"
  },

  // Assignment channels
  ASSIGN: {
    GET_UNASSIGNED_TASKS: "assign:getUnassignedTasks",
    GET_DEVELOPERS_WITH_WORKLOAD: "assign:getDevelopersWithWorkload",
    ASSIGN_TASK: "assign:assignTask",
    BULK_ASSIGN: "assign:bulkAssign"
  },

  // Assignment overview channels
  ASSIGNMENT: {
    GET_ALL_ASSIGNMENTS: "assignment:getAllAssignments",
    REASSIGN_TASK: "assignment:reassignTask",
    GET_SPRINT_LIST: "assignment:getSprintList"
  },

  // Admin control panel channels
  ADMIN: {
    GET_USERS: "admin:getUsers",
    UPDATE_USER_ROLE: "admin:updateUserRole",
    REMOVE_USER: "admin:removeUser",
    GET_AUDIT_LOGS: "admin:getAuditLogs",
    GET_FEATURE_FLAGS: "admin:getFeatureFlags",
    TOGGLE_FEATURE_FLAG: "admin:toggleFeatureFlag"
  },

  // Backlog channels
  BACKLOG: {
    GET_ITEMS: "backlog:getItems",
    CREATE_ITEM: "backlog:createItem",
    UPDATE_ITEM: "backlog:updateItem",
    REORDER_ITEMS: "backlog:reorderItems",
    ADD_TO_SPRINT: "backlog:addToSprint",
    BULK_UPDATE: "backlog:bulkUpdate",
    DELETE_ITEM: "backlog:deleteItem",
    BULK_DELETE: "backlog:bulkDelete"
  },

  // Board channels
  BOARD: {
    GET_SPRINT_BACKLOG: "board:getSprintBacklog",
    MOVE_TO_BOARD: "board:moveToBoard",
    GET_TASKS_WITH_PRS: "board:getTasksWithPRs",
    LINK_PR: "board:linkPR",
    UNLINK_PR: "board:unlinkPR"
  },

  // App metadata and health
  APP: {
    GET_VERSION: "app:getVersion",
    GET_BUILD_INFO: "app:getBuildInfo",
    GET_PLATFORM: "app:getPlatform",
    HEALTH_CHECK: "app:healthCheck"
  },

  // Authentication and session
  AUTH: {
    SAVE_SESSION: "auth:saveSession",
    GET_SESSION: "auth:getSession",
    CLEAR_SESSION: "auth:clearSession",
    CHECK_SESSION: "auth:checkSession",
    VALIDATE_TOKEN: "auth:validateToken"
  },

  // Local app data and settings
  STORAGE: {
    GET: "storage:get",
    SET: "storage:set",
    DELETE: "storage:delete",
    CLEAR: "storage:clear",
    GET_ALL: "storage:getAll"
  },

  // Desktop notifications
  NOTIFICATIONS: {
    SHOW: "notifications:show",
    HIDE: "notifications:hide",
    REQUEST_PERMISSION: "notifications:requestPermission",
    PLAY_SOUND: "notifications:playSound"
  },

  // System level capabilities
  SYSTEM: {
    OPEN_EXTERNAL: "system:openExternal",
    OPEN_PATH: "system:openPath",
    GET_PATH: "system:getPath",
    CLIPBOARD_READ: "system:clipboardRead",
    CLIPBOARD_WRITE: "system:clipboardWrite"
  },

  // Auto-update controls
  UPDATES: {
    CHECK: "updates:check",
    DOWNLOAD: "updates:download",
    INSTALL: "updates:install",
    SKIP_UPDATE: "updates:skipUpdate",
    RESTART: "updates:restart"
  },

  // Offline queue and sync
  SYNC: {
    GET_STATUS: "sync:getStatus",
    GET_QUEUE: "sync:getQueue",
    CLEAR_QUEUE: "sync:clearQueue",
    RETRY_QUEUE: "sync:retryQueue",
    PAUSE_SYNC: "sync:pauseSync",
    RESUME_SYNC: "sync:resumeSync"
  },

  // Events (one-way from main to renderer)
  EVENTS: {
    UPDATE_STATUS: "updates:status",
    SYNC_PROGRESS: "sync:progress",
    SYNC_CONFLICT: "sync:conflict",
    CONNECTIVITY: "system:connectivity",
    SESSION_EXPIRED: "auth:sessionExpired",
    LOG_EVENT: "app:logEvent"
  }
};

module.exports = CHANNELS;
