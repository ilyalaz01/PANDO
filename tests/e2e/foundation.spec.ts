import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("renders the foundation and supports keyboard bypass", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "A calm, testable foundation for PANDO." }),
  ).toBeVisible();

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("fits a mobile viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("initializes calm motion from the system preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const standardDuration = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-duration-standard")
      .trim(),
  );

  expect(standardDuration).toBe("80ms");
});

test("has no automatically detectable WCAG A or AA violations", async ({ page }) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
