import { chromium } from "@playwright/test";
export async function reproduceExport(customerId: string) {
  const url = new URL(process.env.APP_BASE_URL || "http://127.0.0.1:3000");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Browser reproduction requires a local HTTP APP_BASE_URL.");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(
      `${url.origin}/demodesk?customer=${encodeURIComponent(customerId)}`,
    );
    await page.getByRole("button", { name: "Sign in to DemoDesk" }).click();
    await page
      .getByRole("button", { name: "Export report" })
      .waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "Export report" }).click();
    await page.getByTestId("export-result").waitFor({ state: "visible" });
    const observation = await page.getByTestId("export-result").innerText();
    return {
      ok: observation.includes("Report ready"),
      observation,
      url: page.url(),
      method: "Playwright Chromium: sign in → dashboard → export report",
    };
  } finally {
    await browser.close();
  }
}
