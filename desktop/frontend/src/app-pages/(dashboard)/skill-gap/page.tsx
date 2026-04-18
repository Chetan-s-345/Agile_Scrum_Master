import { useEffect, useState } from "react";

type Developer = {
  id: string;
  fullName?: string;
  email?: string;
  role?: string;
};

type Skill = {
  id: string;
  name: string;
  category: string;
  importance?: number;
  defaultLevel?: number;
};

type SkillLevel = number;

type SkillGapMatrix = {
  members: Developer[];
  skills: Skill[];
  matrix: SkillLevel[][];
};

type RequiredSkill = {
  skillId: string;
  name: string;
  category: string;
  demand: number;
  importance: number;
  availability: number;
  gapScore: number;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function invokeDesktop<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.desktopApi?.invoke) {
    throw new Error("Desktop IPC bridge unavailable");
  }

  const response = await window.desktopApi.invoke(channel, payload);
  if (response && typeof response === "object" && "ok" in (response as Record<string, unknown>)) {
    const wrapped = response as { ok: boolean; data?: T; error?: { message?: string; detail?: string } };
    if (!wrapped.ok) {
      throw new Error(asText(wrapped.error?.message || wrapped.error?.detail) || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }
  return response as T;
}

export default function SkillGapPage() {
  const [matrixData, setMatrixData] = useState<SkillGapMatrix>({ members: [], skills: [], matrix: [] });
  const [requiredSkills, setRequiredSkills] = useState<RequiredSkill[]>([]);
  const [activeSprintId] = useState("sprint-24");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [matrix, required] = await Promise.all([
          invokeDesktop<SkillGapMatrix>("skillGap:getMatrix"),
          invokeDesktop<RequiredSkill[]>("skillGap:getRequiredSkills", { sprintId: activeSprintId }),
        ]);
        if (cancelled) return;
        setMatrixData(matrix && typeof matrix === "object" ? matrix : { members: [], skills: [], matrix: [] });
        setRequiredSkills(Array.isArray(required) ? required : []);
      } catch {
        if (cancelled) return;
        setMatrixData({ members: [], skills: [], matrix: [] });
        setRequiredSkills([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSprintId]);

  async function updateSkillLevel(memberId: string, skillId: string, level: number) {
    const nextRow = await invokeDesktop<SkillLevel[]>("skillGap:updateSkillLevel", {
      memberId,
      skillId,
      level,
    });

    setMatrixData((prev) => {
      const memberIndex = prev.members.findIndex((member) => String(member.id || "") === memberId);
      if (memberIndex < 0 || !Array.isArray(nextRow)) return prev;
      const nextMatrix = [...prev.matrix];
      nextMatrix[memberIndex] = nextRow;
      return { ...prev, matrix: nextMatrix };
    });
  }

  async function assignTraining(memberId: string, skillId: string, resourceUrl: string) {
    await invokeDesktop<{ success: boolean }>("skillGap:assignTraining", {
      memberId,
      skillId,
      resourceUrl,
    });
  }

  void matrixData;
  void requiredSkills;
  void updateSkillLevel;
  void assignTraining;

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">Skill Gap Analyzer</h1>
        <p className="text-slate-600 dark:text-slate-300">
          UI scaffold. Backend endpoints for skill-gap reporting aren’t present in the gateway yet.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-slate-700 dark:text-slate-200">
          Once the backend endpoint exists, this page can display:
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>Missing skills aggregated from failed assignments</li>
            <li>Impact level + suggested hire/train action</li>
            <li>Weekly report generation</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

