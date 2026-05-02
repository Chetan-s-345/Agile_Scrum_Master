import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "./api-gateway";

/**
 * Check if auth is available or in dev mode.
 * In development mode, allow requests without a token.
 * In production, require a valid token.
 */
export async function getRequiredAuthToken(allowDevMode = true) {
  const token = await getAuthTokenFromCookies();

  if (!token) {
    if (allowDevMode && process.env.NODE_ENV === "development") {
      // Return a placeholder token that indicates dev mode
      return "dev-mode";
    }
    return null;
  }

  return token;
}

/**
 * Middleware to check auth and return 401 if not authorized.
 * In dev mode, allows requests without a token.
 */
export async function requireAuth(allowDevMode = true) {
  const token = await getRequiredAuthToken(allowDevMode);

  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized", code: 401, detail: "Missing auth token." },
      { status: 401 }
    );
  }

  return token;
}
