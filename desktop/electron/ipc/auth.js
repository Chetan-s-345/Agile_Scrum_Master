const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const CHANNELS = require("./channels");

const SESSION_FILE_NAME = "auth-session.json";

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function decodeJwtPayload(token) {
  try {
    const parts = asString(token).split(".");
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function deriveExpiresAt(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return exp * 1000;
}

function sanitizeUser(rawUser) {
  if (!rawUser || typeof rawUser !== "object") return null;

  const id = asString(rawUser.id || rawUser.userId || rawUser.sub);
  const email = asString(rawUser.email || rawUser.username || rawUser.preferred_username || rawUser.upn);
  const fullName = asString(rawUser.fullName || rawUser.name || rawUser.displayName || rawUser.given_name);

  if (!id && !email && !fullName) return null;
  return { id, email, fullName };
}

function deriveUserFromToken(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload || typeof payload !== "object") return null;
  return sanitizeUser(payload);
}

function getSessionFilePath() {
  return path.join(app.getPath("userData"), SESSION_FILE_NAME);
}

function sanitizeSession(raw) {
  const accessToken = asString(raw?.accessToken || raw?.token);
  if (!accessToken) return null;

  const userFromInput = sanitizeUser(raw?.user);
  const userFromToken = deriveUserFromToken(accessToken);
  const user = sanitizeUser({
    id: userFromInput?.id || userFromToken?.id,
    email: userFromInput?.email || userFromToken?.email,
    fullName: userFromInput?.fullName || userFromToken?.fullName,
  });

  const expiresAtInput = Number(raw?.expiresAt);
  const expiresAt = Number.isFinite(expiresAtInput) && expiresAtInput > 0
    ? expiresAtInput
    : deriveExpiresAt(accessToken);

  return {
    accessToken,
    user,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    updatedAt: new Date().toISOString(),
  };
}

function serializeForDisk(session) {
  const data = JSON.stringify(session);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(data).toString("base64");
    return JSON.stringify({ encrypted: true, data: encrypted });
  }
  return JSON.stringify({ encrypted: false, data });
}

function deserializeFromDisk(payload) {
  if (!payload || typeof payload !== "object") return null;
  const encrypted = Boolean(payload.encrypted);
  const data = asString(payload.data);
  if (!data) return null;

  if (encrypted) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buffer = Buffer.from(data, "base64");
    const decrypted = safeStorage.decryptString(buffer);
    return JSON.parse(decrypted);
  }

  return JSON.parse(data);
}

function saveSession(sessionInput) {
  const session = sanitizeSession(sessionInput);
  if (!session) {
    throw new Error("accessToken is required");
  }

  const filePath = getSessionFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, serializeForDisk(session), { encoding: "utf8" });
  return session;
}

function readSession() {
  try {
    const filePath = getSessionFilePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    const session = deserializeFromDisk(parsed);
    return sanitizeSession(session);
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    const filePath = getSessionFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best effort cleanup.
  }
}

function getSessionStatus() {
  const session = readSession();
  if (!session) {
    return { authenticated: false, session: null, reason: "missing" };
  }

  if (Number.isFinite(session.expiresAt) && Number(session.expiresAt) <= Date.now()) {
    clearSession();
    return { authenticated: false, session: null, reason: "expired" };
  }

  return {
    authenticated: true,
    session: {
      user: session.user,
      expiresAt: session.expiresAt,
      updatedAt: session.updatedAt,
    },
    reason: "ok",
  };
}

function processDesktopAuthCallback(rawUrl) {
  const urlText = asString(rawUrl).replace(/^"+|"+$/g, "");
  if (!urlText) return { handled: false, authenticated: false };

  let parsed;
  try {
    parsed = new URL(urlText);
  } catch {
    return { handled: false, authenticated: false };
  }

  if (String(parsed.protocol || "").toLowerCase() !== "asmdesktop:") {
    return { handled: false, authenticated: false };
  }

  const clear = parsed.searchParams.get("clear");
  if (clear === "1" || clear === "true") {
    clearSession();
    return { handled: true, authenticated: false };
  }

  const accessToken = asString(parsed.searchParams.get("token") || parsed.searchParams.get("accessToken"));
  if (!accessToken) {
    return { handled: true, authenticated: false };
  }

  const saved = saveSession({ accessToken });
  return {
    handled: true,
    authenticated: true,
    session: {
      user: saved.user,
      expiresAt: saved.expiresAt,
      updatedAt: saved.updatedAt,
    },
  };
}

function registerAuthIpcHandlers(ipcMain, options = {}) {
  const onSessionChanged = typeof options.onSessionChanged === "function" ? options.onSessionChanged : null;

  ipcMain.handle(CHANNELS.AUTH.SAVE_SESSION, async (_event, payload) => {
    const saved = saveSession(payload);
    if (onSessionChanged) {
      onSessionChanged({ authenticated: true });
    }
    return {
      authenticated: true,
      session: {
        user: saved.user,
        expiresAt: saved.expiresAt,
        updatedAt: saved.updatedAt,
      },
    };
  });

  ipcMain.handle(CHANNELS.AUTH.GET_SESSION, async () => {
    return getSessionStatus();
  });

  ipcMain.handle(CHANNELS.AUTH.CLEAR_SESSION, async () => {
    clearSession();
    if (onSessionChanged) {
      onSessionChanged({ authenticated: false });
    }
    return { authenticated: false, session: null, reason: "cleared" };
  });

  ipcMain.handle(CHANNELS.AUTH.CHECK_SESSION, async () => {
    return getSessionStatus();
  });

  ipcMain.handle(CHANNELS.AUTH.VALIDATE_TOKEN, async () => {
    return getSessionStatus();
  });
}

module.exports = {
  registerAuthIpcHandlers,
  processDesktopAuthCallback,
  getStoredSession: readSession,
};