import type { ModelConfig, Profile } from "@/lib/types";

export const providerKeys: Record<ModelConfig["provider"], string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export function defaultModel(
  provider: ModelConfig["provider"],
  profile: Profile,
) {
  if (provider === "openrouter") return recommendedProfiles[profile].model;
  if (provider === "openai")
    return profile === "advanced" ? "gpt-4.1" : "gpt-4.1-mini";
  const googleModel =
    profile === "advanced" ? "gemini-2.5-pro" : "gemini-2.5-flash";
  return googleModel;
}

export const recommendedProfiles: Record<Profile, Required<ModelConfig>> = {
  fast: {
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    reasoning: "off",
    maxOutputTokens: 1024,
  },
  balanced: {
    provider: "openrouter",
    model: "deepseek/deepseek-v4.1-flash",
    reasoning: "low",
    maxOutputTokens: 4096,
  },
  advanced: {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-5.5",
    reasoning: "medium",
    maxOutputTokens: 8192,
  },
};
export const reasoningLabels = {
  default: "Model default",
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;
export function reasoningOptions(
  modelId: string,
): NonNullable<ModelConfig["reasoning"]>[] {
  if (/^anthropic\/claude-(sonnet|opus)-5\.5(?:$|[-:])/.test(modelId))
    return ["default", "low", "medium", "high"];
  if (/^deepseek\/deepseek-v4\.1-flash(?:$|[-:])/.test(modelId))
    return ["default", "off", "low", "high"];
  return ["default", "off", "low", "medium", "high"];
}
export function defaultReasoning(
  provider: ModelConfig["provider"],
  profile: Profile,
) {
  return provider === "openrouter"
    ? recommendedProfiles[profile].reasoning
    : "default";
}
export function normalizeModelConfig(
  config: ModelConfig,
  profile: Profile,
): Required<ModelConfig> {
  const fallback = defaultReasoning(config.provider, profile);
  const reasoning =
    config.reasoning ??
    (config.provider === "openrouter" &&
    !reasoningOptions(config.model).includes(fallback)
      ? "default"
      : fallback);
  const maxOutputTokens =
    config.maxOutputTokens ?? recommendedProfiles[profile].maxOutputTokens;
  if (
    config.provider === "openrouter" &&
    !reasoningOptions(config.model).includes(reasoning)
  )
    throw new Error(
      `Reasoning setting ${reasoning} is not supported for ${config.model}.`,
    );
  if (
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 256 ||
    maxOutputTokens > 32768
  )
    throw new Error("Output token limit must be an integer from 256 to 32768.");
  return { ...config, reasoning, maxOutputTokens };
}
