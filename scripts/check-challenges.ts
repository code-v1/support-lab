// Opt-in live model checks. Normal customer history is never advanced or reset.
// Each invocation uses a fresh temporary SQLite database and provider credits.
import { loadEnvConfig } from "@next/env";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { all, customer, getCall, one, run } from "@/lib/db";
import { settings } from "@/lib/ai/router";
import { start, step, safeError } from "@/lib/simulation/orchestrator";
import { performance } from "@/lib/evaluation/performance";
import type { Activity, Message, Scenario, Usage } from "@/lib/types";

async function main() {
  loadEnvConfig(process.cwd(), true);
  const selection = process.argv
    .find((arg) => arg.startsWith("--scenario="))
    ?.split("=")[1];
  const choices = [
    "report_guidance",
    "export_multi_fault",
    "export_engineering",
  ] as const;
  if (
    !selection ||
    (selection !== "all" &&
      !choices.includes(selection as (typeof choices)[number]))
  )
    throw new Error(
      "Usage: npx tsx scripts/check-challenges.ts --scenario=all|report_guidance|export_multi_fault|export_engineering. At most three live calls, eight support turns each.",
    );
  // Copy model and tool settings, never credentials, before changing DB paths.
  const config = settings();
  const directory = mkdtempSync(join(tmpdir(), "support-lab-challenges-"));
  process.env.DATABASE_PATH = join(directory, "live.sqlite");
  process.env.ENABLE_BROWSER_TOOLS = "false";
  run(
    "INSERT OR REPLACE INTO meta(key,value) VALUES ('settings',?)",
    JSON.stringify(config),
  );
  const scenarios: Scenario[] =
    selection === "all" ? [...choices] : [selection as Scenario];
  mkdirSync(resolve("artifacts"), { recursive: true });
  let failed = false;
  for (const scenario of scenarios) {
    const call = start("maya", scenario, 8, {
      seed: `live-${scenario}-2026-10`,
      difficulty: "challenge",
      followUp: true,
    });
    console.log(
      JSON.stringify({
        event: "started",
        scenario,
        callId: call.id,
        isolated: true,
      }),
    );
    for (
      let count = 0;
      count < 21 && getCall(call.id).status === "running";
      count++
    ) {
      const state = await step(call.id);
      const last = one<Message>(
        "SELECT * FROM messages WHERE call_id=? AND role!='system' ORDER BY id DESC LIMIT 1",
        call.id,
      );
      console.log(
        JSON.stringify({
          event: "step",
          scenario,
          status: state.status,
          turns: state.turns,
          tools: state.tool_calls,
          speaker: last?.role,
          text: last?.text.slice(0, 420),
          error: state.error,
        }),
      );
    }
    const result = getCall(call.id);
    const activities = all<Activity>(
      "SELECT * FROM activities WHERE call_id=? ORDER BY id",
      call.id,
    );
    const usage = all<Usage>(
      "SELECT * FROM usage WHERE call_id=? ORDER BY id",
      call.id,
    );
    const metrics = performance(result, activities, usage);
    const expected =
      scenario === "export_engineering" ? "escalated" : "resolved";
    const passed =
      result.status === expected &&
      !!result.outcome_verified &&
      (scenario !== "export_engineering" || !result.verified);
    failed ||= !passed;
    const output = resolve(`artifacts/live-${scenario}.json`);
    writeFileSync(
      output,
      JSON.stringify(
        {
          passed,
          call: result,
          account: customer(result.customer_id),
          messages: all(
            "SELECT * FROM messages WHERE call_id=? ORDER BY id",
            call.id,
          ),
          activities,
          completion: all(
            "SELECT * FROM completion_checks WHERE call_id=? ORDER BY id",
            call.id,
          ),
          tickets: all("SELECT * FROM tickets WHERE call_id=?", call.id),
          engineering: all(
            "SELECT * FROM engineering_handoffs WHERE call_id=?",
            call.id,
          ),
          metrics,
          usage,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        event: "result",
        scenario,
        passed,
        status: result.status,
        verified: result.verified,
        outcomeVerified: result.outcome_verified,
        metrics,
        output,
        error: result.error,
      }),
    );
    // Continue independent cases even if one model run stalls at review.
    if (result.status === "running" || result.status === "paused")
      run(
        "UPDATE calls SET status='cancelled',busy_until=0 WHERE id=?",
        call.id,
      );
  }
  if (failed) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(safeError(error));
  process.exitCode = 1;
});
