import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFocusFixture(page: import("@playwright/test").Page) {
  await page.goto("/dev/focus-fixture");
  await expect(page.getByRole("heading", { name: "Typing practice", level: 1 })).toBeVisible();
  await expect(page.getByText(/Produce a working result without copying/iu)).toBeVisible();
  await expect(page.getByRole("link", { name: /Open activity resource/iu })).toBeVisible();
}

test("supports keyboard navigation, local scratch, and explicit evidence choices", async ({
  page,
}) => {
  await openFocusFixture(page);
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to Focus" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  const scratch = page.getByLabel("Scratch area");
  await scratch.fill("Temporary browser-only thought");
  await expect(scratch).toHaveValue("Temporary browser-only thought");
  await expect(page.getByText(/Local and unsaved/iu)).toBeVisible();

  await page.getByLabel("I tried, but the result did not work").check();
  await expect(page.getByLabel("I tried, but the result did not work")).toBeChecked();
  await page.getByRole("button", { name: "Correct this evidence" }).click();
  await expect(page.getByLabel("Why is this evidence incorrect?")).toBeVisible();
  await expect(page.getByText(/Recalculating from the active evidence ledger/iu)).toHaveAttribute(
    "role",
    "status",
  );
});

test("fits a 320px mobile viewport with touch-sized controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openFocusFixture(page);

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const primary = page.getByRole("button", { name: "Complete and save result" });
  const box = await primary.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("honors reduced motion and forced-colors focus visibility", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openFocusFixture(page);
  const primary = page.getByRole("button", { name: "Complete and save result" });
  await primary.focus();
  const styles = await primary.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      outlineStyle: computed.outlineStyle,
      transitionDuration: computed.transitionDuration,
    };
  });
  expect(styles.outlineStyle).not.toBe("none");
  expect(
    styles.transitionDuration.split(",").every((duration) => Number.parseFloat(duration) <= 0.08),
  ).toBe(true);
});

test("has no automatically detectable WCAG A or AA violations", async ({ page }) => {
  await openFocusFixture(page);
  await page.getByRole("button", { name: "Correct this evidence" }).click();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
