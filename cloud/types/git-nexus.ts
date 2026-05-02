/**
 * GitNexus Analysis Types
 * TypeScript interfaces for frontend integration
 */

export interface NexusAnalysisRequest {
  repo_url: string;
  project_id: string;
  branch?: string;
  since_days?: number;
  resource_tier?: "small" | "medium" | "large" | "";
  ram_mb?: number;
  github_token?: string;
  sprint_id?: string;
}

export interface NexusSuggestedTask {
  title: string;
  description: string;
  tech_tags: string[];
  story_points: number;
  priority: "critical" | "high" | "medium" | "low";
  source: string;
  suggested_assignee_email: string | null;
  evidence: {
    files: string[];
    commits: string[];
    authors: string[];
  };
}

export interface NexusDeveloperInsight {
  email: string;
  name?: string;
  commits: number;
  lines_added: number;
  lines_deleted: number;
  primary_files: string[];
  primary_tech: string[];
  suggested_capacity_points: number;
}

export interface NexusRiskSignal {
  type: "bus_factor" | "stale_code" | "test_coverage_gap" | "large_file" | string;
  severity: "high" | "medium" | "low";
  detail: string;
  files: string[];
}

export interface NexusRepoMeta {
  url: string;
  branch: string;
  total_commits_analyzed: number;
  analysis_window_days: number;
  repo_size_kb: number;
  primary_language: string;
  languages_detected: string[];
}

export interface NexusProjectStructure {
  project_type?: string;
  root_files?: string[];
  key_dirs?: string[];
  package_files?: string[];
  is_monorepo?: boolean;
  frameworks?: string[];
  workspaces?: string[];
  all_dirs?: string[];
  all_files?: string[];
  scan_depth?: number;
  all_dirs_total?: number;
  all_files_total?: number;
  all_dirs_truncated?: boolean;
  all_files_truncated?: boolean;
}

export interface NexusSandboxConfig {
  tier_name: string;
  ram_mb: number;
  cpu: number;
  timeout_seconds?: number;
  duration_seconds: number;
  override_applied?: boolean;
}

export interface NexusSymbolInventory {
  totals?: {
    function?: number;
    class?: number;
    interface?: number;
  };
  files_scanned?: number;
  files_with_symbols?: number;
  truncated?: boolean;
  top_files?: Array<{
    file: string;
    functions?: string[];
    classes?: string[];
    interfaces?: string[];
  }>;
}

export interface NexusAnalysisResult {
  repo_meta: NexusRepoMeta;
  suggested_tasks: NexusSuggestedTask[];
  developer_insights: NexusDeveloperInsight[];
  risk_signals: NexusRiskSignal[];
  project_structure?: NexusProjectStructure;
  symbol_inventory?: NexusSymbolInventory;
  sandbox_config?: NexusSandboxConfig;
}

export interface NexusStreamEvent {
  event: "progress" | "complete" | "error";
  data: string | NexusAnalysisResult | { message?: string } | Record<string, unknown>;
  stats?: {
    total_suggested: number;
    deduplicated: number;
    assigned_developers: number;
    unassigned: number;
  };
}

export interface NexusSandboxStatus {
  active_sandboxes: number;
  total_analyses_today: number;
  avg_duration_seconds: number;
  last_error: string | null;
}

export interface NexusTasksCache {
  suggested_tasks: NexusSuggestedTask[];
  developer_insights: NexusDeveloperInsight[];
  risk_signals: NexusRiskSignal[];
  cached: boolean;
  timestamp: string | null;
}

export interface NexusBulkImportRequest {
  tasks: Array<{
    title: string;
    description: string;
    tech_tags: string[];
    story_points: number;
    priority: "critical" | "high" | "medium" | "low";
    assignee_id?: string | null;
    sprint_id?: string;
  }>;
  project_id: string;
}

export interface NexusBulkImportResponse {
  imported: number;
  failed: number;
  errors?: string[];
}
