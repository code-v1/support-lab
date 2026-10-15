import { z } from "zod";
import { NextResponse } from "next/server";
import { snapshot } from "@/lib/snapshot";
import {
  assertIdle,
  reset,
  safeError,
  start,
  step,
} from "@/lib/simulation/orchestrator";
import { getCall, one, run } from "@/lib/db";
import { inject } from "@/lib/demodesk";
import { learn } from "@/lib/learning";
import { validateRecipe } from "@/lib/learning/workflows";
import { catalog } from "@/lib/tools/catalog";
import { isSameOrigin } from "@/lib/http";
import { modelConfigSchema as modelConfig } from "@/lib/ai/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const scenario = z.enum(["account_locked", "export_config", "export_stuck"]);
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    customerId: z.string(),
    scenario,
    maxTurns: z.number().int().min(2).max(12),
  }),
  z.object({
    action: z.enum(["step", "pause", "resume", "cancel", "learn"]),
    callId: z.string(),
  }),
  z.object({ action: z.literal("reset"), preserveKnowledge: z.boolean() }),
  z.object({ action: z.literal("inject"), customerId: z.string(), scenario }),
  z.object({
    action: z.literal("settings"),
    settings: z.object({
      profiles: z.object({
        fast: modelConfig,
        balanced: modelConfig,
        advanced: modelConfig,
      }),
      disabledTools: z
        .array(z.string())
        .refine(
          (names) =>
            names.every((name) => catalog.some((t) => t.name === name)),
          "Unknown tool",
        ),
    }),
  }),
  z.object({
    action: z.literal("workflow"),
    id: z.string(),
    active: z.boolean(),
  }),
]);
export async function GET() {
  return NextResponse.json(snapshot());
}
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request))
      return NextResponse.json(
        { error: "Cross-origin mutations are not allowed." },
        { status: 403 },
      );
    const input = schema.parse(await request.json());
    switch (input.action) {
      case "start":
        start(input.customerId, input.scenario, input.maxTurns);
        break;
      case "step":
        await step(input.callId);
        break;
      case "pause":
        run(
          "UPDATE calls SET status='paused' WHERE id=? AND status='running'",
          input.callId,
        );
        break;
      case "resume":
        run(
          "UPDATE calls SET status='running' WHERE id=? AND status='paused'",
          input.callId,
        );
        break;
      case "cancel":
        run(
          "UPDATE calls SET status='cancelled',ended_at=?,learning_status='Skipped: cancelled' WHERE id=? AND status IN ('running','paused')",
          new Date().toISOString(),
          input.callId,
        );
        run(
          "UPDATE tickets SET status='escalated' WHERE call_id=? AND status!='resolved'",
          input.callId,
        );
        break;
      case "reset":
        reset(input.preserveKnowledge);
        break;
      case "inject":
        assertIdle();
        inject(input.customerId, input.scenario);
        break;
      case "settings":
        assertIdle();
        run(
          "INSERT OR REPLACE INTO meta(key,value) VALUES ('settings',?)",
          JSON.stringify(input.settings),
        );
        break;
      case "workflow": {
        assertIdle();
        const workflow = one<{ recipe: string }>(
          "SELECT recipe FROM workflows WHERE id=?",
          input.id,
        );
        if (!workflow) throw new Error("Workflow not found");
        validateRecipe(JSON.parse(workflow.recipe));
        run(
          "UPDATE workflows SET active=? WHERE id=?",
          Number(input.active),
          input.id,
        );
        break;
      }
      case "learn": {
        assertIdle();
        const call = getCall(input.callId);
        if (call.status !== "resolved")
          throw new Error("Only verified resolved calls can be learned.");
        await learn(input.callId);
        break;
      }
    }
    return NextResponse.json(snapshot());
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
