import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

export const runtime = "nodejs";

function extractSignature(headers: Headers): string {
  return (
    headers.get("x-daily-signature") ||
    headers.get("daily-signature") ||
    headers.get("x-daily-hmac") ||
    ""
  ).trim();
}

function normalizeSignature(raw: string): string {
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.startsWith("sha256=")) return raw.slice(7).trim();
  return raw;
}

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const normalized = normalizeSignature(signature);
  const hex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const base64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeCompare(normalized, hex) || safeCompare(normalized, base64);
}

function extractEventName(payload: Record<string, unknown>): string {
  const direct = String(payload.event || payload.type || "").trim();
  if (direct) return direct;

  const nested = payload.payload as Record<string, unknown> | undefined;
  return String(nested?.event || nested?.type || "").trim();
}

export async function POST(request: Request) {
  const secret = String(process.env.DAILY_WEBHOOK_HMAC_SECRET || "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured", code: 500, detail: "Missing DAILY_WEBHOOK_HMAC_SECRET" },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  const signature = extractSignature(request.headers);
  if (!signature || !verifySignature(rawBody, signature, secret)) {
    return NextResponse.json(
      { error: "Invalid signature", code: 401, detail: "Daily webhook signature verification failed" },
      { status: 401 }
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid payload", code: 400, detail: "Webhook payload must be valid JSON" },
      { status: 400 }
    );
  }
  const eventName = extractEventName(payload);

  if (eventName !== "meeting-ended") {
    return NextResponse.json({ ok: true, ignored: true, reason: "unsupported_event" }, { status: 200 });
  }

  // Queueing is delegated to the API gateway worker stack to keep queue logic centralized.
  void fetch(`${getApiGatewayBaseUrl()}/api/v1/webhooks/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
    cache: "no-store",
  }).catch(() => null);

  return NextResponse.json({ ok: true }, { status: 200 });
}
