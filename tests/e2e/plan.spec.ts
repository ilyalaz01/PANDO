import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page) {
  await page.goto("/dev/plan-fixture");
  await expect(
    page.getByRole("heading", { name: "Keep the plan aligned with your life.", level: 1 }),
  ).toBeVisible();
}

test("shows an exact lifecycle preview and keeps confirmation keyboard-operable", async ({
  page,
}) => {
  await openFixture(page);
  const comparison = page.getByLabel("Exact plan change preview");
  await expect(comparison).toContainText("ACTIVE");
  await expect(comparison).toContainText("PAUSED");
  await expect(comparison).toContainText("4");
  await expect(comparison).toContainText("5");
  await expect(page.getByText(/preserve history while priorities change/iu)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to Plan" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.getByRole("button", { name: "Confirm and apply" }).focus();
  await expect(page.getByRole("button", { name: "Confirm and apply" })).toBeFocused();
});

test("fits 320px with touch-sized Plan controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openFixture(page);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  const box = await page.getByRole("button", { name: "Confirm and apply" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("honors reduced motion and forced-colors focus visibility", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openFixture(page);
  const control = page.getByRole("button", { name: "Confirm and apply" });
  await control.focus();
  const styles = await control.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(styles.outlineStyle).not.toBe("none");
  expect(styles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);
});

test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await openFixture(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
