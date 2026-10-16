import { beforeEach, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { all, customer, getCall, one, run } from "@/lib/db";
import { start } from "@/lib/simulation/orchestrator";
import { createCase, readCase, scenarioIds } from "@/lib/simulation/cases";
import { exportReport, useReportControls } from "@/lib/demodesk";
import { backend } from "@/lib/tools";
import {
  evaluate,
  hasOutcomeVerification,
  hasVerification,
} from "@/lib/evaluation";
import { snapshot } from "@/lib/snapshot";
import type { EngineeringHandoff, Ticket } from "@/lib/types";

beforeEach(() => {
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "support-lab-challenge-")),
    "test.sqlite",
  );
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "unit-test-only";
});
const handoffInput = {
  severity: "high",
  summary: "Report renderer fails before creating a file",
  customerImpact:
    "Finance cannot download the report needed for today's review.",
  reproductionSteps: [
    "Sign in to the affected workspace.",
    "Open the report and choose Export report.",
  ],
  expectedResult: "A CSV report downloads successfully.",
  actualResult:
    "The report renderer returns REPORT_RENDERER_DEFECT with a request reference.",
};
async function investigate(id: string) {
  await backend.execute(id, "inspect_export_job", {});
  await backend.execute(id, "get_application_logs", {});
  return backend.execute(id, "retry_export", {});
}

it("recreates the entire randomized setup from its saved seed and options", () => {
  const selected = createCase("random", {
    seed: "repeatable-case",
    difficulty: "challenge",
    followUp: true,
  });
  expect(
    createCase(selected.scenarioCase.selection, {
      seed: selected.scenarioCase.seed,
      difficulty: selected.scenarioCase.difficulty,
      followUp: !!selected.scenarioCase.followUp,
    }),
  ).toEqual(selected);
  const families = new Set(
    Array.from(
      { length: 100 },
      (_, index) =>
        createCase("random", {
          seed: `sample-${index}`,
          difficulty: "challenge",
        }).scenario,
    ),
  );
  expect([...families].sort()).toEqual([...scenarioIds].sort());
});
it("does not change physical faults when related follow-ups are toggled", () => {
  const first = createCase("export_multi_fault", {
    seed: "physical-case",
    difficulty: "challenge",
    followUp: false,
  });
  const second = createCase("export_multi_fault", {
    seed: "physical-case",
    difficulty: "challenge",
    followUp: true,
  });
  expect(first.scenarioCase.recoveryFailures).toBe(
    second.scenarioCase.recoveryFailures,
  );
  expect(first.scenarioCase.targetRange).toBe(second.scenarioCase.targetRange);
  expect(first.scenarioCase.followUp).toBeNull();
  expect(second.scenarioCase.followUp).toBeTruthy();
});
it("requires the requested report and a real customer download, not just a generated CSV", async () => {
  const call = start("jules", "report_guidance", 8, {
    seed: "guided-case",
    difficulty: "challenge",
  });
  const goal = readCase(call);
  expect(exportReport("jules").ok).toBe(false);
  useReportControls("jules", {
    action: "choose_range",
    range: goal.targetRange === "q2" ? "q3" : "q2",
  });
  useReportControls("jules", {
    action: "choose_columns",
    columns: goal.targetColumns,
  });
  useReportControls("jules", { action: "apply_preview" });
  expect(useReportControls("jules", { action: "download_report" }).ok).toBe(
    true,
  );
  expect(evaluate(call.id).passed).toBe(false);
  useReportControls("jules", {
    action: "choose_range",
    range: goal.targetRange,
  });
  expect(exportReport("jules").ok).toBe(false);
  useReportControls("jules", { action: "apply_preview" });
  expect(
    await backend.execute(call.id, "verify_fix", { action: "export" }),
  ).toMatchObject({ ok: true });
  expect(hasVerification(call.id)).toBe(false);
  const download = useReportControls("jules", { action: "download_report" });
  expect(download.csv).toContain(goal.targetRange === "q2" ? "April" : "July");
  expect(hasVerification(call.id)).toBe(true);
  expect(getCall(call.id).tool_calls).toBe(1);
  expect(
    snapshot().performance.find((entry) => entry.call_id === call.id)
      ?.customerActions,
  ).toBe(7);
});
it("does not accept a report missing a requested column", () => {
  const call = start("jules", "report_guidance", 8, { seed: "missing-column" });
  const goal = readCase(call);
  useReportControls("jules", {
    action: "choose_range",
    range: goal.targetRange,
  });
  useReportControls("jules", {
    action: "choose_columns",
    columns: ["tickets"],
  });
  useReportControls("jules", { action: "apply_preview" });
  useReportControls("jules", { action: "download_report" });
  expect(evaluate(call.id).passed).toBe(false);
});
it("requires all independent faults to be fixed before a multi-fault export is verified", async () => {
  const call = start("maya", "export_multi_fault", 8, { seed: "compound" });
  await backend.execute(call.id, "update_account_status", { status: "active" });
  expect(
    await backend.execute(call.id, "verify_fix", { action: "login" }),
  ).toMatchObject({ ok: true, verifiedAction: "login" });
  expect(hasVerification(call.id)).toBe(false);
  await backend.execute(call.id, "repair_export_config", {});
  expect(exportReport("maya").ok).toBe(false);
  await backend.execute(call.id, "retry_export", {});
  await backend.execute(call.id, "verify_fix", { action: "export" });
  expect(hasVerification(call.id)).toBe(true);
});
it("keeps a transient recovery failure recoverable and rejects an unsupported engineering escalation", async () => {
  const call = start("oliver", "export_stuck", 6);
  run("UPDATE customers SET recovery_failures=1 WHERE id='oliver'");
  expect(await investigate(call.id)).toMatchObject({
    ok: false,
    code: "EXPORT_WORKER_BUSY",
  });
  expect(
    await backend.execute(call.id, "escalate_to_engineering", handoffInput),
  ).toMatchObject({ ok: false });
  expect(customer("oliver").export_job).toBe("stuck");
  expect(await backend.execute(call.id, "retry_export", {})).toMatchObject({
    ok: true,
  });
  await backend.execute(call.id, "verify_fix", { action: "export" });
  expect(hasVerification(call.id)).toBe(true);
});
it("creates an idempotent evidence-backed engineering handoff while leaving the feature broken", async () => {
  const call = start("oliver", "export_engineering", 8);
  expect(
    await backend.execute(call.id, "escalate_to_engineering", handoffInput),
  ).toMatchObject({ ok: false });
  expect(await investigate(call.id)).toMatchObject({
    ok: false,
    code: "REPORT_RENDERER_DEFECT",
  });
  await backend.execute(call.id, "repair_export_config", {});
  expect(exportReport("oliver").ok).toBe(false);
  const filed = (await backend.execute(
    call.id,
    "escalate_to_engineering",
    handoffInput,
  )) as { id: string };
  expect(filed.id).toMatch(/^ENG-/);
  expect(hasOutcomeVerification(call.id)).toBe(true);
  expect(hasVerification(call.id)).toBe(false);
  expect(
    one<Ticket>("SELECT * FROM tickets WHERE call_id=?", call.id)?.status,
  ).toBe("engineering");
  const evidence = JSON.parse(
    one<EngineeringHandoff>(
      "SELECT * FROM engineering_handoffs WHERE call_id=?",
      call.id,
    )!.evidence,
  );
  expect(
    evidence.some((entry: { tool: string }) => entry.tool === "retry_export"),
  ).toBe(true);
  expect(
    await backend.execute(call.id, "escalate_to_engineering", handoffInput),
  ).toMatchObject({ id: filed.id });
  expect(all("SELECT * FROM engineering_handoffs")).toHaveLength(1);
  expect(
    await backend.execute(call.id, "update_ticket", {
      status: "investigating",
      resolution:
        "Customer understands that engineering will triage the defect.",
    }),
  ).toMatchObject({ ok: true, status: "engineering" });
  expect(
    one<Ticket>("SELECT * FROM tickets WHERE call_id=?", call.id)?.status,
  ).toBe("engineering");
  expect(
    await backend.execute(call.id, "update_ticket", {
      status: "resolved",
      resolution: "The report is fixed.",
    }),
  ).toMatchObject({ ok: false });
});
it("does not borrow reproduction evidence from an earlier call", async () => {
  const first = start("oliver", "export_engineering", 8);
  await investigate(first.id);
  run("UPDATE calls SET status='cancelled' WHERE id=?", first.id);
  const second = start("oliver", "export_engineering", 8);
  expect(
    await backend.execute(second.id, "escalate_to_engineering", handoffInput),
  ).toMatchObject({ ok: false });
});
it("records a failed customer preview separately from support failures", () => {
  const call = start("jules", "report_guidance", 8);
  expect(useReportControls("jules", { action: "apply_preview" }).ok).toBe(
    false,
  );
  const result = snapshot().performance.find(
    (entry) => entry.call_id === call.id,
  )!;
  expect(result.customerActions).toBe(1);
  expect(result.failedCustomerActions).toBe(1);
  expect(result.failedTools).toBe(0);
  expect(result.avoidableActions).toBe(0);
});
it("counts repeated unrecoverable attempts as waste while preserving the first useful reproduction", async () => {
  const call = start("oliver", "export_engineering", 8);
  await investigate(call.id);
  expect(snapshot().performance[0].avoidableActions).toBe(0);
  await backend.execute(call.id, "retry_export", {});
  const result = snapshot().performance[0];
  expect(result.avoidableActions).toBe(1);
  expect(result.failedTools).toBe(2);
  expect(result.completedOutcome).toBe(false);
});
