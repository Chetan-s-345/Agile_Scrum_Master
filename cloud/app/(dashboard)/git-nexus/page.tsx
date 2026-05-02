"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Card, PageWrapper } from "@/components/ui/themed";
import { GitNexusChatBox } from "@/components/git-nexus-chatbox";
import { GitNexusPanel } from "@/components/git-nexus-panel";
import type { NexusAnalysisResult } from "@/types/git-nexus";

type Project = { id: string; name?: string; repo_url?: string };

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default function GitNexusPage() {
  const getQueryProjectId = () => {
    try {
      if (typeof window === "undefined") return "";
      return new URLSearchParams(window.location.search).get("projectId") ?? "";
    } catch {
      return "";
    }
  };
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(getQueryProjectId() ?? "");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [analysisResult, setAnalysisResult] = useState<NexusAnalysisResult | null>(null);

  const routeLabel = useMemo(() => "/git-nexus", []);
  const ready = projectId.trim().length > 0;
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId.trim()) || null, [projectId, projects]);
  const structurePayload = useMemo(() => {
    if (!analysisResult?.project_structure || typeof analysisResult.project_structure !== "object") {
      return null;
    }
    return analysisResult.project_structure;
  }, [analysisResult]);
  const structureFieldNames = useMemo(() => {
    return structurePayload ? Object.keys(structurePayload).sort() : [];
  }, [structurePayload]);
  const structureJson = useMemo(() => {
    return structurePayload ? JSON.stringify(structurePayload, null, 2) : "{}";
  }, [structurePayload]);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(420);
  const resizingRef = useRef<{ active: boolean; startX: number; startWidth: number }>({ active: false, startX: 0, startWidth: 420 });
  const gitNexusEndpoints = useMemo(() => {
    return [
      {
        method: "POST",
        pageRoute: "/api/ai/git-nexus/analyze",
        serviceRoute: "/api/v1/git-nexus/analyze",
        purpose: "Run repository analysis (SSE)",
      },
      {
        method: "GET",
        pageRoute: "/api/ai/git-nexus/status",
        serviceRoute: "/api/v1/git-nexus/status",
        purpose: "Sandbox status and readiness",
      },
      {
        method: "GET",
        pageRoute: "/api/ai/git-nexus/tasks?projectId=...",
        serviceRoute: "/api/v1/git-nexus/tasks?project_id=...",
        purpose: "Read cached GitNexus task suggestions",
      },
      {
        method: "POST",
        pageRoute: "(via API gateway) /api/ai/git-nexus/import-tasks",
        serviceRoute: "/api/v1/git-nexus/import-tasks",
        purpose: "Bulk import mapped tasks",
      },
      {
        method: "GET",
        pageRoute: "/api/projects",
        serviceRoute: "database-backed frontend route",
        purpose: "Load project picker data",
      },
      {
        method: "POST",
        pageRoute: "/api/tasks/bulk-create",
        serviceRoute: "task service",
        purpose: "Create selected tasks",
      },
    ];
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectLoading(true);
    setProjectsError("");
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { items?: Project[]; projects?: Project[]; error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || `Failed to load projects (${response.status})`);
      }

      const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.projects) ? payload.projects : [];
      const rows = items.map((row) => ({ id: safeText(row?.id), name: safeText(row?.name), repo_url: safeText(row?.repo_url) })).filter((row) => Boolean(row.id));

      setProjects(rows);
      setProjectId((current) => {
        const normalizedCurrent = safeText(current);
        if (normalizedCurrent && rows.some((row) => row.id === normalizedCurrent)) return normalizedCurrent;
        const queryProjectId = safeText(getQueryProjectId());
        if (queryProjectId && rows.some((row) => row.id === queryProjectId)) return queryProjectId;
        return rows[0]?.id || "";
      });
    } catch (caught) {
      setProjectsError(caught instanceof Error ? caught.message : "Failed to load projects");
    } finally {
      setProjectLoading(false);
    }
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizingRef.current.active) return;
      const dx = resizingRef.current.startX - e.clientX;
      const newWidth = Math.max(320, Math.min(900, resizingRef.current.startWidth + dx));
      setChatWidth(newWidth);
    }

    function onMouseUp() {
      resizingRef.current.active = false;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    if (resizingRef.current.active) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "ew-resize";
    }
    void loadProjects();
  }, [loadProjects]);

  return (
    <PageWrapper title="GitNexus Analysis" subtitle="">
      <div className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_35%),linear-gradient(180deg,_rgba(11,14,20,0.96),_rgba(8,10,14,1))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="pointer-events-none absolute -right-14 top-4 h-40 w-40 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute left-0 bottom-0 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--text-secondary)]">GitNexus</p>
            <h2 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">Repository analysis</h2>
          </div>
          <div className="flex items-center gap-2">
            <Badge color={ready ? "green" : projectLoading ? "blue" : "default"}>{ready ? "Project ready" : projectLoading ? "Loading projects" : "Select a project"}</Badge>
            <Link href="/dashboard" className="text-sm text-[var(--text-secondary)] underline-offset-4 hover:underline">
              Back to dashboard
            </Link>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <div className="space-y-4">
            <Card className="space-y-3">
              {projectsError ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  {projectsError}
                </div>
              ) : null}
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">Project from database</label>
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    disabled={projectLoading}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">{projectLoading ? "Loading projects..." : "Select a project"}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name ? `${project.name} (${project.id})` : project.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  <span className="block uppercase tracking-[0.2em]">Route</span>
                  <code className="text-[var(--text-primary)]">{routeLabel}</code>
                </div>
              </div>

              {selectedProject ? (
                <>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    Active project: <span className="text-[var(--text-primary)]">{selectedProject.name || selectedProject.id}</span>
                  </div>
                  {selectedProject.repo_url && (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                      Repository: <span className="text-[var(--text-primary)]">{selectedProject.repo_url}</span>
                    </div>
                  )}
                </>
              ) : null}
            </Card>

            {selectedProject ? (
              <>
                <GitNexusPanel
                  projectId={projectId.trim()}
                  connectedRepo={selectedProject.repo_url || undefined}
                  embedded
                  onResult={setAnalysisResult}
                />
              </>
            ) : (
              <Card className="space-y-2 border-dashed">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Select a project to continue</h3>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Project details</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Database project metadata and the latest analysis summary.</p>
                </div>
                {analysisResult ? <Badge color="blue">{analysisResult.repo_meta.primary_language}</Badge> : null}
              </div>

              {selectedProject ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
                  <div className="font-medium text-[var(--text-primary)]">{selectedProject.name || selectedProject.id}</div>
                  <div className="mt-1 break-all">Project ID: {selectedProject.id}</div>
                  {selectedProject.repo_url ? <div className="mt-1 break-all">Repository: {selectedProject.repo_url}</div> : null}
                </div>
              ) : null}

              {analysisResult ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    Structure source: live GitNexus analysis payload
                    {structurePayload ? ` · fields: ${structureFieldNames.join(", ") || "none"}` : " · project_structure missing in payload"}
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">API endpoint coverage</div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">Frontend and backend GitNexus endpoints wired for this page.</p>
                    <div className="mt-3 space-y-2 text-xs text-[var(--text-secondary)]">
                      {gitNexusEndpoints.map((endpoint) => (
                        <div key={`${endpoint.method}-${endpoint.pageRoute}`} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[var(--text-primary)] font-medium">{endpoint.method} {endpoint.pageRoute}</div>
                          <div className="mt-1">Backend: {endpoint.serviceRoute}</div>
                          <div className="mt-1">Purpose: {endpoint.purpose}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Project type</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.project_structure?.project_type || analysisResult.repo_meta.primary_language || "Unknown"}</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Analysis window</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.repo_meta.analysis_window_days} days · {analysisResult.repo_meta.total_commits_analyzed} commits</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Directories</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.project_structure?.key_dirs?.length || 0} detected</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Frameworks</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.project_structure?.frameworks?.length || 0} detected</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Workspaces</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.project_structure?.workspaces?.length || 0} detected</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Suggested tasks</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.suggested_tasks.length} returned</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Developers</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.developer_insights.length} analyzed</p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Risks</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{analysisResult.risk_signals.length} identified</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Repository metadata</div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 text-sm text-[var(--text-secondary)]">
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                        <div className="text-[11px] uppercase tracking-[0.2em]">URL</div>
                        <div className="mt-2 break-all text-[var(--text-primary)]">{analysisResult.repo_meta.url || "Unknown"}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                        <div className="text-[11px] uppercase tracking-[0.2em]">Branch</div>
                        <div className="mt-2 text-[var(--text-primary)]">{analysisResult.repo_meta.branch || "Unknown"}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                        <div className="text-[11px] uppercase tracking-[0.2em]">Size</div>
                        <div className="mt-2 text-[var(--text-primary)]">{Math.round(analysisResult.repo_meta.repo_size_kb / 1024)} MB</div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                        <div className="text-[11px] uppercase tracking-[0.2em]">Primary language</div>
                        <div className="mt-2 text-[var(--text-primary)]">{analysisResult.repo_meta.primary_language || "Unknown"}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                        <div className="text-[11px] uppercase tracking-[0.2em]">Languages detected</div>
                        <div className="mt-2 text-[var(--text-primary)]">{analysisResult.repo_meta.languages_detected.length ? analysisResult.repo_meta.languages_detected.join(", ") : "None"}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                        <div className="text-[11px] uppercase tracking-[0.2em]">Sandbox tier</div>
                        <div className="mt-2 text-[var(--text-primary)]">{analysisResult.sandbox_config?.tier_name || "Not reported"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">Analysis output</div>
                      <div className="mt-3 space-y-3 text-sm text-[var(--text-secondary)]">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Total commits analyzed</div>
                          <div className="mt-2 text-[var(--text-primary)]">{analysisResult.repo_meta.total_commits_analyzed}</div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Analysis window</div>
                          <div className="mt-2 text-[var(--text-primary)]">{analysisResult.repo_meta.analysis_window_days} days</div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Sandbox configuration</div>
                          <div className="mt-2 space-y-1 text-[var(--text-primary)]">
                            <div>{analysisResult.sandbox_config?.tier_name || "Not reported"}</div>
                            <div>{analysisResult.sandbox_config ? `${analysisResult.sandbox_config.ram_mb} MB RAM · ${analysisResult.sandbox_config.cpu} CPU` : ""}</div>
                            <div>{analysisResult.sandbox_config?.timeout_seconds ? `${analysisResult.sandbox_config.timeout_seconds}s timeout` : ""}</div>
                            <div>{analysisResult.sandbox_config ? `${analysisResult.sandbox_config.duration_seconds} sec duration` : ""}</div>
                            <div>{analysisResult.sandbox_config?.override_applied ? "Manual override applied" : "Auto resource selection"}</div>
                          </div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Symbol inventory</div>
                          <div className="mt-2 space-y-1 text-[var(--text-primary)]">
                            <div>
                              {analysisResult.symbol_inventory?.totals
                                ? `Functions ${analysisResult.symbol_inventory.totals.function || 0}, Classes ${analysisResult.symbol_inventory.totals.class || 0}, Interfaces ${analysisResult.symbol_inventory.totals.interface || 0}`
                                : "No symbol totals returned"}
                            </div>
                            <div>
                              {analysisResult.symbol_inventory?.files_scanned
                                ? `${analysisResult.symbol_inventory.files_scanned} files scanned`
                                : ""}
                            </div>
                            <div>
                              {analysisResult.symbol_inventory?.files_with_symbols
                                ? `${analysisResult.symbol_inventory.files_with_symbols} files with symbols`
                                : ""}
                            </div>
                          </div>
                          <div className="mt-3 max-h-32 space-y-2 overflow-y-auto pr-1 text-xs">
                            {analysisResult.symbol_inventory?.top_files?.length
                              ? analysisResult.symbol_inventory.top_files.slice(0, 25).map((entry) => (
                                  <div key={entry.file} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)]">
                                    <div className="break-all font-medium">{entry.file}</div>
                                    <div className="mt-1 text-[var(--text-secondary)]">
                                      fn:{entry.functions?.length || 0} · cls:{entry.classes?.length || 0} · intf:{entry.interfaces?.length || 0}
                                    </div>
                                  </div>
                                ))
                              : <div>No symbol-by-file entries returned.</div>}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Task priorities</div>
                          <div className="mt-2 text-[var(--text-primary)]">{analysisResult.suggested_tasks.length ? analysisResult.suggested_tasks.map((task) => task.priority).join(", ") : "No tasks returned"}</div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Developer emails</div>
                          <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1 break-all text-[var(--text-primary)]">
                            {analysisResult.developer_insights.length ? analysisResult.developer_insights.map((dev) => <div key={dev.email}>{dev.email}</div>) : <div>No developers returned.</div>}
                          </div>
                        </div>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
                          <div className="text-[11px] uppercase tracking-[0.2em]">Risk details</div>
                          <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1 text-[var(--text-primary)]">
                            {analysisResult.risk_signals.length ? analysisResult.risk_signals.map((risk, index) => <div key={`${risk.type}-${index}`}>{risk.type} · {risk.severity} · {risk.detail}</div>) : <div>No risks returned.</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
                  Run an analysis to populate project details.
                </div>
              )}
            </Card>

          </div>
        </div>
        {/* Floating Chat Panel */}
        {chatOpen ? (
          <div
            style={{ width: chatWidth }}
            className="fixed right-6 top-20 bottom-6 z-50 flex max-w-[90%] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
              <div className="text-sm font-semibold tracking-[0.02em] text-[var(--text-primary)]">GitNexus Chat</div>
              <button type="button" onClick={() => setChatOpen(false)} className="rounded px-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Close</button>
            </div>
            <div className="flex h-full min-h-0 flex-1 overflow-hidden">
              <div className="relative flex-1 overflow-auto p-3">
                <GitNexusChatBox projectId={projectId.trim()} analysisResult={analysisResult} />
              </div>
              <div
                role="separator"
                onMouseDown={(e) => {
                  resizingRef.current.active = true;
                  resizingRef.current.startX = e.clientX;
                  resizingRef.current.startWidth = chatWidth;
                }}
                aria-label="Resize chat panel"
                className="w-2 cursor-ew-resize touch-none bg-transparent hover:bg-[var(--border-focus)]/20"
                style={{ cursor: "ew-resize" }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="fixed right-6 top-20 z-50 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-primary)] shadow-lg"
          >
            Chat
          </button>
        )}
      </div>
    </PageWrapper>
  );
}