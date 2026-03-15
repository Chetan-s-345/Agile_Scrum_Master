import { inngest } from "../client";
import { groqChat } from "@/lib/groq";

export const sprintCreatedGroqBrief = inngest.createFunction(
  {
    id: "sprint-created-groq-brief",
    name: "Generate sprint brief (Groq)",
  },
  { event: "sprint/created" },
  async ({ event, step }) => {
    const data = event.data as unknown;
    const sprintName =
      (data && typeof data === "object" && typeof (data as Record<string, unknown>).sprintName === "string"
        ? String((data as Record<string, unknown>).sprintName)
        : "New Sprint");

    const context = JSON.stringify(event.data ?? {}, null, 2).slice(0, 6000);

    const brief = await step.run("groq-generate-brief", async () => {
      return groqChat({
        system:
          "You are an AI Scrum Master. Produce concise, actionable output. Use bullets. Do not invent facts not present in the input.",
        user:
          `We just created a sprint: ${sprintName}.\n\nInput data (JSON):\n${context}\n\nReturn:\n- Suggested sprint goal (1-2 lines)\n- Top 5 risks (bullets)\n- 5 standup prompts (bullets)\n- 3 tracking metrics (bullets)`
      });
    });

    // Durable result: available in Inngest run output/logs.
    console.log("Groq sprint brief:\n", brief);

    return { ok: true, briefLength: brief.length };
  }
);
