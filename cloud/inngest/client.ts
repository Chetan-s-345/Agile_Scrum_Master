import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "ai-sprint-manager",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
