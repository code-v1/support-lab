import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configuration,
  generationSettings,
  model,
  recordUsage,
  settings,
} from "@/lib/ai/router";
import {
  defaultModel,
  normalizeModelConfig,
  recommendedProfiles,
} from "@/lib/ai/config";
import { modelConfigSchema } from "@/lib/ai/schema";
import { generateText } from "ai";
import { safeError } from "@/lib/simulation/orchestrator";
import { all, one, run } from "@/lib/db";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv(
    "DATABASE_PATH",
    join(mkdtempSync(join(tmpdir(), "support-lab-router-")), "test.sqlite"),
  );
  for (const profile of ["FAST", "BALANCED", "ADVANCED"]) {
    vi.stubEnv(`${profile}_PROVIDER`, "openrouter");
    vi.stubEnv(`${profile}_MODEL`, "");
    vi.stubEnv(`${profile}_REASONING`, "");
    vi.stubEnv(`${profile}_MAX_OUTPUT_TOKENS`, "");
  }
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
});
it("requires only the OpenRouter key when all three profiles use OpenRouter", () => {
  expect(configuration()).toMatchObject({
    ready: false,
    missing: ["OPENROUTER_API_KEY"],
  });
  expect(() => model("balanced")).toThrow("OPENROUTER_API_KEY");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-openrouter-key");
  expect(configuration()).toMatchObject({ ready: true, missing: [] });
});
it("constructs an OpenRouter model using its vendor-prefixed ID", () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-openrouter-key");
  vi.stubEnv("BALANCED_MODEL", "anthropic/claude-sonnet-4");
  const result = model("balanced");
  expect(result.modelId).toBe("anthropic/claude-sonnet-4");
  expect(result.provider).toContain("openrouter");
  expect(defaultModel("openrouter", "advanced")).toBe(
    "anthropic/claude-sonnet-5.5",
  );
});

it("applies the recommended roles, reasoning controls, and token budgets", () => {
  expect(settings().profiles).toEqual(recommendedProfiles);
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
  expect(generationSettings("fast")).toMatchObject({
    maxOutputTokens: 1024,
    providerOptions: { openrouter: { reasoning: { enabled: false } } },
  });
  expect(generationSettings("balanced")).toMatchObject({
    maxOutputTokens: 4096,
    providerOptions: { openrouter: { reasoning: { effort: "low" } } },
  });
  expect(generationSettings("advanced")).toMatchObject({
    maxOutputTokens: 8192,
    providerOptions: { openrouter: { reasoning: { effort: "medium" } } },
  });
});
it("keeps older saved model assignments and fills in missing controls", () => {
  run(
    "INSERT INTO meta(key,value) VALUES ('settings',?)",
    JSON.stringify({
      profiles: {
        fast: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" },
        balanced: { provider: "google", model: "gemini-2.5-flash" },
        advanced: { provider: "openai", model: "gpt-4.1" },
      },
      disabledTools: [],
    }),
  );
  expect(settings().profiles.fast).toMatchObject({
    model: "anthropic/claude-sonnet-5.5",
    reasoning: "default",
    maxOutputTokens: 1024,
  });
  expect(settings().profiles.advanced).toMatchObject({
    provider: "openai",
    reasoning: "default",
    maxOutputTokens: 8192,
  });
});
it("reads environment overrides and rejects invalid effort or token settings", () => {
  vi.stubEnv("ADVANCED_REASONING", "low");
  vi.stubEnv("ADVANCED_MAX_OUTPUT_TOKENS", "12000");
  expect(settings().profiles.advanced).toMatchObject({
    reasoning: "low",
    maxOutputTokens: 12000,
  });
  expect(() =>
    modelConfigSchema.parse({
      ...recommendedProfiles.advanced,
      reasoning: "off",
    }),
  ).toThrow("not supported");
  expect(() =>
    modelConfigSchema.parse({
      ...recommendedProfiles.balanced,
      reasoning: "medium",
    }),
  ).toThrow("not supported");
  expect(() =>
    modelConfigSchema.parse({
      ...recommendedProfiles.fast,
      maxOutputTokens: 1000000,
    }),
  ).toThrow();
  expect(() =>
    normalizeModelConfig(
      { ...recommendedProfiles.fast, maxOutputTokens: 0 },
      "fast",
    ),
  ).toThrow("token limit");
});
it("omits OpenRouter reasoning controls for direct providers and model-default mode", () => {
  vi.stubEnv("FAST_PROVIDER", "google");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-only-google-key");
  expect(generationSettings("fast").providerOptions).toBeUndefined();
  vi.stubEnv("FAST_PROVIDER", "openrouter");
  vi.stubEnv("FAST_REASONING", "default");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
  expect(generationSettings("fast").providerOptions).toBeUndefined();
});
it.each(["fast", "balanced", "advanced"] as const)(
  "sends %s reasoning and limits through the actual SDK adapter",
  async (profile) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only-key");
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "test-completion",
            object: "chat.completion",
            created: 1,
            model: recommendedProfiles[profile].model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Test response." },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateText({
      ...generationSettings(profile),
      prompt: "Test only; no network.",
      maxRetries: 0,
    });
    expect(result.text).toBe("Test response.");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: recommendedProfiles[profile].model,
      max_tokens: recommendedProfiles[profile].maxOutputTokens,
      reasoning:
        profile === "fast"
          ? { enabled: false }
          : { effort: recommendedProfiles[profile].reasoning },
    });
  },
);
it("honors persisted OpenRouter profiles and detects keys in mixed setups", () => {
  const saved = settings();
  saved.profiles.advanced = { provider: "openai", model: "gpt-4.1" };
  run(
    "INSERT INTO meta(key,value) VALUES ('settings',?)",
    JSON.stringify(saved),
  );
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-openrouter-key");
  expect(configuration().missing).toEqual(["OPENAI_API_KEY"]);
  expect(settings().profiles.balanced.provider).toBe("openrouter");
});
it("records the OpenRouter provider and token counts without leaking its key", () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test-only-openrouter-key");
  run(
    "INSERT INTO calls(id,customer_id,scenario,status,max_turns,batch) VALUES ('router-test','maya','account_locked','failed',4,1)",
  );
  recordUsage("router-test", "support", "balanced", {
    inputTokens: 80,
    outputTokens: 20,
  });
  expect(
    one("SELECT provider,input_tokens,output_tokens FROM usage"),
  ).toMatchObject({
    provider: "openrouter",
    input_tokens: 80,
    output_tokens: 20,
  });
  expect(JSON.stringify(settings())).not.toContain("test-only-openrouter-key");
  expect(safeError(new Error("Invalid key: test-only-openrouter-key"))).toBe(
    "Invalid key: [redacted]",
  );
  expect(all("SELECT id FROM articles")).toHaveLength(0);
});
