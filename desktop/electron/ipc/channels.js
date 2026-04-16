/**
 * IPC Channel Constants
 * Centralized namespace for all IPC communication between renderer and main process
 */

const CHANNELS = {
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
