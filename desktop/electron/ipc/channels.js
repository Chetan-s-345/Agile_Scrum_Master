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

  // Forms channels
  FORMS: {
    GET_TEMPLATES: "forms:getTemplates",
    GET_TASK_FORMS: "forms:getTaskForms",
    SUBMIT_FORM: "forms:submitForm",
    ATTACH_TEMPLATE: "forms:attachTemplate"
  },

  // Pages channels
  PAGES: {
    GET_LIST: "pages:getList",
    GET_CONTENT: "pages:getContent",
    CREATE_PAGE: "pages:createPage",
    UPDATE_PAGE: "pages:updatePage",
    DELETE_PAGE: "pages:deletePage"
  },

  // Sprint analytics channels
  SPRINT: {
    GET_SUMMARY: "sprint:getSummary",
    GET_BURNDOWN: "sprint:getBurndown",
    GET_VELOCITY_HISTORY: "sprint:getVelocityHistory",
    GET_CONTRIBUTORS: "sprint:getContributors"
  },

  // Timeline channels
  TIMELINE: {
    GET_TASKS: "timeline:getTasks",
    UPDATE_TASK_DATES: "timeline:updateTaskDates"
  },

  // Developers directory channels
  DEVELOPERS: {
    GET_ALL: "developers:getAll",
    INVITE: "developers:invite",
    SEARCH: "developers:search",
    GET_BY_ID: "developers:getById",
    GET_STATS: "developers:getStats",
    GET_CURRENT_TASKS: "developers:getCurrentTasks",
    GET_SPRINT_HISTORY: "developers:getSprintHistory",
    UPDATE_PROFILE: "developers:updateProfile"
  },

  // GitHub integration channels
  GITHUB: {
    GET_CONNECTION_STATUS: "github:getConnectionStatus",
    GET_LINKED_REPOS: "github:getLinkedRepos",
    GET_RECENT_PRS: "github:getRecentPRs",
    SYNC_NOW: "github:syncNow"
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

  // Goals and key results
  GOALS: {
    GET_ALL: "goals:getAll",
    CREATE: "goals:create",
    UPDATE: "goals:update",
    UPDATE_PROGRESS: "goals:updateProgress",
    DELETE: "goals:delete"
  },

  // Third-party integration hub
  INTEGRATIONS: {
    GET_ALL: "integrations:getAll",
    CONNECT: "integrations:connect",
    DISCONNECT: "integrations:disconnect",
    SYNC_NOW: "integrations:syncNow",
    GET_CONFIG: "integrations:getConfig",
    UPDATE_CONFIG: "integrations:updateConfig",
    REGENERATE_WEBHOOK_SECRET: "integrations:regenerateWebhookSecret",
    GET_JIRA_PROJECT_MAPPINGS: "integrations:getJiraProjectMappings",
    SAVE_JIRA_MAPPING: "integrations:saveJiraMapping"
  },

  // GitHub repository management
  GITHUB: {
    GET_AVAILABLE_REPOS: "github:getAvailableRepos",
    GET_LINKED_REPOS: "github:getLinkedRepos",
    TOGGLE_REPO_SYNC: "github:toggleRepoSync",
    LINK_REPO_TO_PROJECT: "github:linkRepoToProject",
    BULK_TOGGLE: "github:bulkToggle"
  },

  // Monitoring and operational diagnostics
  MONITORING: {
    GET_HEALTH_STATUS: "monitoring:getHealthStatus",
    GET_ERROR_LOGS: "monitoring:getErrorLogs",
    GET_WEBHOOK_DLQ: "monitoring:getWebhookDLQ",
    RETRY_WEBHOOK: "monitoring:retryWebhook",
    GET_JIRA_SYNC_LOGS: "monitoring:getJiraSyncLogs"
  },

  // Onboarding workflow
  ONBOARDING: {
    GET_STATUS: "onboarding:getStatus",
    MARK_STEP_COMPLETE: "onboarding:markStepComplete",
    SKIP_STEP: "onboarding:skipStep",
    RESET: "onboarding:reset"
  },

  // User profile management
  PROFILE: {
    GET: "profile:get",
    GET_CURRENT: "profile:getCurrent",
    UPDATE: "profile:update",
    CHANGE_PASSWORD: "profile:changePassword",
    CHANGE_EMAIL: "profile:changeEmail",
    UPLOAD_AVATAR: "profile:uploadAvatar",
    GET_ACTIVITY_STATS: "profile:getActivityStats",
    GET_SESSIONS: "profile:getSessions",
    REVOKE_SESSION: "profile:revokeSession",
    TOGGLE_2FA: "profile:toggle2FA"
  },

  // User preferences and personal defaults
  PREFERENCES: {
    GET: "preferences:get",
    UPDATE: "preferences:update",
    GET_AUTO_TASK_RULES: "preferences:getAutoTaskRules",
    SAVE_AUTO_TASK_RULES: "preferences:saveAutoTaskRules"
  },

  // Team management settings
  TEAMS: {
    GET_ALL: "teams:getAll",
    CREATE: "teams:create",
    UPDATE: "teams:update",
    DELETE: "teams:delete",
    ADD_MEMBER: "teams:addMember",
    REMOVE_MEMBER: "teams:removeMember"
  },

  // Skill gap analysis and training assignment
  SKILL_GAP: {
    GET_MATRIX: "skillGap:getMatrix",
    UPDATE_SKILL_LEVEL: "skillGap:updateSkillLevel",
    GET_REQUIRED_SKILLS: "skillGap:getRequiredSkills",
    ASSIGN_TRAINING: "skillGap:assignTraining"
  },

  // Project detail and management
  PROJECTS: {
    GET_BY_ID: "projects:getById",
    GET_SPRINTS: "projects:getSprints",
    GET_MEMBERS: "projects:getMembers",
    ADD_MEMBER: "projects:addMember",
    UPDATE: "projects:update",
    ARCHIVE: "projects:archive"
  },

  // Sprint reports and velocity analytics
  REPORTS: {
    GET_ALL: "reports:getAll",
    GENERATE: "reports:generate",
    GET_VELOCITY_HISTORY: "reports:getVelocityHistory",
    GET_BY_SPRINT_ID: "reports:getBySprintId",
    UPDATE_RETRO_NOTES: "reports:updateRetroNotes",
    EXPORT_PDF: "reports:exportPDF"
  },

  // Scrum Master control center
  SCRUM_MASTER: {
    GET_AGENDA: "scrumMaster:getAgenda",
    GET_IMPEDIMENTS: "scrumMaster:getImpediments",
    RESOLVE_IMPEDIMENT: "scrumMaster:resolveImpediment",
    GET_SPRINT_HEALTH: "scrumMaster:getSprintHealth",
    RUN_AGENT_ACTION: "scrumMaster:runAgentAction",
    ANALYZE_TASK: "scrumMaster:analyzeTask"
  },

  // Task detail and task-level collaboration
  TASKS: {
    GET_BY_ID: "tasks:getById",
    GET_ACTIVITY_LOG: "tasks:getActivityLog",
    ADD_BLOCKER: "tasks:addBlocker",
    REMOVE_BLOCKER: "tasks:removeBlocker",
    ADD_COMMENT: "tasks:addComment"
  },

  // Agent detail, chat, and runtime controls
  AGENT: {
    GET_BY_ID: "agent:getById",
    GET_CONVERSATION: "agent:getConversation",
    SEND_MESSAGE: "agent:sendMessage",
    GET_ACTION_LOG: "agent:getActionLog",
    TOGGLE_RUN: "agent:toggleRun",
    UPDATE_CONFIG: "agent:updateConfig",
    DELETE: "agent:delete"
  },

  // Billing and subscription settings
  BILLING: {
    GET_PLAN: "billing:getPlan",
    GET_PAYMENT_METHOD: "billing:getPaymentMethod",
    GET_INVOICES: "billing:getInvoices",
    GET_USAGE: "billing:getUsage",
    GET_BILLING_PORTAL_URL: "billing:getBillingPortalUrl"
  },

  // Organization developer/seat management
  DEVELOPERS: {
    GET_ORG_MEMBERS: "developers:getOrgMembers",
    UPDATE_ROLE: "developers:updateRole",
    REMOVE_FROM_ORG: "developers:removeFromOrg",
    INVITE_TO_ORG: "developers:inviteToOrg",
    GET_PENDING_INVITATIONS: "developers:getPendingInvitations",
    REVOKE_INVITATION: "developers:revokeInvitation"
  },

  // Organization settings and ownership controls
  ORG: {
    GET_SETTINGS: "org:getSettings",
    UPDATE: "org:update",
    UPLOAD_LOGO: "org:uploadLogo",
    TRANSFER_OWNERSHIP: "org:transferOwnership",
    DELETE: "org:delete"
  },

  // Events (one-way from main to renderer)
  EVENTS: {
    UPDATE_STATUS: "updates:status",
    SYNC_PROGRESS: "sync:progress",
    SYNC_CONFLICT: "sync:conflict",
    CONNECTIVITY: "system:connectivity",
    SESSION_UPDATED: "auth:sessionUpdated",
    SESSION_EXPIRED: "auth:sessionExpired",
    LOG_EVENT: "app:logEvent"
  }
};

module.exports = CHANNELS;
