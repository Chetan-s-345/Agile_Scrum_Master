import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl, getAuthTokenFromCookies } from "@/lib/api-gateway";

type TranscriptBody = {
  roomName?: string;
  transcript?: string;
};

type UpstreamResponse = {
  status: number;
  payload: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

async function postGatewayJson(path: string, token: string, body: unknown, timeoutMs: number): Promise<UpstreamResponse> {
  const upstreamUrl = `${getApiGatewayBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await resp.json().catch(() => null)) as unknown;
    return { status: resp.status, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as TranscriptBody | null;
  const roomName = String(body?.roomName || "").trim();
  const transcript = String(body?.transcript || "").trim();

  if (!roomName) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "roomName is required" }, { status: 400 });
  }

  const transcriptValue = transcript;
  const captureMeta = {
    captured: Boolean(transcriptValue),
    charCount: transcriptValue.length,
    source: "deepgram-livekit",
  };

  try {
    const primary = await postGatewayJson(
      `/api/v1/meetings/${encodeURIComponent(roomName)}/transcript`,
      token,
      {
        transcript: transcriptValue,
        transcriptText: transcriptValue,
      },
      90000
    );

    if (primary.status >= 200 && primary.status < 300) {
      if (primary.payload && typeof primary.payload === "object") {
        return NextResponse.json({ ...(primary.payload as Record<string, unknown>), ...captureMeta }, { status: primary.status });
      }
      return NextResponse.json(captureMeta, { status: primary.status });
    }

    if (isUuid(roomName)) {
      const fallback = await postGatewayJson(
        `/api/v1/meetings/${encodeURIComponent(roomName)}/transcripts`,
        token,
        {
          sourceType: "livekit",
          mimeType: "text/plain",
          transcriptText: transcriptValue,
        },
        90000
      );

      if (fallback.status >= 200 && fallback.status < 300) {
        if (fallback.payload && typeof fallback.payload === "object") {
          return NextResponse.json({ ...(fallback.payload as Record<string, unknown>), ...captureMeta }, { status: fallback.status });
        }
        return NextResponse.json(captureMeta, { status: fallback.status });
      }

      return NextResponse.json(fallback.payload, { status: fallback.status });
    }

    return NextResponse.json(primary.payload, { status: primary.status });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Failed to proxy transcript";
    return NextResponse.json({ error: "Bad gateway", code: 502, detail }, { status: 502 });
  }
}
