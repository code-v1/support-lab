import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { all, customer, getCall, log, one, run } from "@/lib/db";
import { login, exportReport } from "@/lib/demodesk";
import { hasVerification } from "@/lib/evaluation";
import { settings } from "@/lib/ai/router";
import { validateRecipe } from "@/lib/learning/workflows";
import { catalog } from "./catalog";
import type { Article, Workflow, Ticket } from "@/lib/types";

const empty = z.object({}).strict();
export const toolSchemas: Record<string, z.ZodType> = {
  ...Object.fromEntries(
    [
      "get_customer",
      "get_account_status",
      "get_application_logs",
      "inspect_export_job",
      "repair_export_config",
      "retry_export",
      "verify_fix",
      "reproduce_export",
    ].map((name) => [name, empty]),
  ),
  update_account_status: z.object({ status: z.literal("active") }).strict(),
  search_knowledge: z.object({ query: z.string().min(1).max(250) }).strict(),
  run_workflow: z.object({ workflowId: z.string().max(100) }).strict(),
  create_ticket: z.object({ subject: z.string().min(1).max(200) }).strict(),
  update_ticket: z
    .object({
      status: z.enum(["open", "investigating", "resolved", "escalated"]),
      resolution: z.string().max(2000),
    })
    .strict(),
};
// Replaceable backend adapter boundary. Tools are always scoped to one call/account.
export interface SupportBackend {
  execute(callId: string, name: string, input: unknown): Promise<unknown>;
}
export class LocalSupportBackend implements SupportBackend {
  async execute(callId: string, name: string, raw: unknown): Promise<unknown> {
    const call = getCall(callId);
    if (!["running", "paused"].includes(call.status))
      throw new Error("Call is no longer active.");
    if (settings().disabledTools.includes(name))
      throw new Error(`Tool ${name} is disabled.`);
    if (
      name === "reproduce_export" &&
      process.env.ENABLE_BROWSER_TOOLS !== "true"
    )
      throw new Error("Browser tools are disabled.");
    const schema = toolSchemas[name];
    if (!schema) throw new Error("Tool is not approved.");
    if (call.tool_calls >= 60)
      throw new Error("Per-call limit of 60 tool executions reached.");
    const started = Date.now();
    let input: Record<string, unknown> = {};
    try {
      input = schema.parse(raw) as Record<string, unknown>;
      const output = await this.perform(callId, name, input);
      const success = !(
        typeof output === "object" &&
        output !== null &&
        "ok" in output &&
        output.ok === false
      );
      run(
        "INSERT INTO activities(call_id,name,input,output,success,duration_ms) VALUES (?,?,?,?,?,?)",
        callId,
        name,
        JSON.stringify(input),
        JSON.stringify(output),
        Number(success),
        Date.now() - started,
      );
      run("UPDATE calls SET tool_calls=tool_calls+1 WHERE id=?", callId);
      return output;
    } catch (error) {
      const output = {
        ok: false,
        error: error instanceof Error ? error.message : "Tool failed",
      };
      run(
        "INSERT INTO activities(call_id,name,input,output,success,duration_ms) VALUES (?,?,?,?,0,?)",
        callId,
        name,
        JSON.stringify(input),
        JSON.stringify(output),
        Date.now() - started,
      );
      run("UPDATE calls SET tool_calls=tool_calls+1 WHERE id=?", callId);
      return output;
    }
  }
  private async perform(
    callId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const call = getCall(callId),
      account = customer(call.customer_id);
    switch (name) {
      case "get_customer":
        return {
          id: account.id,
          name: account.name,
          email: account.email,
          company: account.company,
          role: account.role,
        };
      case "get_account_status":
        return { status: account.status, role: account.role };
      case "get_application_logs":
        return all(
          "SELECT level,event,detail,created_at FROM logs WHERE customer_id=? ORDER BY id DESC LIMIT 20",
          account.id,
        );
      case "inspect_export_job":
        return {
          format: account.export_format,
          jobStatus: account.export_job,
          supportedFormats: ["csv"],
          permission: account.role,
        };
      case "update_account_status": {
        if (account.status !== "locked")
          return {
            ok: false,
            error: "Only locked test accounts may be unlocked.",
          };
        run("UPDATE customers SET status='active' WHERE id=?", account.id);
        log(
          account.id,
          "info",
          "support.unlocked",
          "Authorized support API unlocked account.",
        );
        return { ok: true, status: "active" };
      }
      case "repair_export_config":
        if (account.export_format === "csv")
          return { ok: true, changed: false, format: "csv" };
        run("UPDATE customers SET export_format='csv' WHERE id=?", account.id);
        log(
          account.id,
          "info",
          "support.config_repaired",
          "Restored supported CSV export format.",
        );
        return {
          ok: true,
          changed: true,
          previousFormat: account.export_format,
          format: "csv",
        };
      case "retry_export":
        if (account.export_job === "stuck")
          run("UPDATE customers SET export_job='idle' WHERE id=?", account.id);
        return { ...exportReport(account.id), previousJob: account.export_job };
      case "verify_fix": {
        // Public reproduction uses observed tool context, never the private scenario label.
        const exportObserved = one(
          "SELECT id FROM activities WHERE call_id=? AND name IN ('inspect_export_job','retry_export','repair_export_config','reproduce_export')",
          callId,
        );
        return exportObserved ? exportReport(account.id) : login(account.id);
      }
      case "search_knowledge": {
        const query = String(input.query).toLowerCase();
        const terms = query.split(/\W+/).filter((t) => t.length > 2);
        if (/login|log.in|sign.in|access|locked|lockout|password/.test(query))
          terms.push("account", "locked");
        if (/export|report|download|csv/.test(query))
          terms.push("export", "report");
        const articles = all<Article>("SELECT * FROM articles")
          .filter((a) =>
            terms.some((t) =>
              (a.title + " " + a.body).toLowerCase().includes(t),
            ),
          )
          .slice(0, 5);
        const workflows = all<Workflow>(
          "SELECT * FROM workflows WHERE active=1",
        ).filter((w) => articles.some((a) => a.signature === w.signature));
        if (articles.length) {
          run("UPDATE calls SET knowledge_used=1 WHERE id=?", callId);
          for (const article of articles)
            run("UPDATE articles SET uses=uses+1 WHERE id=?", article.id);
        }
        return { articles, workflows };
      }
      case "run_workflow": {
        const workflow = one<Workflow>(
          "SELECT * FROM workflows WHERE id=? AND active=1",
          String(input.workflowId),
        );
        if (!workflow) throw new Error("Active workflow not found.");
        const recipe = validateRecipe(JSON.parse(workflow.recipe));
        const allowed =
          recipe.condition === "account_locked"
            ? account.status === "locked"
            : recipe.condition === "invalid_export_format"
              ? account.export_format !== "csv"
              : account.export_job === "stuck";
        if (!allowed)
          throw new Error(
            "Workflow precondition is not met. Inspect this account before choosing a recipe.",
          );
        if (
          recipe.steps.some((step) =>
            settings().disabledTools.includes(step.tool),
          )
        )
          throw new Error("Workflow contains a disabled tool.");
        const results = [];
        for (const step of recipe.steps) {
          const result = await this.execute(callId, step.tool, step.input);
          results.push({ tool: step.tool, result });
          if (
            result &&
            typeof result === "object" &&
            "ok" in result &&
            result.ok === false
          )
            return { ok: false, results };
        }
        run("UPDATE workflows SET uses=uses+1 WHERE id=?", workflow.id);
        run("UPDATE calls SET workflow_used=1 WHERE id=?", callId);
        return { ok: true, results };
      }
      case "create_ticket": {
        const existing = one<Ticket>(
          "SELECT * FROM tickets WHERE call_id=?",
          callId,
        );
        if (existing) return existing;
        const id = "T-" + crypto.randomUUID().slice(0, 8).toUpperCase();
        run(
          "INSERT INTO tickets(id,call_id,customer_id,subject,status) VALUES (?,?,?,?,'open')",
          id,
          callId,
          account.id,
          String(input.subject),
        );
        return { id, status: "open" };
      }
      case "update_ticket": {
        const ticket = one<Ticket>(
          "SELECT * FROM tickets WHERE call_id=?",
          callId,
        );
        if (!ticket) throw new Error("Create a ticket first.");
        if (input.status === "resolved" && !hasVerification(callId))
          throw new Error(
            "Ticket cannot be resolved until an actual customer action passes verification.",
          );
        run(
          "UPDATE tickets SET status=?,resolution=? WHERE call_id=?",
          String(input.status),
          String(input.resolution),
          callId,
        );
        return { ok: true, id: ticket.id, status: input.status };
      }
      case "reproduce_export": {
        const { reproduceExport } = await import("@/lib/simulation/browser");
        return reproduceExport(account.id);
      }
      default:
        throw new Error("Unapproved tool");
    }
  }
}
export const backend = new LocalSupportBackend();
export function agentTools(callId: string): ToolSet {
  const disabled = settings().disabledTools;
  return Object.fromEntries(
    catalog
      .filter(
        (t) =>
          !disabled.includes(t.name) &&
          (t.name !== "reproduce_export" ||
            process.env.ENABLE_BROWSER_TOOLS === "true"),
      )
      .map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: toolSchemas[t.name],
          execute: (input) => backend.execute(callId, t.name, input),
        }),
      ]),
  );
}
