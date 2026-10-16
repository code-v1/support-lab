import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateObject: vi.fn(async () => ({
      object: {
        title: "Restore access after a test account lockout",
        summary:
          "Inspect account access. If the account is locked, use the authorized unlock API and verify the customer can sign in.",
      },
      usage: { inputTokens: 100, outputTokens: 40 },
    })),
  };
});
import { all, batch, customer, getCall, one, run } from "@/lib/db";
import { exportReport, inject, login, observe } from "@/lib/demodesk";
import { backend } from "@/lib/tools";
import { evaluate, hasVerification } from "@/lib/evaluation";
import { recordCompletion } from "@/lib/evaluation/conversation";
import { configuration, settings } from "@/lib/ai/router";
import { validateRecipe } from "@/lib/learning/workflows";
import { learn } from "@/lib/learning";
import { addMessage, reset, start } from "@/lib/simulation/orchestrator";
import type { Article, Workflow } from "@/lib/types";
import { readCase } from "@/lib/simulation/cases";
import { useReportControls } from "@/lib/demodesk";

beforeEach(() => {
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "support-lab-test-")),
    "test.sqlite",
  );
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "unit-test-only";
  delete process.env.ENABLE_BROWSER_TOOLS;
});
function call(
  customerId = "maya",
  scenario:
    "account_locked" | "export_config" | "export_stuck" = "account_locked",
) {
  return start(customerId, scenario, 6);
}
async function unlock(callId: string) {
  await backend.execute(callId, "get_account_status", {});
  await backend.execute(callId, "update_account_status", { status: "active" });
  await backend.execute(callId, "verify_fix", {});
}

describe("real DemoDesk state", () => {
  it("seeds customers but never seeds successful calls or knowledge", () => {
    expect(all("SELECT id FROM customers")).toHaveLength(3);
    expect(all("SELECT id FROM calls")).toHaveLength(0);
    expect(all("SELECT id FROM articles")).toHaveLength(0);
    expect(all("SELECT id FROM workflows")).toHaveLength(0);
  });
  it("login actually fails for a locked account and succeeds after an authorized repair", async () => {
    const c = call();
    expect(login("maya").ok).toBe(false);
    expect(evaluate(c.id).passed).toBe(false);
    await unlock(c.id);
    expect(login("maya").ok).toBe(true);
    expect(evaluate(c.id).passed).toBe(true);
    expect(hasVerification(c.id)).toBe(true);
    expect(all("SELECT id FROM activities WHERE call_id=?", c.id)).toHaveLength(
      3,
    );
  });
  it.each(["export_config", "export_stuck"] as const)(
    "requires a working report export to resolve %s",
    async (scenario) => {
      const c = call("oliver", scenario);
      expect(exportReport("oliver").ok).toBe(false);
      expect(evaluate(c.id).passed).toBe(false);
      await backend.execute(c.id, "inspect_export_job", {});
      if (scenario === "export_config")
        await backend.execute(c.id, "repair_export_config", {});
      await backend.execute(c.id, "retry_export", {});
      await backend.execute(c.id, "verify_fix", {});
      expect(hasVerification(c.id)).toBe(true);
      expect(exportReport("oliver")).toMatchObject({
        ok: true,
        csv: expect.stringContaining("January,12400,86"),
      });
    },
  );
  it("keeps technical root causes out of customer observations", () => {
    inject("maya", "export_config");
    const observation = JSON.stringify(observe("maya", "export"));
    expect(observation).not.toContain("legacy_xml");
    expect(observation).not.toContain("INVALID_EXPORT_FORMAT");
    expect(observation).toContain("contact support");
  });
  it("honors actual application permissions", () => {
    run("UPDATE customers SET role='viewer' WHERE id='maya'");
    expect(exportReport("maya")).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
  });
});
describe("bounded tools and verification", () => {
  it("cannot mutate a different account by adding a customer ID", async () => {
    const c = call();
    const result = await backend.execute(c.id, "update_account_status", {
      status: "active",
      customerId: "oliver",
    });
    expect(result).toMatchObject({ ok: false });
    expect(customer("maya").status).toBe("locked");
    expect(customer("oliver").status).toBe("active");
  });
  it("never grants suspended accounts access", async () => {
    const c = call();
    run("UPDATE customers SET status='suspended' WHERE id='maya'");
    expect(
      await backend.execute(c.id, "update_account_status", {
        status: "active",
      }),
    ).toMatchObject({ ok: false });
    expect(customer("maya").status).toBe("suspended");
  });
  it("rejects unknown tools and tools on finished calls", async () => {
    const c = call();
    await expect(
      backend.execute(c.id, "run_shell", { command: "whoami" }),
    ).rejects.toThrow("approved");
    run("UPDATE calls SET status='cancelled' WHERE id=?", c.id);
    await expect(backend.execute(c.id, "get_customer", {})).rejects.toThrow(
      "active",
    );
  });
  it("does not close a ticket based on an LLM claim or an unverified state change", async () => {
    const c = call();
    await backend.execute(c.id, "create_ticket", { subject: "Cannot sign in" });
    expect(
      await backend.execute(c.id, "update_ticket", {
        status: "resolved",
        resolution: "I fixed it",
      }),
    ).toMatchObject({ ok: false });
    await backend.execute(c.id, "update_account_status", { status: "active" });
    expect(evaluate(c.id).passed).toBe(true);
    expect(hasVerification(c.id)).toBe(false);
    expect(
      await backend.execute(c.id, "update_ticket", {
        status: "resolved",
        resolution: "Looks fixed",
      }),
    ).toMatchObject({ ok: false });
    await backend.execute(c.id, "verify_fix", {});
    expect(
      await backend.execute(c.id, "update_ticket", {
        status: "resolved",
        resolution: "Verified login",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("customer confirms"),
    });
    addMessage(
      c.id,
      "support",
      "I unlocked the account and verified successful sign-in.",
    );
    const confirmation = addMessage(
      c.id,
      "customer",
      "It works, and that answers my questions. Thank you.",
    );
    recordCompletion(c.id, confirmation, {
      customerSatisfied: true,
      explanationComplete: true,
      evidenceSupported: true,
      openQuestions: [],
      reason: "Customer confirms completion.",
    });
    expect(
      await backend.execute(c.id, "update_ticket", {
        status: "resolved",
        resolution: "Verified login",
      }),
    ).toMatchObject({ ok: true });
  });
  it("blocks learning for unverified fixes", async () => {
    const c = call();
    await expect(learn(c.id)).rejects.toThrow("verified");
    expect(all("SELECT id FROM articles")).toHaveLength(0);
  });
  it("appends follow-up notes and preserves long repair evidence during closure", async () => {
    const c = call();
    await backend.execute(c.id, "create_ticket", { subject: "Account access" });
    const repair = "Verified account repair. ".repeat(65);
    const followup =
      "Explained that the logs do not identify the actor. ".repeat(30);
    await backend.execute(c.id, "update_ticket", {
      status: "investigating",
      resolution: repair,
    });
    await backend.execute(c.id, "update_ticket", {
      status: "investigating",
      resolution: followup,
    });
    await unlock(c.id);
    addMessage(
      c.id,
      "support",
      "I restored access and verified sign-in. The logs do not identify who made the attempts.",
    );
    const messageId = addMessage(
      c.id,
      "customer",
      "That answers my concern. Everything works, thank you.",
    );
    recordCompletion(c.id, messageId, {
      customerSatisfied: true,
      explanationComplete: true,
      evidenceSupported: true,
      openQuestions: [],
      reason: "Customer accepts the repair and explanation.",
    });
    expect(
      await backend.execute(c.id, "update_ticket", {
        status: "resolved",
        resolution: "",
      }),
    ).toMatchObject({ ok: true });
    const ticket = one<{ resolution: string }>(
      "SELECT resolution FROM tickets WHERE call_id=?",
      c.id,
    )!;
    expect(ticket.resolution).toBe(`${repair.trim()}\n\n${followup.trim()}`);
    expect(ticket.resolution.length).toBeGreaterThan(2000);
  });
  it("cannot start an AI simulation without keys", () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(configuration().ready).toBe(false);
    expect(() => call()).toThrow("configuration");
    expect(all("SELECT id FROM calls")).toHaveLength(0);
    expect(customer("maya").status).toBe("active");
  });
  it("allows only one active simulation and refuses reset while tools are running", () => {
    const c = call();
    expect(() => call("oliver")).toThrow("Finish");
    expect(() => reset(true)).toThrow("Finish");
    run(
      "UPDATE calls SET status='cancelled',busy_until=? WHERE id=?",
      Date.now() + 10000,
      c.id,
    );
    expect(() => reset(true)).toThrow("wait");
  });
});
describe("learning and replay", () => {
  it("learns a compound workflow only after all three observed repairs succeed", async () => {
    const current = start("maya", "export_multi_fault", 8);
    await backend.execute(current.id, "get_account_status", {});
    await backend.execute(current.id, "update_account_status", {
      status: "active",
    });
    await backend.execute(current.id, "inspect_export_job", {});
    await backend.execute(current.id, "repair_export_config", {});
    await backend.execute(current.id, "retry_export", {});
    await backend.execute(current.id, "verify_fix", { action: "export" });
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", current.id);
    await learn(current.id);
    const workflow = one<Workflow>("SELECT * FROM workflows")!;
    const recipe = validateRecipe(JSON.parse(workflow.recipe));
    expect(recipe.condition).toBe("compound_export");
    expect(recipe.steps.map((step) => step.tool)).toEqual([
      "get_account_status",
      "update_account_status",
      "inspect_export_job",
      "repair_export_config",
      "retry_export",
      "verify_fix",
    ]);
    reset(true);
    const replay = start("jules", "export_multi_fault", 8);
    expect(
      await backend.execute(replay.id, "run_workflow", {
        workflowId: workflow.id,
      }),
    ).toMatchObject({ ok: true });
    expect(hasVerification(replay.id)).toBe(true);
  });
  it("learns a coaching article from actual customer UI actions without creating a repair macro", async () => {
    const current = start("jules", "report_guidance", 8, {
      seed: "coaching-learning",
    });
    const goal = readCase(current);
    useReportControls("jules", {
      action: "choose_range",
      range: goal.targetRange,
    });
    useReportControls("jules", {
      action: "choose_columns",
      columns: goal.targetColumns,
    });
    useReportControls("jules", { action: "apply_preview" });
    useReportControls("jules", { action: "download_report" });
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", current.id);
    await learn(current.id);
    expect(one<Article>("SELECT * FROM articles")?.signature).toBe(
      "report_builder_guidance",
    );
    expect(all("SELECT * FROM workflows")).toHaveLength(0);
  });
  it("does not mistake a no-op configuration check for the cause of a stuck export", async () => {
    const c = call("oliver", "export_stuck");
    expect(
      await backend.execute(c.id, "repair_export_config", {}),
    ).toMatchObject({ ok: true, changed: false });
    await backend.execute(c.id, "retry_export", {});
    await backend.execute(c.id, "verify_fix", {});
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", c.id);
    await learn(c.id);
    expect(one<Article>("SELECT * FROM articles")?.signature).toBe(
      "stuck_export_job",
    );
  });
  it("learns from verified tool evidence and reuses it for a different customer", async () => {
    const first = call();
    await unlock(first.id);
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", first.id);
    await learn(first.id);
    const article = one<Article>("SELECT * FROM articles")!,
      workflow = one<Workflow>("SELECT * FROM workflows")!;
    expect(article.source_call).toBe(first.id);
    expect(workflow.active).toBe(1);
    expect(validateRecipe(JSON.parse(workflow.recipe)).condition).toBe(
      "account_locked",
    );
    reset(true);
    expect(batch()).toBe(2);
    expect(all("SELECT id FROM articles")).toHaveLength(1);
    const second = call("oliver");
    const found = (await backend.execute(second.id, "search_knowledge", {
      query: "I cannot sign into my workspace",
    })) as { articles: Article[]; workflows: Workflow[] };
    expect(found.articles).toHaveLength(1);
    expect(
      await backend.execute(second.id, "run_workflow", {
        workflowId: workflow.id,
      }),
    ).toMatchObject({ ok: true });
    expect(hasVerification(second.id)).toBe(true);
    expect(customer("oliver").status).toBe("active");
    expect(getCall(second.id)).toMatchObject({
      knowledge_used: 1,
      workflow_used: 1,
    });
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", second.id);
    await learn(second.id);
    expect(all("SELECT id FROM articles")).toHaveLength(1);
    expect(all("SELECT id FROM workflows")).toHaveLength(1);
    reset(false);
    expect(all("SELECT id FROM articles")).toHaveLength(0);
    expect(all("SELECT id FROM workflows")).toHaveLength(0);
    expect(all("SELECT id FROM calls")).toHaveLength(2);
  });
  it("refuses workflow actions when their precondition does not match", async () => {
    const first = call();
    await unlock(first.id);
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", first.id);
    await learn(first.id);
    const workflow = one<Workflow>("SELECT * FROM workflows")!;
    const second = call("jules", "export_config");
    expect(
      await backend.execute(second.id, "run_workflow", {
        workflowId: workflow.id,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("precondition"),
    });
    expect(customer("jules").export_format).toBe("legacy_xml");
  });
  it("honors disabled tools inside otherwise valid workflows", async () => {
    const first = call();
    await unlock(first.id);
    run("UPDATE calls SET status='resolved',verified=1 WHERE id=?", first.id);
    await learn(first.id);
    const workflow = one<Workflow>("SELECT * FROM workflows")!;
    const second = call("jules");
    const config = settings();
    config.disabledTools = ["update_account_status"];
    run(
      "INSERT OR REPLACE INTO meta VALUES ('settings',?)",
      JSON.stringify(config),
    );
    expect(
      await backend.execute(second.id, "run_workflow", {
        workflowId: workflow.id,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("disabled") });
    expect(customer("jules").status).toBe("locked");
  });
  it("rejects executable content and cross-account workflow inputs", () => {
    expect(() =>
      validateRecipe({
        version: 1,
        condition: "account_locked",
        steps: [
          { tool: "run_shell", input: { command: "node exploit.js" } },
          { tool: "verify_fix", input: {} },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateRecipe({
        version: 1,
        condition: "account_locked",
        steps: [
          {
            tool: "update_account_status",
            input: { status: "active", customerId: "other" },
          },
          { tool: "verify_fix", input: {} },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateRecipe({
        version: 1,
        condition: "account_locked",
        steps: [
          { tool: "get_account_status", input: {} },
          { tool: "update_account_status", input: { status: "active" } },
        ],
      }),
    ).toThrow("verification");
  });
});
