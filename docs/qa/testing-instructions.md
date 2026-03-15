# AI Sprint Manager — Manual Testing Instructions (QA)

This document explains how a human tester should execute the manual test plan and record results.

Files:

- Manual test plan: `docs/qa/manual-test-plan.md`

## 1) Tools you need

- A modern browser (Chrome or Edge recommended)
- Access to:
  - GitHub account (for GitHub OAuth)
  - Google account (for Firebase Google sign-in)
  - Email inbox (for Firebase email sign-up/verification)
  - Jira test site + Jira test project
- Ability to view browser DevTools (Console + Network)

## 2) Environment prerequisites (confirm before testing)

You should be given the following by the dev team:

- Web URL for AI Sprint Manager (example: `http://localhost:3000` or a staging URL)
- Jira integration configured on the backend (OAuth client id/secret)
- Groq key configured for AI features (required for enrichment/summaries)
- Inngest configured and able to receive events
- Neon Postgres configured (required for ML prediction persistence)

If you do not have these, mark affected tests as **BLOCKED** and write what is missing in Notes/Bug ID.

## 3) Test accounts and test data

Create or obtain the following:

- **Tenant/Org A** user (Admin recommended)
- **Tenant/Org B** user (Admin recommended)
- Jira Project for Org A (example key: `QAT-A`)
- Jira Project for Org B (example key: `QAT-B`)

Recommended Jira backlog data per project:

- 10+ backlog issues (Story/Task/Bug mix)
- 2 epics
- 1 issue you will repeatedly update (for webhook + bidirectional tests)

Recommended developer data per org:

- 5+ developers with different tech stacks
- 1 overloaded developer (capacity exceeded)

## 4) How to execute a test case

For each TEST-XXX in `manual-test-plan.md` (or in the Word doc):

1. Read **Preconditions** and confirm they are true.
2. Follow the **Step-by-Step Instructions** exactly.
3. Compare actual behavior to **Expected Result**.
4. Determine PASS/FAIL/BLOCKED/N/A:
   - PASS: meets Pass Criteria exactly
   - FAIL: meets any Fail Criteria, or user-visible error occurs
   - BLOCKED: cannot execute due to environment/data missing
   - N/A: truly not applicable to your environment (rare; explain why)
5. Fill in:
   - Result checkbox
   - Tested By, Date, Build/Version
   - Notes/Bug ID: include bug tracker ID or paste evidence summary

Evidence checklist for failures:

- Screenshot of the UI error state
- Browser Console errors (copy/paste)
- Network request details (status code + endpoint)
- Steps to reproduce

## 5) Navigation map (where modules typically live)

Depending on your build, module locations may differ. Use these common locations:

- Authentication: `/auth/*` routes, Sign In/Sign Up
- Jira Integration: Settings → Integrations → Jira
- Backlog: Backlog page
- Sprint Planning: Sprint → Plan
- Assignment: Assignment page
- Sprint Board: Tasks → Board / Sprint Board
- Standup: Standup page
- Reports: Reports pages
- Monitoring/Alerts: Monitoring pages
- Billing: Settings → Billing

## 6) Notes on AI + Streaming (SSE)

Some AI features stream partial output over time (SSE). During these tests:

- Confirm that text appears incrementally (multiple updates)
- Confirm that the final state is readable and complete
- If the stream stops, check Network tab for the request status and error body

## 7) Notes on ML tests

ML tests may require training before prediction works.

- If there is an Admin/ML UI, use it to train models with the minimum sample counts.
- If there is no UI, coordinate with the dev team to provide a way to trigger training.
- If prediction endpoints return “model not trained yet”, mark the test BLOCKED unless training was already performed.

## 8) Completion and sign-off

After executing all tests:

1. Fill in the summary table (Pass/Fail/Blocked/N/A totals).
2. Compute Pass% per module: `Pass% = Pass / Total Tests * 100`.
3. Review all FAIL/BLOCKED results with the dev team.
4. Obtain signatures in the Sign-Off section.
