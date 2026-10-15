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
import { customerMessage } from "@/lib/agents/customer";
import { supportMessage } from "@/lib/agents/support";
import { learn } from "@/lib/learning";
import { all, getCall, run } from "@/lib/db";
import { backend } from "@/lib/tools";
import { start, step } from "@/lib/simulation/orchestrator";
import type { Ticket } from "@/lib/types";
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(customerMessage).mockImplementation(
    async () => "I cannot sign in to my account.",
  );
  vi.mocked(supportMessage).mockImplementation(
    async () => "Let me investigate your account.",
  );
  vi.mocked(learn).mockResolvedValue(undefined);
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
it("escalates after two unresolved support turns and stops at the turn limit", async () => {
  const c = start("maya", "account_locked", 4);
  for (let i = 0; i < 8; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "failed",
    verified: 0,
    turns: 4,
    escalations: 1,
  });
  expect(learn).not.toHaveBeenCalled();
});
it("closes a real ticket and runs learning only after an observed fix passes", async () => {
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
  expect(getCall(c.id)).toMatchObject({
    status: "resolved",
    verified: 1,
    busy_until: 0,
  });
  expect(
    all<Ticket>("SELECT * FROM tickets WHERE call_id=?", c.id)[0].status,
  ).toBe("resolved");
  expect(learn).toHaveBeenCalledWith(c.id);
});
it("does not trust a model saying it solved the issue", async () => {
  vi.mocked(supportMessage).mockResolvedValue("Everything is resolved.");
  const c = start("maya", "account_locked", 2);
  for (let i = 0; i < 4; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({ status: "failed", verified: 0 });
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
  vi.mocked(supportMessage).mockImplementation(async (id) => {
    await backend.execute(id, "update_account_status", { status: "active" });
    await backend.execute(id, "verify_fix", {});
    return "Sign-in is verified.";
  });
  vi.mocked(learn).mockRejectedValueOnce(
    new Error("Learning provider timed out"),
  );
  const c = start("maya", "account_locked", 4);
  for (let i = 0; i < 3; i++) await step(c.id);
  expect(getCall(c.id)).toMatchObject({
    status: "resolved",
    verified: 1,
    learning_status: "Learning failed; retry available",
  });
});
it("rejects concurrent or paused steps", async () => {
  const c = start("maya", "account_locked", 4);
  run("UPDATE calls SET busy_until=? WHERE id=?", Date.now() + 60000, c.id);
  await expect(step(c.id)).rejects.toThrow("already processing");
  run("UPDATE calls SET busy_until=0,status='paused' WHERE id=?", c.id);
  await expect(step(c.id)).rejects.toThrow("paused");
});
