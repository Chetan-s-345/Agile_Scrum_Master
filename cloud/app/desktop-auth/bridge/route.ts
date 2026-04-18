import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const DEFAULT_CALLBACK_URI = "asmdesktop://auth-callback";
const DEFAULT_ENTRY = "/desktop-auth/sign-in";

function asText(value: string | null): string {
  return String(value || "").trim();
}

function normalizeEntryPath(value: string): "/desktop-auth/sign-in" | "/desktop-auth/sign-up" {
  return value === "/desktop-auth/sign-up" ? "/desktop-auth/sign-up" : "/desktop-auth/sign-in";
}

function isAllowedDesktopRedirectUri(value: string): boolean {
  return value.toLowerCase().startsWith("asmdesktop://");
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const desktopRedirectUri = asText(url.searchParams.get("desktop_redirect_uri")) || DEFAULT_CALLBACK_URI;
  const desktopEntry = normalizeEntryPath(asText(url.searchParams.get("desktop_entry")) || DEFAULT_ENTRY);

  if (!isAllowedDesktopRedirectUri(desktopRedirectUri)) {
    const fallback = new URL("/desktop-auth/sign-in", url.origin);
    return NextResponse.redirect(fallback);
  }

  const cookieStore = await cookies();
  const tokenFromCookie = asText(cookieStore.get("auth_token")?.value || null);

  if (tokenFromCookie) {
    const callbackUrl = new URL(desktopRedirectUri);
    callbackUrl.searchParams.set("token", tokenFromCookie);
    return NextResponse.redirect(callbackUrl.toString());
  }

  const entryUrl = new URL(desktopEntry, url.origin);
  entryUrl.searchParams.set("desktop_redirect_uri", desktopRedirectUri);
  return NextResponse.redirect(entryUrl);
}
