import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "README",
  "auth",
  "tasks",
  "sprints",
  "projects",
  "developers",
  "assignment",
  "agents",
  "github",
  "webhooks",
  "ai",
  "notifications",
]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;

  if (!ALLOWED.has(slug)) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "docs", "api", `${slug}.md`);

  try {
    const content = await readFile(filePath, "utf8");
    return new NextResponse(content, {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
}
