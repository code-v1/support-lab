import { expect, test } from "@playwright/test";
import type { Call, Snapshot } from "../../lib/types";

test("shows a verified repair as incomplete while the customer's export question remains", async ({
  page,
  request,
}) => {
  const snapshot: Snapshot = await (await request.get("/api/lab")).json();
  const call: Call = {
    id: "completion-ui-test",
    customer_id: "oliver",
    scenario: "export_config",
    status: "incomplete",
    turns: 4,
    max_turns: 4,
    tool_calls: 12,
    escalations: 1,
    knowledge_used: 0,
    workflow_used: 0,
    verified: 0,
    repair_verified: 1,
    closing_customer_message_id: null,
    error:
      "Turn limit reached: repair verified, but customer completion is not confirmed. Ticket escalated for follow-up.",
    learning_status: "Skipped: conversation not resolved",
    batch: 1,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    busy_until: 0,
  };
  snapshot.calls = [call];
  snapshot.messages = [
    {
      id: 1,
      call_id: call.id,
      role: "support",
      text: "Verification passed. Let me close out the ticket.",
      created_at: call.started_at,
    },
    {
      id: 2,
      call_id: call.id,
      role: "customer",
      text: "Could you confirm whether the earlier failed export is resolved, or whether there's still something I should retry?",
      created_at: call.started_at,
    },
  ];
  snapshot.completionChecks = [
    {
      id: 1,
      call_id: call.id,
      customer_message_id: 2,
      customer_satisfied: 0,
      explanation_complete: 0,
      evidence_supported: 1,
      open_questions: JSON.stringify([
        "Is the original failure resolved, and do I need to retry?",
      ]),
      reason:
        "Oliver still needs an explanation of the repair and whether he should retry.",
      created_at: call.started_at,
    },
  ];
  snapshot.activities = [];
  snapshot.configuration.ready = true;
  snapshot.configuration.missing = [];
  await page.route("**/api/lab", (route) => route.fulfill({ json: snapshot }));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Simulation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Incomplete · follow-up required" }),
  ).toBeVisible();
  await expect(
    page.getByText("Repair verified · customer completion not confirmed", {
      exact: true,
    }),
  ).toBeVisible();
  const check = page.getByRole("region", { name: "Customer completion check" });
  await expect(check).toContainText("Oliver still needs an explanation");
  await expect(check).toContainText("do I need to retry?");
  await expect(page.locator(".transcript-footer")).toContainText(
    "Conversation ended",
  );
  await page.screenshot({
    path: "artifacts/support-lab-incomplete.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await expect(page.getByText("incomplete", { exact: true })).toBeVisible();
});
test("pauses on an internal reviewer error and offers review retry without generating dialogue", async ({
  page,
  request,
}) => {
  const snapshot: Snapshot = await (await request.get("/api/lab")).json();
  const now = new Date().toISOString();
  snapshot.calls = [
    {
      id: "paused-review-test",
      customer_id: "jules",
      scenario: "export_stuck",
      status: "paused",
      turns: 1,
      max_turns: 4,
      tool_calls: 5,
      escalations: 0,
      knowledge_used: 0,
      workflow_used: 0,
      verified: 0,
      repair_verified: 1,
      closing_customer_message_id: null,
      error: "Completion review unavailable",
      learning_status: "pending",
      batch: 1,
      started_at: now,
      ended_at: null,
      busy_until: 0,
    },
  ];
  snapshot.messages = [
    {
      id: 1,
      call_id: "paused-review-test",
      role: "support",
      text: "Your report is ready now.",
      created_at: now,
    },
    {
      id: 2,
      call_id: "paused-review-test",
      role: "customer",
      text: "Okay, thanks.",
      created_at: now,
    },
  ];
  snapshot.completionChecks = [
    {
      id: 1,
      call_id: "paused-review-test",
      customer_message_id: 2,
      customer_satisfied: 0,
      explanation_complete: 0,
      evidence_supported: 0,
      open_questions: "[]",
      reason: "Provider output could not be checked.",
      assessment_error: "Provider output could not be checked.",
      created_at: now,
    },
  ];
  snapshot.activities = [];
  snapshot.configuration.ready = true;
  snapshot.configuration.missing = [];
  let posts = 0;
  await page.route("**/api/lab", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Live Simulation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Completion review unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry completion review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Customer follow-up", exact: true }),
  ).not.toBeVisible();
  await page.waitForTimeout(600);
  expect(posts).toBe(0);
});
