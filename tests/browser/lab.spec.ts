import { expect, test } from "@playwright/test";
import { reproduceExport } from "../../lib/simulation/browser";
test.beforeEach(async ({ request }) => {
  await request.post("/api/lab", {
    data: { action: "reset", preserveKnowledge: false },
  });
});
test("honest no-key setup and all six dashboard views", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Better support starts with practice." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start simulation" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Live Simulation", exact: true })
    .click();
  await expect(
    page.getByText("Start a simulation to watch both agents at work."),
  ).toBeVisible();
  await page.getByRole("button", { name: "CRM", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Maya Chen", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Knowledge", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clean slate, by design" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Did learning make a difference?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agent Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Model routing" }),
  ).toBeVisible();
  await expect(page.getByLabel("balanced provider")).toHaveValue("google");
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({
    path: "artifacts/support-lab-overview.png",
    fullPage: true,
  });
});
test("a locked account really cannot sign in", async ({ page, request }) => {
  await request.post("/api/lab", {
    data: { action: "inject", customerId: "maya", scenario: "account_locked" },
  });
  await page.goto("/demodesk?customer=maya");
  await page.getByRole("button", { name: "Sign in to DemoDesk" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "account is unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export report" }),
  ).not.toBeVisible();
});

test("OpenRouter profile selections save through the real API", async ({
  page,
  request,
}) => {
  const original = (await (await request.get("/api/lab")).json()).settings;
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Agent Settings", exact: true })
      .click();
    for (const profile of ["fast", "balanced", "advanced"])
      await page
        .getByLabel(`${profile} provider`, { exact: true })
        .selectOption("openrouter");
    await page
      .getByLabel("balanced model", { exact: true })
      .fill("google/gemini-2.5-flash");
    await page.getByRole("button", { name: "Save configuration" }).click();
    await expect(page.getByRole("status")).toContainText("configuration saved");
    await page.reload();
    await page
      .getByRole("button", { name: "Agent Settings", exact: true })
      .click();
    for (const profile of ["fast", "balanced", "advanced"])
      await expect(
        page.getByLabel(`${profile} provider`, { exact: true }),
      ).toHaveValue("openrouter");
    await expect(
      page.getByText("Missing: OPENROUTER_API_KEY", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use recommended lineup", exact: true })
      .click();
    await expect(page.getByLabel("fast model", { exact: true })).toHaveValue(
      "anthropic/claude-haiku-5.5",
    );
    await expect(
      page.getByLabel("balanced model", { exact: true }),
    ).toHaveValue("deepseek/deepseek-v4.1-flash");
    await expect(
      page.getByLabel("advanced model", { exact: true }),
    ).toHaveValue("anthropic/claude-sonnet-5.5");
    await expect(
      page.getByLabel("fast reasoning", { exact: true }),
    ).toHaveValue("off");
    await expect(
      page.getByLabel("advanced output tokens", { exact: true }),
    ).toHaveValue("8192");
    expect(
      await page
        .getByLabel("advanced reasoning", { exact: true })
        .locator('option[value="off"]')
        .count(),
    ).toBe(0);
    expect(
      await page
        .getByLabel("balanced reasoning", { exact: true })
        .locator('option[value="medium"]')
        .count(),
    ).toBe(0);
    await page
      .getByLabel("advanced output tokens", { exact: true })
      .fill("10000");
    await page.getByRole("button", { name: "Save configuration" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Agent Settings", exact: true })
      .click();
    await expect(
      page.getByLabel("advanced output tokens", { exact: true }),
    ).toHaveValue("10000");
    await expect(
      page.getByLabel("advanced reasoning", { exact: true }),
    ).toHaveValue("medium");
    await page.setViewportSize({ width: 1440, height: 1180 });
    await page.screenshot({
      path: "artifacts/recommended-model-settings.png",
      fullPage: true,
    });
    const invalid = await request.post("/api/lab", {
      data: {
        action: "settings",
        settings: {
          profiles: {
            fast: {
              provider: "openrouter",
              model: "anthropic/claude-haiku-5.5",
            },
            balanced: {
              provider: "openrouter",
              model: "deepseek/deepseek-v4.1-flash",
            },
            advanced: {
              provider: "openrouter",
              model: "anthropic/claude-sonnet-5.5",
              reasoning: "off",
            },
          },
          disabledTools: [],
        },
      },
    });
    expect(invalid.status()).toBe(400);
    expect(
      (await (await request.get("/api/lab")).json()).configuration.missing,
    ).toEqual(["OPENROUTER_API_KEY"]);
  } finally {
    await request.post("/api/lab", {
      data: { action: "settings", settings: original },
    });
  }
});
test("Playwright reproduces an actual export failure and succeeds after reset", async ({
  page,
  request,
}) => {
  await request.post("/api/lab", {
    data: { action: "inject", customerId: "oliver", scenario: "export_config" },
  });
  await page.goto("/demodesk?customer=oliver");
  await page.getByRole("button", { name: "Sign in to DemoDesk" }).click();
  await page.getByRole("button", { name: "Export report" }).click();
  await expect(page.getByTestId("export-result")).toContainText(
    "Report export failed",
  );
  await request.post("/api/lab", {
    data: { action: "reset", preserveKnowledge: true },
  });
  await page.getByRole("button", { name: "Export report" }).click();
  await expect(page.getByTestId("export-result")).toContainText("Report ready");
  await expect(
    page.getByRole("link", { name: "Download CSV" }),
  ).toHaveAttribute("href", /data:text\/csv/);
  await page.screenshot({
    path: "artifacts/demodesk-verified-export.png",
    fullPage: true,
  });
});
test("reset is explicit and mobile layout stays within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Reset & replay" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Reset environment" }).click();
  await expect(page.getByRole("status")).toContainText("Knowledge preserved");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the approved reproduction workflow observes failure and recovery", async ({
  request,
}) => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "http://127.0.0.1:3100";
  try {
    await request.post("/api/lab", {
      data: {
        action: "inject",
        customerId: "oliver",
        scenario: "export_stuck",
      },
    });
    expect(await reproduceExport("oliver")).toMatchObject({
      ok: false,
      observation: expect.stringContaining("already in progress"),
    });
    await request.post("/api/lab", {
      data: { action: "reset", preserveKnowledge: true },
    });
    expect(await reproduceExport("oliver")).toMatchObject({
      ok: true,
      observation: expect.stringContaining("Report ready"),
    });
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});
