"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui/themed";
import { GitNexusGraph } from "@/components/git-nexus-graph";
import type { NexusAnalysisResult } from "@/types/git-nexus";

interface GitNexusPanelProps {
  projectId: string;
  connectedRepo?: string;
  onClose?: () => void;
  onTasksImported?: () => void;
  onResult?: (result: NexusAnalysisResult) => void;
  onProgress?: (message: string) => void;
  embedded?: boolean;
}

type StreamEnvelope = {
  event?: string;
  type?: string;
  data?: unknown;
  result?: unknown;
  error?: string;
  line?: string;
};

type SandboxStatus = {
  active_sandboxes?: number;
  total_analyses_today?: number;
  avg_duration_seconds?: number;
  last_error?: string | null;
  configured?: boolean;
  ready?: boolean;
  template_name?: string | null;
};

function getEventName(payload: StreamEnvelope): string {
  return String(payload.event || payload.type || "").toLowerCase();
}

function extractAnalysis(payload: StreamEnvelope): NexusAnalysisResult | null {
  const direct = payload.data as NexusAnalysisResult | undefined;
  if (direct && typeof direct === "object" && "repo_meta" in direct) return direct;

  const nested = payload.data as { result?: NexusAnalysisResult } | undefined;
  if (nested?.result && typeof nested.result === "object" && "repo_meta" in nested.result) return nested.result;

  const fromResult = payload.result as { result?: NexusAnalysisResult } | NexusAnalysisResult | undefined;
  if (fromResult && typeof fromResult === "object") {
    if ("repo_meta" in fromResult) return fromResult as NexusAnalysisResult;
    if ("result" in fromResult && fromResult.result && typeof fromResult.result === "object" && "repo_meta" in fromResult.result) {
      return fromResult.result;
    }
  }

  return null;
}

function eventText(payload: StreamEnvelope): string {
  if (payload.line) return payload.line;
  if (typeof payload.data === "string") return payload.data;
  if (payload.error) return payload.error;
  if (payload.data && typeof payload.data === "object") {
    const nested = payload.data as { message?: unknown; detail?: unknown; error?: unknown };
    if (typeof nested.message === "string" && nested.message.trim().length > 0) return nested.message;
    if (typeof nested.detail === "string" && nested.detail.trim().length > 0) return nested.detail;
    if (typeof nested.error === "string" && nested.error.trim().length > 0) return nested.error;
  }
  return "";
}

function statusText(status: SandboxStatus | null): string {
  if (!status) return "Sandbox status not checked yet.";
  if (status.ready) {
    const templateLabel = status.template_name || "unknown template";
    return `Sandbox ready using ${templateLabel}.`;
  }
  if (!status.configured) return status.last_error || "E2B is not configured for this environment.";
  return status.last_error || "Sandbox is not ready.";
}

function sanitizeTerminalLine(message: string): string {
  return message
    .replace(/^[\s\u200B-\u200D\uFEFF]*[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{S}\p{P}]+\s*/gu, "")
    .replace(/^Running analysis\s+/i, "")
    .trim();
}

export function GitNexusPanel({
  projectId,
  connectedRepo,
  onClose,
  onTasksImported,
  onResult,
  onProgress,
  embedded = false,
}: GitNexusPanelProps) {
  const [repoUrl, setRepoUrl] = useState(connectedRepo || "");
  const [sinceDays, setSinceDays] = useState("30");
  const [resourceTier, setResourceTier] = useState<"" | "small" | "medium" | "large">("");
  const [ramMb, setRamMb] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [result, setResult] = useState<NexusAnalysisResult | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sandboxTier, setSandboxTier] = useState<string | null>(null);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null);

  const progressLogRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (progressLogRef.current) {
      progressLogRef.current.scrollTop = progressLogRef.current.scrollHeight;
    }
  }, [progress]);

  useEffect(() => {
    void fetch("/api/ai/git-nexus/status", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as SandboxStatus & { error?: string; detail?: string };
        if (!response.ok) {
          throw new Error(payload.detail || payload.error || `Sandbox status check failed (${response.status})`);
        }
        setSandboxStatus(payload as SandboxStatus);
      })
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Sandbox status check failed";
        setSandboxStatus({ configured: false, ready: false, last_error: message });
      });
  }, []);

  function appendProgress(message: string) {
    if (!message) return;
    const line = sanitizeTerminalLine(message);
    if (!line) return;
    setProgress((current) => [...current, line]);
    onProgress?.(line);
  }

  async function analyzeRepository(repoOverride?: string) {
    const nextRepoUrl = (repoOverride || repoUrl).trim();
    if (!nextRepoUrl) {
      setError("Please enter a GitHub repository URL");
      return;
    }

    setAnalyzing(true);
    setError(null);
    setProgress([]);
    setResult(null);
    setSelectedTasks(new Set());
    setSandboxTier(null);
    setSandboxStatus(null);
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/ai/git-nexus/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: nextRepoUrl,
          project_id: projectId,
          branch: "",
          since_days: Number.parseInt(sinceDays, 10) || 30,
          resource_tier: resourceTier,
          ram_mb: ramMb.trim() ? Number.parseInt(ramMb, 10) : undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error(payload.detail || payload.error || "Analysis failed");
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;

          if (raw === "[DONE]") {
            continue;
          }

          try {
            const payload = JSON.parse(raw) as StreamEnvelope;
            const eventName = getEventName(payload);

            if (eventName === "progress") {
              const message = eventText(payload);
              appendProgress(message);
              if (message.includes("Sandbox")) {
                const tierMatch = message.match(/\(([^)]+Sandbox[^)]*)\)/i);
                if (tierMatch) setSandboxTier(tierMatch[1]);
              }
              continue;
            }

            if (eventName === "complete") {
              const analysis = extractAnalysis(payload);
              if (analysis) {
                setResult(analysis);
                onResult?.(analysis);
              }
              appendProgress("Analysis complete");
              continue;
            }

            if (eventName === "error") {
              const message = eventText(payload) || "Unknown error";
              setError(message);
              appendProgress(`Error: ${message}`);
            }
          } catch (parseError) {
            console.error("GitNexus stream parse error", parseError);
          }
        }
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name !== "AbortError") {
        const message = caught.message || "Analysis failed";
        setError(message);
        appendProgress(`❌ Error: ${message}`);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  function toggleTask(taskTitle: string) {
    setSelectedTasks((current) => {
      const next = new Set(current);
      if (next.has(taskTitle)) next.delete(taskTitle);
      else next.add(taskTitle);
      return next;
    });
  }

  async function importTasks() {
    if (selectedTasks.size === 0) {
      setError("Select at least one task to import");
      return;
    }

    if (!result) return;

    setImporting(true);
    try {
      const tasksToImport = result.suggested_tasks.filter((task) => selectedTasks.has(task.title));
      const response = await fetch("/api/tasks/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: tasksToImport.map((task) => ({
            title: task.title,
            description: task.description,
            tech_tags: task.tech_tags,
            story_points: task.story_points,
            priority: task.priority,
            assignee_id: task.suggested_assignee_email || null,
            sprint_id: null,
          })),
          project_id: projectId,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Import failed");
      }

      onTasksImported?.();
      onClose?.();
      appendProgress(`✅ Imported ${tasksToImport.length} tasks`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function resetAnalysis() {
    setResult(null);
    setProgress([]);
    setSelectedTasks(new Set());
    setError(null);
    setSandboxTier(null);
  }

  function abortAnalysis() {
    abortControllerRef.current?.abort();
    setAnalyzing(false);
    setError("Analysis cancelled by user");
  }

  const shellClassName = embedded
    ? "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6"
    : "w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6";

  return (
    <div className={embedded ? "w-full" : "fixed inset-0 z-50 flex items-center justify-center bg-black/50"}>
      <div className={shellClassName}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Analyze Repository</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Run repository analysis after the AI sandbox is ready.</p>
          </div>
          {onClose ? (
            <button type="button" onClick={onClose} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Close
            </button>
          ) : null}
        </div>

        {!analyzing && !result ? (
          <div className="mb-6 space-y-4">
            {!connectedRepo && (
              <>
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)]">GitHub Repository URL</label>
                  <Input
                    type="text"
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    className="mt-1"
                    disabled={analyzing}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)]">Analyze Last N Days</label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={sinceDays}
                    onChange={(event) => setSinceDays(event.target.value)}
                    className="mt-1"
                    disabled={analyzing}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)]">Resource tier override</label>
                  <select
                    value={resourceTier}
                    onChange={(event) => setResourceTier(event.target.value as "" | "small" | "medium" | "large")}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--border-focus)]"
                    disabled={analyzing}
                  >
                    <option value="">Auto</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)]">RAM override (MB)</label>
                  <Input
                    type="number"
                    min="512"
                    max="8192"
                    value={ramMb}
                    onChange={(event) => setRamMb(event.target.value)}
                    className="mt-1"
                    disabled={analyzing}
                    placeholder="Auto"
                  />
                </div>
              </>
            )}

            {connectedRepo && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
                <span className="font-medium text-[var(--text-primary)]">Repository:</span> {connectedRepo}
              </div>
            )}

            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-sm text-[var(--text-secondary)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium text-[var(--text-primary)]">Sandbox status:</span> {statusText(sandboxStatus)}
                </div>
                <Badge color={sandboxStatus?.ready ? "green" : "default"}>
                  {sandboxStatus?.ready ? "Ready" : "Not ready"}
                </Badge>
              </div>
            </div>

            {error ? <div className="rounded-lg border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200">{error}</div> : null}

            <div className="flex gap-3">
              <Button onClick={() => void analyzeRepository()} disabled={analyzing || !repoUrl.trim()} className="flex-1" variant="primary">
                {analyzing ? "Analyzing..." : connectedRepo ? "Retry analysis" : "Analyze"}
              </Button>
              {onClose ? (
                <Button onClick={onClose} variant="default">
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {analyzing ? (
          <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span className="text-sm font-medium text-[var(--text-primary)]">Terminal session active</span>
            </div>

            {sandboxTier ? <Badge color="blue">{sandboxTier}</Badge> : null}

            <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#050608] shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_24px_80px_rgba(0,0,0,0.55)]">
              <div className="flex items-center gap-2 border-b border-white/5 bg-white/5 px-4 py-2">
                <span className="h-3 w-3 rounded-full bg-red-500/80" />
                <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
                <div className="ml-2 text-[11px] uppercase tracking-[0.24em] text-emerald-200/70">E2B Sandbox</div>
              </div>

              <div ref={progressLogRef} className="max-h-56 overflow-y-auto px-4 py-4 font-mono text-[12px] leading-6 text-emerald-300">
                <div className="mb-3 flex items-center gap-2 text-emerald-200/80">
                  <span className="text-emerald-400">$</span>
                  <span className="truncate">gitnexus analyze --repo {repoUrl.trim() || connectedRepo || "<repo>"}</span>
                </div>

                {progress.map((line, index) => (
                  <div key={`${line}-${index}`} className="whitespace-pre-wrap break-words">
                    {line}
                  </div>
                ))}

                {analyzing ? <div className="mt-1 inline-flex h-4 w-2 animate-pulse bg-emerald-300" aria-hidden="true" /> : null}
              </div>
            </div>

            <Button onClick={abortAnalysis} variant="default" className="w-full">
              Cancel Analysis
            </Button>
          </div>
        ) : null}

        {result && !analyzing ? (
          <div className="mb-6 space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge>{result.repo_meta.primary_language}</Badge>
              <Badge color="blue">{Math.round(result.repo_meta.repo_size_kb / 1024)} MB</Badge>
              <Badge color="green">{result.repo_meta.total_commits_analyzed} commits</Badge>
              {result.sandbox_config ? <Badge color="purple">{result.sandbox_config.tier_name}</Badge> : null}
            </div>

            <GitNexusGraph result={result} />

            {result.suggested_tasks.length > 0 ? (
              <Card>
                <h3 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Suggested Tasks ({result.suggested_tasks.length})</h3>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {result.suggested_tasks.map((task) => (
                    <div key={task.title} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={selectedTasks.has(task.title)} onChange={() => toggleTask(task.title)} className="mt-1" />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-medium text-[var(--text-primary)]">{task.title}</h4>
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">{task.description}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded bg-[var(--bg-badge)] px-2 py-1 text-[var(--text-secondary)]">{task.priority}</span>
                            <span className="rounded bg-[var(--bg-badge)] px-2 py-1 text-[var(--text-secondary)]">{task.story_points} pts</span>
                            <span className="rounded bg-[var(--bg-badge)] px-2 py-1 text-[var(--text-secondary)]">{task.source}</span>
                          </div>
                          {task.evidence ? (
                            <details className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2 text-xs text-[var(--text-secondary)]">
                              <summary className="cursor-pointer font-medium text-[var(--text-primary)]">Evidence</summary>
                              <div className="mt-2 space-y-2">
                                {task.evidence.files.length > 0 ? (
                                  <div>
                                    <strong>Files:</strong>
                                    <ul className="ml-4 list-disc">
                                      {task.evidence.files.map((file) => (
                                        <li key={file}>{file}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                {task.evidence.commits.length > 0 ? (
                                  <div>
                                    <strong>Commits:</strong>
                                    <ul className="ml-4 list-disc">
                                      {task.evidence.commits.map((commit) => (
                                        <li key={commit}>
                                          <code>{commit.slice(0, 7)}</code>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {result.risk_signals.length > 0 ? (
              <Card>
                <h3 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Risk Signals ({result.risk_signals.length})</h3>
                <div className="space-y-2">
                  {result.risk_signals.map((risk, index) => (
                    <div key={`${risk.type}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
                      <h4 className="text-sm font-medium text-[var(--text-primary)]">{risk.type}</h4>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{risk.detail}</p>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {result.developer_insights.length > 0 ? (
              <Card>
                <h3 className="mb-3 text-lg font-semibold text-[var(--text-primary)]">Developer Insights ({result.developer_insights.length})</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-[var(--border)]">
                      <tr>
                        <th className="px-2 py-1 text-left">Developer</th>
                        <th className="px-2 py-1 text-right">Commits</th>
                        <th className="px-2 py-1 text-right">Tech</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.developer_insights.map((developer) => (
                        <tr key={developer.email} className="border-b border-[var(--border)]/50">
                          <td className="px-2 py-1 text-[var(--text-primary)]">{developer.name || developer.email}</td>
                          <td className="px-2 py-1 text-right text-[var(--text-secondary)]">{developer.commits}</td>
                          <td className="px-2 py-1 text-right text-[var(--text-secondary)]">{developer.primary_tech.slice(0, 2).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}

            <div className="flex gap-3 border-t border-[var(--border)] pt-4">
              <Button onClick={() => void importTasks()} disabled={selectedTasks.size === 0 || importing} className="flex-1" variant="primary">
                {importing ? "Importing..." : `Import ${selectedTasks.size} Tasks`}
              </Button>
              <Button onClick={resetAnalysis} variant="default">
                Analyze Another
              </Button>
            </div>
          </div>
        ) : null}

        {error && result ? <div className="rounded-lg border border-red-500/50 bg-red-950/30 p-3 text-sm text-red-200">{error}</div> : null}
      </div>
    </div>
  );
}
