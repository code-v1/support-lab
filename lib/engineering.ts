import { all, customer, getCall, one, run, transaction } from "@/lib/db";
import type { Activity, EngineeringHandoff, Ticket } from "@/lib/types";
export interface EngineeringInput {
  severity: "low" | "medium" | "high";
  summary: string;
  customerImpact: string;
  reproductionSteps: string[];
  expectedResult: string;
  actualResult: string;
}
export function engineeringEvidence(callId: string) {
  const events = all<Activity>(
    "SELECT * FROM activities WHERE call_id=? ORDER BY id",
    callId,
  );
  const failure = events.find(
    (event) =>
      event.name === "retry_export" &&
      JSON.parse(event.output).code === "REPORT_RENDERER_DEFECT",
  );
  const inspected = events.some(
    (event) => event.name === "inspect_export_job" && event.success,
  );
  const logs = events.some(
    (event) => event.name === "get_application_logs" && event.success,
  );
  return {
    ready: !!failure && inspected && logs,
    events: events.filter((event) =>
      ["inspect_export_job", "get_application_logs", "retry_export"].includes(
        event.name,
      ),
    ),
    failure,
  };
}
export function fileEngineeringHandoff(
  callId: string,
  input: EngineeringInput,
) {
  const existing = one<EngineeringHandoff>(
    "SELECT * FROM engineering_handoffs WHERE call_id=?",
    callId,
  );
  if (existing)
    return {
      ok: true,
      id: existing.id,
      ticketId: existing.ticket_id,
      status: existing.status,
      queue: "Engineering",
      fixAvailable: false,
    };
  const evidence = engineeringEvidence(callId);
  if (!evidence.ready)
    throw new Error(
      "Before escalating, inspect the export job and application logs, then reproduce the unrecoverable renderer failure once with retry_export. A timeout or untried repair is not evidence of this defect.",
    );
  return transaction(() => {
    const call = getCall(callId);
    let ticket = one<Ticket>("SELECT * FROM tickets WHERE call_id=?", callId);
    if (!ticket) {
      run(
        "INSERT INTO tickets(id,call_id,customer_id,subject,status) VALUES (?,?,?,?,'investigating')",
        "T-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
        callId,
        call.customer_id,
        input.summary.slice(0, 180),
      );
      ticket = one<Ticket>("SELECT * FROM tickets WHERE call_id=?", callId)!;
    }
    const id = "ENG-" + crypto.randomUUID().slice(0, 8).toUpperCase();
    run(
      "INSERT INTO engineering_handoffs(id,call_id,ticket_id,customer_id,severity,summary,customer_impact,reproduction_steps,expected_result,actual_result,evidence) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      id,
      callId,
      ticket.id,
      call.customer_id,
      input.severity,
      input.summary,
      input.customerImpact,
      JSON.stringify(input.reproductionSteps),
      input.expectedResult,
      input.actualResult,
      JSON.stringify(
        evidence.events.map((event) => ({
          activityId: event.id,
          tool: event.name,
          input: JSON.parse(event.input),
          result: JSON.parse(event.output),
        })),
      ),
    );
    const note = `Engineering handoff ${id}: ${input.summary}\nCustomer impact: ${input.customerImpact}\nExpected: ${input.expectedResult}\nActual: ${input.actualResult}\nStatus: pending engineering triage; no confirmed fix time.`;
    run(
      "UPDATE tickets SET status='engineering',resolution=? WHERE id=?",
      [ticket.resolution, note].filter(Boolean).join("\n\n"),
      ticket.id,
    );
    return {
      ok: true,
      id,
      ticketId: ticket.id,
      status: "open",
      queue: "Engineering",
      fixAvailable: false,
      nextStep:
        "Engineering will review the recorded reproduction and error evidence. Updates belong on the linked support ticket; no confirmed ETA.",
    };
  });
}
export function hasEngineeringVerification(callId: string) {
  const call = getCall(callId);
  const handoff = one<EngineeringHandoff>(
    "SELECT * FROM engineering_handoffs WHERE call_id=?",
    callId,
  );
  const ticket =
    handoff &&
    one<Ticket>(
      "SELECT * FROM tickets WHERE id=? AND call_id=?",
      handoff.ticket_id,
      callId,
    );
  return (
    call.scenario === "export_engineering" &&
    customer(call.customer_id).export_bug === "renderer_regression" &&
    !!handoff &&
    ticket?.status === "engineering" &&
    engineeringEvidence(callId).ready
  );
}
