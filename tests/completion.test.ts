import { beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));
import {
  assessCompletion,
  hasCustomerConfirmation,
  recordCompletion,
} from "@/lib/evaluation/conversation";
import { addMessage, start } from "@/lib/simulation/orchestrator";
import { all, run } from "@/lib/db";
import { backend } from "@/lib/tools";

const accepted = {
  customerSatisfied: true,
  explanationComplete: true,
  evidenceSupported: true,
  openQuestions: [] as string[],
  reason: "Customer accepts the explained and verified repair.",
};
beforeEach(() => {
  vi.resetAllMocks();
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "support-lab-completion-")),
    "test.sqlite",
  );
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "unit-test-only";
});
it.each([
  { customerSatisfied: false },
  { explanationComplete: false },
  { evidenceSupported: false },
  { openQuestions: ["It works, but do I need to retry?"] },
])(
  "requires every completion condition, including $openQuestions",
  (missing) => {
    const call = start("maya", "account_locked", 4);
    addMessage(call.id, "support", "Your sign-in works now.");
    const messageId = addMessage(
      call.id,
      "customer",
      "Thanks, but explain what happened.",
    );
    recordCompletion(call.id, messageId, { ...accepted, ...missing });
    expect(hasCustomerConfirmation(call.id)).toBe(false);
  },
);
it("binds confirmation to the latest customer message in the same call", () => {
  const call = start("maya", "account_locked", 4);
  addMessage(
    call.id,
    "support",
    "I unlocked the account and verified sign-in.",
  );
  const messageId = addMessage(
    call.id,
    "customer",
    "That answers everything. Thank you.",
  );
  recordCompletion(call.id, messageId, accepted);
  expect(hasCustomerConfirmation(call.id)).toBe(true);
  addMessage(call.id, "system", "Administrative note.");
  expect(hasCustomerConfirmation(call.id)).toBe(true);
  addMessage(call.id, "customer", "Actually, I still need help with this.");
  expect(hasCustomerConfirmation(call.id)).toBe(false);
  run("UPDATE calls SET status='cancelled' WHERE id=?", call.id);
  const other = start("oliver", "account_locked", 4);
  expect(() => recordCompletion(other.id, messageId, accepted)).toThrow(
    "from this call",
  );
});
it("does not carry an old confirmation over a later support response", () => {
  const call = start("maya", "account_locked", 4);
  addMessage(call.id, "support", "I unlocked and verified the account.");
  const messageId = addMessage(call.id, "customer", "Everything is resolved.");
  recordCompletion(call.id, messageId, accepted);
  addMessage(call.id, "support", "I need to clarify an earlier statement.");
  expect(hasCustomerConfirmation(call.id)).toBe(false);
});
it("binds the final closing statement to the exact accepted customer response", () => {
  const call = start("maya", "account_locked", 4);
  addMessage(call.id, "support", "I unlocked the account. Sign-in works now.");
  const id = addMessage(call.id, "customer", "Okay, thank you.");
  recordCompletion(call.id, id, accepted);
  run("UPDATE calls SET closing_customer_message_id=? WHERE id=?", id, call.id);
  addMessage(
    call.id,
    "support",
    "You're all set, Maya. Have a good day.",
    "closing",
  );
  expect(hasCustomerConfirmation(call.id)).toBe(true);
  addMessage(call.id, "support", "Actually, I need to ask something new.");
  expect(hasCustomerConfirmation(call.id)).toBe(false);
});
it("runs a separate structured assessment on the actual transcript and tool evidence, and records usage", async () => {
  const call = start("maya", "account_locked", 4);
  await backend.execute(call.id, "get_application_logs", {});
  await backend.execute(call.id, "update_account_status", { status: "active" });
  await backend.execute(call.id, "verify_fix", {});
  addMessage(
    call.id,
    "support",
    "The account is back up. Be careful with your password attempts.",
  );
  addMessage(
    call.id,
    "customer",
    "Thanks, but why did it lock? I haven't changed anything.",
  );
  const decision = {
    ...accepted,
    customerSatisfied: false,
    evidenceSupported: false,
    openQuestions: ["Why did it lock?"],
    reason:
      "The customer still has a concern; the logs do not identify who made the attempts.",
  };
  vi.mocked(generateText).mockResolvedValue({
    toolCalls: [{ toolName: "submit_completion", input: decision }],
    totalUsage: { inputTokens: 200, outputTokens: 90 },
  } as never);
  expect(await assessCompletion(call.id)).toEqual(decision);
  const options = vi.mocked(generateText).mock.calls[0][0];
  const input = JSON.parse(options.prompt as string);
  expect(input.transcript.at(-1).text).toContain("why did it lock");
  expect(input.evidence[0].tool).toBe("get_application_logs");
  expect(options.system).toContain(
    "Thanks or a working action followed by a concern",
  );
  expect(options.system).toContain("do not identify who made them");
  expect(options.system).toContain(
    "Verification passed. Let me close out the ticket.",
  );
  expect(JSON.stringify(input)).not.toContain('"scenario"');
  expect(
    all(
      "SELECT role,input_tokens,output_tokens FROM usage WHERE call_id=?",
      call.id,
    ),
  ).toMatchObject([
    { role: "completion", input_tokens: 200, output_tokens: 90 },
  ]);
});
it("rejects malformed completion output rather than treating it as acceptance", async () => {
  const call = start("maya", "account_locked", 4);
  await backend.execute(call.id, "update_account_status", { status: "active" });
  await backend.execute(call.id, "verify_fix", {});
  addMessage(
    call.id,
    "support",
    "The account is unlocked and sign-in is verified.",
  );
  addMessage(call.id, "customer", "Okay, thanks.");
  vi.mocked(generateText).mockResolvedValue({
    toolCalls: [
      { toolName: "submit_completion", input: { customerSatisfied: "yes" } },
    ],
    totalUsage: {},
  } as never);
  await expect(assessCompletion(call.id)).rejects.toThrow();
  expect(hasCustomerConfirmation(call.id)).toBe(false);
});
it("does not assess acceptance before the application repair is verified", async () => {
  const call = start("maya", "account_locked", 4);
  await expect(assessCompletion(call.id)).rejects.toThrow(
    "verified application resolution or engineering handoff",
  );
  expect(generateText).not.toHaveBeenCalled();
});
it("uses the Advanced reviewer when Fast returns an invalid structured decision", async () => {
  const call = start("jules", "export_stuck", 4);
  await backend.execute(call.id, "retry_export", {});
  await backend.execute(call.id, "verify_fix", {});
  addMessage(
    call.id,
    "support",
    "The old export stalled. I cleared it, and your report is ready.",
  );
  addMessage(
    call.id,
    "customer",
    "Thanks, that helps. I'll reach out if it happens again.",
  );
  vi.mocked(generateText)
    .mockResolvedValueOnce({
      toolCalls: [],
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    } as never)
    .mockResolvedValueOnce({
      toolCalls: [{ toolName: "submit_completion", input: accepted }],
      totalUsage: { inputTokens: 20, outputTokens: 10 },
    } as never);
  expect(await assessCompletion(call.id)).toEqual(accepted);
  expect(all("SELECT profile FROM usage WHERE call_id=?", call.id)).toEqual([
    { profile: "fast" },
    { profile: "advanced" },
  ]);
  expect(generateText).toHaveBeenCalledTimes(2);
});
it("consults Advanced for an ambiguous okay without inventing a follow-up", async () => {
  const call = start("maya", "account_locked", 4);
  await backend.execute(call.id, "update_account_status", { status: "active" });
  await backend.execute(call.id, "verify_fix", {});
  addMessage(call.id, "support", "I unlocked your account. Sign-in works now.");
  addMessage(call.id, "customer", "Okay.");
  vi.mocked(generateText)
    .mockResolvedValueOnce({
      toolCalls: [
        {
          toolName: "submit_completion",
          input: { ...accepted, customerSatisfied: false },
        },
      ],
      totalUsage: {},
    } as never)
    .mockResolvedValueOnce({
      toolCalls: [{ toolName: "submit_completion", input: accepted }],
      totalUsage: {},
    } as never);
  expect(await assessCompletion(call.id)).toEqual(accepted);
  expect(generateText).toHaveBeenCalledTimes(2);
});
it.each(["tool", "json"])(
  "accepts a valid %s decision with an overlong display explanation",
  async (format) => {
    const call = start("maya", "account_locked", 4);
    await backend.execute(call.id, "update_account_status", {
      status: "active",
    });
    await backend.execute(call.id, "verify_fix", {});
    addMessage(
      call.id,
      "support",
      "Your account is unlocked and sign-in works.",
    );
    addMessage(call.id, "customer", "Okay, thank you.");
    const decision = {
      ...accepted,
      reason: "The customer accepts the verified repair. ".repeat(50),
    };
    vi.mocked(generateText).mockResolvedValue({
      toolCalls:
        format === "tool"
          ? [{ toolName: "submit_completion", input: decision }]
          : [],
      text:
        format === "json"
          ? "```json\n" + JSON.stringify(decision) + "\n```"
          : "",
      totalUsage: {},
      finishReason: "stop",
    } as never);
    const reviewed = await assessCompletion(call.id);
    expect(reviewed.customerSatisfied).toBe(true);
    expect(reviewed.reason).toHaveLength(600);
    expect(generateText).toHaveBeenCalledOnce();
  },
);
