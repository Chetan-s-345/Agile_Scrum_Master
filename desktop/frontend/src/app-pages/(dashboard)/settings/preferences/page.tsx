"use client";

import { useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/lib/theme-store";
import { AutoTaskRulesPanel } from "@/components/auto-task-rules-panel";

type OrgResponse = {
  org?: {
    name?: string;
    slug?: string;
    timezone?: string;
  } | null;
  error?: string;
};

type MeResponse = {
  user?: {
    email?: string;
    fullName?: string;
  };
};

type UserPreferences = {
  theme?: "dark" | "light" | "system";
  language?: string;
  notifications?: {
    email?: NotificationSettings;
    inApp?: NotificationSettings;
  };
};

type ProfileResponse = {
  fullName?: string;
  email?: string;
};

type OrgSettingsResponse = {
  id?: string;
  name?: string;
  slug?: string;
  preferences?: {
    timezone?: string;
  };
};

type NotificationSettings = {
  sprintAlerts: boolean;
  digestEmail: boolean;
  assignmentAlerts: boolean;
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
      throw new Error(wrapped.error?.message || wrapped.error?.detail || "IPC request failed");
    }
    return (wrapped.data as T) ?? (null as T);
  }
  return response as T;
}

export default function PreferencesPage() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [language, setLanguage] = useState("en");

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [notifications, setNotifications] = useState<NotificationSettings>({
    sprintAlerts: true,
    digestEmail: true,
    assignmentAlerts: true,
  });

  const notificationPayload = useMemo(
    () => ({
      sprintAlerts: notifications.sprintAlerts,
      digestEmail: notifications.digestEmail,
      assignmentAlerts: notifications.assignmentAlerts,
    }),
    [notifications]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [orgData, meData, preferenceData] = await Promise.all([
          invokeDesktop<OrgSettingsResponse>("org:getSettings"),
          invokeDesktop<ProfileResponse>("profile:getCurrent"),
          invokeDesktop<UserPreferences>("preferences:get"),
        ]);

        if (cancelled) return;

        setOrgName(asText(orgData?.name));
        setOrgSlug(asText(orgData?.slug));
        setTimezone(asText(orgData?.preferences?.timezone) || "UTC");
        setUserEmail(asText(meData?.email));
        setUserName(asText(meData?.fullName));
        setLanguage(asText(preferenceData?.language) || "en");

        const nextTheme = asText(preferenceData?.theme);
        if (nextTheme === "dark" || nextTheme === "light" || nextTheme === "system") {
          setTheme(nextTheme);
        }

        const emailPrefs = preferenceData?.notifications?.email;
        if (emailPrefs && typeof emailPrefs === "object") {
          setNotifications({
            sprintAlerts: Boolean(emailPrefs.sprintAlerts),
            digestEmail: Boolean(emailPrefs.digestEmail),
            assignmentAlerts: Boolean(emailPrefs.assignmentAlerts),
          });
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load preferences");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [setTheme]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      await Promise.all([
        invokeDesktop<UserPreferences>("preferences:update", {
          theme,
          language,
          notifications: {
            email: notificationPayload,
            inApp: notificationPayload,
          },
        }),
        invokeDesktop<OrgSettingsResponse>("org:update", {
          name: orgName.trim() || undefined,
          description: undefined,
          industry: undefined,
          size: undefined,
          preferences: {
            timezone: timezone.trim() || undefined,
          },
        }),
      ]);

      setSaving(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (saveError) {
      setSaving(false);
      setError(saveError instanceof Error ? saveError.message : "Failed to save preferences");
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black px-4 py-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Preferences</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Organization and notification settings backed by your API.</p>
          <div className="mt-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:opacity-80"
              aria-label="Toggle global theme"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {theme === "dark" ? "Switch to Light" : "Switch to Dark"}
            </button>
          </div>
        </div>

        {loading ? <div className="text-sm text-slate-600 dark:text-slate-300">Loading preferences...</div> : null}
        {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <div className="text-lg font-semibold text-slate-900 dark:text-white">Organization</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label>
              <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Organization name</div>
              <input
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </label>
            <label>
              <div className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Timezone</div>
              <input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-800/40 px-3 py-2 text-sm text-slate-900 dark:text-white"
                placeholder="UTC"
              />
            </label>
          </div>
          <div className="text-xs text-slate-500">Slug: {orgSlug || "—"}</div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <div className="text-lg font-semibold text-slate-900 dark:text-white">Notifications</div>
          <ToggleRow
            label="Sprint alerts"
            checked={notifications.sprintAlerts}
            onChange={(value) => setNotifications((prev) => ({ ...prev, sprintAlerts: value }))}
          />
          <ToggleRow
            label="Daily digest email"
            checked={notifications.digestEmail}
            onChange={(value) => setNotifications((prev) => ({ ...prev, digestEmail: value }))}
          />
          <ToggleRow
            label="Task assignment alerts"
            checked={notifications.assignmentAlerts}
            onChange={(value) => setNotifications((prev) => ({ ...prev, assignmentAlerts: value }))}
          />
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-2">
          <div className="text-lg font-semibold text-slate-900 dark:text-white">Account</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">{userName || "User"}</div>
          <div className="text-sm text-slate-600 dark:text-slate-300">{userEmail || "—"}</div>
        </div>

        <AutoTaskRulesPanel />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 px-4 py-2 text-sm font-semibold text-white dark:text-black disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Preferences"}
          </button>
          {saved ? <span className="text-sm text-green-700 dark:text-green-300">Saved</span> : null}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between rounded border border-slate-200 dark:border-zinc-800 px-3 py-2">
      <span className="text-sm text-slate-800 dark:text-slate-200">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

