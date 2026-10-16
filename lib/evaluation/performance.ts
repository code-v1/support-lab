import type { Activity, Call, CallPerformance, Usage } from "@/lib/types";
import { readCase } from "@/lib/simulation/cases";
export function performance(
  call: Call,
  activities: Activity[],
  usage: Usage[],
): CallPerformance {
  const events = activities.filter((event) => event.call_id === call.id);
  let avoidable = 0,
    verified = false,
    rendererFailed = false;
  for (const event of events) {
    const result = JSON.parse(event.output);
    if (
      [
        "customer.choose_range",
        "customer.choose_columns",
        "customer.apply_preview",
      ].includes(event.name)
    )
      verified = false;
    if (
      [
        "update_account_status",
        "repair_export_config",
        "retry_export",
      ].includes(event.name) &&
      event.success &&
      result.changed !== false
    )
      verified = false;
    if (event.name === "verify_fix" && event.success && result.ok) {
      if (verified) avoidable++;
      verified = true;
    }
    if (event.name === "repair_export_config" && result.changed === false)
      avoidable++;
    if (!event.success && /precondition|Only locked/.test(result.error || ""))
      avoidable++;
    if (
      event.name === "retry_export" &&
      result.code === "REPORT_RENDERER_DEFECT"
    ) {
      if (rendererFailed) avoidable++;
      rendererFailed = true;
    }
  }
  const variant = readCase(call);
  return {
    call_id: call.id,
    supportTools: call.tool_calls,
    customerActions: events.filter((event) =>
      event.name.startsWith("customer."),
    ).length,
    avoidableActions: avoidable,
    failedTools: events.filter(
      (event) => !event.name.startsWith("customer.") && !event.success,
    ).length,
    failedCustomerActions: events.filter(
      (event) => event.name.startsWith("customer.") && !event.success,
    ).length,
    modelTokens: usage
      .filter((event) => event.call_id === call.id)
      .reduce(
        (sum, event) =>
          sum + (event.input_tokens || 0) + (event.output_tokens || 0),
        0,
      ),
    toolMilliseconds: events.reduce((sum, event) => sum + event.duration_ms, 0),
    referenceTools: variant.referenceTools + variant.recoveryFailures,
    referenceTurns: variant.referenceTurns + (variant.followUp ? 1 : 0),
    completedOutcome: !!(call.outcome_verified || call.verified),
  };
}
