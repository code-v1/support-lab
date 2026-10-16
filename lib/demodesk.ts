import { customer, log, one, run } from "@/lib/db";
import type { Scenario, ScenarioCase, Call } from "@/lib/types";
import { reportActionSchema, reportRows } from "@/lib/reporting";
export const baselineAccount =
  "status='active',role='admin',export_format='csv',export_job='idle',export_bug='none',recovery_failures=0,report_range='q1',report_columns='[\"revenue\",\"tickets\"]',draft_range='q1',draft_columns='[\"revenue\",\"tickets\"]',report_applied=1,report_downloaded=0,report_builder=0";

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
  if (account.export_bug !== "none") {
    const requestId = `REQ-${customerId.toUpperCase()}-RPT-502`;
    log(
      customerId,
      "error",
      "report.renderer.failed",
      `SummaryRenderer NullReference; release=report-worker@2.7.1; request=${requestId}; job failed before a file was created.`,
    );
    return {
      ok: false,
      error: `The report could not be generated. Reference ${requestId}. Please contact support.`,
      code: "REPORT_RENDERER_DEFECT",
      requestId,
      release: "report-worker@2.7.1",
    };
  }
  if (!account.report_applied)
    return {
      ok: false,
      error:
        "Your report selections have not been applied. Apply the preview before exporting.",
      code: "REPORT_DRAFT_NOT_APPLIED",
    };
  const columns = JSON.parse(account.report_columns) as (
    "revenue" | "tickets"
  )[];
  if (!columns.length)
    return {
      ok: false,
      error: "Choose at least one report column, then apply the preview.",
      code: "REPORT_COLUMNS_REQUIRED",
    };
  run("UPDATE customers SET export_job='completed' WHERE id=?", customerId);
  log(
    customerId,
    "info",
    "export.completed",
    "CSV report successfully generated.",
  );
  return {
    ok: true,
    csv:
      [
        "month," + columns.join(","),
        ...reportView(customerId).rows.map((row) =>
          [row.month, ...columns.map((column) => row[column])].join(","),
        ),
      ].join("\n") + "\n",
    code: "EXPORT_COMPLETED",
  };
}
export function inject(
  customerId: string,
  scenario: Scenario,
  variant?: ScenarioCase,
) {
  customer(customerId);
  run(`UPDATE customers SET ${baselineAccount} WHERE id=?`, customerId);
  if (variant?.noise)
    log(
      customerId,
      "warn",
      "notification.delivery_delayed",
      "An earlier receipt email is awaiting delivery; notification service remains available.",
    );
  if (scenario === "account_locked" || scenario === "export_multi_fault") {
    run("UPDATE customers SET status='locked' WHERE id=?", customerId);
    log(
      customerId,
      "warn",
      "security.lockout",
      "Account locked after repeated failed sign-in attempts.",
    );
  }
  if (scenario === "export_config" || scenario === "export_multi_fault") {
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
  if (scenario === "export_stuck" || scenario === "export_multi_fault") {
    run("UPDATE customers SET export_job='stuck' WHERE id=?", customerId);
    log(
      customerId,
      "warn",
      "export.started",
      "Export job started; no completion event received.",
    );
  }
  if (scenario === "report_guidance")
    run(
      "UPDATE customers SET report_builder=1,report_applied=0,draft_columns='[]' WHERE id=?",
      customerId,
    );
  if (scenario === "export_engineering")
    run(
      "UPDATE customers SET export_bug='renderer_regression' WHERE id=?",
      customerId,
    );
  if (variant?.recoveryFailures)
    run(
      "UPDATE customers SET recovery_failures=? WHERE id=?",
      variant.recoveryFailures,
      customerId,
    );
}
export function reportView(customerId: string) {
  const account = customer(customerId);
  const offset =
    ({ q1: 0, q2: 3, q3: 6 } as Record<string, number>)[account.report_range] ||
    0;
  return {
    range: account.report_range,
    columns: JSON.parse(account.report_columns) as string[],
    draftRange: account.draft_range,
    draftColumns: JSON.parse(account.draft_columns) as string[],
    applied: !!account.report_applied,
    downloaded: !!account.report_downloaded,
    rows: reportRows.slice(offset, offset + 3),
  };
}
export function useReportControls(customerId: string, raw: unknown) {
  const input = reportActionSchema.parse(raw);
  const account = customer(customerId);
  let result: { ok: boolean; error?: string; csv?: string; code?: string };
  if (account.status !== "active")
    result = { ok: false, error: "Sign in before using the report builder." };
  else if (input.action === "choose_range") {
    if (!input.range) throw new Error("Choose a report quarter.");
    run(
      "UPDATE customers SET draft_range=?,report_applied=0,report_downloaded=0 WHERE id=?",
      input.range,
      customerId,
    );
    result = { ok: true };
  } else if (input.action === "choose_columns") {
    if (!input.columns?.length) throw new Error("Choose at least one column.");
    run(
      "UPDATE customers SET draft_columns=?,report_applied=0,report_downloaded=0 WHERE id=?",
      JSON.stringify([...new Set(input.columns)]),
      customerId,
    );
    result = { ok: true };
  } else if (input.action === "apply_preview") {
    if (!JSON.parse(account.draft_columns).length)
      result = {
        ok: false,
        error: "Choose at least one column before applying the preview.",
      };
    else {
      run(
        "UPDATE customers SET report_range=draft_range,report_columns=draft_columns,report_applied=1,report_downloaded=0 WHERE id=?",
        customerId,
      );
      result = { ok: true };
    }
  } else {
    result = exportReport(customerId);
    if (result.ok)
      run("UPDATE customers SET report_downloaded=1 WHERE id=?", customerId);
  }
  log(
    customerId,
    result.ok ? "info" : "warn",
    `ui.${input.action}`,
    result.ok
      ? "Customer used report controls."
      : result.error || "Report action failed.",
  );
  const active = one<Call>(
    "SELECT * FROM calls WHERE customer_id=? AND status IN ('running','paused') ORDER BY started_at DESC LIMIT 1",
    customerId,
  );
  if (active)
    run(
      "INSERT INTO activities(call_id,name,input,output,success,duration_ms) VALUES (?,?,?,?,?,0)",
      active.id,
      `customer.${input.action}`,
      JSON.stringify(input),
      JSON.stringify(result),
      Number(result.ok),
    );
  return { ...result, view: reportView(customerId) };
}
// Only customer-visible symptoms cross into customer-agent context.
export function observe(
  customerId: string,
  symptom: "login" | "export" | "builder",
) {
  if (symptom === "builder") {
    const view = reportView(customerId);
    return {
      accessible: view.downloaded,
      observation: view.downloaded
        ? "My report downloaded successfully."
        : "I need help selecting the report period and columns, applying the preview, and downloading the right report.",
      report: view,
    };
  }
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
