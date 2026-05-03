import { desktopGatewayRequest, type GatewayMethod } from "@/lib/desktop-gateway";

type CacheEntry = {
  savedAt: number;
  payload: unknown;
};

const CACHE_PREFIX = "asm.desktop.api.cache.v1:";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const PATH_CANDIDATE_ORIGIN = "http://desktop.local";

function isDesktopRenderer(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktopApi?.invoke);
}

function normalizePath(path: string): string {
  const value = String(path || "").trim();
  if (!value.startsWith("/")) {
    throw new Error("Path must start with '/'");
  }
  return value;
}

function toPathWithV1Prefix(path: string): string {
  const normalized = normalizePath(path);
  const url = new URL(normalized, PATH_CANDIDATE_ORIGIN);
  if (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/v1/")) {
    return `${url.pathname}${url.search}`;
  }
  url.pathname = `/api/v1/${url.pathname.slice("/api/".length)}`;
  return `${url.pathname}${url.search}`;
}

function toCandidatePaths(path: string): string[] {
  const normalized = normalizePath(path);
  if (!normalized.startsWith("/api/") || normalized.startsWith("/api/v1/")) {
    return [normalized];
  }
  return [toPathWithV1Prefix(normalized), normalized];
}

function asStatusCode(message: string): number {
  const match = String(message || "").match(/\((\d{3})\)/);
  const code = Number(match?.[1] || 500);
  if (!Number.isFinite(code)) return 500;
  return Math.max(400, Math.min(599, code));
}

function isSupportedMethod(method: string): method is GatewayMethod {
  return method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function toPath(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : "";

  if (!raw) return null;

  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const parsed = new URL(raw);
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }

  if (raw.startsWith("/")) return raw;
  return null;
}

function parseBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }
  return undefined;
}

function getCacheKey(path: string): string {
  return `${CACHE_PREFIX}${path}`;
}

function readCache(path: string): unknown | null {
  try {
    const raw = window.localStorage.getItem(getCacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

function writeCache(path: string, payload: unknown): void {
  try {
    const entry: CacheEntry = { savedAt: Date.now(), payload };
    window.localStorage.setItem(getCacheKey(path), JSON.stringify(entry));
  } catch {
    // Ignore quota/cache serialization errors.
  }
}

function jsonResponse(payload: unknown, status = 200, source?: "gateway" | "cache"): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (source) headers.set("x-asm-data-source", source);
  return new Response(JSON.stringify(payload ?? null), { status, headers });
}

async function tryNativeFetchCandidates(
  nativeFetch: typeof window.fetch,
  candidatePaths: string[],
  method: GatewayMethod,
  init?: RequestInit
): Promise<Response | null> {
  let lastResponse: Response | null = null;

  for (const candidatePath of candidatePaths) {
    try {
      const response = await nativeFetch(candidatePath, {
        ...(init || {}),
        method,
        cache: "no-store",
        credentials: init?.credentials || "include",
        body: method === "GET" || method === "DELETE" ? undefined : init?.body,
      });

      if (response.ok) return response;
      lastResponse = response;
    } catch {
      // Try next candidate path.
    }
  }

  return lastResponse;
}

export function installDesktopFetchBridge(): void {
  if (!isDesktopRenderer()) return;

  const win = window as Window & { __asmFetchBridgeInstalled?: boolean };
  if (win.__asmFetchBridgeInstalled) return;
  win.__asmFetchBridgeInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = toPath(input);
    if (!path || !path.startsWith("/api/")) {
      return nativeFetch(input, init);
    }

    const methodRaw = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!isSupportedMethod(methodRaw)) {
      return nativeFetch(input, init);
    }

    if (input instanceof Request) {
      return nativeFetch(input, init);
    }

    const candidatePaths = toCandidatePaths(path);
    const payload = methodRaw === "GET" || methodRaw === "DELETE" ? undefined : parseBody(init?.body);

    try {
      const data = await desktopGatewayRequest(methodRaw, path, payload);
      if (methodRaw === "GET") writeCache(path, data);
      return jsonResponse(data, 200, "gateway");
    } catch (error) {
      const nativeResponse = await tryNativeFetchCandidates(nativeFetch, candidatePaths, methodRaw, init);
      if (nativeResponse && nativeResponse.ok) {
        return nativeResponse;
      }

      const message = error instanceof Error ? error.message : "Gateway request failed";
      if (methodRaw === "GET") {
        const cached = readCache(path);
        if (cached != null) {
          return jsonResponse(cached, 200, "cache");
        }
      }

      if (nativeResponse) return nativeResponse;

      const status = asStatusCode(message);
      return jsonResponse({ error: message, detail: message }, status);
    }
  };
}
