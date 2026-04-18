import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function getBaseUrl(req: Request): string {
  const envBase = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const reqUrl = new URL(req.url);
  return reqUrl.origin;
}

function randomStateValue(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function GET(req: Request) {
  const clientId = String(process.env.GITHUB_OAUTH_CLIENT_ID || "").trim();
  if (!clientId) {
    const redirect = new URL("/settings/integrations", getBaseUrl(req));
    redirect.searchParams.set("github_oauth", "failed");
    redirect.searchParams.set("detail", "Missing GITHUB_OAUTH_CLIENT_ID");
    return NextResponse.redirect(redirect);
  }

  const callbackUrl = `${getBaseUrl(req)}/api/auth/github/callback`;
  const state = randomStateValue();
  const cookieStore = await cookies();
  cookieStore.set({
    name: "gh_oauth_state",
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", clientId);
  githubUrl.searchParams.set("redirect_uri", callbackUrl);
  githubUrl.searchParams.set("scope", "repo read:org admin:repo_hook");
  githubUrl.searchParams.set("state", state);

  return NextResponse.redirect(githubUrl);
}
