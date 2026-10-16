import { beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("@/lib/agents/customer", () => ({
  customerMessage: vi.fn(async () => "I cannot sign in to my account."),
}));
vi.mock("@/lib/agents/support", () => ({
  supportMessage: vi.fn(async () => "Let me investigate your account."),
}));
vi.mock("@/lib/learning", () => ({ learn: vi.fn(async () => undefined) }));
vi.mock("@/lib/evaluation/conversation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/evaluation/conversation")>();
  return { ...actual, assessCompletion: vi.fn() };
});
import { customerMessage } from "@/lib/agents/customer";
import { supportMessage } from "@/lib/agents/support";
import { learn } from "@/lib/learning";
import { assessCompletion } from "@/lib/evaluation/conversation";
import { all, getCall, run } from "@/lib/db";
import { backend } from "@/lib/tools";
import { start, step } from "@/lib/simulation/orchestrator";
import { readCase } from "@/lib/simulation/cases";
import { useReportControls } from "@/lib/demodesk";
import type { Ticket } from "@/lib/types";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(customerMessage).mockImplementation(
    async () => "I cannot sign in to my account.",
  );
  vi.mocked(supportMessage).mockImplementation(
    async () => "Let me investigate your account.",
  );
  vi.mocked(learn).mockResolvedValue(undefined);
  vi.mocked(assessCompletion).mockResolvedValue({
    customerSatisfied: true,
    explanationComplete: true,
    evidenceSupported: true,
    openQuestions: [],
    reason:
      "Customer accepts the verified repair and has no remaining questions.",
  });
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "support-lab-orchestrator-")),
    "test.sqlite",
  );
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "unit-test-only";
});
it("produces one speaker per step so browser voice can finish before the next agent", async () => {
  const c = start("maya", "account_locked", 4);
  await step(c.id);
  expect(customerMessage).toHaveBeenCalledOnce();
  expect(supportMessage).not.toHaveBeenCalled();
  expect(all("SELECT id FROM messages WHERE call_id=?", c.id)).toHaveLength(1);
  await step(c.id);
  expect(supportMessage).toHaveBeenCalledOnce();
  expect(getCall(c.id).turns).toBe(1);
});
it("escalates after two unresolved support turns and allows a final customer response at the limit", async () => {
  const c = start("maya", "account_locked", 4);
  for (let i = 0; i < 8; i++) await step(c.id);
  expect(getCall(c.id).status).toBe("running");
  await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "incomplete",
    verified: 0,
    turns: 4,
    escalations: 1,
  });
  expect(learn).not.toHaveBeenCalled();
});
it("closes a real ticket and runs learning only after verification and customer confirmation", async () => {
  vi.mocked(customerMessage)
    .mockResolvedValueOnce("I cannot sign in.")
    .mockResolvedValueOnce(
      "Sign-in works now. That answers my questions, thank you.",
    );
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    await backend.execute(id, "get_account_status", {});
    await backend.execute(id, "update_account_status", { status: "active" });
    await backend.execute(id, "verify_fix", {});
    return "I unlocked your account and verified that sign-in works.";
  });
  const c = start("maya", "account_locked", 4);
  await step(c.id);
  await step(c.id);
  expect(getCall(c.id).status).toBe("running");
  await step(c.id);
  expect(getCall(c.id).closing_customer_message_id).toBeTruthy();
  expect(getCall(c.id).status).toBe("running");
  expect(learn).not.toHaveBeenCalled();
  await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "resolved",
    verified: 1,
    repair_verified: 1,
    busy_until: 0,
  });
  expect(
    all<Ticket>("SELECT * FROM tickets WHERE call_id=?", c.id)[0].status,
  ).toBe("resolved");
  expect(learn).toHaveBeenCalledWith(c.id);
  expect(
    all<Ticket>("SELECT * FROM tickets WHERE call_id=?", c.id)[0].resolution,
  ).toContain("update_account_status");
  const closing = all<{ text: string }>(
    "SELECT text FROM messages WHERE call_id=? AND kind='closing'",
    c.id,
  );
  expect(closing).toHaveLength(1);
  expect(closing[0].text).toContain("You're all set, Maya");
  expect(closing[0].text).not.toContain("?");
  expect(supportMessage).toHaveBeenCalledOnce();
  await expect(step(c.id)).rejects.toThrow("complete");
});
it("closes a coached task with actual customer control evidence in the ticket", async () => {
  vi.mocked(customerMessage)
    .mockResolvedValueOnce("How do I build and download my report?")
    .mockImplementationOnce(async (id) => {
      const call = getCall(id),
        goal = readCase(call);
      useReportControls(call.customer_id, {
        action: "choose_range",
        range: goal.targetRange,
      });
      useReportControls(call.customer_id, {
        action: "choose_columns",
        columns: goal.targetColumns,
      });
      useReportControls(call.customer_id, { action: "apply_preview" });
      useReportControls(call.customer_id, { action: "download_report" });
      return "I downloaded the correct report, thanks.";
    });
  vi.mocked(supportMessage).mockResolvedValue(
    "Choose the quarter and columns, apply the preview, then export your report.",
  );
  const call = start("jules", "report_guidance", 4);
  for (let index = 0; index < 4; index++) await step(call.id);
  expect(getCall(call.id).status).toBe("resolved");
  const ticket = all<Ticket>(
    "SELECT * FROM tickets WHERE call_id=?",
    call.id,
  )[0];
  expect(ticket.resolution).toContain("customer.choose_range");
  expect(ticket.resolution).toContain(readCase(call).targetRange);
  expect(ticket.resolution).toContain("customer.download_report");
  expect(ticket.resolution).not.toContain("repair evidence: []");
});
it("does not trust a model saying it solved the issue", async () => {
  vi.mocked(supportMessage).mockResolvedValue("Everything is resolved.");
  const c = start("maya", "account_locked", 2);
  for (let i = 0; i < 5; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({ status: "incomplete", verified: 0 });
  expect(assessCompletion).not.toHaveBeenCalled();
  expect(learn).not.toHaveBeenCalled();
});
it("records provider errors as failed calls without fabricating a resolution", async () => {
  vi.mocked(customerMessage).mockRejectedValueOnce(
    new Error("Provider rejected API key"),
  );
  const c = start("maya", "account_locked", 4);
  await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "failed",
    verified: 0,
    error: "Provider rejected API key",
    busy_until: 0,
  });
});
it("preserves a verified fix if the learning provider fails", async () => {
  vi.mocked(customerMessage)
    .mockResolvedValueOnce("I cannot sign in.")
    .mockResolvedValueOnce(
      "I can sign in and understand the repair. Thank you.",
    );
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    await backend.execute(id, "update_account_status", { status: "active" });
    await backend.execute(id, "verify_fix", {});
    return "Sign-in is verified.";
  });
  vi.mocked(learn).mockRejectedValueOnce(
    new Error("Learning provider timed out"),
  );
  const c = start("maya", "account_locked", 4);
  for (let i = 0; i < 4; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "resolved",
    verified: 1,
    learning_status: "Learning failed; retry available",
  });
});
it.each([
  {
    customer: "maya",
    scenario: "account_locked" as const,
    firstReply:
      "Your DemoDesk account is back up. Be careful with your password attempts.",
    followup:
      "Oh, good, I can get in now and see my dashboard. Thank you. I'm still a bit worried, though. Why did it lock in the first place? I haven't been changing anything on my end.",
    question: "Why did the account lock, and who made the failed attempts?",
    answer:
      "Failed sign-in attempts triggered the lock, which I removed and verified. I should not have implied those were your attempts: the logs do not show who made them.",
    resolution:
      "Unlocked the locked account and verified successful sign-in. Logs show repeated failed attempts without identifying the actor.",
  },
  {
    customer: "oliver",
    scenario: "export_config" as const,
    firstReply: "Verification passed. Let me close out the ticket.",
    followup:
      "Hi, thanks for closing that out, but the export I'm looking at right now actually shows \"My CSV report downloaded successfully,\" so I'm not sure what ticket was closed. My original issue was the export failing with a message to contact support. Could you confirm whether the earlier failed export is resolved, or whether there's still something I should retry?",
    question:
      "Is the original export failure resolved, and do I need to retry?",
    answer:
      "The report was using an unsupported format. I restored CSV and reran the export successfully; your downloaded report confirms the repair, and you do not need to retry now.",
    resolution:
      "Repaired unsupported legacy_xml output to CSV, reran the export and verified EXPORT_COMPLETED.",
  },
])(
  "keeps $customer's actual follow-up open, answers it and preserves the repair notes",
  async (example) => {
    vi.mocked(customerMessage)
      .mockResolvedValueOnce("My account action is failing. Please help.")
      .mockResolvedValueOnce(example.followup)
      .mockResolvedValueOnce(
        "That explains it. Everything works and I have what I need, thank you.",
      );
    vi.mocked(assessCompletion).mockResolvedValueOnce({
      customerSatisfied: false,
      explanationComplete: false,
      evidenceSupported: example.customer !== "maya",
      openQuestions: [example.question],
      reason: example.question,
    });
    vi.mocked(supportMessage)
      .mockImplementationOnce(async (id) => {
        await backend.execute(id, "create_ticket", {
          subject: "Customer needs help",
        });
        if (example.scenario === "account_locked")
          await backend.execute(id, "update_account_status", {
            status: "active",
          });
        else {
          await backend.execute(id, "repair_export_config", {});
          await backend.execute(id, "retry_export", {});
        }
        await backend.execute(id, "verify_fix", {});
        await backend.execute(id, "update_ticket", {
          status: "investigating",
          resolution: example.resolution,
        });
        expect(
          await backend.execute(id, "update_ticket", {
            status: "resolved",
            resolution: example.resolution,
          }),
        ).toMatchObject({ ok: false });
        return example.firstReply;
      })
      .mockResolvedValueOnce(example.answer);
    const c = start(example.customer, example.scenario, 4);
    for (let i = 0; i < 3; i++) await step(c.id);
    expect(getCall(c.id)).toMatchObject({
      status: "running",
      repair_verified: 1,
      verified: 0,
      turns: 1,
    });
    expect(
      all<Ticket>("SELECT * FROM tickets WHERE call_id=?", c.id)[0],
    ).toMatchObject({
      status: "investigating",
      resolution: example.resolution,
    });
    expect(learn).not.toHaveBeenCalled();
    expect(
      all("SELECT * FROM completion_checks WHERE call_id=?", c.id),
    ).toHaveLength(1);
    await step(c.id);
    expect(getCall(c.id).turns).toBe(2);
    expect(
      all<{ text: string }>(
        "SELECT text FROM messages WHERE call_id=? AND role='support' ORDER BY id",
        c.id,
      ).at(-1)?.text,
    ).toBe(example.answer);
    await step(c.id);
    expect(getCall(c.id).closing_customer_message_id).toBeTruthy();
    await step(c.id);
    expect(getCall(c.id)).toMatchObject({
      status: "resolved",
      turns: 2,
      verified: 1,
      repair_verified: 1,
    });
    expect(
      all<Ticket>("SELECT * FROM tickets WHERE call_id=?", c.id)[0],
    ).toMatchObject({ status: "resolved", resolution: example.resolution });
    expect(learn).toHaveBeenCalledOnce();
  },
);
it("marks a verified repair incomplete when the final customer still has a question", async () => {
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    if (getCall(id).turns === 1) {
      await backend.execute(id, "create_ticket", { subject: "Account access" });
      await backend.execute(id, "update_account_status", { status: "active" });
      await backend.execute(id, "verify_fix", {});
    }
    return "Sign-in works now, but I have not answered your concern.";
  });
  vi.mocked(customerMessage).mockResolvedValue(
    "I can sign in, but please explain who made the attempts.",
  );
  vi.mocked(assessCompletion).mockResolvedValue({
    customerSatisfied: false,
    explanationComplete: false,
    evidenceSupported: true,
    openQuestions: ["Who made the attempts?"],
    reason: "Customer still has a question.",
  });
  const c = start("maya", "account_locked", 2);
  for (let i = 0; i < 5; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "incomplete",
    repair_verified: 1,
    verified: 0,
    turns: 2,
    error: expect.stringContaining("customer completion is not confirmed"),
  });
  expect(
    all<Ticket>("SELECT * FROM tickets WHERE call_id=?", c.id)[0].status,
  ).toBe("escalated");
  expect(learn).not.toHaveBeenCalled();
});
it("can resolve on the final allowed response after the customer confirms", async () => {
  vi.mocked(customerMessage)
    .mockResolvedValueOnce("I cannot sign in.")
    .mockResolvedValueOnce("I still cannot sign in.")
    .mockResolvedValueOnce(
      "It works now, and your explanation answers my questions. Thank you.",
    );
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    if (getCall(id).turns === 2) {
      await backend.execute(id, "update_account_status", { status: "active" });
      await backend.execute(id, "verify_fix", {});
    }
    return "The account lock was removed and sign-in has passed verification.";
  });
  const c = start("maya", "account_locked", 2);
  for (let i = 0; i < 6; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "resolved",
    turns: 2,
    verified: 1,
  });
});
it("does not close when the completion assessor fails", async () => {
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    await backend.execute(id, "update_account_status", { status: "active" });
    await backend.execute(id, "verify_fix", {});
    return "Sign-in is restored and verified.";
  });
  vi.mocked(assessCompletion).mockRejectedValueOnce(
    new Error("Completion provider unavailable " + "details ".repeat(150)),
  );
  const c = start("maya", "account_locked", 4);
  for (let i = 0; i < 3; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "paused",
    repair_verified: 1,
    verified: 0,
  });
  expect(
    all<{ reason: string }>(
      "SELECT reason FROM completion_checks WHERE call_id=?",
      c.id,
    )[0].reason,
  ).toContain("Completion provider unavailable");
  expect(
    all<{ reason: string }>(
      "SELECT reason FROM completion_checks WHERE call_id=?",
      c.id,
    )[0].reason.length,
  ).toBeLessThanOrEqual(600);
  expect(learn).not.toHaveBeenCalled();
  const messageCount = all(
    "SELECT id FROM messages WHERE call_id=? AND role!='system'",
    c.id,
  ).length;
  run("UPDATE calls SET status='running' WHERE id=?", c.id);
  await step(c.id);
  expect(getCall(c.id).closing_customer_message_id).toBeTruthy();
  expect(
    all("SELECT id FROM messages WHERE call_id=? AND role!='system'", c.id),
  ).toHaveLength(messageCount);
  expect(customerMessage).toHaveBeenCalledTimes(2);
  expect(supportMessage).toHaveBeenCalledOnce();
  await step(c.id);
  expect(getCall(c.id).status).toBe("resolved");
  expect(
    all("SELECT id FROM messages WHERE call_id=? AND kind='closing'", c.id),
  ).toHaveLength(1);
});
it("does not finish or learn when cancelled during the completion assessment", async () => {
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    await backend.execute(id, "update_account_status", { status: "active" });
    await backend.execute(id, "verify_fix", {});
    return "Sign-in is restored and verified.";
  });
  vi.mocked(assessCompletion).mockImplementationOnce(async (id) => {
    run("UPDATE calls SET status='cancelled' WHERE id=?", id);
    return {
      customerSatisfied: true,
      explanationComplete: true,
      evidenceSupported: true,
      openQuestions: [],
      reason: "Satisfied",
    };
  });
  const c = start("maya", "account_locked", 4);
  for (let i = 0; i < 3; i++) await step(c.id);
  expect(getCall(c.id).status).toBe("cancelled");
  expect(
    all("SELECT id FROM completion_checks WHERE call_id=?", c.id),
  ).toHaveLength(0);
  expect(learn).not.toHaveBeenCalled();
});
it("rejects concurrent or paused steps", async () => {
  const c = start("maya", "account_locked", 4);
  run("UPDATE calls SET busy_until=? WHERE id=?", Date.now() + 60000, c.id);
  await expect(step(c.id)).rejects.toThrow("already processing");
  run("UPDATE calls SET busy_until=0,status='paused' WHERE id=?", c.id);
  await expect(step(c.id)).rejects.toThrow("paused");
});
it("finishes a customer-accepted engineering handoff without claiming a fix or learning a repair", async () => {
  vi.mocked(customerMessage)
    .mockResolvedValueOnce("The report still fails, and I need it for finance.")
    .mockResolvedValueOnce(
      "I understand engineering will investigate. I'll wait for the ticket update, thanks.",
    );
  vi.mocked(supportMessage).mockImplementationOnce(async (id) => {
    await backend.execute(id, "inspect_export_job", {});
    await backend.execute(id, "get_application_logs", {});
    await backend.execute(id, "retry_export", {});
    const handoff = (await backend.execute(id, "escalate_to_engineering", {
      severity: "high",
      summary: "Report rendering fails before download",
      customerImpact:
        "The customer cannot download the report needed for finance.",
      reproductionSteps: [
        "Sign in to the affected account.",
        "Open the report and choose Export report.",
      ],
      expectedResult: "CSV downloads successfully.",
      actualResult: "Renderer fails with a request reference.",
    })) as { id: string };
    return `The report is not fixed. Engineering case ${handoff.id} is pending triage; updates will be on your support ticket, and there is no confirmed repair time.`;
  });
  const current = start("oliver", "export_engineering", 4);
  for (let index = 0; index < 4; index++) await step(current.id);
  expect(getCall(current.id)).toMatchObject({
    status: "escalated",
    verified: 0,
    repair_verified: 0,
    outcome_verified: 1,
    outcome: "engineering_handoff",
  });
  expect(
    all<Ticket>("SELECT * FROM tickets WHERE call_id=?", current.id)[0].status,
  ).toBe("engineering");
  const closing = all<{ text: string }>(
    "SELECT text FROM messages WHERE call_id=? AND kind='closing'",
    current.id,
  );
  expect(closing).toHaveLength(1);
  expect(closing[0].text).toContain("case is with engineering");
  expect(closing[0].text).not.toContain("You're all set");
  expect(learn).not.toHaveBeenCalled();
});
