import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x) => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

async function patchTask(taskId: string, token: string, body: Record<string, unknown>) {
  const response = await proxyToApiGateway({
    upstreamPath: `/api/v1/tasks/${encodeURIComponent(taskId)}`,
    method: "PATCH",
    token,
    body,
  });
  return response.ok;
}

async function deleteTask(taskId: string, token: string) {
  const response = await proxyToApiGateway({
    upstreamPath: `/api/v1/tasks/${encodeURIComponent(taskId)}?hard=true`,
    method: "DELETE",
    token,
  });
  return response.ok;
}

export async function PATCH(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const ids = parseIds(body?.ids);
  if (!ids.length) {
    return NextResponse.json({ error: "Validation failed", code: 400, detail: "ids is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body?.priority === "string") patch.priority = body.priority;
  if (typeof body?.storyPoints === "number") patch.storyPoints = body.storyPoints;
  if (typeof body?.dueDate === "string") patch.dueDate = body.dueDate;

  const ops = await Promise.all(ids.map((id) => patchTask(id, token, patch)));
  const successCount = ops.filter(Boolean).length;

  return NextResponse.json({ ok: true, successCount, total: ids.length, partial: successCount !== ids.length });
}

export async function DELETE(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const ids = parseIds(body?.ids);
  if (!ids.length) {
    return NextResponse.json({ error: "Validation failed", code: 400, detail: "ids is required" }, { status: 400 });
  }

  const ops = await Promise.all(ids.map((id) => deleteTask(id, token)));
  const successCount = ops.filter(Boolean).length;

  return NextResponse.json({ ok: true, successCount, total: ids.length, partial: successCount !== ids.length });
}
