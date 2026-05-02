"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, Card, PageWrapper } from "@/components/ui/themed";
import { GitNexusChatBox } from "@/components/git-nexus-chatbox";
import { GitNexusPanel } from "@/components/git-nexus-panel";
import type { NexusAnalysisResult } from "@/types/git-nexus";

type Project = { id: string; name?: string; repo_url?: string };

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default function GitNexusPage() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [analysisResult, setAnalysisResult] = useState<NexusAnalysisResult | null>(null);
  const [analysisLogs, setAnalysisLogs] = useState<string[]>([]);

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
        const queryProjectId = safeText(searchParams.get("projectId"));
        if (queryProjectId && rows.some((row) => row.id === queryProjectId)) return queryProjectId;
        return rows[0]?.id || "";
      });
    } catch (caught) {
      setProjectsError(caught instanceof Error ? caught.message : "Failed to load projects");
    } finally {
      setProjectLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
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
                  onProgress={(message) => setAnalysisLogs((current) => [...current, message])}
                />
                <Card className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">Analysis logs</h3>
                      <p className="text-sm text-[var(--text-secondary)]">Streaming progress.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAnalysisLogs([])}
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Clear logs
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 font-mono text-xs text-emerald-300">
                    {analysisLogs.length ? analysisLogs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>) : <div className="text-[var(--text-secondary)]">No log entries yet.</div>}
                  </div>
                </Card>
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

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">Structure</div>
                      <div className="mt-3 space-y-3 text-sm text-[var(--text-secondary)]">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">Key directories</div>
                          <div className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
                            {analysisResult.project_structure?.key_dirs?.length ? analysisResult.project_structure.key_dirs.map((dir) => (
                              <div key={dir} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                                <div className="break-all text-[var(--text-primary)]">{dir}</div>
                              </div>
                            )) : <div>No directories detected.</div>}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">Root files</div>
                          <div className="mt-2 max-h-32 space-y-2 overflow-y-auto pr-1">
                            {analysisResult.project_structure?.root_files?.length ? analysisResult.project_structure.root_files.map((file) => (
                              <div key={file} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                                <div className="break-all text-[var(--text-primary)]">{file}</div>
                              </div>
                            )) : <div>No root files detected.</div>}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">Package files</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {analysisResult.project_structure?.package_files?.length ? analysisResult.project_structure.package_files.map((file) => (
                              <span key={file} className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">{file}</span>
                            )) : <span>No package files detected.</span>}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">Frameworks</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {analysisResult.project_structure?.frameworks?.length ? analysisResult.project_structure.frameworks.map((framework) => (
                              <span key={framework} className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">{framework}</span>
                            )) : <span>No frameworks detected.</span>}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">Workspaces</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {analysisResult.project_structure?.workspaces?.length ? analysisResult.project_structure.workspaces.map((workspace) => (
                              <span key={workspace} className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">{workspace}</span>
                            )) : <span>No workspaces detected.</span>}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">All directories (recursive)</div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {analysisResult.project_structure?.all_dirs_total
                              ? `${analysisResult.project_structure.all_dirs_total} total`
                              : "Total not reported"}
                            {analysisResult.project_structure?.all_dirs_truncated ? " · truncated in payload" : ""}
                          </div>
                          <div className="mt-2 max-h-32 space-y-2 overflow-y-auto pr-1">
                            {analysisResult.project_structure?.all_dirs?.length ? (
                              analysisResult.project_structure.all_dirs.map((dir) => (
                                <div key={dir} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                                  <div className="break-all text-[var(--text-primary)]">{dir}</div>
                                </div>
                              ))
                            ) : (
                              <span>No recursive directory list returned.</span>
                            )}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em]">All files (recursive)</div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {analysisResult.project_structure?.all_files_total
                              ? `${analysisResult.project_structure.all_files_total} total`
                              : "Total not reported"}
                            {analysisResult.project_structure?.all_files_truncated ? " · truncated in payload" : ""}
                          </div>
                          <div className="mt-2 max-h-32 space-y-2 overflow-y-auto pr-1">
                            {analysisResult.project_structure?.all_files?.length ? (
                              analysisResult.project_structure.all_files.map((file) => (
                                <div key={file} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2">
                                  <div className="break-all text-[var(--text-primary)]">{file}</div>
                                </div>
                              ))
                            ) : (
                              <span>No recursive file list returned.</span>
                            )}
                          </div>
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

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">Raw project_structure JSON</div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">Directly rendered from the latest GitNexus response.</p>
                    <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 text-xs text-[var(--text-primary)]">
                      {structureJson}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
                  Run an analysis to populate project details.
                </div>
              )}
            </Card>

            <GitNexusChatBox projectId={projectId.trim()} analysisResult={analysisResult} />
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}