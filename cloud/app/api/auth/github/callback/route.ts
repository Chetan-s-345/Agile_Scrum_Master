import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

type GithubRepo = {
  name?: string;
  full_name?: string;
  fork?: boolean;
  owner?: {
    login?: string;
  };
};

function safeMessage(value: string): string {
  return value.replace(/[^a-zA-Z0-9 _.,:/-]/g, "").slice(0, 140);
}

function getBaseUrl(req: Request): string {
  const envBase = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

function integrationRedirect(req: Request): URL {
  return new URL("/settings/integrations", getBaseUrl(req));
}

async function githubApi<T>(path: string, accessToken: string): Promise<T> {
  const resp = await fetch(`https://api.github.com${path}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(`GitHub API error (${resp.status})`);
  }
  return data as T;
}

function pickRepo(repos: GithubRepo[]): GithubRepo | null {
  if (!repos.length) return null;
  const nonFork = repos.find((repo) => !repo.fork && repo.owner?.login && repo.name);
  return nonFork || repos.find((repo) => repo.owner?.login && repo.name) || null;
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("gh_oauth_state")?.value || "";
  cookieStore.delete("gh_oauth_state");

  const fail = (detail: string) => {
    const redirect = integrationRedirect(req);
    redirect.searchParams.set("github_oauth", "failed");
    redirect.searchParams.set("detail", safeMessage(detail));
    return NextResponse.redirect(redirect);
  };

  if (!code || !state || !storedState || state !== storedState) {
    return fail("Invalid OAuth state");
  }

  const clientId = String(process.env.GITHUB_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GITHUB_OAUTH_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return fail("Missing OAuth client configuration");
  }

  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData = (await tokenResp.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  const accessToken = String(tokenData?.access_token || "").trim();
  if (!accessToken) {
    return fail(tokenData?.error_description || "Unable to obtain GitHub access token");
  }

  const authToken = cookieStore.get("auth_token")?.value || null;
  if (!authToken) {
    return fail("You must be signed in before connecting GitHub");
  }

  let repos: GithubRepo[] = [];
  try {
    repos = await githubApi<GithubRepo[]>("/user/repos?sort=updated&direction=desc&per_page=50", accessToken);
  } catch {
    return fail("Unable to list repositories from GitHub");
  }

  const chosen = pickRepo(Array.isArray(repos) ? repos : []);
  if (!chosen || !chosen.owner?.login || !chosen.name) {
    const redirect = integrationRedirect(req);
    redirect.searchParams.set("github_oauth", "no_repo");
    return NextResponse.redirect(redirect);
  }

  const gatewayResp = await fetch(`${getApiGatewayBaseUrl()}/api/v1/integrations/github/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      githubOrg: String(chosen.owner.login),
      repoName: String(chosen.name),
      accessToken,
      createIfMissing: false,
    }),
    cache: "no-store",
  });

  if (!gatewayResp.ok) {
    return fail(`Auto-connect failed (${gatewayResp.status})`);
  }

  const redirect = integrationRedirect(req);
  redirect.searchParams.set("github_oauth", "connected");
  redirect.searchParams.set("repo", String(chosen.full_name || `${chosen.owner.login}/${chosen.name}`));
  return NextResponse.redirect(redirect);
}
