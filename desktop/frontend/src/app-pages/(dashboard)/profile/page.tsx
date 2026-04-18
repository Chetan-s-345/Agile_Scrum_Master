"use client";

import { useEffect, useState } from "react";
import { User, Save } from "lucide-react";

type ProfileDraft = {
  name: string;
  bio: string;
  timezone: string;
  notifications: {
    emailDailyDigest: boolean;
    sprintAlerts: boolean;
    standupReminders: boolean;
  };
};

type UserProfile = {
  id: string;
  displayName?: string;
  name: string;
  email: string;
  role?: string;
  title?: string;
  bio?: string;
  phone?: string;
  timezone?: string;
  githubUsername?: string;
  slack?: string;
  ssoProviders?: Array<{ id: string; name: string; connected: boolean }>;
  twoFactorEnabled?: boolean;
  twoFactorQrCodeUrl?: string | null;
  avatarUrl?: string | null;
  notifications?: ProfileDraft["notifications"];
};

type Session = {
  sessionId: string;
  device?: string;
  ipAddress?: string;
  lastActiveAt?: string;
  current?: boolean;
};

type ActivityStats = {
  tasksCompleted: number;
  prsReviewed: number;
  standupsAttended: number;
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

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [draft, setDraft] = useState<ProfileDraft>({
    name: "",
    bio: "",
    timezone: "",
    notifications: {
      emailDailyDigest: true,
      sprintAlerts: true,
      standupReminders: true,
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [profileData, statsData, sessionsData] = await Promise.all([
          invokeDesktop<UserProfile>("profile:get"),
          invokeDesktop<ActivityStats>("profile:getActivityStats"),
          invokeDesktop<Session[]>("profile:getSessions"),
        ]);
        if (cancelled) return;

        setProfile(profileData);
        setActivityStats(statsData);
        setSessions(Array.isArray(sessionsData) ? sessionsData : []);
        setDraft({
          name: asText(profileData?.displayName || profileData?.name),
          bio: asText(profileData?.bio),
          timezone: asText(profileData?.timezone),
          notifications: {
            emailDailyDigest: Boolean(profileData?.notifications?.emailDailyDigest),
            sprintAlerts: Boolean(profileData?.notifications?.sprintAlerts),
            standupReminders: Boolean(profileData?.notifications?.standupReminders),
          },
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveProfile() {
    setSaving(true);
    setError(null);
    try {
      const updated = await invokeDesktop<UserProfile>("profile:update", {
        displayName: draft.name,
        title: asText(profile?.title),
        bio: draft.bio,
        phone: asText(profile?.phone),
        timezone: draft.timezone,
        notifications: draft.notifications,
      });
      setProfile(updated);
      setSaved("Profile saved");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function changeEmail(newEmail: string, password: string) {
    setError(null);
    try {
      const result = await invokeDesktop<{ success: boolean }>("profile:changeEmail", {
        newEmail,
        password,
      });
      if (!result?.success) {
        throw new Error("Failed to change email");
      }
      setProfile((prev) => (prev ? { ...prev, email: newEmail } : prev));
      setSaved("Email updated");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change email");
    }
  }

  async function revokeSession(sessionId: string) {
    setError(null);
    try {
      const result = await invokeDesktop<{ success: boolean }>("profile:revokeSession", {
        sessionId,
      });
      if (!result?.success) {
        throw new Error("Failed to revoke session");
      }
      const nextSessions = sessions.filter((item) => item.sessionId !== sessionId);
      setSessions(nextSessions);
      setSaved("Session revoked");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke session");
    }
  }

  async function toggleTwoFactor(enabled: boolean) {
    setError(null);
    try {
      const result = await invokeDesktop<{ qrCodeUrl?: string; success: boolean }>("profile:toggle2FA", {
        enabled,
      });
      if (!result?.success) {
        throw new Error("Failed to toggle 2FA");
      }
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              twoFactorEnabled: enabled,
              twoFactorQrCodeUrl: result.qrCodeUrl || (enabled ? prev.twoFactorQrCodeUrl || null : null),
            }
          : prev
      );
      setSaved(enabled ? "2FA enabled" : "2FA disabled");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle 2FA");
    }
  }

  async function uploadAvatar(file: File | null) {
    if (!file) return;
    setError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(file);
      });

      const result = await invokeDesktop<{ avatarUrl: string }>("profile:uploadAvatar", { base64Image: base64 });
      setProfile((prev) => (prev ? { ...prev, avatarUrl: result.avatarUrl } : prev));
      setSaved("Avatar updated");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar");
    }
  }

  async function changePassword() {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }

    setPasswordSaving(true);
    setError(null);
    try {
      await invokeDesktop<{ success: boolean }>("profile:changePassword", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setSaved("Password changed");
      window.setTimeout(() => setSaved(""), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
            <User className="w-8 h-8" />
            Profile
          </h1>
          <p className="text-slate-600 dark:text-slate-300">Manage your account details and personal preferences</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Account</h2>
          {loading ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">Loading profile...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="md:col-span-2 flex items-center gap-4">
                <label className="inline-flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-xs text-slate-600 dark:text-slate-300">
                  {profile?.avatarUrl ? <img src={profile.avatarUrl} alt="avatar" className="h-full w-full object-cover" /> : "Avatar"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void uploadAvatar(e.target.files?.[0] || null)}
                  />
                </label>
                <div>
                  <p className="text-slate-900 dark:text-white font-medium">{profile?.name || "-"}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Role: {profile?.role || "-"}</p>
                </div>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-400">Email</p>
                <p className="text-slate-900 dark:text-white font-medium">{profile?.email || "-"}</p>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-400">Role</p>
                <p className="text-slate-900 dark:text-white font-medium">{profile?.role || "-"}</p>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-400">GitHub</p>
                <p className="text-slate-900 dark:text-white font-medium">{profile?.githubUsername || "-"}</p>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-400">Slack</p>
                <p className="text-slate-900 dark:text-white font-medium">{profile?.slack || "-"}</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Personal Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Display name</label>
              <input
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Timezone</label>
              <input
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={draft.timezone}
                onChange={(e) => setDraft((prev) => ({ ...prev, timezone: e.target.value }))}
                placeholder="Asia/Kolkata"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Notification Preferences</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.notifications.emailDailyDigest}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        notifications: { ...prev.notifications, emailDailyDigest: e.target.checked },
                      }))
                    }
                  />
                  Email digest
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.notifications.sprintAlerts}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        notifications: { ...prev.notifications, sprintAlerts: e.target.checked },
                      }))
                    }
                  />
                  Sprint alerts
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.notifications.standupReminders}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        notifications: { ...prev.notifications, standupReminders: e.target.checked },
                      }))
                    }
                  />
                  Standup reminders
                </label>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Bio</label>
              <textarea
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                rows={4}
                value={draft.bio}
                onChange={(e) => setDraft((prev) => ({ ...prev, bio: e.target.value }))}
                placeholder="Add your profile details..."
              />
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={saving}
              className="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black font-semibold py-2 px-4 rounded-lg transition inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save Profile"}
            </button>
            {saved ? <p className="text-sm text-green-700 dark:text-green-300">{saved}</p> : null}
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Change Password</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="password"
                placeholder="Current password"
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))}
              />
              <input
                type="password"
                placeholder="New password"
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
              />
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void changePassword()}
                disabled={passwordSaving}
                className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-60"
              >
                {passwordSaving ? "Updating..." : "Change Password"}
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Activity Stats</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                <p className="text-slate-600 dark:text-slate-400">Tasks Completed</p>
                <p className="text-xl font-bold text-slate-900 dark:text-white">{Number(activityStats?.tasksCompleted || 0)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                <p className="text-slate-600 dark:text-slate-400">PRs Reviewed</p>
                <p className="text-xl font-bold text-slate-900 dark:text-white">{Number(activityStats?.prsReviewed || 0)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-zinc-800 p-3">
                <p className="text-slate-600 dark:text-slate-400">Standups Attended</p>
                <p className="text-xl font-bold text-slate-900 dark:text-white">{Number(activityStats?.standupsAttended || 0)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

