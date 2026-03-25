import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import {
  githubIssueToTask,
  githubPushToTask,
  projectMonitoringPulse,
  prMergedToDone,
  prToTask,
  sprintCreatedGroqBrief,
  sprintEndCleanupCron,
  sprintEndCleanupEvent,
  taskCreatedAutoAssign,
  taskUpdatedMonitoring,
} from "@/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    sprintCreatedGroqBrief,
    githubIssueToTask,
    githubPushToTask,
    prToTask,
    prMergedToDone,
    taskCreatedAutoAssign,
    taskUpdatedMonitoring,
    projectMonitoringPulse,
    sprintEndCleanupCron,
    sprintEndCleanupEvent,
  ],
});
