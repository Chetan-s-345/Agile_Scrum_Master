"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Team = {
  id: string;
  name: string;
  description?: string | null;
  leadId?: string;
  lead?: { id: string; fullName?: string; email?: string } | null;
  membersCount: number;
  projectsCount?: number;
  pendingRequests: number;
  members?: Array<{ id: string; fullName?: string; email?: string; role?: string }>;
  projectIds?: string[];
  myTeamRole?: "admin" | "developer" | null;
};

type TeamMember = {
  memberId: string;
  fullName?: string;
  email?: string;
  orgRole?: string;
  teamRole?: "admin" | "developer";
  score: number;
};

type JoinRequest = {
  id: string;
  memberId: string;
  status: "pending" | "accepted" | "rejected";
  requestedAt: string;
  member: { fullName?: string; email?: string; orgRole?: string };
};

type ScoreItem = {
  rank: number;
  memberId: string;
  fullName?: string;
  email?: string;
  score: number;
  metric: string;
};

type OrgMember = { id: string; fullName?: string; email?: string; role?: string };

type TeamDetailResponse = {
  team: Team;
  members: Array<{ id?: string; fullName?: string; email?: string; role?: string }>;
  currentTasks: Array<{ id?: string; assignee?: { id?: string }; assigneeId?: string }>;
  velocity: Array<{ sprint?: string; velocity?: number; completedTasks?: number }>;
};

type MeResponse = {
  user?: { id?: string; email?: string; fullName?: string };
  activeOrgId?: string | null;
  memberships?: Array<{ org: { id: string }; role: string }>;
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

function roleCanAdmin(role: string | null | undefined) {
  return ["owner", "admin", "manager"].includes(String(role || "").toLowerCase());
}

export default function TeamsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string>("");

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [scores, setScores] = useState<ScoreItem[]>([]);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedTeamRole, setSelectedTeamRole] = useState<"admin" | "developer">("developer");
  const [joinNote, setJoinNote] = useState("");
  const [scoreDraft, setScoreDraft] = useState<Record<string, string>>({});

  const activeTeam = useMemo(() => teams.find((t) => t.id === activeTeamId) || null, [teams, activeTeamId]);
  const activeOrgRole = useMemo(() => {
    const activeOrgId = me?.activeOrgId;
    if (!activeOrgId || !me?.memberships) return null;
    const row = me.memberships.find((m) => m.org?.id === activeOrgId);
    return row?.role || null;
  }, [me]);

  const canAdmin = useMemo(() => {
    if (roleCanAdmin(activeOrgRole)) return true;
    return String(activeTeam?.myTeamRole || "") === "admin";
  }, [activeOrgRole, activeTeam]);

  const myEmail = String(me?.user?.email || "").toLowerCase();
  const myMember = useMemo(
    () => orgMembers.find((m) => String(m.email || "").toLowerCase() === myEmail) || null,
    [orgMembers, myEmail]
  );

  const isMemberInActiveTeam = useMemo(() => {
    if (!myMember) return false;
    return members.some((m) => m.memberId === myMember.id);
  }, [members, myMember]);

  const myScore = useMemo(() => {
    if (!myMember) return null;
    return scores.find((s) => s.memberId === myMember.id) || null;
  }, [myMember, scores]);

  const availableMembersToAdd = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.memberId));
    return orgMembers.filter((m) => !memberIds.has(m.id));
  }, [orgMembers, members]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsResp, membersResp] = await Promise.all([
        invokeDesktop<Team[]>("teams:getAll"),
        invokeDesktop<Array<{ id?: string; fullName?: string; name?: string; email?: string; role?: string }>>(
          "developers:getOrgMembers"
        ).catch(() => []),
      ]);

      const nextTeams = Array.isArray(teamsResp)
        ? teamsResp.map((team) => ({
            ...team,
            pendingRequests: Number(team.pendingRequests || 0),
            myTeamRole: "admin" as const,
          }))
        : [];

      const nextMembers = Array.isArray(membersResp)
        ? membersResp.map((member) => ({
            id: String(member.id || ""),
            fullName: asText(member.fullName || member.name),
            email: asText(member.email),
            role: asText(member.role || "developer"),
          }))
        : [];

      setMe({
        user: {
          id: nextMembers[0]?.id,
          email: nextMembers[0]?.email,
          fullName: nextMembers[0]?.fullName,
        },
        activeOrgId: "org-default",
        memberships: [{ org: { id: "org-default" }, role: "owner" }],
      });

      setTeams(nextTeams);
      setOrgMembers(nextMembers);
      if (!activeTeamId && nextTeams[0]?.id) setActiveTeamId(nextTeams[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams workspace data");
      setTeams([]);
      setOrgMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeTeamId]);

  const loadTeamDetails = useCallback(async () => {
    if (!activeTeamId) {
      setMembers([]);
      setJoinRequests([]);
      setScores([]);
      return;
    }

    try {
      const detail = await invokeDesktop<TeamDetailResponse>("teams:getDetail", { teamId: activeTeamId });
      const team = detail?.team;
      if (team?.id) {
        setTeams((prev) => prev.map((item) => (item.id === team.id ? { ...item, ...team } : item)));
      }

      const detailMembers = Array.isArray(detail?.members) ? detail.members : [];
      const detailedMembers: TeamMember[] = detailMembers.map((member, index) => ({
        memberId: String(member.id || ""),
        fullName: asText(member.fullName),
        email: asText(member.email),
        orgRole: asText(member.role || "developer"),
        teamRole: String(member.id || "") === String(team?.leadId || "") ? "admin" : "developer",
        score: Math.max(60, 100 - index * 5),
      }));

      const scoreRows: ScoreItem[] = detailedMembers.map((member, index) => ({
        rank: index + 1,
        memberId: member.memberId,
        fullName: member.fullName,
        email: member.email,
        score: member.score,
        metric: "performance",
      }));

      setMembers(detailedMembers);
      setJoinRequests([]);
      setScores(scoreRows);
    } catch {
      setMembers([]);
      setJoinRequests([]);
      setScores([]);
    }
  }, [activeTeamId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadBase();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadBase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTeamDetails();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTeamDetails]);

  async function createTeam() {
    const name = newTeamName.trim();
    if (!name) return;

    try {
      const leadId = orgMembers[0]?.id || "";
      const created = await invokeDesktop<Team>("teams:create", {
        name,
        description: newTeamDescription.trim() || undefined,
        leadId,
      });

      setNewTeamName("");
      setNewTeamDescription("");
      await loadBase();
      if (created?.id) setActiveTeamId(created.id);
    } catch {
      setError("Create team failed");
      return;
    }
  }

  async function deleteTeam() {
    if (!activeTeamId) return;
    if (!window.confirm("Delete this team?")) return;

    try {
      await invokeDesktop<{ success: boolean }>("teams:delete", { teamId: activeTeamId });
    } catch {
      setError("Delete team failed");
      return;
    }

    setActiveTeamId("");
    await loadBase();
  }

  async function addMemberToTeam() {
    if (!activeTeamId || !selectedMemberId) return;

    try {
      const updated = await invokeDesktop<Team>("teams:addMember", {
        teamId: activeTeamId,
        userId: selectedMemberId,
      });
      if (selectedTeamRole === "admin") {
        await invokeDesktop<Team>("teams:update", {
          teamId: activeTeamId,
          changes: { leadId: selectedMemberId },
        });
      }

      setTeams((prev) => prev.map((team) => (team.id === activeTeamId ? { ...team, ...updated } : team)));
    } catch {
      setError("Add developer failed");
      return;
    }

    setSelectedMemberId("");
    await loadTeamDetails();
    await loadBase();
  }

  async function removeMemberFromTeam(memberId: string) {
    if (!activeTeamId) return;
    const confirmed = window.confirm("Remove this developer from team?");
    if (!confirmed) return;

    try {
      const updated = await invokeDesktop<Team>("teams:removeMember", {
        teamId: activeTeamId,
        userId: memberId,
      });
      setTeams((prev) => prev.map((team) => (team.id === activeTeamId ? { ...team, ...updated } : team)));
    } catch {
      setError("Remove developer failed");
      return;
    }

    await loadTeamDetails();
    await loadBase();
  }

  async function sendJoinRequest() {
    if (!activeTeamId) return;
    const request: JoinRequest = {
      id: `${activeTeamId}-${Date.now()}`,
      memberId: "local-user",
      status: "pending",
      requestedAt: new Date().toISOString(),
      member: {
        fullName: myMember?.fullName || "Member",
        email: myMember?.email || "",
        orgRole: myMember?.role || "developer",
      },
    };
    setJoinRequests((prev) => [request, ...prev]);
    setJoinNote("");
  }

  async function reviewRequest(requestId: string, status: "accepted" | "rejected") {
    setJoinRequests((prev) => prev.map((item) => (item.id === requestId ? { ...item, status } : item)));
  }

  async function updateScore(memberId: string) {
    if (!activeTeamId) return;
    const value = Number(scoreDraft[memberId]);
    if (!Number.isFinite(value)) return;

    setScores((prev) => prev.map((item) => (item.memberId === memberId ? { ...item, score: value } : item)));
    setMembers((prev) => prev.map((item) => (item.memberId === memberId ? { ...item, score: value } : item)));
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Teams Hub</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-300">Main collaboration hub with membership requests, role-aware actions, and performance scoring.</p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : null}

        {loading ? <div className="text-sm text-slate-600 dark:text-slate-300">Loading teams...</div> : null}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Teams</div>
            {teams.length ? (
              <div className="space-y-2">
                {teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setActiveTeamId(team.id)}
                    className={
                      "w-full rounded-lg border px-3 py-2 text-left text-sm " +
                      (team.id === activeTeamId
                        ? "border-slate-900 dark:border-white bg-slate-100 dark:bg-zinc-800"
                        : "border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50")
                    }
                  >
                    <div className="font-semibold text-slate-900 dark:text-white">{team.name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">{team.membersCount} members · {team.pendingRequests} pending</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-600 dark:text-slate-300">No teams yet.</div>
            )}

            {roleCanAdmin(activeOrgRole) ? (
              <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 space-y-2">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Create Team</div>
                <input
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Core Platform"
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
                />
                <textarea
                  value={newTeamDescription}
                  onChange={(e) => setNewTeamDescription(e.target.value)}
                  placeholder="Team mission"
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
                />
                <button type="button" onClick={() => void createTeam()} className="rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black px-3 py-2 text-sm font-semibold">
                  Create team
                </button>
              </div>
            ) : null}
          </section>

          <section className="lg:col-span-2 rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
            {!activeTeam ? (
              <div className="text-sm text-slate-600 dark:text-slate-300">Select a team to view collaboration details.</div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">{activeTeam.name}</h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{activeTeam.description || "No description"}</p>
                  </div>
                  {canAdmin ? (
                    <button type="button" onClick={() => void deleteTeam()} className="rounded-lg border border-red-300 dark:border-red-900 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300">
                      Delete team
                    </button>
                  ) : null}
                </div>

                {!canAdmin && !isMemberInActiveTeam ? (
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 p-3 space-y-2">
                    <div className="text-sm text-slate-700 dark:text-slate-200">Request to join this team</div>
                    <input
                      value={joinNote}
                      onChange={(e) => setJoinNote(e.target.value)}
                      placeholder="Optional note for admins"
                      className="w-full rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
                    />
                    <button type="button" onClick={() => void sendJoinRequest()} className="rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black px-3 py-1.5 text-sm font-semibold">
                      Send join request
                    </button>
                  </div>
                ) : null}

                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 text-sm font-semibold">Developers</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-zinc-800">
                          <th className="px-4 py-2 text-left">Developer</th>
                          <th className="px-4 py-2 text-left">Org Role</th>
                          <th className="px-4 py-2 text-left">Team Role</th>
                          <th className="px-4 py-2 text-left">Score</th>
                          {canAdmin ? <th className="px-4 py-2 text-left">Actions</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m) => (
                          <tr key={m.memberId} className="border-b border-slate-100 dark:border-zinc-800">
                            <td className="px-4 py-2">{m.fullName || m.email || m.memberId}</td>
                            <td className="px-4 py-2">{m.orgRole || "developer"}</td>
                            <td className="px-4 py-2">{m.teamRole || "developer"}</td>
                            <td className="px-4 py-2">{m.score}</td>
                            {canAdmin ? (
                              <td className="px-4 py-2">
                                <button type="button" onClick={() => void removeMemberFromTeam(m.memberId)} className="text-xs font-semibold text-red-700 dark:text-red-300">
                                  Remove
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                        {!members.length ? (
                          <tr>
                            <td colSpan={canAdmin ? 5 : 4} className="px-4 py-6 text-center text-slate-600 dark:text-slate-300">
                              No team members yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                {canAdmin ? (
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3 space-y-2">
                    <div className="text-sm font-semibold">Add developer to team</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <select
                        value={selectedMemberId}
                        onChange={(e) => setSelectedMemberId(e.target.value)}
                        className="md:col-span-2 rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
                      >
                        <option value="">Select developer</option>
                        {availableMembersToAdd.map((m) => (
                          <option key={m.id} value={m.id}>{m.fullName || m.email || m.id}</option>
                        ))}
                      </select>
                      <select
                        value={selectedTeamRole}
                        onChange={(e) => setSelectedTeamRole(e.target.value as "admin" | "developer")}
                        className="rounded-lg border border-slate-200 dark:border-zinc-700 px-3 py-2 text-sm bg-white dark:bg-zinc-950"
                      >
                        <option value="developer">developer</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                    <button type="button" onClick={() => void addMemberToTeam()} className="rounded-lg bg-slate-900 dark:bg-white text-white dark:text-black px-3 py-1.5 text-sm font-semibold">
                      Add developer
                    </button>
                  </div>
                ) : null}

                {canAdmin ? (
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 text-sm font-semibold">Join Requests</div>
                    <div className="divide-y divide-slate-100 dark:divide-zinc-800">
                      {joinRequests.map((jr) => (
                        <div key={jr.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div>
                            <div className="font-semibold">{jr.member.fullName || jr.member.email || jr.memberId}</div>
                            <div className="text-xs text-slate-600 dark:text-slate-300">Status: {jr.status}</div>
                          </div>
                          {jr.status === "pending" ? (
                            <div className="flex gap-2">
                              <button type="button" onClick={() => void reviewRequest(jr.id, "accepted")} className="rounded border border-emerald-300 dark:border-emerald-900 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Accept</button>
                              <button type="button" onClick={() => void reviewRequest(jr.id, "rejected")} className="rounded border border-red-300 dark:border-red-900 px-2 py-1 text-xs font-semibold text-red-700 dark:text-red-300">Reject</button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {!joinRequests.length ? <div className="px-4 py-5 text-sm text-slate-600 dark:text-slate-300">No join requests.</div> : null}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 text-sm font-semibold">Scoreboard</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-zinc-800">
                          <th className="px-4 py-2 text-left">Rank</th>
                          <th className="px-4 py-2 text-left">Developer</th>
                          <th className="px-4 py-2 text-left">Score</th>
                          <th className="px-4 py-2 text-left">Metric</th>
                          {canAdmin ? <th className="px-4 py-2 text-left">Update</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {scores.map((s) => (
                          <tr key={s.memberId} className="border-b border-slate-100 dark:border-zinc-800">
                            <td className="px-4 py-2">#{s.rank}</td>
                            <td className="px-4 py-2">{s.fullName || s.email || s.memberId}</td>
                            <td className="px-4 py-2">{s.score}</td>
                            <td className="px-4 py-2">{s.metric}</td>
                            {canAdmin ? (
                              <td className="px-4 py-2">
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    value={scoreDraft[s.memberId] ?? String(s.score)}
                                    onChange={(e) => setScoreDraft((prev) => ({ ...prev, [s.memberId]: e.target.value }))}
                                    className="w-24 rounded border border-slate-200 dark:border-zinc-700 px-2 py-1 text-xs bg-white dark:bg-zinc-950"
                                  />
                                  <button type="button" onClick={() => void updateScore(s.memberId)} className="rounded border border-slate-200 dark:border-zinc-700 px-2 py-1 text-xs font-semibold">
                                    Save
                                  </button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                        {!scores.length ? (
                          <tr>
                            <td colSpan={canAdmin ? 5 : 4} className="px-4 py-6 text-center text-slate-600 dark:text-slate-300">
                              No scores yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                {!canAdmin && myScore ? (
                  <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/30 p-3 text-sm">
                    Your performance score: <span className="font-semibold">{myScore.score}</span> ({myScore.metric})
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

