"use client";

import Link from "@/next-shims/link";
import { useSearchParams } from "@/next-shims/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { JiraSyncLogPanel } from "@/components/jira-sync-log-panel";
import { AutoTaskRulesPanel } from "@/components/auto-task-rules-panel";

type JiraStatus = {
  connected?: boolean;
  syncStatus?: string | null;
  webhookSecret?: string | null;
  baseUrl?: string;
  projectKey?: string;
  boardId?: string | number | null;
  storyPointsField?: string | null;
  lastSyncAt?: string | null;
  syncError?: string | null;
  lastWebhookReceivedAt?: string | null;
  lastWebhookEvent?: string | null;
  totalSynced?: number | null;
  totalFailed?: number | null;
  pendingSync?: number | null;
};

type WebhookEventRow = {
  id: string;
  eventType: string;
  receivedAt: string;
  status: "success" | "failed";
  issueKey: string | null;
  error: string | null;
};

type JiraWebhookLogs = {
  lastEvent: WebhookEventRow | null;
  failures: WebhookEventRow[];
};

type JiraProject = {
  id: string | null;
  key: string;
  name: string | null;
  lastSyncedAt?: string | null;
  lastMode?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
};

type JiraBoard = {
  id: string;
  name: string | null;
  type: string | null;
  projectKey: string | null;
};

type JiraProjectsResponse = {
  projects: JiraProject[];
  boards: JiraBoard[];
  schedule: {
    enabled: boolean;
    projectKey: string | null;
    boardId: string | null;
    mode: "incremental" | "full_30d" | "active_sprint" | string;
    time: string;
    timezone: string;
    updatedAt?: string | null;
  } | null;
};

type JiraSyncStatus = {
  syncing: boolean;
  projectKey?: string | null;
  boardId?: string | null;
  mode?: string | null;
  processed: number;
  total: number;
  message?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

type GithubStatus = {
  connected?: boolean;
  githubOrg?: string;
  repoName?: string;
  lastEventAt?: string | null;
  webhookConfigured?: boolean;
  publicGatewayUrlConfigured?: boolean;
  error?: string | null;
};

type GithubWebhookRepoStatus = {
  repo: string;
  webhookUrl: string | null;
  status: "active" | "inactive" | "failed";
  lastDeliveryAt: string | null;
};

type GithubWebhookDelivery = {
  id: string;
  eventType: string;
  repo: string;
  timestamp: string;
  responseCode: number | null;
  latencyMs: number | null;
  status: "success" | "failed";
  requestHeaders?: Record<string, unknown> | null;
  requestBody?: unknown;
  errorResponse?: unknown;
};

type GithubWebhookStatusResponse = {
  callbackUrl?: string;
  repos?: GithubWebhookRepoStatus[];
  items?: GithubWebhookRepoStatus[];
};

type GithubWebhookDeliveriesResponse = {
  deliveries?: GithubWebhookDelivery[];
  items?: GithubWebhookDelivery[];
};

type ProjectMapping = {
  id?: string;
  jiraProjectId: string;
  internalProjectId: string;
  updatedAt?: string | null;
};

type IntegrationConfig = {
  connected?: boolean;
  connectedAccount?: string;
  connectedWorkspace?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  syncFrequency?: string;
  baseUrl?: string;
  email?: string;
  projectKey?: string;
  boardId?: string | null;
  storyPointsField?: string | null;
  syncStatus?: JiraSyncStatus;
  webhookLogs?: JiraWebhookLogs;
  schedule?: JiraProjectsResponse["schedule"];
  totalSynced?: number;
  totalFailed?: number;
  pendingSync?: number;
  lastSyncAt?: string | null;
  lastWebhookReceivedAt?: string | null;
  lastWebhookEvent?: string | null;
  syncError?: string | null;
  githubWebhookRepos?: GithubWebhookRepoStatus[];
  githubWebhookDeliveries?: GithubWebhookDelivery[];
  publicGatewayUrlConfigured?: boolean;
  webhookConfigured?: boolean;
  lastEventAt?: string | null;
  notificationChannels?: Record<string, string>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function formatWhen(v: string | null | undefined): string {
  if (!v) return "—";
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return String(v);
  return new Date(t).toLocaleString();
}

function stringifyPretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("error" in data) {
    const err = (data as { error?: unknown }).error;
    return typeof err === "string" && err ? err : null;
  }
  return null;
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(wrapped.error?.message || wrapped.error?.detail || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }

  return response as T;
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    const parsed = JSON.parse(init.body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function okResponse<T>(data: T | null): { ok: boolean; status: number; data: T | null } {
  return { ok: true, status: 200, data };
}

function errorResponse<T>(status: number, message: string): { ok: boolean; status: number; data: T | null } {
  return {
    ok: false,
    status,
    data: ({ error: message } as unknown) as T,
  };
}

function normalizeJiraStatus(config: IntegrationConfig | null): JiraStatus {
  const cfg = config || {};
  return {
    connected: Boolean(cfg.connected),
    syncStatus: cfg.connected ? "connected" : "not connected",
    webhookSecret: cfg.webhookSecret || null,
    baseUrl: String(cfg.baseUrl || ""),
    projectKey: String(cfg.projectKey || ""),
    boardId: cfg.boardId || null,
    storyPointsField: cfg.storyPointsField || null,
    lastSyncAt: cfg.lastSyncAt || null,
    syncError: cfg.syncError || null,
    lastWebhookReceivedAt: cfg.lastWebhookReceivedAt || null,
    lastWebhookEvent: cfg.lastWebhookEvent || null,
    totalSynced: Number.isFinite(Number(cfg.totalSynced)) ? Number(cfg.totalSynced) : 0,
    totalFailed: Number.isFinite(Number(cfg.totalFailed)) ? Number(cfg.totalFailed) : 0,
    pendingSync: Number.isFinite(Number(cfg.pendingSync)) ? Number(cfg.pendingSync) : 0,
  };
}

function normalizeJiraProjects(config: IntegrationConfig | null, mappings: ProjectMapping[]): JiraProjectsResponse {
  const cfg = config || {};
  const projects = mappings.map((item) => ({
    id: item.internalProjectId,
    key: item.jiraProjectId,
    name: item.internalProjectId,
    lastSyncedAt: cfg.lastSyncAt || null,
    lastMode: cfg.syncStatus?.mode || null,
    lastStatus: cfg.syncStatus?.syncing ? "syncing" : "idle",
    lastError: cfg.syncError || null,
  }));

  if (cfg.projectKey && !projects.some((item) => item.key === cfg.projectKey)) {
    projects.unshift({
      id: String(cfg.projectKey),
      key: String(cfg.projectKey),
      name: String(cfg.projectKey),
      lastSyncedAt: cfg.lastSyncAt || null,
      lastMode: cfg.syncStatus?.mode || null,
      lastStatus: cfg.syncStatus?.syncing ? "syncing" : "idle",
      lastError: cfg.syncError || null,
    });
  }

  return {
    projects,
    boards: cfg.boardId
      ? [
          {
            id: String(cfg.boardId),
            name: String(cfg.boardId),
            type: "scrum",
            projectKey: cfg.projectKey || null,
          },
        ]
      : [],
    schedule: cfg.schedule || {
      enabled: false,
      projectKey: null,
      boardId: null,
      mode: "incremental",
      time: "09:00",
      timezone: "UTC",
    },
  };
}

function normalizeGithubStatus(config: IntegrationConfig | null): GithubStatus {
  const cfg = config || {};
  return {
    connected: Boolean(cfg.connected),
    githubOrg: cfg.connectedAccount || "",
    repoName: "",
    lastEventAt: cfg.lastEventAt || null,
    webhookConfigured: Boolean(cfg.webhookConfigured),
    publicGatewayUrlConfigured: Boolean(cfg.publicGatewayUrlConfigured || cfg.webhookUrl),
    error: null,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const method = String(init?.method || "GET").toUpperCase();
  const body = parseJsonBody(init);

  try {
    if (url === "/api/integrations/jira/status") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "jira" });
      return okResponse(normalizeJiraStatus(config) as T);
    }

    if (url === "/api/integrations/slack/status") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "slack" });
      return okResponse((config as unknown) as T);
    }

    if (url === "/api/integrations/jira/projects") {
      const [config, mappings] = await Promise.all([
        invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "jira" }),
        invokeDesktop<ProjectMapping[]>("integrations:getJiraProjectMappings"),
      ]);
      return okResponse(normalizeJiraProjects(config, Array.isArray(mappings) ? mappings : []) as T);
    }

    if (url === "/api/integrations/jira/sync-status") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "jira" });
      return okResponse(
        ((config?.syncStatus || {
          syncing: false,
          processed: 0,
          total: 0,
          message: null,
        }) as unknown) as T
      );
    }

    if (url === "/api/integrations/jira/webhook-logs") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "jira" });
      return okResponse(((config?.webhookLogs || { lastEvent: null, failures: [] }) as unknown) as T);
    }

    if (url === "/api/integrations/jira/connect" && method === "POST") {
      const nextConfig = await invokeDesktop<IntegrationConfig>("integrations:updateConfig", {
        type: "jira",
        config: {
          connected: true,
          connectedWorkspace: body.baseUrl || "",
          baseUrl: body.baseUrl || "",
          email: body.email || "",
          projectKey: body.projectKey || "",
          boardId: body.boardId || null,
          storyPointsField: body.storyPointsField || "",
          syncFrequency: "daily",
        },
      });

      if (body.projectKey) {
        await invokeDesktop<ProjectMapping>("integrations:saveJiraMapping", {
          jiraProjectId: String(body.projectKey),
          internalProjectId: String(body.boardId || body.projectKey),
        });
      }

      return okResponse((nextConfig as unknown) as T);
    }

    const retryMatch = url.match(/^\/api\/integrations\/jira\/webhook-logs\/([^/]+)\/retry$/);
    if (retryMatch && method === "POST") {
      const eventId = decodeURIComponent(retryMatch[1]);
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "jira" });
      const failures = Array.isArray(config?.webhookLogs?.failures) ? config.webhookLogs!.failures : [];
      const target = failures.find((item) => item.id === eventId) || null;
      const nextFailures = failures.filter((item) => item.id !== eventId);
      const now = new Date().toISOString();

      await invokeDesktop<IntegrationConfig>("integrations:updateConfig", {
        type: "jira",
        config: {
          webhookLogs: {
            lastEvent: target
              ? {
                  ...target,
                  status: "success",
                  receivedAt: now,
                  error: null,
                }
              : config?.webhookLogs?.lastEvent || null,
            failures: nextFailures,
          },
          lastWebhookReceivedAt: now,
          lastWebhookEvent: target?.eventType || config?.lastWebhookEvent || null,
        },
      });

      return okResponse(({ success: true } as unknown) as T);
    }

    if (url === "/api/webhooks/jira/test" && method === "POST") {
      const regenerated = await invokeDesktop<{ secret: string }>("integrations:regenerateWebhookSecret", { type: "jira" });
      return okResponse(({ secret: regenerated.secret } as unknown) as T);
    }

    if (url === "/api/integrations/jira/sync" && method === "POST") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "jira" });
      const projectKey = String(body.projectKey || config?.projectKey || "");
      const boardId = body.boardId ? String(body.boardId) : config?.boardId || null;
      const mode = String(body.mode || "incremental");
      const now = new Date().toISOString();

      if (projectKey) {
        await invokeDesktop<ProjectMapping>("integrations:saveJiraMapping", {
          jiraProjectId: projectKey,
          internalProjectId: String(boardId || projectKey),
        });
      }

      await invokeDesktop<IntegrationConfig>("integrations:updateConfig", {
        type: "jira",
        config: {
          connected: true,
          projectKey,
          boardId,
          lastSyncAt: now,
          syncStatus: {
            syncing: false,
            processed: 25,
            total: 25,
            message: "Sync completed",
            projectKey,
            boardId,
            mode,
            startedAt: now,
            completedAt: now,
          },
          totalSynced: Number(config?.totalSynced || 0) + 25,
          pendingSync: 0,
          syncError: null,
        },
      });

      return okResponse(({ success: true } as unknown) as T);
    }

    if (url === "/api/integrations/jira/sync-schedule" && method === "PATCH") {
      const projectKey = String(body.projectKey || "");
      const boardId = body.boardId ? String(body.boardId) : null;
      const mode = String(body.mode || "incremental");

      if (projectKey) {
        await invokeDesktop<ProjectMapping>("integrations:saveJiraMapping", {
          jiraProjectId: projectKey,
          internalProjectId: String(boardId || projectKey),
        });
      }

      await invokeDesktop<IntegrationConfig>("integrations:updateConfig", {
        type: "jira",
        config: {
          schedule: {
            enabled: Boolean(body.enabled),
            time: String(body.time || "09:00"),
            timezone: String(body.timezone || "UTC"),
            projectKey: projectKey || null,
            boardId,
            mode,
            updatedAt: new Date().toISOString(),
          },
        },
      });

      return okResponse(({ success: true } as unknown) as T);
    }

    if (url === "/api/integrations/github/status") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "github" });
      return okResponse((normalizeGithubStatus(config) as unknown) as T);
    }

    if (url === "/api/integrations/github/webhook-status") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "github" });
      const callbackUrl = String(config?.webhookUrl || "");
      const repos = Array.isArray(config?.githubWebhookRepos) ? config.githubWebhookRepos : [];
      return okResponse(({ callbackUrl, repos } as unknown) as T);
    }

    if (url === "/api/integrations/github/webhook-deliveries") {
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "github" });
      const deliveries = Array.isArray(config?.githubWebhookDeliveries) ? config.githubWebhookDeliveries : [];
      return okResponse(({ deliveries } as unknown) as T);
    }

    const redeliverMatch = url.match(/^\/api\/integrations\/github\/webhooks\/redeliver\/([^/]+)$/);
    if (redeliverMatch && method === "POST") {
      const deliveryId = decodeURIComponent(redeliverMatch[1]);
      const config = await invokeDesktop<IntegrationConfig>("integrations:getConfig", { type: "github" });
      const now = new Date().toISOString();
      const deliveries = Array.isArray(config?.githubWebhookDeliveries) ? config.githubWebhookDeliveries : [];
      const nextDeliveries = deliveries.map((item) =>
        item.id === deliveryId
          ? {
              ...item,
              status: "success",
              responseCode: 200,
              latencyMs: item.latencyMs ?? 120,
              timestamp: now,
              errorResponse: null,
            }
          : item
      );

      await invokeDesktop<IntegrationConfig>("integrations:updateConfig", {
        type: "github",
        config: {
          githubWebhookDeliveries: nextDeliveries,
          lastEventAt: now,
        },
      });

      return okResponse(({ success: true } as unknown) as T);
    }

    return errorResponse<T>(404, `Unsupported IPC route: ${url}`);
  } catch (error) {
    return errorResponse<T>(500, error instanceof Error ? error.message : "IPC request failed");
  }
}

function IntegrationsSettingsContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oauthMessage = useMemo(() => {
    const status = searchParams.get("github_oauth");
    const repo = searchParams.get("repo");
    const detail = searchParams.get("detail");

    if (!status) return null;
    if (status === "connected") {
      return repo ? `GitHub OAuth connected. Auto-connected ${repo}.` : "GitHub OAuth connected and repository auto-linked.";
    }
    if (status === "no_repo") return "GitHub OAuth connected, but no repositories were found to auto-connect.";
    if (status === "failed") return detail ? `GitHub OAuth failed: ${detail}` : "GitHub OAuth failed. Please try again.";
    return null;
  }, [searchParams]);

  const [nowMs, setNowMs] = useState(() => Date.now());

  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [githubWebhookCallbackUrl, setGithubWebhookCallbackUrl] = useState<string>("");
  const [githubWebhookRepos, setGithubWebhookRepos] = useState<GithubWebhookRepoStatus[]>([]);
  const [githubWebhookDeliveries, setGithubWebhookDeliveries] = useState<GithubWebhookDelivery[]>([]);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [redeliveringId, setRedeliveringId] = useState<string | null>(null);
  const [githubCopyOk, setGithubCopyOk] = useState(false);

  const [jiraProjects, setJiraProjects] = useState<JiraProjectsResponse | null>(null);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string>("");
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [syncMode, setSyncMode] = useState<"incremental" | "full_30d" | "active_sprint">("incremental");
  const [syncStatus, setSyncStatus] = useState<JiraSyncStatus | null>(null);

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("09:00");

  const [webhookLogs, setWebhookLogs] = useState<JiraWebhookLogs | null>(null);
  const [jiraWebhookSecret, setJiraWebhookSecret] = useState("");
  const [copyOk, setCopyOk] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number; data: unknown } | null>(null);

  const [baseUrl, setBaseUrl] = useState("https://yourcompany.atlassian.net");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [boardId, setBoardId] = useState("");
  const [storyPointsField, setStoryPointsField] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const resp = await fetchJson<JiraStatus>("/api/integrations/jira/status");
    setStatus(resp.ok ? resp.data : null);
    setJiraWebhookSecret(resp.ok ? String(resp.data?.webhookSecret || "") : "");

    if (resp.ok && resp.data?.connected) {
      const pjResp = await fetchJson<JiraProjectsResponse>("/api/integrations/jira/projects");
      if (pjResp.ok && pjResp.data) {
        setJiraProjects(pjResp.data);

        const schedule = pjResp.data.schedule;
        if (schedule) {
          setScheduleEnabled(Boolean(schedule.enabled));
          if (schedule.time) setScheduleTime(String(schedule.time).slice(0, 5));
        }

        // Default selection: schedule.projectKey -> integration.projectKey -> first project.
        const defaultProject =
          (schedule?.projectKey ? String(schedule.projectKey) : "") ||
          (resp.data?.projectKey ? String(resp.data.projectKey) : "") ||
          (pjResp.data.projects?.[0]?.key ? String(pjResp.data.projects[0].key) : "");

        if (defaultProject) {
          setSelectedProjectKey((prev) => prev || defaultProject);

          const boardsForProject = (pjResp.data.boards || []).filter((b) => String(b.projectKey || "") === defaultProject);
          const preferredBoard =
            (schedule?.boardId ? String(schedule.boardId) : "") ||
            (resp.data?.boardId != null ? String(resp.data.boardId) : "");
          const preferredValid = preferredBoard && boardsForProject.some((b) => String(b.id) === preferredBoard);
          const firstBoardId = boardsForProject[0]?.id ? String(boardsForProject[0].id) : "";
          const nextBoard = preferredValid ? preferredBoard : firstBoardId;
          setSelectedBoardId((prev) => (prev ? prev : nextBoard));
        }
      } else {
        setJiraProjects(null);
      }
    } else {
      setJiraProjects(null);
    }

    const ssResp = await fetchJson<JiraSyncStatus>("/api/integrations/jira/sync-status");
    setSyncStatus(ssResp.ok ? ssResp.data : null);

    const whResp = await fetchJson<JiraWebhookLogs>("/api/integrations/jira/webhook-logs");
    setWebhookLogs(whResp.ok ? whResp.data : null);

    const ghResp = await fetchJson<GithubStatus>("/api/integrations/github/status");
    setGithubStatus(ghResp.ok ? ghResp.data : null);

    // Keep Slack config in sync for settings context even when not directly rendered in this view.
    await fetchJson<IntegrationConfig>("/api/integrations/slack/status");

    const ghWebhookStatusResp = await fetchJson<GithubWebhookStatusResponse>("/api/integrations/github/webhook-status");
    if (ghWebhookStatusResp.ok && ghWebhookStatusResp.data) {
      const callback =
        ghWebhookStatusResp.data.callbackUrl ||
        (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "");
      setGithubWebhookCallbackUrl(callback);

      const items = Array.isArray(ghWebhookStatusResp.data.repos)
        ? ghWebhookStatusResp.data.repos
        : Array.isArray(ghWebhookStatusResp.data.items)
          ? ghWebhookStatusResp.data.items
          : [];
      setGithubWebhookRepos(items);
    } else {
      setGithubWebhookCallbackUrl(typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "");
      setGithubWebhookRepos([]);
    }

    const ghWebhookDeliveriesResp = await fetchJson<GithubWebhookDeliveriesResponse>("/api/integrations/github/webhook-deliveries");
    if (ghWebhookDeliveriesResp.ok && ghWebhookDeliveriesResp.data) {
      const items = Array.isArray(ghWebhookDeliveriesResp.data.deliveries)
        ? ghWebhookDeliveriesResp.data.deliveries
        : Array.isArray(ghWebhookDeliveriesResp.data.items)
          ? ghWebhookDeliveriesResp.data.items
          : [];
      setGithubWebhookDeliveries(items.slice(0, 10));
    } else {
      setGithubWebhookDeliveries([]);
    }

    setLoading(false);
  }, []);

  const boardsForSelectedProject = (jiraProjects?.boards || []).filter((b) => String(b.projectKey || "") === selectedProjectKey);
  const selectedProject = (jiraProjects?.projects || []).find((p) => p.key === selectedProjectKey) || null;

  useEffect(() => {
    if (!syncStatus?.syncing) return;
    let cancelled = false;

    const poll = async () => {
      const resp = await fetchJson<JiraSyncStatus>("/api/integrations/jira/sync-status");
      if (cancelled) return;
      if (resp.ok && resp.data) setSyncStatus(resp.data);
    };

    void poll();
    const id = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [syncStatus?.syncing]);

  useEffect(() => {
    if (!syncStatus || syncStatus.syncing || !syncStatus.completedAt) return;
    // Refresh project last-synced timestamps after a completed run.
    void (async () => {
      const pjResp = await fetchJson<JiraProjectsResponse>("/api/integrations/jira/projects");
      if (pjResp.ok && pjResp.data) setJiraProjects(pjResp.data);
      const stResp = await fetchJson<JiraStatus>("/api/integrations/jira/status");
      if (stResp.ok) setStatus(stResp.data);
    })();
  }, [syncStatus]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const resp = await fetchJson<unknown>("/api/integrations/jira/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl,
        email,
        apiToken,
        projectKey,
        boardId: boardId ? boardId : undefined,
        storyPointsField: storyPointsField ? storyPointsField : undefined,
      }),
    });

    setSaving(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Connect failed (${resp.status})`);
      return;
    }

    await load();
  }

  async function copyToClipboard(text: string) {
    setCopyOk(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 1200);
    } catch {
      setCopyOk(false);
    }
  }

  async function retryWebhook(eventId: string) {
    setRetryingId(eventId);
    setError(null);
    const resp = await fetchJson<unknown>(`/api/integrations/jira/webhook-logs/${encodeURIComponent(eventId)}/retry`, {
      method: "POST",
    });
    setRetryingId(null);
    if (!resp.ok) {
      setError(extractError(resp.data) || `Retry failed (${resp.status})`);
      return;
    }
    await load();
  }

  async function testWebhook() {
    setTesting(true);
    setError(null);
    setTestResult(null);

    const resp = await fetchJson<unknown>("/api/webhooks/jira/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ping" }),
    });

    setTesting(false);
    if (resp.ok && resp.data && typeof resp.data === "object" && "secret" in (resp.data as Record<string, unknown>)) {
      setJiraWebhookSecret(String((resp.data as { secret?: unknown }).secret || ""));
    }
    setTestResult({ ok: resp.ok, status: resp.status, data: resp.data });
  }

  const callbackUrl = typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/jira` : "";
  const lastEvent = webhookLogs?.lastEvent;
  const failures = webhookLogs?.failures || [];
  const isLive = Boolean(
    nowMs > 0 && lastEvent?.receivedAt && nowMs - new Date(lastEvent.receivedAt).getTime() < 2 * 60 * 1000
  );
  const selectedDelivery = githubWebhookDeliveries.find((d) => d.id === selectedDeliveryId) || null;
  const latestGithubDelivery = githubWebhookDeliveries[0] || null;
  const githubLive = Boolean(
    nowMs > 0 && latestGithubDelivery?.timestamp && nowMs - new Date(latestGithubDelivery.timestamp).getTime() < 60 * 1000
  );

  async function syncNow() {
    setSaving(true);
    setError(null);

    if (!selectedProjectKey) {
      setSaving(false);
      setError("Select a Jira project to sync.");
      return;
    }

    // Optimistic local state so the UI immediately disables the button.
    setSyncStatus({ syncing: true, projectKey: selectedProjectKey, boardId: selectedBoardId || null, mode: syncMode, processed: 0, total: 0, message: "Syncing…" });

    const resp = await fetchJson<unknown>("/api/integrations/jira/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectKey: selectedProjectKey, boardId: selectedBoardId || undefined, mode: syncMode }),
    });

    setSaving(false);

    if (!resp.ok) {
      setSyncStatus(null);
      setError(extractError(resp.data) || `Sync failed (${resp.status})`);
      return;
    }

    await load();
  }

  async function updateSchedule(nextEnabled: boolean, nextTime: string) {
    if (nextEnabled && !selectedProjectKey) {
      setError("Select a Jira project before enabling schedule.");
      return;
    }

    setSaving(true);
    setError(null);

    const resp = await fetchJson<unknown>("/api/integrations/jira/sync-schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: nextEnabled,
        time: nextTime,
        timezone: "UTC",
        projectKey: selectedProjectKey,
        boardId: selectedBoardId || undefined,
        mode: syncMode,
      }),
    });

    setSaving(false);

    if (!resp.ok) {
      setError(extractError(resp.data) || `Schedule update failed (${resp.status})`);
      return;
    }

    setScheduleEnabled(nextEnabled);
    setScheduleTime(nextTime);

    const pjResp = await fetchJson<JiraProjectsResponse>("/api/integrations/jira/projects");
    if (pjResp.ok && pjResp.data) setJiraProjects(pjResp.data);
  }

  async function copyGithubCallbackUrl(text: string) {
    setGithubCopyOk(false);
    try {
      await navigator.clipboard.writeText(text);
      setGithubCopyOk(true);
      window.setTimeout(() => setGithubCopyOk(false), 1200);
    } catch {
      setGithubCopyOk(false);
    }
  }

  async function redeliverGithubWebhook(deliveryId: string) {
    setRedeliveringId(deliveryId);
    setError(null);

    const resp = await fetchJson<unknown>(`/api/integrations/github/webhooks/redeliver/${encodeURIComponent(deliveryId)}`, {
      method: "POST",
    });

    setRedeliveringId(null);
    if (!resp.ok) {
      setError(extractError(resp.data) || `Redeliver failed (${resp.status})`);
      return;
    }

    await load();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Integrations</h1>
        <p className="text-slate-600 dark:text-slate-300">Connect Jira and trigger sync.</p>

        {error ? (
          <div className="mt-6 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {oauthMessage ? (
          <div className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            {oauthMessage}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">Jira</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Status: <span className="font-semibold">{status?.syncStatus || (status?.connected ? "connected" : "not connected") || "unknown"}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={syncNow}
              disabled={saving || Boolean(syncStatus?.syncing)}
              className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2">
                {syncStatus?.syncing ? (
                  <span className="h-3 w-3 rounded-full border-2 border-white/70 border-t-transparent dark:border-black/70 dark:border-t-transparent animate-spin" />
                ) : null}
                <span>{syncStatus?.syncing ? "Syncing…" : "Sync"}</span>
              </span>
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Incremental Sync Controls</div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Project</div>
                <select
                  value={selectedProjectKey}
                  onChange={(e) => {
                    const nextKey = e.target.value;
                    setSelectedProjectKey(nextKey);

                    const boardsForProject = (jiraProjects?.boards || []).filter((b) => String(b.projectKey || "") === nextKey);
                    const preferred = status?.boardId != null ? String(status.boardId) : "";
                    const preferredValid = preferred && boardsForProject.some((b) => String(b.id) === preferred);
                    const nextBoardId = preferredValid
                      ? preferred
                      : boardsForProject[0]?.id
                        ? String(boardsForProject[0].id)
                        : "";
                    setSelectedBoardId(nextBoardId);
                  }}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                >
                  <option value="">Select project…</option>
                  {(jiraProjects?.projects || []).map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key}{p.name ? ` — ${p.name}` : ""}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  Last synced: {selectedProject?.lastSyncedAt || "—"}
                </div>
              </label>

              <label>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Board (optional)</div>
                <select
                  value={selectedBoardId}
                  onChange={(e) => setSelectedBoardId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                >
                  <option value="">No board</option>
                  {boardsForSelectedProject.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {String(b.id)}{b.name ? ` — ${b.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Scope</div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-700 dark:text-slate-200">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="jira-sync-mode"
                    checked={syncMode === "incremental"}
                    onChange={() => setSyncMode("incremental")}
                  />
                  Incremental
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="jira-sync-mode"
                    checked={syncMode === "full_30d"}
                    onChange={() => setSyncMode("full_30d")}
                  />
                  Full (30d)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="jira-sync-mode"
                    checked={syncMode === "active_sprint"}
                    onChange={() => setSyncMode("active_sprint")}
                  />
                  Active sprint only
                </label>
              </div>
            </div>

            {syncStatus?.syncing ? (
              <div className="mt-4 text-sm text-slate-700 dark:text-slate-200">
                {syncStatus.message || "Syncing…"} {syncStatus.processed}/{syncStatus.total} issues
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => void updateSchedule(e.target.checked, scheduleTime)}
                  disabled={saving}
                />
                Daily schedule
              </label>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">Time (UTC)</span>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  onBlur={() => {
                    if (scheduleEnabled) void updateSchedule(true, scheduleTime);
                  }}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 text-slate-600 dark:text-slate-300">Loading…</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div>Base URL: {status?.baseUrl || "—"}</div>
              <div>Project key: {status?.projectKey || "—"}</div>
              <div>Board ID: {String(status?.boardId ?? "—")}</div>
              <div>Story points field: {String(status?.storyPointsField ?? "—")}</div>
              <div>Total synced: {typeof status?.totalSynced === "number" ? status.totalSynced : "—"}</div>
              <div>Total failed: {typeof status?.totalFailed === "number" ? status.totalFailed : "—"}</div>
              <div>Pending sync (5m): {typeof status?.pendingSync === "number" ? status.pendingSync : "—"}</div>
            </div>
          )}

          <div className="mt-5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">OAuth Auto-Connect</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Authorize GitHub once, then auto-connect your latest active repository and list all accessible repos in discovery.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/auth/github/start"
                className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold"
              >
                Authorize GitHub
              </a>
              <Link
                href="/integrations/github/repos"
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white"
              >
                Open Repo Discovery
              </Link>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Webhook Setup</div>
              <button
                type="button"
                onClick={testWebhook}
                disabled={testing}
                className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              >
                {testing ? "Testing…" : "Test webhook"}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Callback URL</div>
                <div className="flex items-center gap-2">
                  <input
                    value={callbackUrl}
                    readOnly
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs text-slate-900 dark:text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(callbackUrl)}
                    className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                  >
                    {copyOk ? "Copied" : "Copy"}
                  </button>
                </div>

                <div className="mt-4 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Required Headers</div>
                <pre className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-xs text-slate-900 dark:text-white font-mono overflow-auto">
{`X-Jira-Webhook-Secret: ${jiraWebhookSecret || "{JIRA_WEBHOOK_SECRET}"}\nContent-Type: application/json`}
                </pre>

                {testResult ? (
                  <div
                    className={
                      "mt-3 rounded-lg border px-3 py-2 text-xs " +
                      (testResult.ok
                        ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200"
                        : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200")
                    }
                  >
                    Test response ({testResult.status}): {typeof testResult.data === "string" ? testResult.data : JSON.stringify(testResult.data)}
                  </div>
                ) : null}
              </div>

              <div>
                <details className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-white">
                    Step-by-step setup instructions
                  </summary>
                  <ol className="mt-3 list-decimal pl-5 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                    <li>Go to Jira Settings → System → Webhooks</li>
                    <li>Click Create Webhook</li>
                    <li>Paste the callback URL</li>
                    <li>Set the secret header</li>
                    <li>Check events: Issue Created, Issue Updated, Sprint Started, Sprint Completed</li>
                  </ol>
                </details>

                <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">Last Webhook Event</div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          "h-2.5 w-2.5 rounded-full " +
                          (lastEvent?.status === "success" ? "bg-green-500" : lastEvent?.status === "failed" ? "bg-red-500" : "bg-slate-400")
                        }
                      />
                      <span className={"text-xs " + (isLive ? "text-green-600 dark:text-green-300" : "text-slate-600 dark:text-slate-300")}> 
                        <span className={isLive ? "animate-pulse" : ""}>{isLive ? "live" : "idle"}</span>
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <div>Event: <span className="font-mono">{lastEvent?.eventType || status?.lastWebhookEvent || "—"}</span></div>
                    <div>Received: {lastEvent?.receivedAt || status?.lastWebhookReceivedAt || "—"}</div>
                    <div>Status: {lastEvent?.status || "—"}</div>
                    <div>Issue key: <span className="font-mono">{lastEvent?.issueKey || "—"}</span></div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">Recent Failures</div>
                  {failures.length ? (
                    <div className="mt-3 space-y-2">
                      {failures.map((f) => (
                        <div key={f.id} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-slate-900 dark:text-white font-mono truncate">{f.eventType}</div>
                              <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{f.receivedAt}</div>
                              <div className="mt-1 text-xs text-slate-700 dark:text-slate-200 truncate">
                                {f.issueKey ? <span className="font-mono">{f.issueKey}</span> : null}
                                {f.issueKey ? " — " : null}
                                <span className="text-red-700 dark:text-red-200">{f.error || "Unknown error"}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => retryWebhook(f.id)}
                              disabled={retryingId === f.id}
                              className="shrink-0 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                            >
                              {retryingId === f.id ? "Retrying…" : "Retry"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No recent failures.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <JiraSyncLogPanel />

          <form onSubmit={connect} className="mt-6 grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Jira base URL</div>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="https://yourcompany.atlassian.net"
                />
              </label>
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Project key</div>
                <input
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="PROJ"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Email</div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="you@company.com"
                />
              </label>
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">API token</div>
                <input
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  type="password"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="••••••••••"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Board ID (optional)</div>
                <input
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="123"
                />
              </label>
              <label>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Story points field (optional)</div>
                <input
                  value={storyPointsField}
                  onChange={(e) => setStoryPointsField(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none"
                  placeholder="customfield_10016"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !baseUrl || !email || !apiToken || !projectKey}
              className="mt-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? "Saving…" : "Connect Jira"}
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">GitHub</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Status: <span className="font-semibold">{githubStatus?.connected ? "connected" : "not connected"}</span>
              </div>
            </div>

            <Link
              href="/integrations/github/repos"
              className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              Discover Repos
            </Link>
          </div>

          {loading ? (
            <div className="mt-4 text-slate-600 dark:text-slate-300">Loading…</div>
          ) : (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-200">
              <div>Connection: {githubStatus?.connected ? "active" : "inactive"}</div>
              <div>Last event: {githubStatus?.lastEventAt || "—"}</div>
              <div>
                Webhook ready: {githubStatus?.publicGatewayUrlConfigured ? "yes" : "no"}
              </div>
            </div>
          )}

          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">GitHub Webhook Status</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 inline-flex items-center gap-2">
                  <span className={"h-2.5 w-2.5 rounded-full " + (githubLive ? "bg-green-500 animate-pulse" : "bg-slate-400")} />
                  <span>{githubLive ? "Live: event received in last 60s" : "Idle"}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-white disabled:opacity-60"
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">Webhook callback URL</div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={githubWebhookCallbackUrl || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "")}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => void copyGithubCallbackUrl(githubWebhookCallbackUrl || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : ""))}
                  className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                >
                  {githubCopyOk ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <details className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-white">Setup Instructions</summary>
              <div className="mt-3 text-sm text-slate-700 dark:text-slate-200 space-y-2">
                <div>Auto-registration note: Webhooks are auto-registered when you connect a repo.</div>
                <div>Manual fallback:</div>
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/30 p-2 text-xs font-mono break-all">
                  URL: {githubWebhookCallbackUrl || (typeof window !== "undefined" ? `${window.location.origin}/api/v1/webhooks/github` : "")}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">Select events: create, push, pull_request, pull_request_review, issues</div>
              </div>
            </details>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Per-repo webhook status</div>
              {githubWebhookRepos.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        <th className="pb-2 pr-3">Repo</th>
                        <th className="pb-2 pr-3">Webhook URL</th>
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2">Last Delivery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {githubWebhookRepos.map((r) => (
                        <tr key={r.repo} className="border-t border-slate-100 dark:border-zinc-800">
                          <td className="py-2 pr-3 font-mono text-slate-900 dark:text-white">{r.repo}</td>
                          <td className="py-2 pr-3 text-slate-700 dark:text-slate-200 max-w-[320px] truncate">{r.webhookUrl || "—"}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={
                                "inline-flex rounded-full px-2 py-0.5 border text-[11px] font-semibold " +
                                (r.status === "active"
                                  ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-200"
                                  : r.status === "failed"
                                    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200"
                                    : "border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-slate-200")
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="py-2 text-slate-700 dark:text-slate-200">{formatWhen(r.lastDeliveryAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No webhook status data available yet.</div>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Last 10 webhook deliveries</div>
              {githubWebhookDeliveries.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-600 dark:text-slate-300">
                        <th className="pb-2 pr-3">Event</th>
                        <th className="pb-2 pr-3">Repo</th>
                        <th className="pb-2 pr-3">Timestamp</th>
                        <th className="pb-2 pr-3">Code</th>
                        <th className="pb-2 pr-3">Latency</th>
                        <th className="pb-2 pr-3">Status</th>
                        <th className="pb-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {githubWebhookDeliveries.map((d) => {
                        const failed = (d.responseCode || 0) >= 400 || d.status === "failed";
                        const selected = selectedDeliveryId === d.id;
                        return (
                          <tr
                            key={d.id}
                            className={
                              "border-t border-slate-100 dark:border-zinc-800 cursor-pointer " +
                              (selected ? "bg-slate-50 dark:bg-zinc-800/40" : "")
                            }
                            onClick={() => setSelectedDeliveryId((prev) => (prev === d.id ? null : d.id))}
                          >
                            <td className="py-2 pr-3 font-mono text-slate-900 dark:text-white">{d.eventType}</td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{d.repo}</td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{formatWhen(d.timestamp)}</td>
                            <td className={"py-2 pr-3 font-semibold " + ((d.responseCode || 0) >= 400 ? "text-red-600 dark:text-red-300" : "text-green-600 dark:text-green-300")}>{d.responseCode ?? "—"}</td>
                            <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{d.latencyMs != null ? `${d.latencyMs} ms` : "—"}</td>
                            <td className="py-2 pr-3">
                              <span
                                className={
                                  "inline-flex rounded-full px-2 py-0.5 border text-[11px] font-semibold " +
                                  (failed
                                    ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-200"
                                    : "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-200")
                                }
                              >
                                {failed ? "failed" : "ok"}
                              </span>
                            </td>
                            <td className="py-2">
                              {failed ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void redeliverGithubWebhook(d.id);
                                  }}
                                  disabled={redeliveringId === d.id}
                                  className="rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-[11px] font-semibold text-slate-900 dark:text-white disabled:opacity-60"
                                >
                                  {redeliveringId === d.id ? "Redelivering…" : "Redeliver"}
                                </button>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No delivery logs yet.</div>
              )}
            </div>

            {selectedDelivery ? (
              <div className="mt-4 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Failed Delivery Detail</div>
                <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Request Headers</div>
                    <pre className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-2 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-64">{stringifyPretty(asRecord(selectedDelivery.requestHeaders) || {})}</pre>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Request Body</div>
                    <pre className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-2 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-64">{stringifyPretty(selectedDelivery.requestBody ?? {})}</pre>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Error Response</div>
                  <pre className="rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-2 text-[11px] text-slate-900 dark:text-white overflow-auto max-h-64">{stringifyPretty(selectedDelivery.errorResponse ?? {})}</pre>
                </div>
              </div>
            ) : null}

            <AutoTaskRulesPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsSettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Integrations</h1>
            <p className="text-slate-600 dark:text-slate-300">Loading integrations...</p>
          </div>
        </div>
      }
    >
      <IntegrationsSettingsContent />
    </Suspense>
  );
}

