import { inngest } from "../client";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";
const GITNEXUS_TOKEN = (process.env.GITNEXUS_TOKEN ?? process.env.GITHUB_TOKEN ?? "").trim();
const GITNEXUS_REPO = "deekshithgowda85/Agile_Scrum_Master";
const GITNEXUS_PROJECT_ID = (process.env.GITNEXUS_PROJECT_ID ?? "").trim();

export const ingestGitnexusCron = inngest.createFunction(
  { id: "ingest-gitnexus-to-rag", name: "Ingest GitNexus repo → pgvector (every 6h)", retries: 3 },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    if (!GITNEXUS_PROJECT_ID) {
      throw new Error("GITNEXUS_PROJECT_ID is required for RAG ingestion.");
    }
    if (!GITNEXUS_TOKEN) {
      throw new Error("GITNEXUS_TOKEN or GITHUB_TOKEN is required for RAG ingestion.");
    }

    // step 1: fetch file list from GitNexus
    const files = await step.run("fetch-gitnexus-files", async () => {
      const res = await fetch(
        `https://api.github.com/repos/${GITNEXUS_REPO}/git/trees/main?recursive=1`,
        { headers: { Authorization: `Bearer ${GITNEXUS_TOKEN}`, Accept: "application/vnd.github+json" } }
      );
      const data = await res.json() as { tree: { path: string; type: string; url: string }[] };
      // filter to text files only
      return (data.tree ?? []).filter(
        (f) => f.type === "blob" && /\.(ts|tsx|py|js|md|json|sql|txt|yaml|yml)$/.test(f.path)
      );
    });

    // step 2: fetch content for each file (batch in groups of 20)
    const fileContents = await step.run("fetch-file-contents", async () => {
      const result: { path: string; content: string }[] = [];
      for (const file of files.slice(0, 100)) {  // cap at 100 files
        try {
          const res = await fetch(file.url, {
            headers: { Authorization: `Bearer ${GITNEXUS_TOKEN}`, Accept: "application/vnd.github+json" }
          });
          const blob = await res.json() as { content?: string; encoding?: string };
          if (blob.encoding === "base64" && blob.content) {
            result.push({
              path: file.path,
              content: Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8"),
            });
          }
        } catch { /* skip unreadable files */ }
      }
      return result;
    });

    // step 3: send to ai-service /rag/ingest
    const result = await step.run("upsert-to-pgvector", async () => {
      const res = await fetch(`${AI_SERVICE_URL}/rag/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: GITNEXUS_REPO,
          files: fileContents,
          commit_sha: Date.now().toString(),
          project_id: GITNEXUS_PROJECT_ID,
        }),
      });
      return res.json();
    });

    console.log("GitNexus ingest complete:", result);
    return result;
  }
);
