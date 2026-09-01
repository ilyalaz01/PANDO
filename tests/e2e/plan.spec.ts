import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page, suffix = "") {
  await page.goto(`/dev/plan-fixture${suffix}`);
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

  await openFixture(page, "?preview=track");
  await page.getByLabel("Learning Track", { exact: true }).first().focus();
  await expect(page.getByLabel("Learning Track", { exact: true }).first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Why is this Track changing?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Preview Track change" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Confirm Track change" })).toBeFocused();

  await openFixture(page, "?preview=track-settings");
  const settingsTrack = page.getByLabel("Learning Track", { exact: true }).last();
  await settingsTrack.focus();
  await expect(settingsTrack).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Priority (0–100)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Protected weekly minimum in minutes (0–10080)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Why are these settings changing?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Preview Track settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Confirm Track settings" })).toBeFocused();
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

  await openFixture(page, "?preview=track");
  const trackDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(trackDimensions.scrollWidth).toBeLessThanOrEqual(trackDimensions.clientWidth);
  for (const control of [
    page.getByLabel("Learning Track", { exact: true }).first(),
    page.getByRole("button", { name: "Preview Track change" }),
    page.getByRole("button", { name: "Confirm Track change" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openFixture(page, "?preview=track-settings");
  for (const control of [
    page.getByLabel("Learning Track", { exact: true }).last(),
    page.getByLabel("Priority (0–100)"),
    page.getByLabel("Protected weekly minimum in minutes (0–10080)"),
    page.getByRole("button", { name: "Confirm Track settings" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
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

  await openFixture(page, "?preview=track");
  const trackControl = page.getByRole("button", { name: "Confirm Track change" });
  await trackControl.focus();
  const trackStyles = await trackControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(trackStyles.outlineStyle).not.toBe("none");
  expect(trackStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openFixture(page, "?preview=track-settings");
  const settingsControl = page.getByRole("button", { name: "Confirm Track settings" });
  await settingsControl.focus();
  const settingsStyles = await settingsControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(settingsStyles.outlineStyle).not.toBe("none");
  expect(settingsStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);
});

test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await openFixture(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await openFixture(page, "?preview=track-settings");
  const settingsResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(settingsResults.violations).toEqual([]);
});

test("shows exact weekly-capacity consequences before confirmation", async ({ page }) => {
  await openFixture(page, "?preview=capacity");
  const comparison = page.getByLabel("Exact weekly capacity preview");
  await expect(comparison).toContainText("600 minutes");
  await expect(comparison).toContainText("720 minutes");
  await expect(comparison).toContainText("180 minutes");
  await expect(comparison).toContainText("540 minutes");
  await expect(page.getByRole("button", { name: "Confirm capacity" })).toBeEnabled();
});

test("blocks a capacity below active Track minima without an apply control", async ({ page }) => {
  await openFixture(page, "?preview=blocked");
  await expect(
    page.getByRole("region", { name: "Review weekly capacity" }).getByRole("alert"),
  ).toContainText("Capacity can't be set to 120 minutes. Active tracks reserve 180 minutes.");
  await expect(page.getByRole("button", { name: "Confirm capacity" })).toHaveCount(0);
});

test("shows an exact Learning Track lifecycle preview before confirmation", async ({ page }) => {
  await openFixture(page, "?preview=track");
  const comparison = page.getByLabel("Exact Learning Track change preview");
  await expect(comparison).toContainText("Algorithms");
  await expect(comparison).toContainText("PAUSED");
  await expect(comparison).toContainText("ACTIVE");
  await expect(comparison).toContainText("420 minutes");
  await expect(page.getByRole("button", { name: "Confirm Track change" })).toBeEnabled();
});

test("blocks a Track resume that would exceed weekly capacity", async ({ page }) => {
  await openFixture(page, "?preview=track-blocked");
  await expect(
    page.getByRole("region", { name: "Review Learning Track change" }).getByRole("alert"),
  ).toContainText("This Track cannot resume within 600 weekly minutes");
  await expect(page.getByRole("button", { name: "Confirm Track change" })).toHaveCount(0);
});

test("shows exact Track settings consequences and blocks active minima over capacity", async ({
  page,
}) => {
  await openFixture(page, "?preview=track-settings");
  const comparison = page.getByLabel("Exact Learning Track settings preview");
  await expect(comparison).toContainText("Priority");
  await expect(comparison).toContainText("120 minutes");
  await expect(comparison).toContainText("500 minutes");
  await expect(page.getByRole("button", { name: "Confirm Track settings" })).toBeEnabled();

  await openFixture(page, "?preview=track-settings-blocked");
  await expect(
    page.getByRole("region", { name: "Review Learning Track settings" }).getByRole("alert"),
  ).toContainText("need at least 560 weekly minutes");
  await expect(page.getByRole("button", { name: "Confirm Track settings" })).toHaveCount(0);
});
