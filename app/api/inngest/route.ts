import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { sprintCreatedGroqBrief } from "@/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sprintCreatedGroqBrief],
});
