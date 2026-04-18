const { getStoredSession } = require("./auth");

class GatewayError extends Error {
  constructor(message, status = 500, payload = null) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.payload = payload;
  }
}

function asString(value, fallback = "") {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function getGatewayBaseUrl() {
  const candidate = asString(
    process.env.DESKTOP_API_GATEWAY_URL ||
      process.env.API_GATEWAY_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:4000"
  );

  return candidate.replace(/\/+$/, "");
}

function getGatewayToken() {
  const session = getStoredSession();
  const token = asString(session?.accessToken);
  if (!token) {
    throw new GatewayError("Desktop session not found. Please sign in.", 401);
  }
  return token;
}

function buildPath(pathname, query) {
  const normalized = asString(pathname);
  if (!normalized || !normalized.startsWith("/")) {
    throw new GatewayError("Gateway path must start with '/'", 400);
  }

  if (!query || typeof query !== "object") {
    return normalized;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    const text = asString(value);
    if (!text) continue;
    params.set(key, text);
  }

  const qs = params.toString();
  if (!qs) return normalized;
  return `${normalized}${normalized.includes("?") ? "&" : "?"}${qs}`;
}

async function gatewayRequest(method, pathname, options = {}) {
  const normalizedMethod = asString(method, "GET").toUpperCase();
  const pathWithQuery = buildPath(pathname, options.query);
  const url = `${getGatewayBaseUrl()}${pathWithQuery}`;
  const token = getGatewayToken();

  const response = await fetch(url, {
    method: normalizedMethod,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      normalizedMethod === "GET" || normalizedMethod === "DELETE"
        ? undefined
        : JSON.stringify(options.body === undefined ? {} : options.body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = asString(
      payload?.detail || payload?.error || payload?.message || response.statusText || "Gateway request failed"
    );
    throw new GatewayError(`Gateway request failed (${response.status}): ${detail}`, response.status, payload);
  }

  return payload;
}

module.exports = {
  gatewayRequest,
  GatewayError,
};
