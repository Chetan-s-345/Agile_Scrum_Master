"use client";

import { AlertTriangle, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inviteMember, listInvitations, listMembers, type OrgInvitation, type OrgMember } from "@/lib/org-member-auth";

type DeveloperListItem = {
  id: string;
  fullName: string;
  role: string | null;
  techStack: string[];
  meritScore: number;
  currentLoad: number;
  maxCapacity: number;
  loadPct: number;
  availabilityStatus: string;
  burnoutRiskFlag: boolean;
};

type LeaderboardItem = {
  rank: number;
  name: string;
  meritScore: number;
  completionRate: number;
  codeQuality: number;
  prReviewSpeed: number;
  peerRating: number;
  trend: "improving" | "stable" | "declining" | string;
};

export default function DevelopersPage() {
  const router = useRouter();

  const [developers, setDevelopers] = useState<DeveloperListItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("developer");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);

  const [requests, setRequests] = useState<OrgInvitation[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const [memberId, setMemberId] = useState("");
  const [primaryRole, setPrimaryRole] = useState("frontend");
  const [techStackRaw, setTechStackRaw] = useState("react, node, postgres");
  const [maxSprintCapacity, setMaxSprintCapacity] = useState<number>(40);
  const [yearsExperience, setYearsExperience] = useState<number>(2);
  const [githubUsername, setGithubUsername] = useState("");
  const [skillLevelsRaw, setSkillLevelsRaw] = useState('{"react":4,"node":3}');

  const memberOptions = useMemo(() => {
    return members.map((m) => ({
      id: m.id,
      label: `${m.fullName} (${m.email})`,
    }));
  }, [members]);

  async function fetchJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
    const resp = await fetch(path, { cache: "no-store" });
    const data = await resp.json().catch(() => null);
    if (resp.ok) return { ok: true, data: data as T };
    const msg = (data && (data.error || data.message)) ? String(data.error || data.message) : "Request failed";
    return { ok: false, status: resp.status, error: msg };
  }

  async function loadAll() {
    setLoading(true);
    setError(null);

    const [devs, lb, mem] = await Promise.all([
      fetchJson<{ items: DeveloperListItem[] }>("/api/developers"),
      fetchJson<{ items: LeaderboardItem[] }>("/api/developers/leaderboard"),
      listMembers({ limit: 200, page: 1 }),
    ]);

    const unauthorized = [devs, lb].find((r) => !r.ok && r.status === 401);
    if (unauthorized) {
      router.push("/auth/sign-in");
      return;
    }

    if (!devs.ok) {
      setError(devs.error);
    } else {
      setDevelopers(Array.isArray(devs.data.items) ? devs.data.items : []);
    }

    if (lb.ok) {
      setLeaderboard(Array.isArray(lb.data.items) ? lb.data.items : []);
    }

    if (mem) {
      setMembers(Array.isArray(mem.members) ? mem.members : []);
      if (!memberId && Array.isArray(mem.members) && mem.members.length) {
        setMemberId(mem.members[0].id);
      }
    }

    setLoading(false);

    // Load sent requests (pending invites)
    void loadRequests();
  }

  async function loadRequests() {
    setRequestsLoading(true);
    setRequestsError(null);
    const inv = await listInvitations();
    if (!inv.ok) {
      // Most common: 403 when not owner/admin
      setRequests([]);
      setRequestsError(inv.status === 403 ? "Requires owner/admin." : inv.error);
      setRequestsLoading(false);
      return;
    }
    setRequests(Array.isArray(inv.invitations) ? inv.invitations : []);
    setRequestsLoading(false);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getMeritColor = (merit: number) => {
    if (merit >= 90) return "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200";
    if (merit >= 80) return "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200";
    return "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200";
  };

  const getCapacityColor = (capacity: number) => {
    if (capacity < 75) return "text-green-600 dark:text-green-400";
    if (capacity < 90) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  async function handleCreateDeveloper(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);
    setCreateStatus(null);

    const techStack = techStackRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    let skillLevels: Record<string, unknown> = {};
    if (skillLevelsRaw.trim()) {
      try {
        skillLevels = JSON.parse(skillLevelsRaw);
      } catch {
        setCreateError("Skill Levels must be valid JSON (e.g. {\"react\":4,\"node\":3})");
        setCreateLoading(false);
        return;
      }
    }

    try {
      const resp = await fetch("/api/developers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          techStack,
          skillLevels,
          primaryRole,
          maxSprintCapacity,
          yearsExperience,
          githubUsername: githubUsername.trim() || undefined,
        }),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setCreateError(String(data?.error || "Failed to add developer"));
        return;
      }

      const developerId = String(data?.id || "");
      if (!developerId) {
        setCreateError("Developer created but response missing id");
        return;
      }

      // Verification step: fetch the created profile.
      const verifyResp = await fetch(`/api/developers/${encodeURIComponent(developerId)}`, { cache: "no-store" });
      if (!verifyResp.ok) {
        const v = await verifyResp.json().catch(() => null);
        setCreateError(String(v?.error || "Developer created but verification failed"));
        return;
      }

      await loadAll();
      setCreateStatus("Developer added and verified.");
    } catch (err) {
      console.error(err);
      setCreateError("Failed to add developer");
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteError(null);
    setInviteStatus(null);

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setInviteError("Email is required");
      setInviteLoading(false);
      return;
    }

    const result = await inviteMember({ email, role: inviteRole });
    if (!result.ok) {
      setInviteError(result.error);
      setInviteLoading(false);
      return;
    }

    if (result.email && result.email.sent === false) {
      setInviteError(String(result.email.error || result.email.message || "Invite created but email failed to send."));
    } else if (result.email?.messageId) {
      setInviteStatus(`Invite sent (messageId: ${result.email.messageId}).`);
    } else {
      setInviteStatus("Invite sent.");
    }

    setInviteEmail("");
    void loadRequests();
    setInviteLoading(false);
  }

  const formatDateTime = (value?: string) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">Developer Hub</h1>
          <p className="text-slate-600 dark:text-slate-300">Team Performance & Merit Leaderboard</p>
        </div>

        {/* Add Developer */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-8">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Add Developer Profile</h2>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition"
            >
              Refresh
            </button>
          </div>

          {error ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          {createError ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{createError}</p>
          ) : null}
          {createStatus ? (
            <p className="mt-3 text-sm text-green-700 dark:text-green-300">{createStatus}</p>
          ) : null}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Invite Developer (Email Request)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sends an org invite email via backend. Requires owner/admin.
              </p>

              {inviteError ? (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400">{inviteError}</p>
              ) : null}
              {inviteStatus ? (
                <p className="mt-3 text-sm text-green-700 dark:text-green-300">{inviteStatus}</p>
              ) : null}

              <form onSubmit={handleInvite} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  type="email"
                  placeholder="developer@example.com"
                  className="md:col-span-2 w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  required
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="developer">developer</option>
                  <option value="manager">manager</option>
                  <option value="admin">admin</option>
                </select>

                <button
                  type="submit"
                  disabled={inviteLoading}
                  className="md:col-span-3 px-5 py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black font-semibold disabled:opacity-60"
                >
                  {inviteLoading ? "Sending…" : "Send Invite"}
                </button>
              </form>

              <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Requests Sent</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Pending invitations that haven’t been accepted yet.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadRequests()}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition text-xs"
                  >
                    Refresh
                  </button>
                </div>

                {requestsError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{requestsError}</p> : null}

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-zinc-800 text-left text-slate-600 dark:text-slate-300">
                        <th className="py-2 pr-4 font-medium">Email</th>
                        <th className="py-2 pr-4 font-medium">Role</th>
                        <th className="py-2 pr-4 font-medium">Created</th>
                        <th className="py-2 pr-4 font-medium">Expires</th>
                        <th className="py-2 pr-0 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requestsLoading ? (
                        <tr>
                          <td colSpan={5} className="py-3 text-slate-600 dark:text-slate-300">
                            Loading…
                          </td>
                        </tr>
                      ) : requests.length ? (
                        requests.map((r) => (
                          <tr key={r.id} className="border-b border-slate-100 dark:border-zinc-900">
                            <td className="py-2 pr-4 text-slate-900 dark:text-white">{r.email}</td>
                            <td className="py-2 pr-4 text-slate-700 dark:text-slate-200">{r.role}</td>
                            <td className="py-2 pr-4 text-slate-700 dark:text-slate-200">{formatDateTime(r.created_at)}</td>
                            <td className="py-2 pr-4 text-slate-700 dark:text-slate-200">{formatDateTime(r.expires_at)}</td>
                            <td className="py-2 pr-0 text-slate-700 dark:text-slate-200">{r.status || "pending"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-3 text-slate-600 dark:text-slate-300">
                            No requests sent yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Create Profile (from Team Member)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Uses an existing member, then verifies by fetching the created profile.
              </p>

              <form onSubmit={handleCreateDeveloper} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Team Member</label>
                  <select
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  >
                    {memberOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Primary Role</label>
                  <input
                    value={primaryRole}
                    onChange={(e) => setPrimaryRole(e.target.value)}
                    placeholder="frontend"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Tech Stack (comma-separated)</label>
                  <input
                    value={techStackRaw}
                    onChange={(e) => setTechStackRaw(e.target.value)}
                    placeholder="react, node, postgres"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Max Sprint Capacity</label>
                  <input
                    type="number"
                    min={0}
                    value={maxSprintCapacity}
                    onChange={(e) => setMaxSprintCapacity(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Years Experience</label>
                  <input
                    type="number"
                    min={0}
                    value={yearsExperience}
                    onChange={(e) => setYearsExperience(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">GitHub Username (optional)</label>
                  <input
                    value={githubUsername}
                    onChange={(e) => setGithubUsername(e.target.value)}
                    placeholder="octocat"
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Skill Levels (JSON)</label>
                  <textarea
                    value={skillLevelsRaw}
                    onChange={(e) => setSkillLevelsRaw(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-black px-3 py-2 text-slate-900 dark:text-white font-mono text-sm"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Example: <span className="font-mono">{"{\"react\":4,\"node\":3}"}</span>
                  </p>
                </div>

                <div className="md:col-span-2 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={createLoading || loading}
                    className="px-5 py-2.5 rounded-lg bg-black dark:bg-white text-white dark:text-black font-semibold disabled:opacity-60"
                  >
                    {createLoading ? "Adding..." : "Add Developer"}
                  </button>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Create requires role: admin/manager/owner.</span>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Leaderboard Table */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-slate-700">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Rank</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Developer</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Skills</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Merit Score</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Capacity</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900 dark:text-white">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      Loading developers…
                    </td>
                  </tr>
                ) : developers.length ? (
                  developers.map((dev, idx) => (
                    <tr key={dev.id} className="border-b border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition">
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 font-bold text-sm">
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{dev.fullName}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{dev.role || "-"}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {(dev.techStack || []).map((skill) => (
                          <span key={skill} className="px-2 py-1 bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs rounded">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`inline-block px-3 py-1 rounded-full font-bold text-sm ${getMeritColor(dev.meritScore)}`}>
                        {dev.meritScore}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="w-32 bg-slate-200 dark:bg-slate-600 rounded-full h-2 mb-1">
                          <div 
                            className="bg-blue-500 h-2 rounded-full" 
                            style={{ width: `${Math.max(0, Math.min(100, dev.loadPct || 0))}%` }}
                          ></div>
                        </div>
                        <span className={`text-xs font-semibold ${getCapacityColor(dev.loadPct || 0)}`}>
                          {Math.round(dev.loadPct || 0)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {dev.burnoutRiskFlag ? (
                        <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-xs font-medium">Burnout Risk</span>
                        </div>
                      ) : (
                        <span className="inline-block px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-xs rounded font-medium">
                          Healthy
                        </span>
                      )}
                    </td>
                  </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      No developer profiles yet. Add one above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Developer Cards */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">Team Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {leaderboard.slice(0, 5).map((dev) => (
              <div key={`${dev.rank}-${dev.name}`} className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-md border border-slate-200 dark:border-zinc-800 hover:shadow-lg transition">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm">{dev.name.split(" ")[0]}</h3>
                  <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Merit Score</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{dev.meritScore}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
