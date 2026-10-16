import { all, batch, customer, getCall, one, run, transaction } from "@/lib/db";
import { inject, baselineAccount } from "@/lib/demodesk";
import { configuration } from "@/lib/ai/router";
import { customerMessage } from "@/lib/agents/customer";
import { supportMessage } from "@/lib/agents/support";
import {
  evaluate,
  hasVerification,
  hasOutcomeVerification,
} from "@/lib/evaluation";
import { hasEngineeringVerification } from "@/lib/engineering";
import { createCase } from "@/lib/simulation/cases";
import {
  assessCompletion,
  hasCustomerConfirmation,
  recordCompletion,
} from "@/lib/evaluation/conversation";
import { learn } from "@/lib/learning";
import { backend } from "@/lib/tools";
import type {
  Scenario,
  Call,
  Message,
  Ticket,
  Activity,
  CompletionCheck,
  CaseOptions,
  ScenarioChoice,
} from "@/lib/types";

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
  choice: ScenarioChoice,
  maxTurns: number,
  options: CaseOptions = {},
) {
  const config = configuration();
  if (!config.ready)
    throw new Error(
      `AI configuration required: ${config.missing.join(", ")}. Add keys to .env.local and restart.`,
    );
  return transaction(() => {
    assertIdle();
    const { scenario, scenarioCase } = createCase(choice, options);
    inject(customerId, scenario, scenarioCase);
    const id = crypto.randomUUID();
    run(
      "INSERT INTO calls(id,customer_id,scenario,status,max_turns,batch,scenario_seed,scenario_case) VALUES (?,?,?,'running',?,?,?,?)",
      id,
      customerId,
      scenario,
      maxTurns,
      batch(),
      scenarioCase.seed,
      JSON.stringify(scenarioCase),
    );
    return getCall(id);
  });
}
export function addMessage(
  callId: string,
  role: string,
  text: string,
  kind: "dialogue" | "closing" = "dialogue",
) {
  return Number(
    run(
      "INSERT INTO messages(call_id,role,text,kind) VALUES (?,?,?,?)",
      callId,
      role,
      text,
      kind,
    ).lastInsertRowid,
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
    if (call.closing_customer_message_id) {
      await completeCall(callId);
      return getCall(callId);
    }
    if (previous?.role === "customer") {
      const review = one<CompletionCheck>(
        "SELECT * FROM completion_checks WHERE call_id=? AND customer_message_id=?",
        callId,
        previous.id,
      );
      if (review?.assessment_error) {
        await reviewCustomer(callId, previous.id);
        return getCall(callId);
      }
      if (call.turns >= call.max_turns) {
        finish(
          callId,
          false,
          "Turn limit reached with customer needs still outstanding.",
          "incomplete",
        );
        return getCall(callId);
      }
      if (call.turns >= 2 && !call.escalations) {
        run("UPDATE calls SET escalations=1 WHERE id=?", callId);
        addMessage(
          callId,
          "system",
          "Two exchanges without customer completion. Follow-up moved to the Advanced model.",
        );
      }
      run("UPDATE calls SET turns=turns+1 WHERE id=?", callId);
      const supportText = await supportMessage(callId);
      if (getCall(callId).status === "cancelled") return getCall(callId);
      addMessage(callId, "support", supportText);
      run(
        "UPDATE calls SET repair_verified=? WHERE id=?",
        Number(hasVerification(callId)),
        callId,
      );
    } else {
      const customerText = await customerMessage(callId);
      if (getCall(callId).status === "cancelled") return getCall(callId);
      const messageId = addMessage(callId, "customer", customerText);
      if (previous?.role === "support") {
        const repairVerified = hasVerification(callId);
        run(
          "UPDATE calls SET repair_verified=? WHERE id=?",
          Number(repairVerified),
          callId,
        );
        if (hasOutcomeVerification(callId)) {
          await reviewCustomer(callId, messageId);
          return getCall(callId);
        }
        call = getCall(callId);
        if (call.turns >= call.max_turns)
          finish(
            callId,
            false,
            repairVerified
              ? "Turn limit reached: repair verified, but customer completion is not confirmed. Ticket escalated for follow-up."
              : "Turn limit reached without a verified repair. Ticket escalated for follow-up.",
            "incomplete",
          );
      }
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
async function reviewCustomer(callId: string, messageId: number) {
  let assessment;
  try {
    assessment = await assessCompletion(callId);
  } catch (error) {
    if (getCall(callId).status === "cancelled") return;
    const reason =
      `Customer completion could not be checked: ${safeError(error)}`.slice(
        0,
        600,
      );
    recordCompletion(
      callId,
      messageId,
      {
        customerSatisfied: false,
        explanationComplete: false,
        evidenceSupported: false,
        openQuestions: [],
        reason,
      },
      reason,
    );
    run(
      "UPDATE calls SET status='paused',error=? WHERE id=?",
      "Completion review unavailable. Retry the review before continuing the conversation.",
      callId,
    );
    addMessage(
      callId,
      "system",
      "Completion review unavailable; call paused without asking the customer to repeat themselves.",
    );
    return;
  }
  if (getCall(callId).status === "cancelled") return;
  recordCompletion(callId, messageId, assessment);
  run("UPDATE calls SET error=NULL WHERE id=?", callId);
  if (hasCustomerConfirmation(callId)) {
    run(
      "UPDATE calls SET closing_customer_message_id=? WHERE id=?",
      messageId,
      callId,
    );
    addMessage(
      callId,
      "system",
      "Customer accepted the outcome and next steps. A final closing statement is next.",
    );
  } else if (getCall(callId).turns >= getCall(callId).max_turns) {
    finish(
      callId,
      false,
      "Turn limit reached: the application outcome is verified, but customer completion is not confirmed. Ticket escalated for follow-up.",
      "incomplete",
    );
  }
}

async function completeCall(callId: string) {
  if (!hasOutcomeVerification(callId) || !hasCustomerConfirmation(callId))
    throw new Error(
      "The application outcome and current customer acceptance must remain confirmed before closing.",
    );
  const opening = one<Message>(
    "SELECT * FROM messages WHERE call_id=? AND role='customer' ORDER BY id LIMIT 1",
    callId,
  )!;
  const engineering = hasEngineeringVerification(callId);
  if (!engineering) await closeTicket(callId, opening.text);
  if (getCall(callId).status === "cancelled") return;
  if (
    !one("SELECT id FROM messages WHERE call_id=? AND kind='closing'", callId)
  ) {
    const name = customer(getCall(callId).customer_id).name.split(" ")[0];
    const handoff = engineering
      ? one<{ id: string }>(
          "SELECT id FROM engineering_handoffs WHERE call_id=?",
          callId,
        )
      : undefined;
    addMessage(
      callId,
      "support",
      handoff
        ? `Your case is with engineering under ${handoff.id}, ${name}. The support ticket stays open for updates; there is no confirmed fix time yet. Thanks for your patience.`
        : `You're all set, ${name}. Thanks for contacting DemoDesk support—have a good day.`,
      "closing",
    );
  }
  finish(callId, true);
  if (engineering) {
    run(
      "UPDATE calls SET learning_status='Engineering handoff verified; no repair workflow learned' WHERE id=?",
      callId,
    );
    return;
  }
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
      `The resolution is confirmed. Learning failed: ${safeError(error)}`,
    );
  }
}
async function closeTicket(callId: string, subject: string) {
  let ticket = one<Ticket>("SELECT * FROM tickets WHERE call_id=?", callId);
  if (!ticket) {
    await backend.execute(callId, "create_ticket", {
      subject: subject.slice(0, 180),
    });
    ticket = one<Ticket>("SELECT * FROM tickets WHERE call_id=?", callId);
  }
  if (!ticket)
    throw new Error(
      "Customer confirmed completion, but the support ticket could not be created.",
    );
  const evidence = all<Activity>(
    "SELECT * FROM activities WHERE call_id=? AND success=1 AND (name IN ('update_account_status','repair_export_config','retry_export','run_workflow','verify_fix') OR name LIKE 'customer.%') ORDER BY id",
    callId,
  );
  const resolution = ticket.resolution?.trim()
    ? ""
    : `Verified customer outcome evidence: ${JSON.stringify(evidence.map((event) => ({ tool: event.name, input: JSON.parse(event.input), result: JSON.parse(event.output) })))}`.slice(
        0,
        2000,
      );
  const result = (await backend.execute(callId, "update_ticket", {
    status: "resolved",
    resolution,
  })) as { ok: boolean; error?: string };
  if (!result.ok)
    throw new Error(result.error || "The support ticket could not be closed.");
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
function finish(
  callId: string,
  success: boolean,
  error?: string,
  failureStatus: "failed" | "incomplete" = "failed",
) {
  const check = evaluate(callId);
  const repairVerified = check.passed && hasVerification(callId);
  const engineering = hasEngineeringVerification(callId);
  const outcomeVerified =
    success &&
    (repairVerified || engineering) &&
    hasCustomerConfirmation(callId);
  const verified = outcomeVerified && repairVerified;
  // Retain an actionable ticket even if the model never performed its admin step.
  run(
    "INSERT OR IGNORE INTO tickets(id,call_id,customer_id,subject,status) VALUES (?,?,?,?,'open')",
    "T-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
    callId,
    getCall(callId).customer_id,
    one<Message>(
      "SELECT * FROM messages WHERE call_id=? AND role='customer' ORDER BY id LIMIT 1",
      callId,
    )?.text.slice(0, 180) || "Support conversation requires follow-up",
  );
  run(
    "UPDATE calls SET status=?,verified=?,repair_verified=?,error=?,ended_at=?,learning_status=?,outcome_verified=?,outcome=? WHERE id=?",
    outcomeVerified ? (engineering ? "escalated" : "resolved") : failureStatus,
    Number(verified),
    Number(repairVerified),
    error || null,
    new Date().toISOString(),
    outcomeVerified
      ? "Analyzing verified resolution"
      : "Skipped: conversation not resolved",
    Number(outcomeVerified),
    outcomeVerified
      ? engineering
        ? "engineering_handoff"
        : "resolution"
      : null,
    callId,
  );
  run(
    "UPDATE tickets SET status=? WHERE call_id=?",
    engineering ? "engineering" : verified ? "resolved" : "escalated",
    callId,
  );
  addMessage(
    callId,
    "system",
    `${outcomeVerified && engineering ? "Verified engineering handoff · Feature remains broken; customer accepted next steps" : verified ? (getCall(callId).scenario === "report_guidance" ? "Verified customer task and accepted completion" : "Verified repair and customer-confirmed resolution") : failureStatus === "incomplete" ? "Incomplete conversation" : "Not resolved"} · ${check.check}${error ? ` · ${error}` : ""}`,
  );
}
export function reset(preserveKnowledge: boolean) {
  transaction(() => {
    assertIdle();
    run(`UPDATE customers SET ${baselineAccount}`);
    run("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='batch'");
    if (!preserveKnowledge) {
      run("DELETE FROM workflows");
      run("DELETE FROM articles");
    }
    // Calls, metrics and transcripts are retained for before/after comparisons.
  });
}
