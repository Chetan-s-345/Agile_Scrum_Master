export type GatewayMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type IpcWrapped<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    detail?: string;
  };
};

type QueryValue = string | number | boolean | null | undefined;

type QueryObject = Record<string, QueryValue>;

const PATH_CANDIDATE_ORIGIN = "http://desktop.local";

function asErrorDetail(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function normalizePath(path: string): string {
  const value = String(path || "").trim();
  if (!value.startsWith("/")) {
    throw new Error("Gateway path must start with '/'");
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

function buildPath(path: string, query?: QueryObject): string {
  const normalizedPath = normalizePath(path);
  if (!query || typeof query !== "object") {
    return normalizedPath;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  if (!queryString) return normalizedPath;
  return `${normalizedPath}${normalizedPath.includes("?") ? "&" : "?"}${queryString}`;
}

async function invokeGatewayIpc<T>(method: GatewayMethod, path: string, body?: unknown): Promise<T> {
  const response = await window.desktopApi!.invoke<IpcWrapped<T>>("system:gatewayRequest", {
    method,
    path,
    body,
  });

  if (response && typeof response === "object" && "ok" in response) {
    const wrapped = response as IpcWrapped<T>;
    if (!wrapped.ok) {
      throw new Error(asErrorDetail(wrapped.error?.message || wrapped.error?.detail) || "Gateway IPC request failed");
    }
    return wrapped.data as T;
  }

  return response as T;
}

async function requestWithFetch<T>(method: GatewayMethod, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      asErrorDetail(payload && typeof payload === "object" ? (payload as { detail?: string; error?: string }).detail : "") ||
      asErrorDetail(payload && typeof payload === "object" ? (payload as { detail?: string; error?: string }).error : "") ||
      response.statusText ||
      "Request failed";
    throw new Error(`Gateway request failed (${response.status}): ${detail}`);
  }

  return payload as T;
}

export async function desktopGatewayRequest<T>(
  method: GatewayMethod,
  path: string,
  body?: unknown,
  query?: QueryObject
): Promise<T> {
  const nextPath = buildPath(path, query);
  const candidatePaths = toCandidatePaths(nextPath);

  if (window.desktopApi?.invoke) {
    let lastError: unknown = null;
    for (const candidatePath of candidatePaths) {
      try {
        return await invokeGatewayIpc<T>(method, candidatePath, body);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Gateway IPC request failed");
  }

  let lastError: unknown = null;
  for (const candidatePath of candidatePaths) {
    try {
      return await requestWithFetch<T>(method, candidatePath, body);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gateway request failed");
}
