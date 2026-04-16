"use client";

import { useEffect, useState } from "react";
import Link from "@/next-shims/link";
import { User, Save } from "lucide-react";
import { getMe } from "@/lib/org-member-auth";

type ProfileDraft = {
  displayName: string;
  title: string;
  phone: string;
  timezone: string;
  bio: string;
};

const STORAGE_KEY = "asm.profile.draft";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [account, setAccount] = useState<{ email: string; fullName: string; orgName: string } | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: "",
    title: "",
    phone: "",
    timezone: "",
    bio: "",
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

      setAccount({ email, fullName, orgName });

      const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<ProfileDraft>;
          setDraft((prev) => ({
            ...prev,
            displayName: String(parsed.displayName || fullName),
            title: String(parsed.title || ""),
            phone: String(parsed.phone || ""),
            timezone: String(parsed.timezone || ""),
            bio: String(parsed.bio || ""),
          }));
        } catch {
          setDraft((prev) => ({ ...prev, displayName: fullName }));
        }
      } else {
        setDraft((prev) => ({ ...prev, displayName: fullName }));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function saveProfile() {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
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

        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6 mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Account</h2>
          {loading ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">Loading profile...</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-600 dark:text-slate-400">Email</p>
                <p className="text-slate-900 dark:text-white font-medium">{account?.email || "-"}</p>
              </div>
              <div>
                <p className="text-slate-600 dark:text-slate-400">Organization</p>
                <p className="text-slate-900 dark:text-white font-medium">{account?.orgName || "-"}</p>
              </div>
            </div>
          )}

          <div className="mt-5 rounded-lg border border-slate-200 dark:border-zinc-800 p-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Need to upgrade your workspace plan?</p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/settings/billing?plan=pro"
                className="inline-flex items-center rounded-lg bg-slate-900 dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-black"
              >
                Upgrade to Pro
              </Link>
              <Link
                href="/settings/billing?plan=enterprise"
                className="inline-flex items-center rounded-lg border border-slate-300 dark:border-zinc-700 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white"
              >
                Upgrade to Enterprise
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-slate-200 dark:border-zinc-800 p-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Personal Details</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Display name</label>
              <input
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={draft.displayName}
                onChange={(e) => setDraft((prev) => ({ ...prev, displayName: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Title</label>
              <input
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Scrum Master"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Phone</label>
              <input
                className="w-full bg-white dark:bg-zinc-900 text-slate-900 dark:text-white px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-800"
                value={draft.phone}
                onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="+1 000 000 0000"
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
              onClick={saveProfile}
              className="bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black font-semibold py-2 px-4 rounded-lg transition inline-flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save Profile
            </button>
            {saved ? <p className="text-sm text-green-700 dark:text-green-300">Saved</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

