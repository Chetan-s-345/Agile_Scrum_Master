import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Sprint API",
      version: "1.0.0",
      description:
        "Reference index for public app API routes. Detailed endpoint docs are available under /api/docs and docs/api/*.md.",
    },
    servers: [{ url: "/api", description: "App API" }],
    tags: [
      { name: "Auth" },
      { name: "Tasks" },
      { name: "Sprints" },
      { name: "Projects" },
      { name: "Developers" },
      { name: "Assignment" },
      { name: "Agents" },
      { name: "GitHub" },
      { name: "Webhooks" },
      { name: "AI" },
      { name: "Notifications" },
    ],
    paths: {
      "/auth/sign-in": { post: { tags: ["Auth"], summary: "Sign in" } },
      "/tasks": {
        get: { tags: ["Tasks"], summary: "List tasks" },
        post: { tags: ["Tasks"], summary: "Create task" },
      },
      "/sprints": {
        get: { tags: ["Sprints"], summary: "List sprints" },
        post: { tags: ["Sprints"], summary: "Create sprint" },
      },
      "/projects": {
        get: { tags: ["Projects"], summary: "List projects" },
        post: { tags: ["Projects"], summary: "Create project" },
      },
      "/developers": { get: { tags: ["Developers"], summary: "List developers" } },
      "/assignment/assign": {
        post: { tags: ["Assignment"], summary: "Assign task" },
      },
      "/agents/status": { get: { tags: ["Agents"], summary: "Agent status" } },
      "/github/overview": { get: { tags: ["GitHub"], summary: "GitHub overview" } },
      "/webhooks/github": { post: { tags: ["Webhooks"], summary: "GitHub webhook" } },
      "/ai/chat": { post: { tags: ["AI"], summary: "AI chat" } },
      "/notifications": {
        get: { tags: ["Notifications"], summary: "List notifications" },
      },
    },
  };

  return NextResponse.json(spec);
}
