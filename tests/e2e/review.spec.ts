import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page) {
  await page.goto("/dev/review-fixture");
  await expect(
    page.getByRole("heading", { name: "Refresh what needs proof.", level: 1 }),
  ).toBeVisible();
}

test("shows a merged item once with every reason and keyboard-operable reason controls", async ({
  page,
}) => {
  await openFixture(page);
  await expect(page.getByRole("heading", { name: "Python error handling", level: 3 })).toHaveCount(
    1,
  );
  const overdue = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Overdue", level: 2 }) });
  await expect(overdue.getByText("Retention risk", { exact: true })).toBeVisible();
  await expect(overdue.getByText("Personal reminder", { exact: true })).toBeVisible();
  await expect(
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Personal reminders", level: 2 }) }),
  ).toContainText("Nothing here.");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to Review" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await overdue.getByRole("button", { name: "Manage retention risk" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("New local due date and time")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip once" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Suppress" })).toBeVisible();
  const suppressed = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Suppressed / excluded", level: 2 }) });
  await suppressed.getByRole("button", { name: "Manage retention risk" }).click();
  await expect(page.getByRole("button", { name: "Restore this reason" })).toBeVisible();
});

test("fits 320px with touch-sized Review controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openFixture(page);
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  const box = await page.getByRole("link", { name: "Start review in Focus" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("honors reduced motion and forced-colors focus visibility", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openFixture(page);
  const control = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Overdue", level: 2 }) })
    .getByRole("button", { name: "Manage retention risk" });
  await control.focus();
  const styles = await control.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    motion: getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-duration-standard")
      .trim(),
  }));
  expect(styles.outlineStyle).not.toBe("none");
  expect(styles.motion).toBe("80ms");
});

test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await openFixture(page);
  await page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Overdue", level: 2 }) })
    .getByRole("button", { name: "Manage retention risk" })
    .click();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
