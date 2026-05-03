"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { MeetingRoom } from "@/components/meetings/MeetingRoom";

type AuthMeResponse = {
  user?: { fullName?: string };
  activeOrgId?: string | null;
  memberships?: Array<{
    org?: { id?: string };
    role?: string;
  }>;
  error?: string;
  detail?: string;
};

export default function LiveMeetingPage() {
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState("");
  const [participantName, setParticipantName] = useState("Team Member");
  const [canManageMeetings, setCanManageMeetings] = useState(false);
  const routeParams = useParams<{ roomName?: string | string[] }>();
  const routeRoomName = Array.isArray(routeParams?.roomName) ? routeParams.roomName[0] : routeParams?.roomName;

  const roomName = useMemo(() => decodeURIComponent(String(routeRoomName || "").trim()), [routeRoomName]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoadingProfile(true);
      setError("");
      try {
        const resp = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = (await resp.json().catch(() => null)) as AuthMeResponse | null;
        if (!resp.ok) {
          throw new Error(String(payload?.detail || payload?.error || "Failed to load profile"));
        }

        if (cancelled) return;
        const nextOrg = String(payload?.activeOrgId || "").trim();
        const nextName = String(payload?.user?.fullName || "Team Member").trim();
        const memberships = Array.isArray(payload?.memberships) ? payload.memberships : [];
        const activeMembership =
          memberships.find((membership) => String(membership?.org?.id || "").trim() === nextOrg) || memberships[0];
        const role = String(activeMembership?.role || "").trim().toLowerCase();

        setParticipantName(nextName || "Team Member");
        setCanManageMeetings(role === "owner" || role === "admin");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        if (!cancelled) {
          setLoadingProfile(false);
        }
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!roomName) {
    return (
      <main className="min-h-screen bg-[linear-gradient(140deg,#0f172a_0%,#101827_55%,#111827_100%)] p-6">
        <div className="mx-auto max-w-[900px] rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          Invalid meeting room name.
        </div>
      </main>
    );
  }

  if (loadingProfile) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[linear-gradient(140deg,#0f172a_0%,#101827_55%,#111827_100%)] p-6">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
      </main>
    );
  }

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[linear-gradient(140deg,#0f172a_0%,#101827_55%,#111827_100%)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/25 px-4 py-3 backdrop-blur-sm">
        <div>
          <h1 className="text-base font-semibold text-white">Live Meeting</h1>
          <p className="text-xs text-slate-300">Room: {roomName}</p>
        </div>
        <Link href="/meetings" className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white transition hover:bg-white/20">
          Back to Meetings Dashboard
        </Link>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 p-3">
        <MeetingRoom roomName={roomName} participantName={participantName} canEndMeeting={canManageMeetings} />
      </div>
    </main>
  );
}
