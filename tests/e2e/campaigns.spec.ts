import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page, suffix = "") {
  await page.goto(`/dev/campaigns-fixture${suffix}`);
  await expect(
    page.getByRole("heading", { name: "Prepare for one loop at a time.", level: 1 }),
  ).toBeVisible();
}

test("shows every campaign with its exact status, target, and deadline phrasing", async ({
  page,
}) => {
  await openFixture(page);
  const list = page.getByRole("region", { name: "Your Interview Campaigns" });
  await expect(list).toContainText("Acme backend loop");
  await expect(list).toContainText("ACTIVE");
  await expect(list).toContainText("Backend readiness");
  await expect(list).toContainText("102 days until the deadline");
  await expect(list).toContainText("Draft loop");
  await expect(list).toContainText("DRAFT");
  await expect(list).toContainText("Ended loop");
  await expect(list).toContainText("ENDED");
});

test("explains there are no campaigns yet, and hides the draft form with no active targets", async ({
  page,
}) => {
  await openFixture(page, "?preview=empty");
  await expect(page.getByText("No Interview Campaigns yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Draft a new Interview Campaign" })).toBeVisible();

  await openFixture(page, "?preview=no-goals");
  await expect(page.getByRole("heading", { name: "Draft a new Interview Campaign" })).toHaveCount(
    0,
  );
});

test("shows exact draft consequences and keeps a stale confirmation dismissed", async ({
  page,
}) => {
  await openFixture(page, "?preview=creation");
  const region = page.getByRole("region", { name: "Draft a new Interview Campaign" });
  await expect(region).toContainText("Start a new campaign as a draft.");
  const comparison = page.getByLabel("Exact Interview Campaign draft preview");
  await expect(comparison).toContainText("New onsite loop");
  await expect(comparison).toContainText("DRAFT");
  await expect(comparison).toContainText("2026-12-20");
  await expect(page.getByRole("button", { name: "Confirm and draft this campaign" })).toBeEnabled();

  await page.getByLabel("Title").fill("A different title");
  await expect(page.getByRole("button", { name: "Confirm and draft this campaign" })).toHaveCount(
    0,
  );
});

test("hides the confirmation and explains the exact blocker for a blocked draft", async ({
  page,
}) => {
  await openFixture(page, "?preview=creation-blocked");
  await expect(page.getByText("TARGETS_CREATE_IDENTITY_COLLISION")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and draft this campaign" })).toHaveCount(
    0,
  );
});

test("shows the exact before/after deadline comparison", async ({ page }) => {
  await openFixture(page, "?preview=deadline");
  const comparison = page.getByLabel("Exact Interview Campaign deadline preview");
  await expect(comparison).toContainText("2026-12-15");
  await expect(comparison).toContainText("2026-12-29");
  await expect(page.getByRole("button", { name: "Confirm deadline change" })).toBeEnabled();
});

test("shows the exact before/after target and revision number for a retarget", async ({ page }) => {
  await openFixture(page, "?preview=retarget");
  const comparison = page.getByLabel("Exact Interview Campaign retarget preview");
  await expect(comparison).toContainText("Backend readiness");
  await expect(comparison).toContainText("Platform readiness");
  await expect(comparison).toContainText("1");
  await expect(
    page.getByText(/both the previous and the new Readiness Goal keep their own history/u),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm retarget" })).toBeEnabled();
});

test("shows the exact before/after lifecycle comparison and available operations", async ({
  page,
}) => {
  await openFixture(page, "?preview=lifecycle");
  const comparison = page.getByLabel("Exact Interview Campaign lifecycle preview");
  await expect(comparison).toContainText("ACTIVE");
  await expect(comparison).toContainText("ENDED");
  await expect(page.getByRole("button", { name: "Confirm: End this campaign" })).toBeEnabled();
});

test("offers a Learning Track override picker only when starting a campaign", async ({ page }) => {
  await openFixture(page, "?preview=lifecycle");
  await page.getByRole("button", { name: "Start this campaign" }).click();
  await expect(
    page.getByLabel("Boost one Learning Track for this campaign (optional)"),
  ).toBeVisible();
  await expect(page.getByLabel(/Priority override/u)).toHaveCount(0);
  await page
    .getByLabel("Boost one Learning Track for this campaign (optional)")
    .selectOption("track:backend");
  await expect(page.getByLabel(/Priority override/u)).toBeVisible();
});

test("lists an active allocation override and pre-fills its change form", async ({ page }) => {
  await openFixture(page, "?preview=override");
  const overrides = page.getByRole("region", { name: "Allocation overrides" });
  await expect(overrides).toContainText("Backend");
  await overrides.getByRole("button", { name: "Change this override" }).click();
  await expect(page.getByLabel(/Priority \(0-100/u)).toHaveValue("95");
  await expect(page.getByRole("button", { name: "Preview: Change this override" })).toBeEnabled();
});

test("prompts explicitly once a running campaign's deadline has passed", async ({ page }) => {
  await openFixture(page, "?preview=deadline-passed");
  await expect(
    page.getByText(/deadline has passed. End or cancel it to close it out/u),
  ).toBeVisible();
});

test("keeps every control keyboard-operable from the skip link forward", async ({ page }) => {
  await openFixture(page, "?preview=creation");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to Interview Campaigns" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.getByLabel("Readiness Goal", { exact: true }).focus();
  await expect(page.getByLabel("Readiness Goal", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Title")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Deadline (local date)", { exact: true })).toBeFocused();
});

test("fits 320px with touch-sized Interview Campaign controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openFixture(page, "?preview=creation");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  for (const control of [
    page.getByLabel("Readiness Goal", { exact: true }),
    page.getByLabel("Title"),
    page.getByLabel("Deadline (local date)", { exact: true }),
    page.getByRole("button", { name: "Confirm and draft this campaign" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openFixture(page, "?preview=lifecycle");
  const lifecycleBox = await page
    .getByRole("button", { name: "Confirm: End this campaign" })
    .boundingBox();
  expect(lifecycleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("honors reduced motion and forced-colors focus visibility", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openFixture(page, "?preview=creation");
  const control = page.getByRole("button", { name: "Confirm and draft this campaign" });
  await control.focus();
  const styles = await control.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(styles.outlineStyle).not.toBe("none");
  expect(styles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);
});

test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  for (const suffix of [
    "",
    "?preview=empty",
    "?preview=creation",
    "?preview=creation-blocked",
    "?preview=deadline",
    "?preview=retarget",
    "?preview=lifecycle",
    "?preview=override",
  ]) {
    await openFixture(page, suffix);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});
