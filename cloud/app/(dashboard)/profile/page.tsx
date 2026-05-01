"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2, User } from "lucide-react";
import { getMe, type MeResponse } from "@/lib/org-member-auth";

type DeveloperProfile = NonNullable<MeResponse["developerProfile"]>;

function cleanSkill(value: string) {
  return String(value || "").trim();
}

function toSkillMap(source: Record<string, unknown> | undefined, skills: string[]) {
  const next: Record<string, number> = {};
  for (const skill of skills) {
    const existing = Number(source?.[skill]);
    next[skill] = Number.isFinite(existing) ? Math.max(0, Math.min(5, existing)) : 3;
  }
  return next;
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [skillsSaved, setSkillsSaved] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [skillSaving, setSkillSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ email: string; fullName: string; orgName: string } | null>(null);
  const [developerProfile, setDeveloperProfile] = useState<DeveloperProfile | null>(null);
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillLevels, setSkillLevels] = useState<Record<string, number>>({});
  const [profileForm, setProfileForm] = useState({
    primaryRole: "",
    yearsExperience: "",
    maxSprintCapacity: "",
    availabilityStatus: "available",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await getMe();
      if (cancelled) return;

      const memberships = Array.isArray(me?.memberships) ? me!.memberships! : [];
      const activeOrgId = me?.activeOrgId ? String(me.activeOrgId) : "";
      const activeMembership = memberships.find((m) => String(m?.org?.id || "") === activeOrgId) || memberships[0] || null;

      const fullName = String(me?.user?.fullName || "");
      const email = String(me?.user?.email || "");
      const orgName = String(activeMembership?.org?.name || activeMembership?.org?.slug || "No organization");
      const profile = me?.developerProfile || null;

      setAccount({ email, fullName, orgName });
      setDeveloperProfile(profile);
      setProfileForm({
        primaryRole: String(profile?.primaryRole || profile?.memberRole || ""),
        yearsExperience: profile?.yearsExperience !== undefined && profile?.yearsExperience !== null ? String(profile.yearsExperience) : "",
        maxSprintCapacity:
          profile?.maxSprintCapacity !== undefined && profile?.maxSprintCapacity !== null ? String(profile.maxSprintCapacity) : "",
        availabilityStatus: String(profile?.availabilityStatus || "available"),
      });

      const profileSkills = Array.isArray(profile?.techStack) ? profile.techStack.map(cleanSkill).filter(Boolean) : [];
      const uniqueSkills = Array.from(new Set(profileSkills));
      setSkills(uniqueSkills);
      setSkillLevels(toSkillMap(profile?.skillLevels as Record<string, unknown> | undefined, uniqueSkills));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function addSkill() {
    const value = cleanSkill(skillInput);
    if (!value) return;
    setSkills((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setSkillLevels((prev) => ({ ...prev, [value]: Number.isFinite(Number(prev[value])) ? Number(prev[value]) : 3 }));
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((item) => item !== skill));
    setSkillLevels((prev) => {
      const next = { ...prev };
      delete next[skill];
      return next;
    });
  }

  async function saveSkills() {
    if (!developerProfile?.id) {
      setSkillError("No linked developer profile was found for this account.");
      return;
    }

    setSkillSaving(true);
    setSkillError(null);

    try {
      const payload = {
        techStack: skills,
        skillLevels,
      };

      const resp = await fetch(`/api/developers/${encodeURIComponent(developerProfile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(String(data?.detail || data?.error || `Failed to save skills (${resp.status})`));
      }

      setDeveloperProfile((prev) =>
        prev
          ? {
              ...prev,
              techStack: Array.isArray(data?.techStack) ? data.techStack : skills,
              skillLevels: (data?.skillLevels && typeof data.skillLevels === "object" ? data.skillLevels : skillLevels) as Record<string, unknown>,
            }
          : prev
      );
      setSkillsSaved(true);
      window.setTimeout(() => setSkillsSaved(false), 1800);
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : "Failed to save skills");
    } finally {
      setSkillSaving(false);
    }
  }

  async function saveDeveloperProfile() {
    if (!developerProfile?.id) {
      setProfileError("No linked developer profile was found for this account.");
      return;
    }

    setProfileSaving(true);
    setProfileError(null);

    try {
      const payload = {
        primaryRole: profileForm.primaryRole.trim() || undefined,
        yearsExperience: profileForm.yearsExperience.trim() ? Number(profileForm.yearsExperience) : undefined,
        maxSprintCapacity: profileForm.maxSprintCapacity.trim() ? Number(profileForm.maxSprintCapacity) : undefined,
        availabilityStatus: profileForm.availabilityStatus.trim() || undefined,
      };

      const resp = await fetch(`/api/developers/${encodeURIComponent(developerProfile.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(String(data?.detail || data?.error || `Failed to save profile (${resp.status})`));
      }

      setDeveloperProfile((prev) =>
        prev
          ? {
              ...prev,
              primaryRole: typeof data?.primaryRole === "string" ? data.primaryRole : prev.primaryRole,
              yearsExperience:
                typeof data?.yearsExperience === "number" ? data.yearsExperience : prev.yearsExperience,
              maxSprintCapacity:
                typeof data?.maxSprintCapacity === "number" ? data.maxSprintCapacity : prev.maxSprintCapacity,
              availabilityStatus:
                typeof data?.availabilityStatus === "string" ? data.availabilityStatus : prev.availabilityStatus,
            }
          : prev
      );
      setProfileSaved(true);
      window.setTimeout(() => setProfileSaved(false), 1800);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
            <User className="w-8 h-8" />
            Profile
          </h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Account</div>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{loading ? "Loading..." : account?.fullName || "Team member"}</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{account?.orgName || "No organization"}</div>
              </div>
            </div>

            {loading ? (
              <p className="mt-6 text-sm text-slate-600 dark:text-slate-300">Loading profile...</p>
            ) : (
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                  <p className="text-slate-500">Email</p>
                  <p className="mt-1 font-medium text-slate-900 dark:text-white">{account?.email || "-"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                  <p className="text-slate-500">Developer Role</p>
                  <p className="mt-1 font-medium text-slate-900 dark:text-white">{developerProfile?.primaryRole || developerProfile?.memberRole || "-"}</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                  <p className="text-slate-500">Current Load</p>
                  <p className="mt-1 font-medium text-slate-900 dark:text-white">{developerProfile?.currentSprintLoad ?? 0} points</p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
                  <p className="text-slate-500">Capacity</p>
                  <p className="mt-1 font-medium text-slate-900 dark:text-white">{developerProfile?.maxSprintCapacity ?? 0} points</p>
                </div>
              </div>
            )}

          </div>

          <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-md">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Developer details</div>
                <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Profile</h2>
              </div>
              {profileSaved ? <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Saved</span> : null}
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Primary role</label>
                <input
                  className="w-full bg-white dark:bg-black text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={profileForm.primaryRole}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, primaryRole: e.target.value }))}
                  placeholder="Frontend"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Years experience</label>
                <input
                  type="number"
                  min={0}
                  max={80}
                  className="w-full bg-white dark:bg-black text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={profileForm.yearsExperience}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, yearsExperience: e.target.value }))}
                  placeholder="5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Sprint capacity</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  className="w-full bg-white dark:bg-black text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={profileForm.maxSprintCapacity}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, maxSprintCapacity: e.target.value }))}
                  placeholder="40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Availability</label>
                <select
                  className="w-full bg-white dark:bg-black text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                  value={profileForm.availabilityStatus}
                  onChange={(e) => setProfileForm((prev) => ({ ...prev, availabilityStatus: e.target.value }))}
                >
                  <option value="available">available</option>
                  <option value="busy">busy</option>
                  <option value="away">away</option>
                </select>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void saveDeveloperProfile()}
                disabled={profileSaving}
                className="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black font-semibold py-2 px-4 rounded-lg transition inline-flex items-center gap-2 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {profileSaving ? "Saving profile..." : "Save Profile"}
              </button>
              {profileError ? <span className="text-sm text-red-700 dark:text-red-300">{profileError}</span> : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Skills</div>
              <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">Skill matrix</h2>
            </div>
          </div>

          {skillError ? (
            <div className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {skillError}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {skills.length ? (
              skills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100">
                  {skill}
                  <button type="button" onClick={() => removeSkill(skill)} className="text-slate-400 hover:text-red-600 dark:hover:text-red-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))
            ) : (
              <span className="text-sm text-slate-500 dark:text-slate-400">No skills added yet.</span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
              }}
              placeholder="Add a skill, e.g. React, SQL, Groq"
              className="min-w-[240px] flex-1 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={addSkill}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white"
            >
              <Plus className="h-4 w-4" />
              Add skill
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {skills.map((skill) => (
              <div key={skill} className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-900 dark:text-white">{skill}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Proficiency level 0-5</div>
                  </div>
                  <div className="rounded-full bg-white dark:bg-black px-3 py-1 text-sm font-semibold text-slate-900 dark:text-white">
                    {skillLevels[skill] ?? 3}
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={1}
                  value={skillLevels[skill] ?? 3}
                  onChange={(e) =>
                    setSkillLevels((prev) => ({
                      ...prev,
                      [skill]: Number(e.target.value),
                    }))
                  }
                  className="mt-4 w-full accent-slate-900 dark:accent-white"
                />
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveSkills()}
              disabled={skillSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black font-semibold py-2 px-4 transition disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {skillSaving ? "Saving skills..." : "Save Skills"}
            </button>
            {skillsSaved ? <span className="text-sm text-emerald-700 dark:text-emerald-300">Skills saved</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
