import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DOCS = [
  { slug: "README", title: "Overview" },
  { slug: "auth", title: "Auth" },
  { slug: "tasks", title: "Tasks" },
  { slug: "sprints", title: "Sprints" },
  { slug: "projects", title: "Projects" },
  { slug: "developers", title: "Developers" },
  { slug: "assignment", title: "Assignment" },
  { slug: "agents", title: "Agents" },
  { slug: "github", title: "GitHub" },
  { slug: "webhooks", title: "Webhooks" },
  { slug: "ai", title: "AI" },
  { slug: "notifications", title: "Notifications" },
];

function renderHtml() {
  const links = DOCS.map(
    (doc) =>
      `<li><a href="/api/docs/${encodeURIComponent(doc.slug)}">${doc.title}</a></li>`
  ).join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sprint API Docs</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 2rem; line-height: 1.5; }
      h1 { margin-bottom: 0.25rem; }
      p { color: #334155; }
      ul { margin-top: 1rem; }
      li { margin: 0.4rem 0; }
      a { color: #0f4c81; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .hint { margin-top: 1.2rem; color: #64748b; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <h1>Sprint API Documentation</h1>
    <p>External integration reference. Choose a section:</p>
    <ul>${links}</ul>
    <p class="hint">Raw OpenAPI summary: <a href="/api/docs/openapi">/api/docs/openapi</a></p>
  </body>
</html>`;
}

export async function GET() {
  return new NextResponse(renderHtml(), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
