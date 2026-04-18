import { ExternalLink, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

type DesktopLoginGateProps = {
  onRefreshSession?: () => Promise<void>;
};

const CONFIGURED_AUTH_BASE_URL =
  String(import.meta.env.VITE_DESKTOP_AUTH_BASE_URL || "").trim() ||
  String(import.meta.env.VITE_CLOUD_APP_URL || "").trim() ||
  String(import.meta.env.VITE_WEB_APP_URL || "").trim();
const FALLBACK_DEPLOYED_WEB_URL = "https://agile-scrum-master.vercel.app";
const DEPLOYED_WEB_URL = (CONFIGURED_AUTH_BASE_URL || FALLBACK_DEPLOYED_WEB_URL).replace(/\/+$/, "");
const LOCAL_WEB_URL = "http://localhost:3000";
const DESKTOP_CALLBACK_URI = "asmdesktop://auth-callback";

function buildDesktopAuthUrl(baseUrl: string, entryPath: "/desktop-auth/sign-in" | "/desktop-auth/sign-up") {
  const redirect = encodeURIComponent(DESKTOP_CALLBACK_URI);
  return `${baseUrl}${entryPath}?desktop_redirect_uri=${redirect}`;
}

async function isLocalWebReachable() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return false;
  try {
    await fetch(`${LOCAL_WEB_URL}/desktop-auth/sign-in`, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  }
}

export function DesktopLoginGate({ onRefreshSession }: DesktopLoginGateProps) {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const signInUrl = useMemo(() => buildDesktopAuthUrl(DEPLOYED_WEB_URL, "/desktop-auth/sign-in"), []);
  const signUpUrl = useMemo(() => buildDesktopAuthUrl(DEPLOYED_WEB_URL, "/desktop-auth/sign-up"), []);

  async function openExternal(url: string) {
    if (typeof window !== "undefined" && window.desktopApi?.invoke) {
      await window.desktopApi.invoke("system:openExternal", { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleBrowserSignIn() {
    setWorking(true);
    setMessage(null);
    try {
      const localReachable = await isLocalWebReachable();
      const target = localReachable
        ? buildDesktopAuthUrl(LOCAL_WEB_URL, "/desktop-auth/sign-in")
        : signInUrl;

      await openExternal(target);
      if (!localReachable && !CONFIGURED_AUTH_BASE_URL) {
        setMessage(
          `Browser opened via fallback URL (${FALLBACK_DEPLOYED_WEB_URL}). Set VITE_DESKTOP_AUTH_BASE_URL to your deployed cloud app URL.`
        );
      } else {
        setMessage("Browser opened. After sign in, desktop will continue automatically.");
      }
      if (typeof onRefreshSession === "function") {
        void onRefreshSession();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to open browser sign in");
    } finally {
      setWorking(false);
    }
  }

  async function handleBrowserSignUp() {
    setWorking(true);
    setMessage(null);
    try {
      const localReachable = await isLocalWebReachable();
      const target = localReachable
        ? buildDesktopAuthUrl(LOCAL_WEB_URL, "/desktop-auth/sign-up")
        : signUpUrl;

      await openExternal(target);
      if (!localReachable && !CONFIGURED_AUTH_BASE_URL) {
        setMessage(
          `Browser opened via fallback URL (${FALLBACK_DEPLOYED_WEB_URL}). Set VITE_DESKTOP_AUTH_BASE_URL to your deployed cloud app URL.`
        );
      } else {
        setMessage("Browser opened for registration. Finish signup, then sign in to continue in desktop.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to open browser sign up");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_20%_20%,#1a2746_0%,transparent_40%),radial-gradient(circle_at_80%_80%,#2a1639_0%,transparent_45%),var(--bg-primary)] px-5 py-10 text-[var(--text-primary)]">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[linear-gradient(180deg,var(--bg-card),rgba(10,10,10,0.92))] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in to Agile Scrum Master</h1>
            <p className="text-sm text-[var(--text-secondary)]">Use your browser to authenticate. Desktop picks up your session automatically.</p>
          </div>
        </div>

        <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3.5 text-sm text-[var(--text-secondary)]">
          <div className="mb-1 inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
            <ShieldCheck className="h-4 w-4" />
            Browser-secured authentication
          </div>
          <p>Authentication runs in browser and redirects back to desktop using a secure callback.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void handleBrowserSignIn()}
            disabled={working}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm font-semibold hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ExternalLink className="h-4 w-4" />
            Sign In In Browser
          </button>

          <button
            type="button"
            onClick={() => void handleBrowserSignUp()}
            disabled={working}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UserPlus className="h-4 w-4" />
            Sign Up In Browser
          </button>
        </div>

        {message ? <p className="mt-4 text-sm text-[var(--text-secondary)]">{message}</p> : null}
      </div>
    </div>
  );
}
