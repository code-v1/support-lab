import { z } from "zod";
export const recipeToolNames = [
  "get_account_status",
  "get_application_logs",
  "inspect_export_job",
  "update_account_status",
  "repair_export_config",
  "retry_export",
  "verify_fix",
] as const;
export const recipeSchema = z
  .object({
    version: z.literal(1),
    condition: z.enum([
      "account_locked",
      "invalid_export_format",
      "stuck_export_job",
      "compound_export",
    ]),
    steps: z
      .array(
        z
          .object({
            tool: z.enum(recipeToolNames),
            input: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;
export function validateRecipe(input: unknown): Recipe {
  const recipe = recipeSchema.parse(input);
  if (recipe.steps.at(-1)?.tool !== "verify_fix")
    throw new Error("Workflow must end with application verification.");
  for (const step of recipe.steps) {
    if (step.tool === "update_account_status")
      z.object({ status: z.literal("active") })
        .strict()
        .parse(step.input);
    else z.object({}).strict().parse(step.input);
  }
  const allowed: Record<Recipe["condition"], string[]> = {
    account_locked: [
      "get_account_status",
      "update_account_status",
      "verify_fix",
    ],
    invalid_export_format: [
      "get_account_status",
      "get_application_logs",
      "inspect_export_job",
      "repair_export_config",
      "retry_export",
      "verify_fix",
    ],
    stuck_export_job: [
      "get_account_status",
      "get_application_logs",
      "inspect_export_job",
      "retry_export",
      "verify_fix",
    ],
    compound_export: [
      "get_account_status",
      "get_application_logs",
      "inspect_export_job",
      "update_account_status",
      "repair_export_config",
      "retry_export",
      "verify_fix",
    ],
  };
  if (
    recipe.steps.some((step) => !allowed[recipe.condition].includes(step.tool))
  )
    throw new Error(
      "Workflow action does not match its validated precondition.",
    );
  return recipe;
}
