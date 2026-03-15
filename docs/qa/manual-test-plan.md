# AI Sprint Manager — Manual Test Plan (Step-by-Step)

Document Purpose: Provide a complete, step-by-step manual test plan for **AI Sprint Manager** (Autonomous Agile/Scrum Management Platform).

Scope: Covers Authentication, Jira integration, Sprint Planning, Developer Assignment, LangGraph + AutoGen agent pipelines, Inngest workflows, Groq SSE features, ML models, dashboards, alerts, API endpoints, multi-tenant isolation, and billing UI.

Tester Instructions: Use this document to execute tests and fill in results (PASS/FAIL/BLOCKED/N/A). Do not skip preconditions.

Assumptions (update as needed for your environment):

- Base URL (web): `http://localhost:3000`
- API Gateway URL: `http://localhost:4000`
- AI Service URL: `http://localhost:8000`
- Tester has access to:
  - A Jira test site + a Jira test project with issues
  - GitHub account for OAuth
  - Firebase Auth enabled for Email/Password and Google
  - At least 2 organizations/tenants in AI Sprint Manager for isolation tests
  - Neon Postgres configured (DATABASE_URL available to ai-service)

Test Data Requirements (prepare before execution):

- Jira Project `QAT` (example) with at least:
  - 10 backlog issues (mix of Bug/Story/Task)
  - 2 epics
  - 2 issues with existing Story Points field (if used)
  - 1 issue with frequent updates (for bidirectional sync)
- Developers dataset in AI Sprint Manager:
  - At least 5 developers with different skills/tech stacks
  - At least 1 developer with “overloaded” capacity
- Two tenants/orgs:
  - Org A: has Jira connected + developers
  - Org B: has different Jira connected + different developers

Execution Notes:

- If a test is BLOCKED, record the dependency in Notes/Bug ID.
- If you see any error toast, HTTP 500 page, or infinite spinner, capture screenshot + console/network details and mark FAIL.

---

## Module 1 — Authentication (GitHub OAuth, Firebase email/Google, sessions, logout)

---

Test ID: TEST-001
Feature Being Tested: GitHub OAuth sign-in
Preconditions: GitHub OAuth is configured; tester is logged out; tester has a valid GitHub account.
Step-by-Step Instructions:

1. Open the AI Sprint Manager web app in a new browser window.
2. Navigate to the Sign In page.
3. Click the button labeled “Sign in with GitHub”.
4. If GitHub prompts for authorization, click “Authorize” for the app.
5. After redirect back to the app, verify you land on the dashboard (or org selection).
   Expected Result: User is authenticated via GitHub and a valid session is established.
   Pass Criteria: Dashboard (or org page) loads and user identity is visible in UI (e.g., profile/menu).
   Fail Criteria: OAuth error, redirect loop, blank page, or user remains unauthenticated.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-002
Feature Being Tested: Firebase Email/Password sign-up + sign-in
Preconditions: Firebase Email/Password provider enabled; tester has access to an unused email inbox.
Step-by-Step Instructions:

1. Navigate to the Sign Up page.
2. Enter a new email address and a strong password.
3. Click “Create account”.
4. If email verification is required, open the inbox and click the verification link.
5. Return to the app and sign in using the same email/password.
   Expected Result: User can create and sign into an account using email/password.
   Pass Criteria: After sign-in, dashboard (or org page) loads and the session is active.
   Fail Criteria: Sign-up fails, verification link invalid, or sign-in does not establish a session.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-003
Feature Being Tested: Firebase Google sign-in
Preconditions: Firebase Google provider enabled; tester is logged out; tester has a Google account.
Step-by-Step Instructions:

1. Navigate to the Sign In page.
2. Click “Sign in with Google”.
3. Choose the tester’s Google account.
4. Complete any Google consent prompts.
5. Verify redirect back to the app.
   Expected Result: User is authenticated via Google and can access the dashboard.
   Pass Criteria: User lands on dashboard (or org selection) and can navigate without re-auth prompts.
   Fail Criteria: Google sign-in errors, redirect loop, or user is not authenticated.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-004
Feature Being Tested: Session persistence + logout
Preconditions: User is logged in via any provider.
Step-by-Step Instructions:

1. Refresh the page.
2. Close the browser tab.
3. Reopen the app in the same browser profile.
4. Verify you are still logged in.
5. Open the user menu and click “Logout”.
6. Verify you are redirected to Sign In.
7. Navigate to a protected route (e.g., Dashboard) directly via URL.
   Expected Result: Session persists across refresh and closes; logout invalidates session.
   Pass Criteria: Session remains active until logout; after logout, protected pages require sign-in.
   Fail Criteria: Session lost unexpectedly, or user can access protected content after logout.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 2 — Jira Integration (OAuth, sync, webhook listener, bidirectional updates)

---

Test ID: TEST-005
Feature Being Tested: Jira OAuth connection
Preconditions: User is logged in; Jira integration credentials configured; user has Jira permissions.
Step-by-Step Instructions:

1. Navigate to Settings → Integrations → Jira.
2. Click “Connect Jira”.
3. Complete Jira authorization in the Jira consent window.
4. Return to the app and verify connection status.
   Expected Result: Jira account is connected and shown as “Connected”.
   Pass Criteria: Integration page shows connected status and Jira site/project selection is available.
   Fail Criteria: OAuth fails, token not stored, or UI does not show connected status.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-006
Feature Being Tested: Jira project/backlog sync into app
Preconditions: Jira is connected; Jira test project has backlog issues; user is in Org A.
Step-by-Step Instructions:

1. Navigate to Backlog.
2. Click “Import from Jira” (or equivalent action).
3. Select the Jira project (e.g., QAT).
4. Start the import/sync.
5. Wait until the UI indicates completion.
6. Verify imported tickets appear in the backlog list.
   Expected Result: Jira issues are pulled into the app and visible in backlog.
   Pass Criteria: Backlog displays expected number of issues and key fields (title/status/assignee) are populated.
   Fail Criteria: Import fails, partial import with no error, or tickets are missing/duplicated.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-007
Feature Being Tested: Webhook listener ingests Jira issue update
Preconditions: Jira is connected; webhook is configured; at least one imported Jira issue exists in app.
Step-by-Step Instructions:

1. In the app, open an imported ticket detail page.
2. In Jira, open the corresponding issue.
3. Change a visible field (e.g., Summary or Description) and save.
4. Return to the app.
5. Refresh the ticket detail page.
   Expected Result: The app reflects Jira-side updates via webhook ingestion.
   Pass Criteria: Updated Jira field value is visible in the app for the same ticket.
   Fail Criteria: App never reflects Jira changes, or changes apply to the wrong ticket.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-008
Feature Being Tested: Bidirectional ticket updates (app → Jira)
Preconditions: Jira is connected; at least one imported ticket exists.
Step-by-Step Instructions:

1. In the app, open an imported ticket.
2. Edit the ticket title/summary in the app (or the mapped editable field).
3. Save changes.
4. Open the same issue in Jira.
5. Verify the Jira field is updated to match.
   Expected Result: Updates made in the app propagate back to Jira.
   Pass Criteria: Jira issue field matches the updated value from the app.
   Fail Criteria: Jira does not update, or app reports success but Jira remains unchanged.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 3 — Sprint Planning (backlog import, enrichment, one-click sprint, story point prediction)

---

Test ID: TEST-009
Feature Being Tested: Backlog import appears in Sprint Planning view
Preconditions: Jira backlog is synced; user is in Sprint Planning page.
Step-by-Step Instructions:

1. Navigate to Sprint → Plan (or Sprint Planning page).
2. Verify the backlog list is populated.
3. Search for a known Jira issue key/title.
4. Open the ticket details.
   Expected Result: Imported backlog items are available for sprint planning.
   Pass Criteria: Ticket list contains the expected Jira issue and details match Jira.
   Fail Criteria: Sprint planning shows empty backlog despite successful import.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-010
Feature Being Tested: AI ticket enrichment (Groq) with SSE streaming
Preconditions: User is logged in; Groq is configured; at least one backlog ticket exists.
Step-by-Step Instructions:

1. Navigate to Backlog.
2. Select a ticket and click “Enrich” (or “AI Enrich”).
3. Observe the enrichment panel output.
4. Verify the output appears incrementally (streaming), not only at the end.
5. After completion, verify enriched fields are saved (accept/apply action if required).
   Expected Result: Enrichment response streams via SSE and produces actionable enhancements (acceptance criteria, improved description, etc.).
   Pass Criteria: Output arrives in chunks while the stream is active; final enriched content is visible and can be saved.
   Fail Criteria: No streaming (single final blob only), stream disconnects with no error, or no enriched content produced.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-011
Feature Being Tested: One-click sprint creation from backlog
Preconditions: Backlog has at least 8 tickets; user has permission to create sprints.
Step-by-Step Instructions:

1. Navigate to Sprint → Plan.
2. Click the “Create Sprint” or “One-click sprint creation” action.
3. Confirm sprint name/date range if prompted.
4. Submit the sprint creation.
5. Navigate to Sprint → [new sprint] page.
   Expected Result: Sprint is created and populated with selected tickets.
   Pass Criteria: New sprint appears in sprint list and contains tickets; status reflects “Active/Planned” as expected.
   Fail Criteria: Sprint not created, tickets not assigned, or UI shows success but sprint missing.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-012
Feature Being Tested: Story point prediction (Complexity classifier) during planning
Preconditions: Complexity model is trained OR system provides fallback; backlog ticket has title/description.
Step-by-Step Instructions:

1. Navigate to Sprint → Plan.
2. Open a ticket without story points.
3. Click “Predict story points” (or observe automatic prediction).
4. Verify predicted story points are shown.
5. Save/apply the predicted points if UI allows.
   Expected Result: System predicts story points and displays confidence.
   Pass Criteria: A bucketed story point value (e.g., 1/2/3/5/8/13) and confidence are displayed and can be applied.
   Fail Criteria: Prediction fails silently, shows invalid points, or confidence missing.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 4 — Developer Assignment (merit, tech stack match, availability, AI auto-assign)

---

Test ID: TEST-013
Feature Being Tested: Merit score display per developer
Preconditions: User is logged in; developers exist; merit scorer model is trained OR has baseline.
Step-by-Step Instructions:

1. Navigate to Developers.
2. Open a developer profile.
3. Locate the “Merit Score” section.
4. Verify score and confidence are shown.
   Expected Result: Merit score is visible and tied to the developer.
   Pass Criteria: Merit score value (0–100) and confidence are displayed without errors.
   Fail Criteria: Merit panel missing, shows NaN/blank, or crashes page.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-014
Feature Being Tested: Tech stack matching in assignment suggestions
Preconditions: At least one ticket has required tech tags; developer profiles include skills.
Step-by-Step Instructions:

1. Navigate to Tasks or Assignment page.
2. Select a ticket with a known tech requirement (e.g., “Next.js”, “Postgres”, “Python”).
3. Click “Suggest Assignees”.
4. Review suggested developers.
5. Verify suggested developers match the required tech skills.
   Expected Result: Suggestions prioritize developers with matching tech stacks.
   Pass Criteria: Top suggestions include developers who have the ticket’s required tech skill(s).
   Fail Criteria: Suggestions ignore required tech stack or recommend incompatible developers.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-015
Feature Being Tested: Availability/capacity check prevents overload
Preconditions: One developer is at/above capacity; workload panel is enabled.
Step-by-Step Instructions:

1. Navigate to Assignment.
2. Choose a ticket and attempt to assign it to the overloaded developer.
3. Confirm assignment.
4. Observe warnings/validation.
   Expected Result: System warns or blocks assignment that exceeds capacity.
   Pass Criteria: UI shows overload warning and either blocks assignment or requires explicit override.
   Fail Criteria: Assignment proceeds with no warning and developer load exceeds capacity unnoticed.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-016
Feature Being Tested: One-click auto-assignment by AI
Preconditions: Sprint exists with unassigned tickets; AI planning/assignment endpoints available.
Step-by-Step Instructions:

1. Navigate to Sprint → [active/planned sprint].
2. Click “Auto-assign” (or “AI Assign”).
3. Wait for completion indicator.
4. Verify multiple tickets now have assignees.
5. Open at least 2 assigned tickets and confirm assignees are valid developers.
   Expected Result: AI assigns tickets to developers based on merit, skills, and availability.
   Pass Criteria: Tickets are assigned and assignment rationale/summary (if shown) is consistent with rules.
   Fail Criteria: No assignments made, assignments to nonexistent developers, or repeated assignment to overloaded developer.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 5 — LangGraph Agent Pipeline (BacklogAnalyzer, DeveloperProfile, AssignmentOptimizer, RiskAssessor, SprintFinalizer)

---

Test ID: TEST-017
Feature Being Tested: LangGraph pipeline runs during sprint planning
Preconditions: User is logged in; backlog exists; LangGraph service is reachable.
Step-by-Step Instructions:

1. Navigate to Sprint → Plan.
2. Click “Generate Plan” (or equivalent).
3. Observe progress indicators/logs in UI.
4. Wait until plan output is shown.
   Expected Result: Pipeline executes and returns a structured sprint plan.
   Pass Criteria: Plan output is displayed (assignments, risks, capacity summary) with no errors.
   Fail Criteria: Pipeline fails, stalls indefinitely, or returns empty/invalid plan.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-018
Feature Being Tested: BacklogAnalyzer output quality (categorization/priorities)
Preconditions: Backlog contains mixed issue types; pipeline can run.
Step-by-Step Instructions:

1. Run sprint plan generation.
2. In the plan output, locate backlog analysis section.
3. Verify tickets are grouped or scored by priority/complexity.
4. Compare against obvious known priorities (e.g., critical bug).
   Expected Result: BacklogAnalyzer identifies priorities and key themes.
   Pass Criteria: Critical/urgent tickets are surfaced; analysis is consistent with backlog content.
   Fail Criteria: Analysis ignores critical tickets or produces irrelevant output.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-019
Feature Being Tested: DeveloperProfile agent uses real developer data
Preconditions: Developers have profiles (skills, recent velocity, capacity).
Step-by-Step Instructions:

1. Run sprint plan generation.
2. Locate developer profiling section in output.
3. Verify at least 2 developers have distinct profiles.
4. Confirm one known skill appears for the correct developer.
   Expected Result: DeveloperProfile reflects stored developer attributes.
   Pass Criteria: Output references correct skills/capacity for known developers.
   Fail Criteria: Output is generic or mismatched to actual developer profiles.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-020
Feature Being Tested: RiskAssessor + SprintFinalizer produce final approved plan
Preconditions: Backlog includes at least one risk (dependency/blocked ticket).
Step-by-Step Instructions:

1. Run sprint plan generation.
2. Locate risk section and final sprint summary.
3. Verify at least 1 risk is listed with mitigation.
4. Verify final sprint scope is clearly stated (ticket list + capacity check).
   Expected Result: Risks are assessed and final sprint scope is produced.
   Pass Criteria: Final plan includes risks and a finalized scope that respects capacity.
   Fail Criteria: No risk assessment, or final scope ignores capacity constraints.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 6 — AutoGen Multi-Agent Loop (ScrumMaster, Developer, ProductOwner, QA conversations)

---

Test ID: TEST-021
Feature Being Tested: Start AutoGen scope finalization conversation
Preconditions: Backlog exists; user can access sprint planning scope finalization.
Step-by-Step Instructions:

1. Navigate to Sprint → Plan.
2. Click “Finalize Scope” (AutoGen).
3. Observe the conversation output panel.
4. Verify multiple roles are shown (ScrumMaster, ProductOwner, Developer, QA).
   Expected Result: Multi-agent conversation starts and displays role-based messages.
   Pass Criteria: At least 4 role messages appear and the conversation continues until a conclusion.
   Fail Criteria: No conversation output, or only a single role appears.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-022
Feature Being Tested: GroupChat output produces a finalized scope summary
Preconditions: AutoGen conversation can run to completion.
Step-by-Step Instructions:

1. Run AutoGen scope finalization.
2. Wait for completion.
3. Locate “Final Scope” or “Decision” section in output.
4. Verify it lists included and excluded tickets.
   Expected Result: Output contains a clear final decision and scope.
   Pass Criteria: Output includes a ticket list and rationale for inclusion/exclusion.
   Fail Criteria: Output ends without a decision or provides contradictory scope.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-023
Feature Being Tested: QA agent identifies missing acceptance criteria
Preconditions: At least 1 backlog ticket has poor/empty acceptance criteria.
Step-by-Step Instructions:

1. Run AutoGen scope finalization.
2. Locate QA agent messages.
3. Verify QA agent flags tickets with insufficient detail.
4. Verify QA suggests improvements (testable acceptance criteria).
   Expected Result: QA agent performs QA review and proposes improvements.
   Pass Criteria: QA agent flags at least one weak ticket and suggests concrete acceptance criteria.
   Fail Criteria: QA agent provides generic feedback without identifying specific gaps.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-024
Feature Being Tested: AutoGen error handling when model/service is unavailable
Preconditions: Tester can simulate outage by using an invalid AI key OR service is intentionally stopped (in test env).
Step-by-Step Instructions:

1. Navigate to Sprint → Plan.
2. Click “Finalize Scope” (AutoGen).
3. Observe UI behavior when the conversation fails.
4. Verify an error is shown to the user.
5. Verify the UI allows retry.
   Expected Result: System fails gracefully and provides retry guidance.
   Pass Criteria: User sees a clear error message and can retry without page crash.
   Fail Criteria: App crashes, shows blank panel, or gets stuck on loading state.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 7 — Inngest Workflows (kickoff, standup collector, health monitor, retrospective, auto-rebalancer)

---

Test ID: TEST-025
Feature Being Tested: Inngest sprint-kickoff triggers on sprint creation
Preconditions: Inngest is configured; user can create a sprint.
Step-by-Step Instructions:

1. Create a new sprint using one-click sprint creation.
2. Navigate to Monitoring → Sprint (or workflow monitoring page).
3. Locate the sprint-kickoff workflow run.
4. Open the run details.
   Expected Result: A sprint-kickoff workflow run exists for the created sprint.
   Pass Criteria: Workflow run is visible and shows successful completion steps.
   Fail Criteria: No workflow triggered, or run fails without user-visible reason.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-026
Feature Being Tested: Daily standup collector workflow creates standup entries
Preconditions: An active sprint exists; standup workflow is enabled.
Step-by-Step Instructions:

1. Navigate to Standup.
2. Trigger standup collection (manual trigger button if available) OR wait for scheduled run.
3. Refresh the standup feed.
4. Verify new standup entries appear for developers.
   Expected Result: Standup collector runs and populates standup feed.
   Pass Criteria: Standup feed shows new entries with correct sprint association.
   Fail Criteria: No entries created, or entries linked to the wrong sprint.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-027
Feature Being Tested: Sprint health monitor detects risk and generates insights
Preconditions: Active sprint exists; at least one developer is overloaded OR tickets are blocked.
Step-by-Step Instructions:

1. Navigate to Monitoring → Sprint Health.
2. Trigger “Run Health Check” (if available) OR wait for scheduled run.
3. Observe health score and insights.
4. Verify at least one risk/alert is produced.
   Expected Result: Health monitor updates health score and produces insights.
   Pass Criteria: Health gauge changes and at least one insight references real sprint data.
   Fail Criteria: Health check runs but provides no output or inaccurate data.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-028
Feature Being Tested: Auto-rebalancer workflow reassigns to reduce overload
Preconditions: At least one developer is overloaded; sprint has reassignable tickets.
Step-by-Step Instructions:

1. Navigate to Monitoring → Alerts.
2. Confirm an overload alert exists.
3. Trigger “Auto-rebalance” (or wait for workflow trigger).
4. Navigate to Sprint Board.
5. Verify at least one ticket is reassigned to a different developer.
   Expected Result: Auto-rebalancer reallocates work to improve balance.
   Pass Criteria: Ticket assignments change and overloaded developer load decreases.
   Fail Criteria: No reassignment occurs, or reassignment worsens load.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 8 — Groq AI Features (ticket enrichment, standup summarizer, retrospective, risk narrator, SSE)

---

Test ID: TEST-029
Feature Being Tested: Ticket enrichment SSE stream completes successfully
Preconditions: Groq configured; backlog ticket exists.
Step-by-Step Instructions:

1. Navigate to Backlog.
2. Select a ticket and click “AI Enrich”.
3. Observe that content streams incrementally.
4. Wait for completion.
5. Verify final output contains acceptance criteria.
   Expected Result: Enrichment streams via SSE and completes with useful content.
   Pass Criteria: Stream shows incremental updates and final output includes acceptance criteria.
   Fail Criteria: Stream disconnects, returns error, or output is empty.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-030
Feature Being Tested: Standup summarizer SSE stream from standup feed
Preconditions: Standup entries exist for today.
Step-by-Step Instructions:

1. Navigate to Standup.
2. Click “Summarize Standup” (AI).
3. Observe streaming summary output.
4. Verify summary contains Yesterday/Today/Blockers sections.
   Expected Result: Standup summary streams and contains structured sections.
   Pass Criteria: Summary includes at least 3 structured sections and references real standup content.
   Fail Criteria: Summary is generic, missing sections, or does not stream.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-031
Feature Being Tested: Retrospective generator SSE output
Preconditions: Sprint has activity data (completed tickets, standups).
Step-by-Step Instructions:

1. Navigate to Reports → Retrospective (or Sprint → Retrospective).
2. Click “Generate Retrospective” (AI).
3. Observe streaming output.
4. Verify it includes “What went well”, “What didn’t”, and “Action items”.
   Expected Result: Retrospective streams and contains a full report.
   Pass Criteria: Report includes the three expected sections and action items are specific.
   Fail Criteria: Missing sections, stream errors, or report unrelated to sprint data.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-032
Feature Being Tested: Risk narrator SSE output for sprint risks
Preconditions: Active sprint exists; at least one risk condition exists (blocked/overload).
Step-by-Step Instructions:

1. Navigate to Monitoring → Sprint Health.
2. Click “Narrate Risks” (AI).
3. Observe streaming risk narrative.
4. Verify narrative references real sprint risks.
   Expected Result: Risk narrator streams and provides actionable risk narrative.
   Pass Criteria: Narrative references at least one real risk and includes mitigation suggestion.
   Fail Criteria: Narrative is generic or does not stream.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 9 — ML Models (merit, velocity, complexity, burndown anomaly)

---

Test ID: TEST-033
Feature Being Tested: Merit scorer training endpoint and persistence
Preconditions: User is logged in; ML training UI or API access is available; ai-service has DATABASE_URL.
Step-by-Step Instructions:

1. Navigate to Admin/ML page (if available) OR use an in-app UI that triggers “Train Merit Model”.
2. Start merit model training with at least 20 samples.
3. Wait for training completion message.
4. Navigate to Developers.
5. Open a developer and verify merit score is available.
   Expected Result: Merit model trains and predictions become available.
   Pass Criteria: Training reports success and merit predictions can be generated with confidence.
   Fail Criteria: Training fails, reports success but no predictions are possible.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-034
Feature Being Tested: Velocity predictor training + prediction
Preconditions: Sprint history exists OR sample velocity series available; ai-service ML dependencies installed.
Step-by-Step Instructions:

1. Navigate to Admin/ML page (if available) OR trigger “Train Velocity Model”.
2. Provide at least 30 samples of past velocities and next velocity.
3. Start training and wait for completion.
4. Navigate to Reports → Sprint Velocity.
5. Trigger velocity prediction for the next sprint.
   Expected Result: Velocity model predicts next sprint velocity with confidence.
   Pass Criteria: Predicted velocity is a non-negative number and confidence is displayed.
   Fail Criteria: Prediction fails, negative velocity, or confidence missing.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-035
Feature Being Tested: Complexity classifier training + prediction
Preconditions: At least 50 labeled tickets exist; torch/transformers installed; model can be trained.
Step-by-Step Instructions:

1. Navigate to Admin/ML page (if available) OR trigger “Train Complexity Model”.
2. Provide at least 50 training samples (title/description/story points).
3. Start training and wait for completion.
4. Navigate to Backlog.
5. Open a ticket and trigger story point prediction.
   Expected Result: Complexity classifier predicts bucketed story points with confidence.
   Pass Criteria: Prediction returns 1/2/3/5/8/13 and confidence is shown.
   Fail Criteria: Training fails, prediction unavailable, or returns out-of-bucket value.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-036
Feature Being Tested: Burndown anomaly detector training + detect
Preconditions: At least 30 burndown series samples exist; sprint burndown data available.
Step-by-Step Instructions:

1. Navigate to Admin/ML page (if available) OR trigger “Train Burndown Anomaly Model”.
2. Provide at least 30 burndown samples.
3. Start training and wait for completion.
4. Navigate to Monitoring → Sprint.
5. Trigger “Detect Burndown Anomalies”.
   Expected Result: Burndown anomalies are detected with an anomaly score and confidence.
   Pass Criteria: UI indicates anomaly true/false and shows confidence; anomalies are plausible.
   Fail Criteria: Detection fails, outputs missing fields, or marks all series as anomalous.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 10 — Sprint Board Dashboard (Kanban, real-time updates, load panel, health gauge, AI insights)

---

Test ID: TEST-037
Feature Being Tested: Kanban board loads and displays columns/cards
Preconditions: Active sprint exists with tickets in multiple statuses.
Step-by-Step Instructions:

1. Navigate to Tasks → Board (or Sprint Board).
2. Verify columns (e.g., To Do / In Progress / Done) are visible.
3. Verify at least 5 cards appear.
4. Open a card detail.
   Expected Result: Board renders with correct columns and cards.
   Pass Criteria: Columns and cards render; card detail opens successfully.
   Fail Criteria: Board blank, missing columns, or card detail fails.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-038
Feature Being Tested: Real-time updates reflected in the board
Preconditions: Two browser sessions available (or two testers); sprint board open.
Step-by-Step Instructions:

1. Open the sprint board in Browser A.
2. Open the same sprint board in Browser B.
3. In Browser B, move one card to a new column (drag/drop or change status).
4. In Browser A, observe the board for updates.
   Expected Result: Board updates in near real-time without manual refresh.
   Pass Criteria: Browser A reflects the card move within 60 seconds.
   Fail Criteria: No update occurs without refresh or updates are incorrect.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-039
Feature Being Tested: Developer load panel accuracy
Preconditions: Developers have assigned tickets; capacity values exist.
Step-by-Step Instructions:

1. Navigate to Sprint Board dashboard.
2. Locate the developer load panel.
3. Compare one developer’s assigned tickets count to the panel value.
4. Verify overload indicator appears for overloaded developer.
   Expected Result: Load panel reflects current assignments and flags overload.
   Pass Criteria: Panel values match assignments and overload is correctly indicated.
   Fail Criteria: Panel mismatches assignments or overload not flagged.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-040
Feature Being Tested: Health gauge + AI insights panel displays data
Preconditions: Sprint health monitor runs; insights available.
Step-by-Step Instructions:

1. Navigate to Sprint Dashboard.
2. Locate health gauge.
3. Locate AI insights panel.
4. Trigger a health check.
5. Verify gauge value and insights update.
   Expected Result: Health gauge and insights show current sprint status.
   Pass Criteria: Gauge shows a numeric/visual state and insights list is populated.
   Fail Criteria: Gauge stuck, insights empty, or errors shown.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 11 — Standup & Retrospective (standup feed, AI summary, retrospective report, action items)

---

Test ID: TEST-041
Feature Being Tested: Standup feed accepts manual entry
Preconditions: Active sprint exists; user can post standup.
Step-by-Step Instructions:

1. Navigate to Standup.
2. Click “Add Standup” (or “Post Update”).
3. Enter Yesterday/Today/Blockers.
4. Submit.
5. Verify the entry appears at the top of the feed.
   Expected Result: Standup entry is saved and visible.
   Pass Criteria: Entry appears with correct content and timestamp.
   Fail Criteria: Entry not saved, missing content, or feed does not update.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-042
Feature Being Tested: Standup AI summary references real entries
Preconditions: At least 3 standup entries exist today.
Step-by-Step Instructions:

1. Navigate to Standup.
2. Click “Summarize” (AI).
3. Wait for completion.
4. Verify summary includes at least one specific item from today’s entries.
   Expected Result: AI summary is grounded in standup feed.
   Pass Criteria: Summary references real tasks/blockers mentioned in entries.
   Fail Criteria: Summary is generic or references nonexistent items.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-043
Feature Being Tested: Retrospective report generation for a sprint
Preconditions: Sprint has completed tickets and standup data.
Step-by-Step Instructions:

1. Navigate to Reports → [Sprint] Retrospective.
2. Click “Generate Retrospective”.
3. Verify report is produced.
4. Verify “Action Items” list is present.
   Expected Result: Retrospective report is generated with action items.
   Pass Criteria: Report includes “Went well/Didn’t go well/Action items” sections.
   Fail Criteria: Report missing sections or fails to generate.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-044
Feature Being Tested: Create action items from retrospective
Preconditions: Retrospective report exists.
Step-by-Step Instructions:

1. Open the retrospective report.
2. Select one action item.
3. Click “Create Task” (or equivalent).
4. Verify the action item appears in backlog as a new ticket/task.
   Expected Result: Action items can be turned into trackable tasks.
   Pass Criteria: New task appears with title/description derived from the action item.
   Fail Criteria: Task is not created or is created with missing/incorrect content.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 12 — Alerts & Escalations (blockers, overload, auto-rebalance, notifications)

---

Test ID: TEST-045
Feature Being Tested: Blocker detection generates an alert
Preconditions: At least one ticket is marked “Blocked” or has blocker tag.
Step-by-Step Instructions:

1. Navigate to Tasks.
2. Open a ticket and mark it as “Blocked” (or add blocker label).
3. Save.
4. Navigate to Monitoring → Alerts.
5. Verify a blocker alert appears.
   Expected Result: Blocker alerts are created for blocked tickets.
   Pass Criteria: Alerts list shows a new blocker alert referencing the correct ticket.
   Fail Criteria: No alert appears or alert references wrong ticket.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-046
Feature Being Tested: Overload alert triggers for overloaded developer
Preconditions: One developer is overloaded (capacity exceeded).
Step-by-Step Instructions:

1. Navigate to Developers.
2. Confirm a developer’s load exceeds capacity.
3. Navigate to Monitoring → Alerts.
4. Verify overload alert exists.
   Expected Result: Overload alerts are raised for capacity violations.
   Pass Criteria: Alerts show overloaded developer and severity.
   Fail Criteria: No overload alert exists despite overload.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-047
Feature Being Tested: Auto-rebalance trigger available from alert
Preconditions: Overload alert exists.
Step-by-Step Instructions:

1. Navigate to Monitoring → Alerts.
2. Open the overload alert details.
3. Click “Auto-rebalance” (if available).
4. Confirm the action.
5. Verify reassignment occurs.
   Expected Result: Alert provides an action that triggers auto-rebalancer.
   Pass Criteria: Trigger action starts and at least one ticket reassignment occurs.
   Fail Criteria: Trigger does nothing or errors with no guidance.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-048
Feature Being Tested: Notification delivery for critical alerts
Preconditions: Notification channel configured (email/in-app); critical alert exists.
Step-by-Step Instructions:

1. Trigger a critical condition (e.g., multiple blockers + overload).
2. Navigate to Notifications (or user inbox UI).
3. Verify a notification entry appears.
4. If email notifications are enabled, check the tester inbox.
   Expected Result: Critical alerts result in notifications.
   Pass Criteria: Notification appears in-app (and email if configured) with correct details.
   Fail Criteria: No notification is delivered for a critical alert.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 13 — API Endpoints (REST routes for core entities)

---

Test ID: TEST-049
Feature Being Tested: API authentication required for protected routes
Preconditions: Tester has a valid logged-in session in the web app.
Step-by-Step Instructions:

1. Open browser DevTools.
2. Navigate to Network tab.
3. Perform an action that loads protected data (e.g., open Developers).
4. Click one API request to `/api/*`.
5. Verify request includes authentication (cookie/session header).
   Expected Result: Protected API requests include authentication context.
   Pass Criteria: Protected requests succeed (200) and are authenticated.
   Fail Criteria: Requests fail with 401 while logged in OR succeed without any auth.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-050
Feature Being Tested: Sprints REST API supports create/read/list
Preconditions: Logged in; org exists.
Step-by-Step Instructions:

1. Navigate to Sprint page.
2. Create a new sprint.
3. Verify sprint appears in sprint list.
4. Open the sprint details.
   Expected Result: Sprint endpoints allow create and retrieval.
   Pass Criteria: Sprint is created and can be opened by ID from UI.
   Fail Criteria: Sprint creation fails or sprint cannot be retrieved.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-051
Feature Being Tested: Tickets REST API supports update and reflects in UI
Preconditions: Ticket exists and is editable.
Step-by-Step Instructions:

1. Open a ticket.
2. Change status or title.
3. Save.
4. Refresh the ticket list.
   Expected Result: Ticket update API persists changes.
   Pass Criteria: Ticket shows updated values after refresh.
   Fail Criteria: Update appears but reverts on refresh, or errors.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-052
Feature Being Tested: Reports REST API renders sprint report page
Preconditions: Sprint exists with some activity.
Step-by-Step Instructions:

1. Navigate to Reports.
2. Open a sprint report.
3. Verify charts/metrics load.
4. Verify no API errors appear in Network tab.
   Expected Result: Report endpoints return data for report rendering.
   Pass Criteria: Report page loads with data and API responses are 200.
   Fail Criteria: Report page empty due to API errors or missing data.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 14 — Multi-Tenant Isolation (no cross-user leakage)

---

Test ID: TEST-053
Feature Being Tested: Org A cannot access Org B sprint via direct URL
Preconditions: Two orgs exist (Org A, Org B); each has at least one sprint.
Step-by-Step Instructions:

1. Log in as a user in Org A.
2. Open a sprint from Org B and copy its URL.
3. Paste the Org B sprint URL while still logged in as Org A.
4. Observe the result.
   Expected Result: Access to Org B resources is denied.
   Pass Criteria: User sees 403/Not authorized (or redirected) and cannot view Org B sprint details.
   Fail Criteria: Org A user can view Org B sprint data.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-054
Feature Being Tested: Developers list is tenant-scoped
Preconditions: Org A and Org B have different developer sets.
Step-by-Step Instructions:

1. Log in to Org A.
2. Navigate to Developers and note the list.
3. Switch to Org B (or log in as Org B user).
4. Navigate to Developers and compare list.
   Expected Result: Each org sees only its own developers.
   Pass Criteria: Org A developers are not visible in Org B and vice versa.
   Fail Criteria: Cross-tenant developer visibility occurs.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-055
Feature Being Tested: Jira webhook events do not leak across tenants
Preconditions: Org A and Org B have separate Jira connections; both have imported tickets.
Step-by-Step Instructions:

1. Log in as Org A.
2. In Org B’s Jira project, update an issue.
3. Return to Org A and refresh the backlog.
4. Verify Org A did not receive Org B updates.
   Expected Result: Webhook processing applies only to the correct tenant.
   Pass Criteria: Org A backlog remains unchanged by Org B Jira events.
   Fail Criteria: Org A sees updates for Org B issues.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-056
Feature Being Tested: Billing/plan info is tenant-scoped
Preconditions: Org A and Org B have different plan states (or test data).
Step-by-Step Instructions:

1. Log in to Org A.
2. Navigate to Settings → Billing.
3. Record plan name/status.
4. Switch to Org B.
5. Navigate to Settings → Billing and compare.
   Expected Result: Billing information is scoped to the current org.
   Pass Criteria: Org A billing does not display Org B plan details.
   Fail Criteria: Billing details from another org appear.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

## Module 15 — Billing & Plans (Free/Pro/Enterprise UI)

---

Test ID: TEST-057
Feature Being Tested: Pricing page displays Free/Pro/Enterprise plans
Preconditions: App is accessible.
Step-by-Step Instructions:

1. Navigate to Pricing.
2. Verify Free plan card is visible.
3. Verify Pro plan card is visible.
4. Verify Enterprise plan card is visible.
   Expected Result: Pricing page lists all plan tiers.
   Pass Criteria: All three plan tiers are displayed with key features.
   Fail Criteria: Missing plan tier or broken layout.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-058
Feature Being Tested: Upgrade flow from Free to Pro (UI)
Preconditions: Org is on Free plan; billing UI enabled.
Step-by-Step Instructions:

1. Navigate to Settings → Billing.
2. Click “Upgrade to Pro”.
3. Verify checkout/payment UI appears (or a test-mode placeholder).
4. Cancel/return without completing payment.
   Expected Result: Upgrade flow is accessible and does not break navigation.
   Pass Criteria: Upgrade UI is reachable and cancel returns to Billing page.
   Fail Criteria: Upgrade button does nothing, or navigation breaks.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-059
Feature Being Tested: Pro-only feature access control
Preconditions: A feature is marked Pro-only; Org is on Free plan.
Step-by-Step Instructions:

1. Log in as a Free-plan org user.
2. Navigate to the Pro-only feature (e.g., advanced reports/burnout analytics).
3. Attempt to use the feature.
4. Observe access control behavior.
   Expected Result: Free plan cannot use Pro-only features.
   Pass Criteria: UI shows upgrade prompt or disables feature with clear message.
   Fail Criteria: Free user can access Pro-only feature without restriction.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

---

Test ID: TEST-060
Feature Being Tested: Enterprise contact/sales CTA
Preconditions: Pricing page is accessible.
Step-by-Step Instructions:

1. Navigate to Pricing.
2. Locate Enterprise plan.
3. Click “Contact Sales” (or equivalent).
4. Verify a contact method opens (form/email link) and is usable.
   Expected Result: Enterprise CTA provides a contact workflow.
   Pass Criteria: Contact form or mailto opens with Enterprise context.
   Fail Criteria: CTA is broken or leads to a dead link.
   Result: [ ] PASS [ ] FAIL [ ] BLOCKED [ ] N/A
   Tested By: ******\_\_\_****** Date: ****\_\_\_****
   Build/Version: ****\_\_\_\_**** Notes/Bug ID: ****\_\_\_****

---

# Summary Table (Fill In)

| Module                      | Total Tests | Pass | Fail | Blocked | N/A | Pass% |
| --------------------------- | ----------: | ---: | ---: | ------: | --: | ----: |
| 1. Authentication           |           4 |      |      |         |     |       |
| 2. Jira Integration         |           4 |      |      |         |     |       |
| 3. Sprint Planning          |           4 |      |      |         |     |       |
| 4. Developer Assignment     |           4 |      |      |         |     |       |
| 5. LangGraph Agent Pipeline |           4 |      |      |         |     |       |
| 6. AutoGen Multi-Agent Loop |           4 |      |      |         |     |       |
| 7. Inngest Workflows        |           4 |      |      |         |     |       |
| 8. Groq AI Features         |           4 |      |      |         |     |       |
| 9. ML Models                |           4 |      |      |         |     |       |
| 10. Sprint Board Dashboard  |           4 |      |      |         |     |       |
| 11. Standup & Retrospective |           4 |      |      |         |     |       |
| 12. Alerts & Escalations    |           4 |      |      |         |     |       |
| 13. API Endpoints           |           4 |      |      |         |     |       |
| 14. Multi-Tenant Isolation  |           4 |      |      |         |     |       |
| 15. Billing & Plans         |           4 |      |      |         |     |       |
| **Total**                   |      **60** |      |      |         |     |       |

# Sign-Off

QA Lead signature: ************\_\_\_\_************ Date: ****\_\_\_****

Dev Lead signature: ************\_\_\_************ Date: ****\_\_\_****
