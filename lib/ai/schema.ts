import { z } from "zod";
import { reasoningOptions } from "./config";
export const modelConfigSchema = z
  .object({
    provider: z.enum(["openai", "google", "openrouter"]),
    model: z.string().trim().min(1).max(150),
    reasoning: z.enum(["default", "off", "low", "medium", "high"]).optional(),
    maxOutputTokens: z.number().int().min(256).max(32768).optional(),
  })
  .superRefine((config, context) => {
    if (
      config.provider === "openrouter" &&
      config.reasoning &&
      !reasoningOptions(config.model).includes(config.reasoning)
    )
      context.addIssue({
        code: "custom",
        path: ["reasoning"],
        message: `Reasoning setting ${config.reasoning} is not supported for ${config.model}.`,
      });
  });
