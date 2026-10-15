import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defaultModel, providerKeys, normalizeModelConfig } from "./config";
import { one, run } from "@/lib/db";
import type { Profile, Settings } from "@/lib/types";
import { modelConfigSchema } from "./schema";

export function settings(): Settings {
  const saved = one<{ value: string }>(
    "SELECT value FROM meta WHERE key='settings'",
  );
  if (saved) {
    const value: Settings = JSON.parse(saved.value);
    return {
      ...value,
      profiles: Object.fromEntries(
        (["fast", "balanced", "advanced"] as const).map((profile) => [
          profile,
          normalizeModelConfig(
            modelConfigSchema.parse(value.profiles[profile]),
            profile,
          ),
        ]),
      ) as Settings["profiles"],
    };
  }
  return {
    profiles: Object.fromEntries(
      (["fast", "balanced", "advanced"] as const).map((profile) => {
        const prefix = profile.toUpperCase();
        const provider = process.env[`${prefix}_PROVIDER`] || "google";
        if (
          provider !== "openai" &&
          provider !== "google" &&
          provider !== "openrouter"
        )
          throw new Error(
            `${prefix}_PROVIDER must be openai, google, or openrouter`,
          );
        return [
          profile,
          normalizeModelConfig(
            modelConfigSchema.parse({
              provider,
              model:
                process.env[`${prefix}_MODEL`] ||
                defaultModel(provider, profile),
              reasoning: process.env[`${prefix}_REASONING`] || undefined,
              maxOutputTokens: process.env[`${prefix}_MAX_OUTPUT_TOKENS`]
                ? Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`])
                : undefined,
            }),
            profile,
          ),
        ];
      }),
    ) as Settings["profiles"],
    disabledTools: [],
  };
}
export function generationSettings(profile: Profile) {
  const config = normalizeModelConfig(settings().profiles[profile], profile);
  const providerOptions:
    | { openrouter: { reasoning: { enabled: boolean } | { effort: string } } }
    | undefined =
    config.provider === "openrouter" && config.reasoning !== "default"
      ? {
          openrouter: {
            reasoning:
              config.reasoning === "off"
                ? { enabled: false }
                : { effort: config.reasoning },
          },
        }
      : undefined;
  return {
    model: model(profile),
    maxOutputTokens: config.maxOutputTokens,
    providerOptions,
  };
}
export function configuration() {
  const missing = new Set<string>();
  for (const [profile, config] of Object.entries(settings().profiles)) {
    const key = providerKeys[config.provider];
    if (!process.env[key]) missing.add(key);
    if (!config.model.trim()) missing.add(`${profile.toUpperCase()}_MODEL`);
  }
  return {
    ready: missing.size === 0,
    missing: [...missing],
    browserEnabled: process.env.ENABLE_BROWSER_TOOLS === "true",
  };
}
export function model(profile: Profile) {
  const config = settings().profiles[profile];
  const keyName = providerKeys[config.provider];
  const key = process.env[keyName];
  if (!key)
    throw new Error(
      `Configure ${keyName} in .env.local and restart the server.`,
    );
  if (config.provider === "openrouter")
    return createOpenRouter({ apiKey: key })(config.model);
  return config.provider === "openai"
    ? createOpenAI({ apiKey: key })(config.model)
    : createGoogleGenerativeAI({ apiKey: key })(config.model);
}
export function recordUsage(
  callId: string,
  role: string,
  profile: Profile,
  usage: { inputTokens?: number; outputTokens?: number },
) {
  const config = settings().profiles[profile];
  run(
    "INSERT INTO usage(call_id,role,profile,provider,model,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?)",
    callId,
    role,
    profile,
    config.provider,
    config.model,
    usage.inputTokens ?? null,
    usage.outputTokens ?? null,
  );
}
