import { customer, getCall, one } from "@/lib/db";
import type { Activity } from "@/lib/types";
import { readCase } from "@/lib/simulation/cases";
import { hasEngineeringVerification } from "@/lib/engineering";

// Private evaluator: never imported into agent prompt construction.
export function evaluate(callId: string) {
  const call = getCall(callId);
  const account = customer(call.customer_id);
  const variant = readCase(call);
  const guidanceReady =
    call.scenario !== "report_guidance" ||
    (account.report_range === variant.targetRange &&
      variant.targetColumns.every((column) =>
        JSON.parse(account.report_columns).includes(column),
      ) &&
      !!account.report_applied &&
      !!account.report_downloaded);
  const passed =
    call.scenario === "account_locked"
      ? account.status === "active"
      : account.status === "active" &&
        account.role === "admin" &&
        account.export_format === "csv" &&
        account.export_job === "completed" &&
        account.export_bug === "none" &&
        guidanceReady;
  return {
    passed,
    check:
      call.scenario === "account_locked"
        ? "Account accepts sign-in"
        : call.scenario === "report_guidance"
          ? "Customer downloaded the requested period and columns"
          : "Authorized CSV export completed",
    checkedAt: new Date().toISOString(),
  };
}
export function hasVerification(callId: string) {
  const evidence = one<Activity>(
    "SELECT * FROM activities WHERE call_id=? AND name IN ('verify_fix','customer.download_report') AND success=1 ORDER BY id DESC LIMIT 1",
    callId,
  );
  return (
    !!evidence &&
    JSON.parse(evidence.output).ok === true &&
    evaluate(callId).passed
  );
}
export function hasOutcomeVerification(callId: string) {
  return hasVerification(callId) || hasEngineeringVerification(callId);
}
