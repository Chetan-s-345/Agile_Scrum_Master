/**
 * Validation Schemas
 * Use these with zod-like validators or simple object shape checks
 */

const SCHEMES = {
  // Session payload schema
  SESSION: {
    validate: (payload) => {
      if (!payload) return { valid: false, error: "Session is required" };
      if (typeof payload.accessToken !== "string") return { valid: false, error: "accessToken must be string" };
      if (!payload.userId || typeof payload.userId !== "string") return { valid: false, error: "userId must be string" };
      return { valid: true };
    }
  },

  // Storage key-value schema
  STORAGE_SET: {
    validate: (payload) => {
      if (!payload || typeof payload !== "object") return { valid: false, error: "Payload must be object" };
      if (typeof payload.key !== "string" || !payload.key) return { valid: false, error: "key must be non-empty string" };
      if (payload.value === undefined) return { valid: false, error: "value is required" };
      return { valid: true };
    }
  },

  // External URL schema
  EXTERNAL_URL: {
    validate: (url) => {
      if (typeof url !== "string") return { valid: false, error: "URL must be string" };
      try {
        const parsed = new URL(url);
        // Allowlist safe protocols
        if (!["http:", "https:", "mailto:", "ftp:"].includes(parsed.protocol)) {
          return { valid: false, error: `Protocol ${parsed.protocol} not allowed` };
        }
        return { valid: true };
      } catch (e) {
        return { valid: false, error: "Invalid URL format" };
      }
    }
  },

  // Notification schema
  NOTIFICATION: {
    validate: (payload) => {
      if (!payload || typeof payload !== "object") return { valid: false, error: "Notification must be object" };
      if (typeof payload.title !== "string") return { valid: false, error: "title must be string" };
      if (payload.body && typeof payload.body !== "string") return { valid: false, error: "body must be string" };
      if (payload.icon && typeof payload.icon !== "string") return { valid: false, error: "icon must be string" };
      return { valid: true };
    }
  },

  // Sync queue item schema
  QUEUE_ITEM: {
    validate: (payload) => {
      if (!payload || typeof payload !== "object") return { valid: false, error: "Queue item must be object" };
      if (typeof payload.id !== "string") return { valid: false, error: "id must be string" };
      if (typeof payload.action !== "string") return { valid: false, error: "action must be string" };
      if (typeof payload.url !== "string") return { valid: false, error: "url must be string" };
      if (typeof payload.method !== "string") return { valid: false, error: "method must be string" };
      return { valid: true };
    }
  }
};

module.exports = SCHEMES;
