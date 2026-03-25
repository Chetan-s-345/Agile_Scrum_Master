"use client";

import { create } from "zustand";
import { io } from "socket.io-client";

function toArray(value, key) {
  if (!value || typeof value !== "object") return [];
  const list = value[key];
  return Array.isArray(list) ? list : [];
}

const STATUS_POLL_MS = 30000;
const APPROVALS_POLL_MS = 15000;
const ACTIONS_POLL_MS = 20000;

function pendingOnly(approvals) {
  return approvals.filter((item) => String(item?.status || "").toLowerCase() === "pending");
}

export const useAgentStore = create((set, get) => ({
  projectId: "",
  agents: [],
  approvals: [],
  pendingApprovals: [],
  recentActions: [],
  feed: [],
  loading: false,
  error: "",
  socket: null,
  statusTimer: null,
  approvalsTimer: null,
  actionsTimer: null,
  expanded: false,

  setProjectId: (projectId) => set({ projectId: String(projectId || "") }),
  setExpanded: (expanded) => set({ expanded: Boolean(expanded) }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  setAgents: (agents) => set({ agents: Array.isArray(agents) ? agents : [] }),
  setApprovals: (approvals) =>
    set({
      approvals: Array.isArray(approvals) ? approvals : [],
      pendingApprovals: pendingOnly(Array.isArray(approvals) ? approvals : []),
    }),
  setRecentActions: (recentActions) => set({ recentActions: Array.isArray(recentActions) ? recentActions : [] }),
  addFeedItem: (item) => set((s) => ({ feed: [item, ...s.feed].slice(0, 50) })),

  refreshAgents: async () => {
    const projectId = get().projectId;
    if (!projectId) return;

    try {
      const statusResp = await fetch("/api/agents/status", { cache: "no-store" });
      const statusJson = await statusResp.json().catch(() => ({}));
      set({ agents: toArray(statusJson, "agents") });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to load agent status.";
      set({ error: detail });
    }
  },

  refreshApprovals: async () => {
    const projectId = get().projectId;
    if (!projectId) return;

    try {
      const approvalsResp = await fetch(`/api/agents/approvals?projectId=${encodeURIComponent(projectId)}&status=pending`, {
        cache: "no-store",
      });
      const approvalsJson = await approvalsResp.json().catch(() => ({}));
      const approvals = toArray(approvalsJson, "approvals");
      set({ approvals, pendingApprovals: pendingOnly(approvals) });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to load approvals.";
      set({ error: detail });
    }
  },

  refreshActions: async () => {
    const projectId = get().projectId;
    if (!projectId) return;

    try {
      const actionsResp = await fetch(`/api/agents/actions?projectId=${encodeURIComponent(projectId)}&limit=20`, { cache: "no-store" });
      const actionsJson = await actionsResp.json().catch(() => ({}));
      const items = toArray(actionsJson, "items");
      set({ recentActions: items });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Failed to load actions.";
      set({ error: detail });
    }
  },

  refreshAll: async () => {
    set({ loading: true, error: "" });
    await Promise.all([get().refreshAgents(), get().refreshApprovals(), get().refreshActions()]);
    set({ loading: false });
  },

  connect: () => {
    const state = get();
    if (state.socket || !state.projectId) return;

    const url = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    if (!url) return;

    const socket = io(url, { transports: ["websocket", "polling"] });
    socket.on("connect", () => {
      socket.emit("project:join", { projectId: get().projectId });
    });

    socket.on("agent:action", (event) => {
      set((prev) => ({
        feed: [event, ...prev.feed].slice(0, 50),
        recentActions: [event, ...prev.recentActions].slice(0, 20),
      }));
    });

    socket.on("agent:approval", (event) => {
      set((prev) => ({ feed: [event, ...prev.feed].slice(0, 50) }));
      get().refreshApprovals();
    });

    set({ socket });
  },

  disconnect: () => {
    const socket = get().socket;
    if (socket) {
      socket.emit("project:leave", { projectId: get().projectId });
      socket.disconnect();
    }

    const statusTimer = get().statusTimer;
    const approvalsTimer = get().approvalsTimer;
    const actionsTimer = get().actionsTimer;
    if (statusTimer) clearInterval(statusTimer);
    if (approvalsTimer) clearInterval(approvalsTimer);
    if (actionsTimer) clearInterval(actionsTimer);
    set({ socket: null, statusTimer: null, approvalsTimer: null, actionsTimer: null });
  },

  start: () => {
    const projectId = get().projectId;
    if (!projectId) return;

    if (get().statusTimer || get().approvalsTimer || get().actionsTimer) return;

    get().refreshAll();
    get().connect();

    const statusTimer = setInterval(() => {
      get().refreshAgents();
    }, STATUS_POLL_MS);

    const approvalsTimer = setInterval(() => {
      get().refreshApprovals();
    }, APPROVALS_POLL_MS);

    const actionsTimer = setInterval(() => {
      get().refreshActions();
    }, ACTIONS_POLL_MS);

    set({ statusTimer, approvalsTimer, actionsTimer });
  },

  stop: () => {
    get().disconnect();
  },

  approve: async (id) => {
    const approvalId = String(id || "").trim();
    if (!approvalId) return;

    await fetch(`/api/agents/approvals/${encodeURIComponent(approvalId)}/approve`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await get().refreshApprovals();
    await get().refreshActions();
  },

  reject: async (id, reason = "Rejected by reviewer") => {
    const approvalId = String(id || "").trim();
    if (!approvalId) return;

    await fetch(`/api/agents/approvals/${encodeURIComponent(approvalId)}/reject`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    await get().refreshApprovals();
    await get().refreshActions();
  },
}));
