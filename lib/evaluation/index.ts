import { customer, getCall, one } from "@/lib/db";
import type { Activity } from "@/lib/types";

// Private evaluator: never imported into agent prompt construction.
export function evaluate(callId: string) {
  const call = getCall(callId);
  const account = customer(call.customer_id);
  const passed =
    call.scenario === "account_locked"
      ? account.status === "active"
      : account.status === "active" &&
        account.role === "admin" &&
        account.export_format === "csv" &&
        account.export_job === "completed";
  return {
    passed,
    check:
      call.scenario === "account_locked"
        ? "Account accepts sign-in"
        : "Authorized CSV export completed",
    checkedAt: new Date().toISOString(),
  };
}
export function hasVerification(callId: string) {
  const evidence = one<Activity>(
    "SELECT * FROM activities WHERE call_id=? AND name='verify_fix' AND success=1 ORDER BY id DESC LIMIT 1",
    callId,
  );
  return (
    !!evidence &&
    JSON.parse(evidence.output).ok === true &&
    evaluate(callId).passed
  );
}
