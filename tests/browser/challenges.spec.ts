import { expect, test } from "@playwright/test";
import type { Call, Snapshot } from "../../lib/types";
import { createCase } from "../../lib/simulation/cases";

test.beforeEach(async ({ request }) => {
  await request.post("/api/lab", {
    data: { action: "reset", preserveKnowledge: false },
  });
});
test("the report builder requires apply and persists the customer's chosen period and columns", async ({
  page,
  request,
}) => {
  await request.post("/api/lab", {
    data: {
      action: "inject",
      customerId: "jules",
      scenario: "report_guidance",
    },
  });
  await page.goto("/demodesk?customer=jules");
  await page.getByRole("button", { name: "Sign in to DemoDesk" }).click();
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  await expect(page.getByTestId("export-result")).toContainText(
    "Apply the preview",
  );
  await page.getByLabel("Date range", { exact: true }).selectOption("q2");
  await page.getByLabel("Revenue", { exact: true }).check();
  await page
    .getByRole("button", { name: "Apply preview", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "April", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "January", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  await expect(page.getByTestId("export-result")).toContainText(
    "generated successfully",
  );
  const href = await page
    .getByRole("link", { name: "Download CSV" })
    .getAttribute("href");
  expect(decodeURIComponent(href!)).toContain("month,revenue\nApril");
  await page.reload();
  await page.getByRole("button", { name: "Sign in to DemoDesk" }).click();
  await expect(page.getByLabel("Date range", { exact: true })).toHaveValue(
    "q2",
  );
  await expect(page.getByLabel("Revenue", { exact: true })).toBeChecked();
  await expect(
    page.getByLabel("Support tickets", { exact: true }),
  ).not.toBeChecked();
  await page.screenshot({
    path: "artifacts/demodesk-report-builder.png",
    fullPage: true,
  });
});
test("the deliberately broken renderer stays broken after changing report settings and retrying", async ({
  page,
  request,
}) => {
  await request.post("/api/lab", {
    data: {
      action: "inject",
      customerId: "oliver",
      scenario: "export_engineering",
    },
  });
  await page.goto("/demodesk?customer=oliver");
  await page.getByRole("button", { name: "Sign in to DemoDesk" }).click();
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  await expect(page.getByTestId("export-result")).toContainText(
    "REQ-OLIVER-RPT-502",
  );
  await page.getByLabel("Date range", { exact: true }).selectOption("q3");
  await page
    .getByRole("button", { name: "Apply preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  await expect(page.getByTestId("export-result")).toContainText(
    "could not be generated",
  );
});
test("engineering is a correct handoff rather than a claimed repair, and the case can be reused", async ({
  page,
  request,
}) => {
  const data: Snapshot = await (await request.get("/api/lab")).json();
  const variant = createCase("export_engineering", {
    seed: "repeat-engineering",
    difficulty: "challenge",
    followUp: true,
  }).scenarioCase;
  const now = new Date().toISOString();
  const call: Call = {
    id: "engineering-ui",
    customer_id: "oliver",
    scenario: "export_engineering",
    status: "escalated",
    turns: 2,
    max_turns: 8,
    tool_calls: 8,
    escalations: 0,
    knowledge_used: 0,
    workflow_used: 0,
    verified: 0,
    repair_verified: 0,
    outcome_verified: 1,
    outcome: "engineering_handoff",
    closing_customer_message_id: 2,
    scenario_seed: variant.seed,
    scenario_case: JSON.stringify(variant),
    error: null,
    learning_status: "Engineering handoff verified; no repair workflow learned",
    batch: 1,
    started_at: now,
    ended_at: now,
    busy_until: 0,
  };
  data.calls = [call];
  data.messages = [];
  data.activities = [];
  data.completionChecks = [];
  data.engineering = [
    {
      id: "ENG-TEST",
      call_id: call.id,
      ticket_id: "T-TEST",
      customer_id: "oliver",
      status: "open",
      severity: "high",
      summary: "Report renderer fails before download",
      customer_impact: "Finance cannot obtain today's report.",
      reproduction_steps: JSON.stringify([
        "Sign in to the workspace.",
        "Choose Export report.",
      ]),
      expected_result: "A CSV downloads.",
      actual_result: "Renderer fails with REQ-OLIVER-RPT-502.",
      evidence: JSON.stringify([
        {
          tool: "retry_export",
          result: { ok: false, code: "REPORT_RENDERER_DEFECT" },
        },
      ]),
      created_at: now,
    },
  ];
  await page.route("**/api/lab", (route) => route.fulfill({ json: data }));
  await page.goto("/");
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await expect(
    page.getByText("0 resolved · 1 engineering handoffs", { exact: true }),
  ).toBeVisible();
  const queue = page.getByRole("region", {
    name: "Engineering queue",
    exact: true,
  });
  await queue
    .getByText("ENG-TEST · Report renderer fails before download", {
      exact: true,
    })
    .click();
  await expect(queue).toContainText("Finance cannot obtain today's report");
  await queue.getByRole("button", { name: "View source conversation" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Engineering handoff verified · feature remains broken",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reuse this case", exact: true })
    .click();
  await expect(page.getByLabel("Case seed", { exact: true })).toHaveValue(
    "repeat-engineering",
  );
  await expect(page.getByLabel("Variation level", { exact: true })).toHaveValue(
    "challenge",
  );
});
