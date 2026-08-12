import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

let harnessServer: ViteDevServer;
let harnessUrl: string;

test.beforeAll(async () => {
  harnessServer = await createServer({
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await harnessServer.listen();
  const address = harnessServer.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Harness server did not bind a TCP port");
  harnessUrl = `http://127.0.0.1:${address.port}/tests/e2e/fixtures/orb-interaction-harness.html`;
});

test.afterAll(async () => {
  await harnessServer.close();
});

test("real capture loss returns a connected drag source without consuming on later pointer-up", async ({ page }) => {
  await page.goto(harnessUrl);
  const filter = page.getByRole("button", { name: "Filter Orb, available" });
  const target = page.getByText("Green mana tile", { exact: true });
  const source = await filter.elementHandle();
  const filterBox = await filter.boundingBox();
  const targetBox = await target.boundingBox();
  expect(source).not.toBeNull();
  expect(filterBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(filterBox!.x + filterBox!.width / 2, filterBox!.y + filterBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 2 });
  await expect(page.locator(".orb-drag-avatar")).toBeVisible();

  const promotion = await source!.evaluate((element) => ({
    connected: element.isConnected,
    captured: element.hasPointerCapture(1),
  }));
  expect(promotion.captured).toBe(true);
  await source!.evaluate((element) => element.releasePointerCapture(1));
  await page.mouse.up();

  const result = await page.evaluate(() => window.orbHarness);
  expect(promotion.connected).toBe(true);
  expect(result.lostCaptures).toBeGreaterThan(0);
  expect(result.uses).toBe(0);
  await expect(page.getByRole("button", { name: "Filter Orb, available" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter Orb, available" })).toHaveAttribute("aria-pressed", "false");
});
