import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import type { Call, Snapshot } from "../../lib/types";

// Actual Web Locks and BroadcastChannel coordinate these browser pages. Only
// speech and model HTTP responses are doubled; normal user history is untouched.
async function fixture(context: BrowserContext, request: APIRequestContext) {
  const snapshot: Snapshot = await (await request.get("/api/lab")).json();
  snapshot.calls = [];
  snapshot.messages = [];
  snapshot.activities = [];
  snapshot.configuration.ready = true;
  snapshot.configuration.missing = [];
  let steps = 0,
    delayPause = false;
  let supportGate: Promise<void> | undefined;
  let releaseSupport: (() => void) | undefined;
  await context.addInitScript(() => {
    const host = window as unknown as {
      SpeechSynthesisUtterance: unknown;
      __spoken: string[];
      __active: boolean;
      __endSpeech: () => void;
      __errorSpeech: () => void;
      __lateEnd: () => void;
    };
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
    host.SpeechSynthesisUtterance = Utterance;
    host.__spoken = [];
    host.__active = false;
    host.__lateEnd = () => {};
    let current: Utterance | null = null;
    host.__endSpeech = () => {
      const item = current;
      current = null;
      host.__active = false;
      item?.onend?.();
    };
    host.__errorSpeech = () => {
      const item = current;
      current = null;
      host.__active = false;
      item?.onerror?.();
    };
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => [
          { name: "Customer", lang: "en-US" },
          { name: "Support", lang: "en-US" },
        ],
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: () => {
          current = null;
          host.__active = false;
        },
        speak: (item: Utterance) => {
          if (current) throw new Error("Overlapping speech request");
          current = item;
          host.__active = true;
          host.__spoken.push(item.text);
          const oldEnd = item.onend;
          host.__lateEnd = () => oldEnd?.();
        },
      },
    });
  });
  await context.route("**/api/lab", async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      if (input.action === "start")
        snapshot.calls = [
          {
            id: "voice-coordination",
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
            repair_verified: 0,
            closing_customer_message_id: null,
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
        if (steps === 2) await supportGate;
        snapshot.messages.push({
          id: steps,
          call_id: "voice-coordination",
          role: steps === 1 || steps === 3 ? "customer" : "support",
          kind: steps === 4 ? "closing" : "dialogue",
          text: [
            "I cannot sign in.",
            "I restored your account access.",
            "That worked, thanks.",
            "You are all set. Have a good day.",
          ][steps - 1],
          created_at: new Date().toISOString(),
        });
        snapshot.calls[0].turns = 1;
        if (steps === 4) {
          snapshot.calls[0].status = "resolved";
          snapshot.calls[0].verified = 1;
        }
      }
      if (input.action === "pause") {
        if (delayPause)
          await new Promise((resolve) => setTimeout(resolve, 1000));
        snapshot.calls[0].status = "paused";
      }
      if (input.action === "resume") snapshot.calls[0].status = "running";
    }
    await route.fulfill({ json: snapshot });
  });
  return {
    steps: () => steps,
    delayPause: () => {
      delayPause = true;
    },
    holdSupport: () => {
      supportGate = new Promise((resolve) => {
        releaseSupport = resolve;
      });
    },
    releaseSupport: () => releaseSupport?.(),
  };
}
const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
const end = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __endSpeech: () => void }).__endSpeech(),
  );

test("missing speech completion pauses instead of starting the next speaker", async ({
  page,
  context,
  request,
}) => {
  const lab = await fixture(context, request);
  await page.goto("/");
  await page.clock.install();
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect
    .poll(async () => {
      await page.clock.runFor(500);
      return (await spoken(page)).length;
    })
    .toBe(1);
  // The fake speech engine omits both completion and error events.
  await page.clock.fastForward(16000);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  expect(lab.steps()).toBe(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { __active: boolean }).__active,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(async () => {
      await page.clock.runFor(500);
      return spoken(page);
    })
    .toEqual(["I cannot sign in.", "I cannot sign in."]);
  expect(lab.steps()).toBe(1);
});

test("a tab that paused can take over after another tab resumes and closes", async ({
  page,
  context,
  request,
}) => {
  const lab = await fixture(context, request);
  await page.goto("/");
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect.poll(() => spoken(page)).toHaveLength(1);
  const observer = await context.newPage();
  await observer.goto("/");
  await observer
    .getByRole("button", { name: "Live Simulation", exact: true })
    .click();
  await observer.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(() => spoken(page)).toHaveLength(2);
  await expect(
    observer.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.close();
  await expect.poll(() => spoken(observer)).toEqual(["That worked, thanks."]);
  expect(lab.steps()).toBe(3);
});

test("only one tab advances and speaks, with a safe explicit transfer and final closing", async ({
  page,
  context,
  request,
}) => {
  const lab = await fixture(context, request);
  await page.goto("/");
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect.poll(() => spoken(page)).toEqual(["I cannot sign in."]);
  const observer = await context.newPage();
  await observer.goto("/");
  await observer
    .getByRole("button", { name: "Live Simulation", exact: true })
    .click();
  await expect(
    observer.getByText(/Live playback is controlled by another tab/),
  ).toBeVisible();
  await page.waitForTimeout(1700);
  expect(lab.steps()).toBe(1);
  expect(await spoken(observer)).toEqual([]);
  await end(page);
  await expect.poll(() => spoken(page)).toHaveLength(2);
  expect(lab.steps()).toBe(2);
  await observer.getByRole("button", { name: "Play in this tab" }).click();
  await expect.poll(() => spoken(observer)).toEqual(["That worked, thanks."]);
  expect(lab.steps()).toBe(3);
  expect(
    await page.evaluate(
      () => (window as unknown as { __active: boolean }).__active,
    ),
  ).toBe(false);
  await page.evaluate(() =>
    (window as unknown as { __lateEnd: () => void }).__lateEnd(),
  );
  await page.waitForTimeout(600);
  expect(lab.steps()).toBe(3);
  await end(observer);
  await expect
    .poll(() => spoken(observer))
    .toEqual(["That worked, thanks.", "You are all set. Have a good day."]);
  await expect(
    page.getByRole("button", { name: "Replay voice" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replay voice" }).click();
  await expect(
    page.getByText(/Live playback is running in another tab/),
  ).toBeVisible();
  expect(await spoken(page)).toHaveLength(2);
  await end(observer);
  await page.waitForTimeout(600);
  expect(lab.steps()).toBe(4);
});

test("transferring during a delayed model response waits and speaks that response once", async ({
  page,
  context,
  request,
}) => {
  const lab = await fixture(context, request);
  lab.holdSupport();
  await page.goto("/");
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect.poll(() => spoken(page)).toHaveLength(1);
  const observer = await context.newPage();
  await observer.goto("/");
  await observer
    .getByRole("button", { name: "Live Simulation", exact: true })
    .click();
  await end(page);
  await expect.poll(lab.steps).toBe(2);
  await observer.getByRole("button", { name: "Play in this tab" }).click();
  await page.waitForTimeout(600);
  expect(await spoken(observer)).toEqual([]);
  expect(lab.steps()).toBe(2);
  lab.releaseSupport();
  await expect
    .poll(() => spoken(observer))
    .toEqual(["I restored your account access."]);
  expect(await spoken(page)).toEqual(["I cannot sign in."]);
  await page.waitForTimeout(600);
  expect(lab.steps()).toBe(2);
  // Closing the owner releases its actual Web Lock. The observing tab resumes
  // after the consumed message, without replaying it from its stale snapshot.
  await observer.close();
  await expect
    .poll(() => spoken(page))
    .toEqual(["I cannot sign in.", "That worked, thanks."]);
  expect(lab.steps()).toBe(3);
});

test("a delayed pause and a speech error cannot release the next speaker early", async ({
  page,
  context,
  request,
}) => {
  const lab = await fixture(context, request);
  lab.delayPause();
  await page.goto("/");
  await page.getByRole("button", { name: "Start simulation" }).click();
  await expect.poll(() => spoken(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(700);
  expect(lab.steps()).toBe(1);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.poll(() => spoken(page)).toHaveLength(2);
  await page.evaluate(() =>
    (window as unknown as { __errorSpeech: () => void }).__errorSpeech(),
  );
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(700);
  expect(lab.steps()).toBe(2);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(() => spoken(page))
    .toEqual([
      "I cannot sign in.",
      "I restored your account access.",
      "I restored your account access.",
    ]);
  expect(lab.steps()).toBe(2);
  await end(page);
  await expect.poll(() => spoken(page)).toHaveLength(4);
  expect(lab.steps()).toBe(3);
});
