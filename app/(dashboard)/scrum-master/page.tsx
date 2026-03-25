"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BlockLoadingOverlay } from "@/components/block-loading-overlay";

type Project = { id: string; name: string };

type Agent = {
  id: string;
  name: string;
  role?: string;
  status?: string;
  dataSources?: string[];
  isCustom?: boolean;
};

type AgentConfig = {
  trigger_settings?: Record<string, unknown>;
  autonomy_level?: number;
  constraints?: Record<string, unknown>;
  context_memo?: string;
};

type CreateAgentForm = {
  name: string;
  role: "task-generator" | "assignment" | "monitoring" | "custom";
  promptTemplate: string;
  dataSources: string[];
  triggerEvents: string[];
  triggerConditions: string[];
  actions: string[];
  autonomyLevel: 1 | 2 | 3;
  projectIds: string[];
};

const DATA_SOURCE_OPTIONS = ["GitHub", "Database", "Documentation (RAG)"];
const TRIGGER_EVENT_OPTIONS = ["github.push", "task.created", "task.updated"];
const ACTION_OPTIONS = ["create tasks", "assign developers", "send alerts", "reassign tasks"];

function safe(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => safe(x)).filter(Boolean);
}

const EMPTY_CREATE_FORM: CreateAgentForm = {
  name: "",
  role: "custom",
  promptTemplate: "",
  dataSources: [],
  triggerEvents: [],
  triggerConditions: [],
  actions: [],
  autonomyLevel: 2,
  projectIds: [],
};

export default function ScrumMasterPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [autoMode, setAutoMode] = useState(true);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createForm, setCreateForm] = useState<CreateAgentForm>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editAgentId, setEditAgentId] = useState("");
  const [editConfigText, setEditConfigText] = useState("{}");

  const [logsByAgent, setLogsByAgent] = useState<Record<string, string[]>>({});

  const customAgents = useMemo(() => agents.filter((a) => Boolean(a.isCustom)), [agents]);

  const loadProjects = useCallback(async () => {
    const resp = await fetch("/api/projects", { cache: "no-store" });
    const json = await resp.json().catch(() => ({}));
    const items = Array.isArray(json?.items) ? json.items : [];
    const rows = items
      .map((x: { id?: string; name?: string }) => ({ id: safe(x.id), name: safe(x.name) }))
      .filter((x: Project) => x.id);
    setProjects(rows);
    if (!projectId && rows.length) setProjectId(rows[0].id);
  }, [projectId]);

  const loadPolicy = useCallback(async () => {
    if (!projectId) return;
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/automation-policy`, { cache: "no-store" });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) return;
    const next =
      Boolean(json?.createFromIssue) &&
      Boolean(json?.createFromPr) &&
      Boolean(json?.autoAssign) &&
      Boolean(json?.monitoringEnabled);
    setAutoMode(next);
  }, [projectId]);

  const loadAgents = useCallback(async () => {
    if (!projectId) return;
    setLoadingAgents(true);
    try {
      const resp = await fetch(`/api/agents?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await resp.json().catch(() => ({}));
      const rows = Array.isArray(json?.agents) ? json.agents : [];
      const normalized = rows
        .map((row: Record<string, unknown>) => ({
          id: safe(row.id),
          name: safe(row.name),
          role: safe(row.role || "custom"),
          status: safe(row.status || "idle"),
          dataSources: asArray(row.dataSources),
          isCustom: Boolean(row.isCustom),
        }))
        .filter((x: Agent) => x.id);
      setAgents(normalized);
    } finally {
      setLoadingAgents(false);
    }
  }, [projectId]);

  const toggleAutoMode = useCallback(async () => {
    if (!projectId) return;
    const next = !autoMode;
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/automation-policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createFromIssue: next,
        createFromPr: next,
        autoAssign: next,
        monitoringEnabled: next,
      }),
    });
    setAutoMode(next);
  }, [autoMode, projectId]);

  const setAgentEnabled = useCallback(
    async (agentId: string, enabled: boolean) => {
      if (!projectId) return;
      await fetch(`/api/agents/${encodeURIComponent(agentId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: enabled ? "active" : "paused" }),
      });
      await loadAgents();
    },
    [loadAgents, projectId]
  );

  const removeAgent = useCallback(
    async (agentId: string) => {
      if (!projectId) return;
      if (!confirm("Remove this agent from the current project?")) return;
      await fetch(`/api/agents/${encodeURIComponent(agentId)}?projectId=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      await loadAgents();
    },
    [loadAgents, projectId]
  );

  const openEdit = useCallback(
    async (agentId: string) => {
      if (!projectId) return;
      setEditAgentId(agentId);
      setEditOpen(true);
      const resp = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/config?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      const json = await resp.json().catch(() => ({}));
      const config = (json?.config || {}) as AgentConfig;
      setEditConfigText(JSON.stringify(config, null, 2));
    },
    [projectId]
  );

  const saveEdit = useCallback(async () => {
    if (!projectId || !editAgentId) return;
    let parsed: AgentConfig;
    try {
      parsed = JSON.parse(editConfigText) as AgentConfig;
    } catch {
      return;
    }

    setEditBusy(true);
    try {
      await fetch(`/api/agents/${encodeURIComponent(editAgentId)}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          triggerSettings: parsed.trigger_settings || {},
          autonomyLevel: Number(parsed.autonomy_level || 2),
          constraints: parsed.constraints || {},
          contextMemo: safe(parsed.context_memo || ""),
        }),
      });
      setEditOpen(false);
      await loadAgents();
    } finally {
      setEditBusy(false);
    }
  }, [editAgentId, editConfigText, loadAgents, projectId]);

  const openLogs = useCallback(
    async (agentId: string) => {
      if (!projectId) return;
      const resp = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/decisions?projectId=${encodeURIComponent(projectId)}&page=1`,
        { cache: "no-store" }
      );
      const json = await resp.json().catch(() => ({}));
      const rows = Array.isArray(json?.items) ? json.items : [];
      setLogsByAgent((prev) => ({
        ...prev,
        [agentId]: rows
          .slice(0, 10)
          .map((x: Record<string, unknown>) => safe(x.action_description || x.status || "update")),
      }));
    },
    [projectId]
  );

  const createAgent = useCallback(async () => {
    if (!createForm.name.trim() || !createForm.projectIds.length) return;
    setCreateError("");
    setCreateSuccess("");
    setCreateBusy(true);
    try {
      const resp = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createForm,
          contextMemo: createForm.promptTemplate,
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setCreateError(safe(json?.detail || json?.error) || "Failed to create agent.");
        return;
      }

      setCreateOpen(false);
      setCreateForm({ ...EMPTY_CREATE_FORM, projectIds: projectId ? [projectId] : [] });
      await loadAgents();
      setCreateSuccess("Agent created successfully.");
    } finally {
      setCreateBusy(false);
    }
  }, [createForm, loadAgents, projectId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!projectId) return;
    void loadPolicy();
    void loadAgents();
  }, [loadAgents, loadPolicy, projectId]);

  useEffect(() => {
    if (!createForm.projectIds.length && projectId) {
      setCreateForm((prev) => ({ ...prev, projectIds: [projectId] }));
    }
  }, [createForm.projectIds.length, projectId]);

  return (
    <div className="jira-page-content min-h-screen p-5 md:p-7">
      <BlockLoadingOverlay active={loadingAgents} label="Loading agents..." fullScreen={true} delayMs={120} />
      <div className="mx-auto max-w-[1280px] space-y-4">
        <div className="text-lg font-semibold">Agentic Scum Manager</div>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="grid gap-2 md:grid-cols-3">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void toggleAutoMode()}
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
              >
                Auto Mode: {autoMode ? "ON" : "OFF"}
              </button>

              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
              >
                Create Agent
              </button>
            </div>
            {loadingAgents ? <div className="text-xs text-[var(--text-secondary)]">Loading agents...</div> : null}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <div className="mb-3 text-sm font-semibold">Project Agents</div>
          {createSuccess ? <div className="mb-2 text-xs text-[var(--accent-green)]">{createSuccess}</div> : null}

          {customAgents.length ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {customAgents.map((agent) => {
                const active = safe(agent.status).toLowerCase().includes("active") || safe(agent.status).toLowerCase().includes("running");
                return (
                  <div key={agent.id} className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">{agent.name}</div>
                      <div className="text-xs text-[var(--text-secondary)]">{agent.status || "idle"}</div>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">role: {agent.role || "custom"}</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      sources: {(agent.dataSources || []).join(", ") || "none"}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void setAgentEnabled(agent.id, !active)}
                        className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs"
                      >
                        {active ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openEdit(agent.id)}
                        className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs"
                      >
                        Edit Configuration
                      </button>
                      <button
                        type="button"
                        onClick={() => void openLogs(agent.id)}
                        className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs"
                      >
                        View Logs
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeAgent(agent.id)}
                        className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300"
                      >
                        Delete Agent
                      </button>
                      <Link
                        href={`/scrum-master/agent/${encodeURIComponent(agent.id)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`}
                        className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs"
                      >
                        Open Agent Page
                      </Link>
                    </div>

                    {logsByAgent[agent.id]?.length ? (
                      <div className="mt-2 rounded border border-[var(--border)] bg-[var(--bg-card)] p-2 text-[11px] text-[var(--text-secondary)]">
                        {logsByAgent[agent.id].map((line, idx) => (
                          <div key={`${agent.id}:${idx}`}>{line}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
              No project agents created yet.
            </div>
          )}
        </section>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Create Agent</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Agent Name"
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
              />
              <select
                value={createForm.role}
                onChange={(e) =>
                  setCreateForm((p) => ({ ...p, role: e.target.value as CreateAgentForm["role"] }))
                }
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
              >
                <option value="task-generator">task generator</option>
                <option value="assignment">assignment</option>
                <option value="monitoring">monitoring</option>
                <option value="custom">custom</option>
              </select>
              <input
                placeholder="Conditions (example: inactivity > 24h)"
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
                onChange={(e) =>
                  setCreateForm((p) => ({
                    ...p,
                    triggerConditions: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                  }))
                }
              />
              <select
                value={createForm.autonomyLevel}
                onChange={(e) =>
                  setCreateForm((p) => ({ ...p, autonomyLevel: Number(e.target.value) as 1 | 2 | 3 }))
                }
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm"
              >
                <option value={1}>Suggestion only</option>
                <option value={2}>Auto-execute</option>
                <option value={3}>Require approval</option>
              </select>
            </div>

            <textarea
              value={createForm.promptTemplate}
              onChange={(e) => setCreateForm((p) => ({ ...p, promptTemplate: e.target.value }))}
              placeholder="AI Agent Prompt Template"
              className="mt-3 h-24 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm"
            />

            <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
              <div className="mb-1 text-[var(--text-secondary)]">Data Sources</div>
              <div className="grid gap-1 md:grid-cols-3">
                {DATA_SOURCE_OPTIONS.map((option) => {
                  const checked = createForm.dataSources.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            dataSources: e.target.checked
                              ? [...new Set([...prev.dataSources, option])]
                              : prev.dataSources.filter((x) => x !== option),
                          }))
                        }
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
              <div className="mb-1 text-[var(--text-secondary)]">Trigger Events</div>
              <div className="grid gap-1 md:grid-cols-3">
                {TRIGGER_EVENT_OPTIONS.map((option) => {
                  const checked = createForm.triggerEvents.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            triggerEvents: e.target.checked
                              ? [...new Set([...prev.triggerEvents, option])]
                              : prev.triggerEvents.filter((x) => x !== option),
                          }))
                        }
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
              <div className="mb-1 text-[var(--text-secondary)]">Actions</div>
              <div className="grid gap-1 md:grid-cols-2">
                {ACTION_OPTIONS.map((option) => {
                  const checked = createForm.actions.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            actions: e.target.checked
                              ? [...new Set([...prev.actions, option])]
                              : prev.actions.filter((x) => x !== option),
                          }))
                        }
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 rounded border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs">
              <div className="mb-1 text-[var(--text-secondary)]">Assign to projects</div>
              <div className="grid gap-1 md:grid-cols-2">
                {projects.map((p) => {
                  const checked = createForm.projectIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setCreateForm((prev) => ({
                            ...prev,
                            projectIds: e.target.checked
                              ? [...new Set([...prev.projectIds, p.id])]
                              : prev.projectIds.filter((id) => id !== p.id),
                          }));
                        }}
                      />
                      {p.name}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void createAgent()}
                className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {createBusy ? "Creating..." : "Create Agent"}
              </button>
            </div>
            {createError ? <div className="mt-2 text-xs text-[var(--accent-red)]">{createError}</div> : null}
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Edit Configuration</h3>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>

            <textarea
              value={editConfigText}
              onChange={(e) => setEditConfigText(e.target.value)}
              className="h-40 w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs"
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editBusy}
                onClick={() => void saveEdit()}
                className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {editBusy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
