# Support Lab

A local AI-to-AI support simulator. Customer agents encounter actual account and report-export problems in **DemoDesk**. A support agent investigates with scoped tools, repairs persistent application state, and verifies the customer action. A learning agent turns verified cases into searchable articles and validated JSON workflows for later calls.

## Run locally

Requires **Node.js 22.13+** (Node 24 LTS recommended) and npm. SQLite uses Node’s built-in `node:sqlite` module; no database service or native compilation is needed. Some Node versions print an experimental SQLite warning.

```sh
npm install
npm run dev
```

Open [Support Lab](http://127.0.0.1:3000) and [DemoDesk](http://127.0.0.1:3000/demodesk). The database and three customer personas initialize automatically. No calls, articles, or successful outcomes are seeded. The UI works without API keys and explains what configuration is missing.

Explicit initialization is also available:

```sh
npm run db:init
```

## Configure models

Copy `.env.example` to `.env.local`, add a provider key, and restart the development server. Choose any model your provider account supports. Model IDs below are configurable examples, not a claim about current availability or pricing.

OpenRouter example (the included `.env.example` uses this setup):

```dotenv
OPENROUTER_API_KEY=your-key
FAST_PROVIDER=openrouter
FAST_MODEL=anthropic/claude-haiku-5.5
FAST_REASONING=off
FAST_MAX_OUTPUT_TOKENS=1024
BALANCED_PROVIDER=openrouter
BALANCED_MODEL=deepseek/deepseek-v4.1-flash
BALANCED_REASONING=low
BALANCED_MAX_OUTPUT_TOKENS=4096
ADVANCED_PROVIDER=openrouter
ADVANCED_MODEL=anthropic/claude-sonnet-5.5
ADVANCED_REASONING=medium
ADVANCED_MAX_OUTPUT_TOKENS=8192
```

OpenRouter uses one key for all three profiles; direct OpenAI or Gemini keys are not needed when every profile uses OpenRouter. Enter the complete `provider/model` ID from the [OpenRouter catalog](https://openrouter.ai/models). Choose tool-capable models for support and structured-output-capable models for learning. You can change models individually in Agent Settings. The official OpenRouter adapter is pinned to the release compatible with this app's AI SDK 6.

The recommended preset uses Haiku for customers and learning, DeepSeek for routine support, and Sonnet for escalations. In **Agent Settings**, **Use recommended lineup** fills the three profiles; **Save configuration** persists them. Each profile has a reasoning selector and output token limit (256–32,768). Limits apply to each model generation step, including reasoning and visible output; they are not a total budget for the call. Fast's limit is shared by its customer and learning requests. Responses are still prompted to stay concise.

OpenRouter reasoning values are `default`, `off`, `low`, `medium`, or `high`. `default` leaves the model's behavior unchanged; `off` explicitly disables thinking where supported. The recommended Haiku preset disables thinking, DeepSeek uses low effort, and Sonnet uses medium effort. Known model restrictions are validated in the UI and backend: Sonnet/Opus 5.5 cannot turn reasoning off, and DeepSeek V4.1 Flash does not accept medium effort. Other models may support a different subset; consult their OpenRouter listing. These controls are sent only to OpenRouter; direct Google and OpenAI profiles retain provider defaults. Older saved profiles retain their model assignments and receive default limits when those settings are missing.

The Advanced support request allows up to 180 seconds; routine support requests allow 90 seconds. Larger token caps allow longer thinking but can increase usage. See [OpenRouter's reasoning budget documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Google Gemini example:

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=your-key
FAST_PROVIDER=google
FAST_MODEL=gemini-2.5-flash
BALANCED_PROVIDER=google
BALANCED_MODEL=gemini-2.5-flash
ADVANCED_PROVIDER=google
ADVANCED_MODEL=gemini-2.5-pro
```

OpenAI example:

```dotenv
OPENAI_API_KEY=your-key
FAST_PROVIDER=openai
FAST_MODEL=gpt-4.1-mini
BALANCED_PROVIDER=openai
BALANCED_MODEL=gpt-4.1-mini
ADVANCED_PROVIDER=openai
ADVANCED_MODEL=gpt-4.1
```

You can mix providers across profiles. **Fast** handles customers and learning; **Balanced** handles support tools; **Advanced** takes over after two unresolved support exchanges. Requests have timeouts, one retry, a six-step tool loop per support exchange, a maximum of 60 tool executions per call, and a configurable 2–12 support-turn limit (the UI offers 4, 6, 8, or 12). Token usage is stored when providers supply it. Dollar costs are deliberately not estimated.

Change provider/model assignments in **Agent Settings**. Saved dashboard settings override environment model assignments. Keys stay exclusively in the server environment and are never returned by the API. The dashboard requires all three profiles to have their corresponding key before starting a call. There is no fake/offline AI mode.

Provider references: [Vercel AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider), [OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai), [Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google), [official OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling).

## Required two-call learning demonstration

1. Configure your models. Select **Maya Chen → Account lockout** in Overview and start the simulation. Starting a call resets that account to a baseline and injects a real lockout.
2. In Live Simulation, follow the original text, customer/support voices, actual tool calls, ticket creation, unlock, and sign-in verification. The customer confirms the observed result. Only a successful application check permits a resolved ticket/outcome.
3. Open **Knowledge**. A successful learning model request creates an evidence-linked article and an active, validated workflow. If learning fails, the verified call stays resolved and offers **Retry learning**.
4. Choose **Reset & replay**, preserving knowledge. This resets all test accounts and advances the batch; history is retained. New calls re-inject the selected problem.
5. Select **Oliver Brooks → Account lockout**. He describes the same visible problem in his own style. The support agent is instructed to search knowledge and use an appropriate workflow. Retrieval and workflow execution are recorded, rather than presumed.
6. Open **Results**. Compare turns, tool calls, and verified outcomes for equivalent scenarios with and without knowledge retrieval. Results reflect what happened; the app never promises that an LLM will improve on every run. Model and persona differences can affect the comparison.

Also try **Report export failure** (invalid persistent output configuration) and **Stuck export job**. Each requires actual state inspection and an export that completes successfully. You can inject the currently selected scenario into a customer manually from CRM, then use that customer's DemoDesk link to inspect the symptom.

## Voice and simulation controls

Each server step advances exactly one speaker. The browser plays that message before requesting the next agent, keeping voice separate from text orchestration. Select voices in Agent Settings; automatic assignment uses different installed English voices when available, with different pitch as a fallback. Browser and OS voice availability varies.

Live Simulation includes pause/resume, stop, mute, speed, full transcript and voice replay. Pause stops speech and prevents the next request; a model/tool request already in progress can finish. Muting continues text orchestration. Text-only fast mode skips speech and shortens the interval between steps. A browser tab must remain open to advance calls; reopening the dashboard resumes an active call. Refreshing does not duplicate completed speaker steps. Opening multiple controlling tabs is discouraged; a database lease rejects overlapping requests.

## Browser troubleshooting

```sh
npm run browser:install
```

Add to `.env.local` and restart:

```dotenv
ENABLE_BROWSER_TOOLS=true
APP_BASE_URL=http://127.0.0.1:3000
```

The `reproduce_export` tool launches an isolated headless Chromium session, signs into the current test account, opens the dashboard, attempts export, and returns the visible result. Its URL is restricted to local HTTP. It cannot browse arbitrary URLs or execute arbitrary agent-generated code. Start/reset restores the baseline, while the reproduction itself observes the currently injected problem. If Chromium is not installed, the tool returns an observable error; the agent can continue through the application APIs.

## Architecture

- `app/`: Next.js dashboard, DemoDesk UI and JSON route handlers.
- `lib/db/`: one SQLite database, schema, seed and query helpers.
- `lib/demodesk.ts`: functioning account access and CSV export rules.
- `lib/ai/`: configurable provider router and model/token usage.
- `lib/agents/`: customer symptom-limited prompts and tool-using support agent.
- `lib/tools/`: Zod-validated, account-scoped tools and the replaceable `SupportBackend` adapter.
- `lib/simulation/`: persistent speaker loop, call lease, escalation, replay and browser reproduction.
- `lib/evaluation/`: private scenario checks against actual application state.
- `lib/learning/`: evidence-gated learning and declarative workflow validation.
- `lib/voice/`: browser SpeechSynthesis playback, independent of the model loop.

Scenario injection/evaluation labels are never included in the agents’ prompts. The customer sees only visible symptoms and conversation history. Support sees customer contact details, conversation, and actual tool observations. The learning agent sees the transcript and recorded execution evidence after independent verification. Articles include source-call evidence; deduplication uses the observed repair signature. Workflows derive from successful approved repair tools, are validated before activation and execution, check a specific precondition, bind automatically to the current account, honor disabled tools, and end in verification.

`SupportBackend` is the seam for future CRM integrations such as Zendesk or Dynamics. The MVP intentionally includes no authentication or enterprise infrastructure. The dev/start scripts bind to loopback; keep this simulator local. DemoDesk’s account selector is a test harness, not real authentication.

## Persistence and replay

Default database: `data/support-lab.sqlite` (override `DATABASE_PATH`). WAL is enabled. Model settings, accounts, tickets, transcripts, tools, usage, knowledge, and workflows persist across restarts. Reset restores the SaaS baseline and increments the batch. It preserves historical calls/tickets/results and optionally clears articles/workflows. Pending work is protected from reset and configuration changes while its current request runs.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run browser:install
npm run test:browser
```

Vitest covers real database behavior, scoped tools, permissions, verification, workflow safety, learning gating/deduplication, replay, and orchestration errors/escalation. **Model responses are mocked only in automated tests**; these tests do not establish real provider availability or live model quality. Unit tests use isolated temporary SQLite databases.

Playwright builds into `.next-browser-tests/` and runs a production server on port 3100 with a separate database (`data/browser-test.sqlite`). It checks dashboard navigation, no-key behavior, provider settings persistence, actual login lockout, export failure/recovery, reset and mobile overflow. The tests do not use your normal database or make paid AI calls. The test runner starts and stops its own server; production mode avoids competing development-server refreshes.

The browser suite also exercises the actual approved export-reproduction function and checks speaker sequencing, different voice assignments, pause, and resume using test-only speech/network doubles. These doubles do not verify audible output on a physical device.

Live provider calls were deferred at the user's request. Saved previews are in `artifacts/`. Provider routing tests cover OpenRouter key requirements, vendor-prefixed model IDs, persisted profiles, token usage, error redaction, reasoning validation, and outgoing reasoning/token parameters through the actual SDK adapter with a mocked network transport.

## MVP limits

Two issue families and three starter personas are supported. Knowledge search is lightweight lexical matching; workflow proposal uses approved recipes derived from repair evidence. Calls run serially and are driven by the open browser, rather than a background worker. No realtime audio, speech recognition, external telephony, unrestricted shell, or generated executable workflows are included. Live provider calls require your keys and model access; browser audio must be checked on your device.
