# Support Lab

A local AI-to-AI support simulator. Customer agents encounter account problems, report failures and knowledge gaps in **DemoDesk**. A support agent investigates with scoped tools, repairs persistent application state, coaches customers through real controls, or files an evidence-backed engineering handoff. A learning agent turns verified resolutions into searchable articles and validated JSON repair workflows for later calls.

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

OpenRouter uses one key for all three profiles; direct OpenAI or Gemini keys are not needed when every profile uses OpenRouter. Enter the complete `provider/model` ID from the [OpenRouter catalog](https://openrouter.ai/models). Choose tool-capable models for support and structured-output-capable models for the Fast profile's completion checks and learning. You can change models individually in Agent Settings. The official OpenRouter adapter is pinned to the release compatible with this app's AI SDK 6.

The recommended preset uses Haiku for customers, completion checks and learning, DeepSeek for routine support, and Sonnet for escalations. In **Agent Settings**, **Use recommended lineup** fills the three profiles; **Save configuration** persists them. Each profile has a reasoning selector and output token limit (256–32,768). Limits apply to each model generation step, including reasoning and visible output; they are not a total budget for the call. Fast's limit is shared by its customer, completion-check and learning requests. Responses are still prompted to stay concise.

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

You can mix providers across profiles. **Fast** handles customers, completion checks and learning; **Balanced** handles routine support; **Advanced** handles ambiguous/failed completion checks and takes over support after two exchanges without customer completion. Investigation uses up to six tool steps plus an internal handoff; a separate, tool-free generation from the selected support profile writes the spoken reply. Replies target 1–3 sentences and at most 75 words. Logs, unchanged settings and speculative causes stay internal unless the customer asks. After a verified repair, explanatory follow-ups cannot rerun repair/verification tools unless the reviewer identifies a continuing application failure.

Requests have timeouts, one retry, a maximum of 60 tool executions per call, and a configurable 2–12 support-turn limit (the UI offers 4, 6, 8, or 12). Token usage includes investigation, spoken replies and each completion-review attempt. Dollar costs are deliberately not estimated.

## Repair verification and conversation completion

A working application action establishes **repair verified**, not a finished conversation. After support responds, the customer gets a chance to confirm or ask a follow-up. When the repair is verified, a separate structured assessment checks acceptance, actual unanswered questions, a sufficient explanation, and material claims against tool evidence. A thank-you followed by a concern is not acceptance. A short "okay" after an explanation, or a plan to contact support if a future problem recurs, can be acceptance. The reviewer must not invent additional needs, demand repeated verification, or confuse a current export attempt with an earlier stalled job.

The reviewer accepts schema-validated tool arguments or JSON text, using automatic tool choice for compatibility with reasoning-enabled provider routes. Decision fields remain strict; long display explanations are shortened instead of rejecting an otherwise valid decision. Fast handles straightforward decisions; Advanced provides a second opinion when Fast fails or returns an ambiguous decision. If both fail, the call pauses and offers **Retry completion review**. Retrying reviews the existing customer response without generating another exchange. Internal review errors are excluded from customer and support conversation context. See [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling) and [Claude thinking/tool-choice compatibility](https://platform.claude.com/docs/en/build-with-claude/extended-thinking).

The assessment and actual outstanding questions are saved and displayed in Live Simulation. Acceptance is bound to that exact customer message. The next speaker step emits one short, tool-free closing statement (for example, "You're all set, Jules. Thanks for contacting DemoDesk support—have a good day.") and finishes the call, with no new question or verification. This closing does not consume another investigation turn. Ticket closure and learning require verified repair plus accepted completion. The support agent saves repair details while investigating; later notes append rather than replace evidence, and final closure preserves those notes.

One turn counts a support response to a customer message. The customer can respond after the final allowed support turn. If they still need help, the call becomes **incomplete**, its ticket is escalated, and learning is skipped. If they confirm completion on that final response and all checks pass, it can resolve. Completion assessment uses an AI model and remains probabilistic; application verification and enforcement of the closure conditions are deterministic. Existing transcripts remain historical records; older resolved calls have no customer-completion assessment.

Change provider/model assignments in **Agent Settings**. Saved dashboard settings override environment model assignments. Keys stay exclusively in the server environment and are never returned by the API. The dashboard requires all three profiles to have their corresponding key before starting a call. There is no fake/offline AI mode.

Provider references: [Vercel AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider), [OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai), [Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google), [official OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling).

## Required two-call learning demonstration

1. Configure your models. Select **Maya Chen → Account lockout** in Overview and start the simulation. Starting a call resets that account to a baseline and injects a real lockout.
2. In Live Simulation, follow the original text, customer/support voices, actual tool calls, ticket creation, unlock, and sign-in verification. Customer questions continue after the fix; only verified repair plus assessed customer confirmation permits a resolved ticket/outcome.
3. Open **Knowledge**. A successful learning model request creates an evidence-linked article and an active, validated workflow. If learning fails, the verified call stays resolved and offers **Retry learning**.
4. Choose **Reset & replay**, preserving knowledge. This resets all test accounts and advances the batch; history is retained. New calls re-inject the selected problem.
5. Select **Oliver Brooks → Account lockout**. He describes the same visible problem in his own style. The support agent is instructed to search knowledge and use an appropriate workflow. Retrieval and workflow execution are recorded, rather than presumed.
6. Open **Results**. Compare turns, tool calls, and verified outcomes for equivalent scenarios with and without knowledge retrieval. Results reflect what happened; the app never promises that an LLM will improve on every run. Model and persona differences can affect the comparison.

Also try **Report export failure** (invalid persistent output configuration) and **Stuck export job**. Each requires actual state inspection and an export that completes successfully. You can inject the currently selected scenario into a customer manually from CRM, then use that customer's DemoDesk link to inspect the symptom.

## Dynamic challenges

Overview offers six scenario families plus **Random challenge**. **Standard** uses the simpler conditions; **Challenge** can add distracting but unrelated log events, a recoverable worker-busy response, and slower customer interaction with report controls. Choose whether to allow one related follow-up question after the original goal works or the engineering handoff is explained. The customer skips a planned question if support already answered it. Dialogue remains generated by the configured models.

- **Report setup guidance** is a knowledge gap. The customer needs a particular quarter and set of columns, and must actually choose them, apply the preview and download the report. In Challenge mode, the customer manages one UI action per exchange, so support must teach the next step clearly. Generating any CSV does not pass: the saved period, required columns and customer download must match the goal. Successful coaching can produce a knowledge article, without inventing a repair workflow.
- **Multiple export faults** combines a locked account, invalid output format and stuck job. Restoring sign-in alone does not pass. The agent must navigate the remaining faults and verify the requested export. Evidence can yield a workflow with the full compound precondition, rather than an unrelated one-step repair.
- **Engineering escalation** injects a persistent report-renderer defect that support tools cannot repair. Changing settings or retrying does not remove it. Support must inspect the job and logs, reproduce the failure, and submit customer impact, reproduction steps and expected/actual behavior. The application attaches scoped tool evidence and keeps the support ticket open with an `ENG-…` reference. Results shows a correct engineering handoff separately from a repaired case; the feature remains broken, no ETA is promised, and no repair workflow is learned. The local engineering queue represents a handoff for review, not an external engineering integration.

Each call saves its **case seed**, variation level, goal and conditions. Leave the seed blank for a new variation, or choose **Reuse case** in Live Simulation to restore the same setup. A seed reproduces the scenario conditions, not the model's exact words or decisions. Reuse the same family/selection, seed, variation level, customer and model settings for meaningful comparisons.

Live Simulation shows support tool calls, actual customer UI steps, failed operations and avoidable actions against visible reference budgets. Results can filter comparisons by seed. Avoidable effort counts no-op configuration repairs, mismatched workflows, verification repeated after success without a new action, and repeated retries of a known unrecoverable defect. The first failed reproduction and a transient recovery failure are useful evidence, not automatically waste. Tool execution time and model tokens are reported separately from elapsed time, which includes voice and pauses; the app does not invent a quality score.

## Voice and simulation controls

Each conversation step emits at most one speaker; a completion-review retry emits no dialogue. The browser plays each message before requesting the next step, including the final closing statement, keeping voice separate from text orchestration. Select voices in Agent Settings; automatic assignment uses different installed English voices when available, with different pitch as a fallback. Browser and OS voice availability varies.

Live Simulation includes pause/resume, stop, mute, speed, full transcript and voice replay. Pause stops speech and prevents the next request immediately; a model/tool request already in progress can finish. Muting continues text orchestration. Text-only fast mode skips speech and shortens the interval between steps. A browser tab must remain open to advance calls; reopening the dashboard resumes an active call.

One tab owns model progression and live audio through a browser Web Lock. Other tabs can observe without starting another speaker; **Play in this tab** transfers control after any in-flight request finishes. Closing the owner permits another waiting tab to take over. A shared, per-call playback cursor prevents automatic repetition after transfers or reloads. Explicit pause/transfer interrupts the current utterance and continues after it, rather than automatically restarting its beginning. Replay is serialized with live playback. Coordination requires Web Locks and BroadcastChannel support on the local origin. The database lease still rejects overlapping server requests.

Speech completion releases the next turn; a speech error or missing completion event stops audio and pauses an active call instead of silently advancing. **Resume** retries a failed message before requesting the next speaker. Voice and speed controls belong to the playback tab. Browser/OS speech behavior still needs an audible check on the user's device.

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

Scenario injection/evaluation labels are never included in the agents’ prompts. The customer sees their public task, visible symptoms and conversation history, and can use scoped report controls when support gives instructions. Support sees customer contact details, conversation, product guides and actual tool observations. Product guides are static application instructions, distinct from learned knowledge. The learning agent sees the transcript and recorded execution evidence after independent verification. Articles include source-call evidence; deduplication uses the observed repair or coaching signature. Workflows derive from successful approved repair tools, are validated before activation and execution, check a specific precondition, bind automatically to the current account, honor disabled tools, and end in verification.

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

For an opt-in live challenge check, run `npx tsx scripts/check-challenges.ts --scenario=all` (or `report_guidance`, `export_multi_fault`, `export_engineering`). It uses configured provider credits for at most three calls with eight support turns each. It copies model/tool settings into a fresh temporary database, leaves your normal simulation history alone, and saves transcripts, evidence and metrics to ignored `artifacts/live-*.json`. Live model behavior can still vary between runs.

For an opt-in live check against a saved conversation, run `npx tsx scripts/check-conversation.ts --call=CALL_ID '--messages=11,14' '--expect=followup,accepted' --reply-at=11` (quote comma-separated arguments in PowerShell). Use actual customer-message IDs from that call. This uses configured provider credits and records usage, but never advances the simulation, changes its transcript/ticket, or replaces saved assessments. It checks at most four decisions and optionally samples one concise spoken reply using the evidence available at that point in the transcript.

Playwright builds into `.next-browser-tests/` and runs a production server on port 3100 with a separate database (`data/browser-test.sqlite`). It checks dashboard navigation, no-key behavior, provider settings persistence, actual login lockout, export failure/recovery, report selection/apply/download persistence, the unrepairable renderer, engineering outcome display, seeded replay controls, reset and mobile overflow. The tests do not use your normal database or make paid AI calls. The test runner starts and stops its own server; production mode avoids competing development-server refreshes.

The browser suite also exercises the actual approved export-reproduction function and checks speaker sequencing, different voice assignments, pause/resume, multi-tab ownership and transfer, delayed model responses, ownership recovery after closing a tab, stale speech callbacks, and speech-error retries. These tests use actual browser Web Locks/BroadcastChannel with test-only speech/network doubles; they do not verify audible output on a physical device.

Saved previews and opt-in live check outputs are in `artifacts/`. Provider routing tests cover OpenRouter key requirements, vendor-prefixed model IDs, persisted profiles, token usage, error redaction, reasoning validation, and outgoing reasoning/token parameters through the actual SDK adapter with a mocked network transport.

## MVP limits

Six scenario families and three starter personas are supported. Variations are seeded conditions within those families, not arbitrary generated backend faults. Knowledge search is lightweight lexical matching; workflow proposal uses approved recipes derived from repair evidence. The engineering queue is local and does not fix or dispatch a defect externally. Calls run serially and are driven by the open browser, rather than a background worker. No realtime audio, speech recognition, external telephony, unrestricted shell, or generated executable workflows are included. Live provider calls require your keys and model access; browser audio must be checked on your device.
