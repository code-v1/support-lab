import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supportMessage } from "@/lib/agents/support";
import { addMessage, start } from "@/lib/simulation/orchestrator";
import { all, customer, run } from "@/lib/db";
import { backend } from "@/lib/tools";
import { assessCompletion } from "@/lib/evaluation/conversation";
import { customerMessage } from "@/lib/agents/customer";
import { readCase } from "@/lib/simulation/cases";

beforeEach(() => {
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "support-lab-support-")), "test.sqlite"),
  );
  vi.stubEnv("OPENROUTER_API_KEY", "unit-test-only");
  for (const role of ["FAST", "BALANCED", "ADVANCED"]) {
    vi.stubEnv(`${role}_PROVIDER`, "openrouter");
    vi.stubEnv(`${role}_MODEL`, "test/model");
  }
});
it.each([false, true])(
  "validates completion through the real OpenRouter adapter (Fast failure: %s)",
  async (fastFails) => {
    vi.stubEnv("FAST_MODEL", "test/fast");
    vi.stubEnv("ADVANCED_MODEL", "test/advanced");
    const bodies: Record<string, unknown>[] = [];
    const decision = {
      customerSatisfied: true,
      explanationComplete: true,
      evidenceSupported: true,
      requiresInvestigation: false,
      openQuestions: [],
      reason:
        "Jules accepts the report and will contact support only if a future problem recurs.",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        const malformed = fastFails && bodies.length === 1;
        return new Response(
          JSON.stringify({
            id: "test-review",
            object: "chat.completion",
            created: 1,
            model: bodies.at(-1)!.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: malformed ? "The customer seems satisfied." : null,
                  ...(malformed
                    ? {}
                    : {
                        tool_calls: [
                          {
                            id: "submit-1",
                            type: "function",
                            function: {
                              name: "submit_completion",
                              arguments: JSON.stringify(decision),
                            },
                          },
                        ],
                      }),
                },
                finish_reason: malformed ? "stop" : "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 30,
              total_tokens: 80,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    const call = start("jules", "export_stuck", 4);
    await backend.execute(call.id, "retry_export", {});
    await backend.execute(call.id, "verify_fix", {});
    addMessage(
      call.id,
      "support",
      "I cleared the stalled export. Your report is ready.",
    );
    addMessage(
      call.id,
      "customer",
      "Thanks, that all makes sense. I'll reach out if it happens again.",
    );
    expect(await assessCompletion(call.id)).toEqual(decision);
    expect(bodies).toHaveLength(fastFails ? 2 : 1);
    expect(bodies[0].tool_choice).toBe("auto");
    expect(bodies[0].response_format).toBeUndefined();
    if (fastFails) expect(bodies[1].model).toBe("test/advanced");
  },
);

it("keeps a verified follow-up out of repair/verification tools and writes a separate brief answer", async () => {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({
          id: "reply",
          object: "chat.completion",
          created: 1,
          model: "test/model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content:
                  bodies.length === 1
                    ? "Internal finding: no actor is recorded for the older job."
                    : "The logs don't identify who started the older job, so I can't tell from the available evidence.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  const call = start("jules", "export_stuck", 4);
  await backend.execute(call.id, "retry_export", {});
  await backend.execute(call.id, "verify_fix", {});
  run("UPDATE calls SET repair_verified=1 WHERE id=?", call.id);
  addMessage(call.id, "customer", "I tried exporting and it got stuck.");
  addMessage(call.id, "support", "The report is ready now.");
  addMessage(call.id, "customer", "It worked. Who started the older export?");
  addMessage(
    call.id,
    "system",
    "Private completion checker diagnostic, never customer context.",
  );
  const reply = await supportMessage(call.id);
  expect(reply).not.toContain("Internal finding");
  const offered = (bodies[0].tools as { function: { name: string } }[]).map(
    (tool) => tool.function.name,
  );
  expect(offered).not.toContain("verify_fix");
  expect(offered).not.toContain("retry_export");
  expect(offered).not.toContain("run_workflow");
  expect(bodies[1].tools).toBeUndefined();
  expect(JSON.stringify(bodies)).not.toContain(
    "Private completion checker diagnostic",
  );
});

it("gives the customer their original action and excludes internal review errors", async () => {
  let body = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(
        JSON.stringify({
          id: "customer",
          object: "chat.completion",
          created: 1,
          model: "test/model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "That worked, thanks!" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  const call = start("jules", "export_stuck", 4);
  addMessage(call.id, "customer", "I clicked export and it got stuck.");
  addMessage(call.id, "system", "Private invalid completion JSON details.");
  addMessage(
    call.id,
    "support",
    "I cleared the stuck job; your report is ready.",
  );
  expect(await customerMessage(call.id)).toBe("That worked, thanks!");
  expect(body).toContain("I clicked export and it got stuck.");
  expect(body).toContain("do not later claim you never tried to export");
  expect(body).not.toContain("Private invalid completion JSON details");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reserves a customer-facing answer after six actual SDK tool steps", async () => {
  const bodies: Record<string, unknown>[] = [];
  const answer =
    "I retrieved your account details and still need to investigate the sign-in issue.";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const final = bodies.length >= 7;
      return new Response(
        JSON.stringify({
          id: "test-completion",
          object: "chat.completion",
          created: 1,
          model: "test/model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: final ? answer : "Let me check the account.",
                ...(final
                  ? {}
                  : {
                      tool_calls: [
                        {
                          id: `lookup-${bodies.length}`,
                          type: "function",
                          function: { name: "get_customer", arguments: "{}" },
                        },
                      ],
                    }),
              },
              finish_reason: final ? "stop" : "tool_calls",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  const call = start("maya", "account_locked", 4);
  addMessage(call.id, "customer", "I cannot sign in.");
  expect(await supportMessage(call.id)).toBe(answer);
  expect(bodies).toHaveLength(8);
  expect(bodies[6].tool_choice).toBe("none");
  expect(bodies[7].tools).toBeUndefined();
  expect(JSON.stringify(bodies[7].messages)).toContain("at most 75 words");
  expect(
    all("SELECT id FROM activities WHERE call_id=?", call.id),
  ).toHaveLength(6);
  expect(
    all(
      "SELECT role,input_tokens,output_tokens FROM usage WHERE call_id=?",
      call.id,
    ),
  ).toMatchObject([
    { role: "support", input_tokens: 140, output_tokens: 70 },
    { role: "support_reply", input_tokens: 20, output_tokens: 10 },
  ]);
});
it("executes one real customer UI action per coaching turn through the actual SDK adapter", async () => {
  const current = start("jules", "report_guidance", 8, {
    seed: "guided-tool",
    difficulty: "challenge",
  });
  const goal = readCase(current);
  addMessage(current.id, "customer", "I need help building the right report.");
  addMessage(
    current.id,
    "support",
    `Choose ${goal.targetRange.toUpperCase()} in Date range, then tell me what you see.`,
  );
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const final = bodies.length === 2;
      return new Response(
        JSON.stringify({
          id: "ui-action",
          object: "chat.completion",
          created: 1,
          model: "test/model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: final
                  ? "I selected that quarter. What should I do next?"
                  : null,
                ...(final
                  ? {}
                  : {
                      tool_calls: [
                        {
                          id: "ui-1",
                          type: "function",
                          function: {
                            name: "use_report_controls",
                            arguments: JSON.stringify({
                              action: "choose_range",
                              range: goal.targetRange,
                            }),
                          },
                        },
                      ],
                    }),
              },
              finish_reason: final ? "stop" : "tool_calls",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }),
  );
  expect(await customerMessage(current.id)).toContain("selected");
  expect(customer("jules").draft_range).toBe(goal.targetRange);
  expect(customer("jules").report_downloaded).toBe(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1].tool_choice).toBe("none");
  expect(
    all(
      "SELECT id FROM activities WHERE call_id=? AND name='customer.choose_range'",
      current.id,
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(bodies)).not.toContain("report_guidance");
});
