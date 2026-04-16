"use client";

import Link from "@/next-shims/link";
import { useParams } from "@/next-shims/navigation";
import { useEffect, useMemo, useState } from "react";

type Project = {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  status?: string;
  github_repo?: string | null;
  jira_project_key?: string | null;
  tech_stack?: string[];
};

type ProjectMember = {
  memberId: string;
  fullName?: string;
  email?: string;
  role?: string;
};

type ProjectDetailResponse = {
  project?: Project;
  members?: ProjectMember[];
  epicsCount?: number;
  sprintsSummary?: { total?: number; planning?: number; active?: number; completed?: number };
};

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = text(params?.projectId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ProjectDetailResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!projectId) {
        setError("Missing project id");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = (await resp.json().catch(() => null)) as ProjectDetailResponse & { error?: string };

      if (cancelled) return;
      if (!resp.ok) {
        setError(text(json?.error) || `Failed to load project (${resp.status})`);
        setData(null);
        setLoading(false);
        return;
      }

      setData(json || null);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const project = data?.project || null;
  const members = Array.isArray(data?.members) ? data!.members! : [];
  const tech = useMemo(() => (Array.isArray(project?.tech_stack) ? project!.tech_stack! : []), [project]);

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{project?.name || "Project"}</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {project?.description || "Project overview and linked integrations."}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/backlog" className="rounded-lg border border-slate-300 dark:border-zinc-700 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-white">
              Backlog
            </Link>
            <Link href="/sprint_plan" className="rounded-lg bg-slate-900 dark:bg-white px-3 py-2 text-sm font-semibold text-white dark:text-black">
              Sprint Plan
            </Link>
          </div>
        </div>

        {loading ? <div className="text-sm text-slate-600 dark:text-slate-300">Loading project...</div> : null}
        {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        {!loading && !error && project ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-xs text-slate-500">Status</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.status || "active"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-xs text-slate-500">GitHub Repo</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.github_repo || "—"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="text-xs text-slate-500">Jira Key</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{project.jira_project_key || "—"}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Tech Stack</div>
              {tech.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tech.map((item) => (
                    <span key={item} className="rounded-full border border-slate-300 dark:border-zinc-700 px-2 py-1 text-xs text-slate-700 dark:text-slate-200">
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No tech stack configured.</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Members</div>
              {members.length ? (
                <div className="mt-3 space-y-2">
                  {members.map((member) => (
                    <div key={member.memberId} className="flex items-center justify-between rounded border border-slate-200 dark:border-zinc-800 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">{member.fullName || member.email || "Member"}</div>
                        <div className="text-xs text-slate-500">{member.email || ""}</div>
                      </div>
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{member.role || "member"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">No members found.</div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
