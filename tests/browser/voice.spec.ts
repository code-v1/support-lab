import { expect, test } from "@playwright/test";
import type { Call, Snapshot } from "../../lib/types";

// Test-only HTTP and speech doubles exercise the real React orchestration.
// No simulated AI outcomes are written to the application's database.
test("waits for each voice, uses different speakers, pauses, and resumes", async ({
  page,
  request,
}) => {
  const snapshot: Snapshot = await (await request.get("/api/lab")).json();
  snapshot.calls = [];
  snapshot.messages = [];
  snapshot.activities = [];
  snapshot.configuration.ready = true;
  snapshot.configuration.missing = [];
  let steps = 0;
  await page.addInitScript(() => {
    const testWindow = window as unknown as {
      SpeechSynthesisUtterance: unknown;
      __spoken: { text: string; voice: string }[];
      __endSpeech: () => void;
    };
    testWindow.__spoken = [];
    class Utterance {
      text: string;
      voice: { name: string } | null = null;
      rate = 1;
      pitch = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    testWindow.SpeechSynthesisUtterance = Utterance;
    let current: Utterance | null = null;
    testWindow.__endSpeech = () => {
      const utterance = current;
      current = null;
      utterance?.onend?.();
    };
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => [
          { name: "Customer test voice", lang: "en-US" },
          { name: "Support test voice", lang: "en-US" },
        ],
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: () => {
          current = null;
        },
        speak: (utterance: Utterance) => {
          current = utterance;
          testWindow.__spoken.push({
            text: utterance.text,
            voice: utterance.voice?.name || "",
          });
        },
      },
    });
  });
  await page.route("**/api/lab", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      if (input.action === "start")
        snapshot.calls = [
          {
            id: "test-only-call",
            customer_id: "maya",
            scenario: "account_locked",
            status: "running",
            turns: 0,
            max_turns: 6,
            tool_calls: 0,
            escalations: 0,
            knowledge_used: 0,
            workflow_used: 0,
            verified: 0,
            error: null,
            learning_status: "pending",
            batch: 1,
            started_at: new Date().toISOString(),
            ended_at: null,
            busy_until: 0,
          } satisfies Call,
        ];
      if (input.action === "step") {
        steps++;
        snapshot.messages.push({
          id: steps,
          call_id: "test-only-call",
          role: steps === 2 ? "support" : "customer",
          text:
            steps === 1
              ? "I cannot sign in."
              : steps === 2
                ? "I checked and repaired your account."
                : "I can sign in now.",
          created_at: new Date().toISOString(),
        });
        snapshot.calls[0].turns = 1;
        if (steps === 3) {
          snapshot.calls[0].status = "resolved";
          snapshot.calls[0].verified = 1;
          snapshot.calls[0].learning_status = "Test-only verified outcome";
        }
      }
      if (input.action === "pause") snapshot.calls[0].status = "paused";
      if (input.action === "resume") snapshot.calls[0].status = "running";
    }
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect(
    page.getByText("I cannot sign in.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __spoken: unknown[] }).__spoken.length,
      ),
    )
    .toBe(1);
  await page.waitForTimeout(600);
  expect(steps).toBe(1);
  await page.evaluate(() =>
    (window as unknown as { __endSpeech: () => void }).__endSpeech(),
  );
  await expect(
    page.getByText("I checked and repaired your account.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __spoken: unknown[] }).__spoken.length,
      ),
    )
    .toBe(2);
  const spoken = await page.evaluate(
    () => (window as unknown as { __spoken: { voice: string }[] }).__spoken,
  );
  expect(spoken[0].voice).not.toBe(spoken[1].voice);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  expect(steps).toBe(2);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verified resolution", exact: true }),
  ).toBeVisible();
  expect(steps).toBe(3);
});
