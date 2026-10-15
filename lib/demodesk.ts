import { customer, log, run } from "@/lib/db";
import type { Scenario } from "@/lib/types";

export function login(customerId: string) {
  const account = customer(customerId);
  if (account.status !== "active") {
    log(customerId, "error", "login.denied", "Account access is restricted.");
    return {
      ok: false,
      error: "Your account is unavailable. Please contact support.",
      code: "ACCESS_RESTRICTED",
    };
  }
  log(customerId, "info", "login.succeeded", "Customer accessed DemoDesk.");
  return { ok: true, name: account.name, company: account.company };
}
export function exportReport(customerId: string) {
  const account = customer(customerId);
  if (account.status !== "active")
    return {
      ok: false,
      error: "Sign in to export a report.",
      code: "ACCESS_RESTRICTED",
    };
  if (account.role !== "admin")
    return {
      ok: false,
      error: "Report export requires admin permission.",
      code: "PERMISSION_DENIED",
    };
  if (account.export_format !== "csv") {
    log(
      customerId,
      "error",
      "export.failed",
      `Unsupported export format: ${account.export_format}`,
    );
    return {
      ok: false,
      error: "Report export failed. Please contact support.",
      code: "INVALID_EXPORT_FORMAT",
    };
  }
  if (account.export_job === "stuck") {
    log(
      customerId,
      "error",
      "export.timeout",
      "Previous export job exceeded its execution window.",
    );
    return {
      ok: false,
      error: "An export is already in progress. Please try again later.",
      code: "EXPORT_JOB_TIMEOUT",
    };
  }
  run("UPDATE customers SET export_job='completed' WHERE id=?", customerId);
  log(
    customerId,
    "info",
    "export.completed",
    "CSV report successfully generated.",
  );
  return {
    ok: true,
    csv: "month,revenue,tickets\nJanuary,12400,86\nFebruary,15800,102\nMarch,18200,94\n",
    code: "EXPORT_COMPLETED",
  };
}
export function inject(customerId: string, scenario: Scenario) {
  customer(customerId);
  run(
    "UPDATE customers SET status='active',role='admin',export_format='csv',export_job='idle' WHERE id=?",
    customerId,
  );
  if (scenario === "account_locked") {
    run("UPDATE customers SET status='locked' WHERE id=?", customerId);
    log(
      customerId,
      "warn",
      "security.lockout",
      "Account locked after repeated failed sign-in attempts.",
    );
  }
  if (scenario === "export_config") {
    run(
      "UPDATE customers SET export_format='legacy_xml' WHERE id=?",
      customerId,
    );
    log(
      customerId,
      "warn",
      "settings.updated",
      "Report output configuration was changed.",
    );
  }
  if (scenario === "export_stuck") {
    run("UPDATE customers SET export_job='stuck' WHERE id=?", customerId);
    log(
      customerId,
      "warn",
      "export.started",
      "Export job started; no completion event received.",
    );
  }
}
// Only customer-visible symptoms cross into customer-agent context.
export function observe(customerId: string, symptom: "login" | "export") {
  const result =
    symptom === "login" ? login(customerId) : exportReport(customerId);
  return {
    accessible: result.ok,
    observation: result.ok
      ? symptom === "login"
        ? "I can sign in and see my dashboard."
        : "My CSV report downloaded successfully."
      : result.error,
  };
}
