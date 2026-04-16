/**
 * IPC Response Envelope Utility
 * Standardizes all IPC communication with consistent success/error format
 */

class IPCResponse {
  static success(data) {
    return {
      ok: true,
      data: data || null,
      timestamp: Date.now()
    };
  }

  static error(code, message, detail = null) {
    return {
      ok: false,
      error: {
        code,
        message,
        detail
      },
      timestamp: Date.now()
    };
  }

  static validation(fieldName, reason) {
    return this.error(
      "VALIDATION_ERROR",
      `Validation failed: ${fieldName}`,
      reason
    );
  }

  static unauthorized() {
    return this.error(
      "UNAUTHORIZED",
      "Session invalid or expired",
      "Please log in again"
    );
  }

  static notFound(resource) {
    return this.error(
      "NOT_FOUND",
      `${resource} not found`,
      null
    );
  }

  static internalError(message, detail = null) {
    console.error("[IPC Error]", message, detail);
    return this.error(
      "INTERNAL_ERROR",
      message,
      detail
    );
  }
}

module.exports = IPCResponse;
