import { all, batch, getCall, run, transaction } from "@/lib/db";
import { inject } from "@/lib/demodesk";
import { configuration } from "@/lib/ai/router";
import { customerMessage } from "@/lib/agents/customer";
import { supportMessage } from "@/lib/agents/support";
import { evaluate, hasVerification } from "@/lib/evaluation";
import { learn } from "@/lib/learning";
import { backend } from "@/lib/tools";
import type { Scenario, Call, Message } from "@/lib/types";

export function assertIdle() {
  if (
    all<Call>(
      "SELECT * FROM calls WHERE status IN ('running','paused') OR busy_until>?",
      Date.now(),
    ).length
  )
    throw new Error(
      "Finish or stop the active call and wait for its current request to finish.",
    );
}
export function start(
  customerId: string,
  scenario: Scenario,
  maxTurns: number,
) {
  const config = configuration();
  if (!config.ready)
    throw new Error(
      `AI configuration required: ${config.missing.join(", ")}. Add keys to .env.local and restart.`,
    );
  return transaction(() => {
    assertIdle();
    inject(customerId, scenario);
    const id = crypto.randomUUID();
    run(
      "INSERT INTO calls(id,customer_id,scenario,status,max_turns,batch) VALUES (?,?,?,'running',?,?)",
      id,
      customerId,
      scenario,
      maxTurns,
      batch(),
    );
    return getCall(id);
  });
}
export function addMessage(callId: string, role: string, text: string) {
  run(
    "INSERT INTO messages(call_id,role,text) VALUES (?,?,?)",
    callId,
    role,
    text,
  );
}
export async function step(callId: string) {
  const lease = run(
    "UPDATE calls SET busy_until=? WHERE id=? AND status='running' AND busy_until<?",
    Date.now() + 600000,
    callId,
    Date.now(),
  );
  if (!lease.changes)
    throw new Error("Call is paused, complete, or already processing a turn.");
  try {
    let call = getCall(callId);
    const dialogue = all<Message>(
      "SELECT * FROM messages WHERE call_id=? AND role!='system' ORDER BY id",
      callId,
    );
    const previous = dialogue.at(-1);
    if (previous?.role === "support" && hasVerification(callId)) {
      const confirmation = await customerMessage(callId);
      if (getCall(callId).status === "cancelled") return getCall(callId);
      addMessage(callId, "customer", confirmation);
      // Ensure a real ticket exists even when a model omits its administrative step.
      await backend.execute(callId, "create_ticket", {
        subject: dialogue[0].text.slice(0, 180),
      });
      await backend.execute(callId, "update_ticket", {
        status: "resolved",
        resolution: previous.text,
      });
      finish(callId, true);
      try {
        await learn(callId);
      } catch (error) {
        run(
          "UPDATE calls SET learning_status='Learning failed; retry available',error=? WHERE id=?",
          safeError(error),
          callId,
        );
        addMessage(
          callId,
          "system",
          `The application fix is verified. Learning failed: ${safeError(error)}`,
        );
      }
    } else if (previous?.role === "customer") {
      if (call.turns > 2 && !call.escalations) {
        run("UPDATE calls SET escalations=1 WHERE id=?", callId);
        addMessage(
          callId,
          "system",
          "Two unresolved exchanges. Investigation moved to the Advanced model.",
        );
      }
      const supportText = await supportMessage(callId);
      if (getCall(callId).status === "cancelled") return getCall(callId);
      addMessage(callId, "support", supportText);
      call = getCall(callId);
      if (call.turns >= call.max_turns && !hasVerification(callId))
        finish(
          callId,
          false,
          "Maximum conversation turns reached without verified resolution.",
        );
    } else {
      if (call.turns >= call.max_turns) {
        finish(callId, false, "Turn limit reached");
        return getCall(callId);
      }
      run("UPDATE calls SET turns=turns+1 WHERE id=?", callId);
      const customerText = await customerMessage(callId);
      if (getCall(callId).status === "cancelled") return getCall(callId);
      addMessage(callId, "customer", customerText);
    }
    return getCall(callId);
  } catch (error) {
    if (getCall(callId).status !== "cancelled") {
      finish(callId, false, safeError(error));
      addMessage(callId, "system", `Simulation stopped: ${safeError(error)}`);
    }
    return getCall(callId);
  } finally {
    run("UPDATE calls SET busy_until=0 WHERE id=?", callId);
  }
}
export function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : "Unexpected error";
  for (const value of [
    process.env.OPENAI_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    process.env.OPENROUTER_API_KEY,
  ])
    if (value) message = message.replaceAll(value, "[redacted]");
  return message.slice(0, 800);
}
function finish(callId: string, success: boolean, error?: string) {
  const check = evaluate(callId);
  const verified = success && check.passed && hasVerification(callId);
  run(
    "UPDATE calls SET status=?,verified=?,error=?,ended_at=?,learning_status=? WHERE id=?",
    verified ? "resolved" : "failed",
    Number(verified),
    error || null,
    new Date().toISOString(),
    verified
      ? "Analyzing verified resolution"
      : "Skipped: outcome not verified",
    callId,
  );
  run(
    "UPDATE tickets SET status=? WHERE call_id=?",
    verified ? "resolved" : "escalated",
    callId,
  );
  addMessage(
    callId,
    "system",
    `${verified ? "Verified resolution" : "Not resolved"} · ${check.check}${error ? ` · ${error}` : ""}`,
  );
}
export function reset(preserveKnowledge: boolean) {
  transaction(() => {
    assertIdle();
    run(
      "UPDATE customers SET status='active',role='admin',export_format='csv',export_job='idle'",
    );
    run("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='batch'");
    if (!preserveKnowledge) {
      run("DELETE FROM workflows");
      run("DELETE FROM articles");
    }
    // Calls, metrics and transcripts are retained for before/after comparisons.
  });
}
