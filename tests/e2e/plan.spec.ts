import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page, suffix = "") {
  await page.goto(`/dev/plan-fixture${suffix}`);
  await expect(
    page.getByRole("heading", { name: "Keep the plan aligned with your life.", level: 1 }),
  ).toBeVisible();
}

async function openSetupFixture(page: import("@playwright/test").Page) {
  await page.goto("/dev/plan-fixture?preview=setup");
  await expect(
    page.getByRole("heading", { name: "Set up your first Growth Plan.", level: 1 }),
  ).toBeVisible();
}

async function openActivityFixture(page: import("@playwright/test").Page, kind = "activity") {
  await page.goto(`/dev/plan-fixture?preview=${kind}`);
  await expect(page.getByRole("heading", { name: "Add useful work", level: 2 })).toBeVisible();
}

async function openMultiTrackActivityFixture(
  page: import("@playwright/test").Page,
  kind = "activity-v2",
) {
  await openActivityFixture(page, kind);
  await expect(
    page.getByRole("heading", { name: "Choose destination Track", level: 2 }),
  ).toBeVisible();
}

async function openTrackCreationFixture(
  page: import("@playwright/test").Page,
  kind = "track-create",
) {
  await page.goto(`/dev/plan-fixture?preview=${kind}`);
  await expect(
    page.getByRole("heading", { name: "Create another Learning Track", level: 2 }),
  ).toBeVisible();
}

async function openTerminalFixture(page: import("@playwright/test").Page) {
  await page.goto("/dev/plan-fixture?preview=terminal");
  await expect(
    page.getByRole("heading", { name: "Complete or archive a Learning Track", level: 2 }),
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
  await expect(
    page.getByRole("region", { name: "Choose destination Track" }).getByLabel("Learning Track"),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("region", { name: "Choose destination Track" })
      .getByRole("button", { name: "Load activity choices" }),
  ).toBeFocused();
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

  await openFixture(page, "?preview=track-cadence");
  const cadenceRegion = page.getByRole("region", { name: "Track cadence" });
  await cadenceRegion.getByLabel("Track", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(cadenceRegion.getByLabel("Evidence-bearing sessions per week")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cadenceRegion.getByLabel("Why should this cadence change now?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cadenceRegion.getByRole("button", { name: "Preview cadence change" })).toBeFocused();
  await page.getByRole("button", { name: "Confirm cadence" }).focus();
  await expect(page.getByRole("button", { name: "Confirm cadence" })).toBeFocused();

  await openFixture(page, "?preview=plan-replacement");
  const replacementRegion = page.getByRole("region", { name: "Replace this Growth Plan" });
  await replacementRegion.getByLabel("New Plan target").focus();
  await page.keyboard.press("Tab");
  await expect(replacementRegion.getByLabel("New weekly capacity (minutes)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(replacementRegion.getByLabel("Default session (minutes)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(replacementRegion.getByLabel("First Track priority")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(replacementRegion.getByLabel("Reason")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    replacementRegion.getByRole("button", { name: "Preview Growth Plan replacement" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Confirm and replace Growth Plan" }).focus();
  await expect(page.getByRole("button", { name: "Confirm and replace Growth Plan" })).toBeFocused();

  await openActivityFixture(page);
  await page.getByLabel("Personal activity").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Estimated minutes")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Energy (optional)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Why does this belong in the Plan?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Preview activity" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Confirm and add activity" })).toBeFocused();

  await openMultiTrackActivityFixture(page);
  const multiTrackActivityDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(multiTrackActivityDimensions.scrollWidth).toBeLessThanOrEqual(
    multiTrackActivityDimensions.clientWidth,
  );
  const destinationRegion = page.getByRole("region", { name: "Choose destination Track" });
  await destinationRegion.getByLabel("Learning Track").focus();
  await page.keyboard.press("Tab");
  await expect(
    destinationRegion.getByRole("button", { name: "Load activity choices" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("region", { name: "Add useful work" }).getByLabel("Personal activity"),
  ).toBeFocused();

  await openTrackCreationFixture(page);
  const creationRegion = page.getByRole("region", { name: "Create another Learning Track" });
  const creationReview = page.getByRole("region", { name: "Review Learning Track creation" });
  await creationRegion.getByLabel("Target").focus();
  await page.keyboard.press("Tab");
  await expect(creationRegion.getByLabel("Track title")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(creationRegion.getByLabel("Priority (0–100)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(creationRegion.getByLabel("Default session (minutes)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(creationRegion.getByLabel("Why does this Track belong now?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    creationRegion.getByRole("button", { name: "Preview Learning Track" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    creationReview.getByRole("button", { name: "Confirm and create Learning Track" }),
  ).toBeFocused();

  await openTerminalFixture(page);
  const terminalRegion = page.getByRole("region", {
    name: "Complete or archive a Learning Track",
  });
  await terminalRegion.getByLabel("Track", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(terminalRegion.getByLabel("Complete Track")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(terminalRegion.getByLabel("Archive Track")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(terminalRegion.getByLabel("Why should this Track change now?")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    terminalRegion.getByRole("button", { name: "Preview terminal change" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(terminalRegion.getByRole("link", { name: "Next history page" })).toBeFocused();

  await openTerminalFixture(page);
  await page.getByRole("button", { name: "Complete this Track" }).focus();
  await expect(page.getByRole("button", { name: "Complete this Track" })).toBeFocused();
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

  await openFixture(page, "?preview=track-cadence");
  const cadenceDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(cadenceDimensions.scrollWidth).toBeLessThanOrEqual(cadenceDimensions.clientWidth);
  const cadenceRegion = page.getByRole("region", { name: "Track cadence" });
  for (const control of [
    cadenceRegion.getByLabel("Track", { exact: true }),
    cadenceRegion.getByLabel("Evidence-bearing sessions per week"),
    cadenceRegion.getByRole("button", { name: "Preview cadence change" }),
    page.getByRole("button", { name: "Confirm cadence" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openFixture(page, "?preview=plan-replacement");
  const replacementDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(replacementDimensions.scrollWidth).toBeLessThanOrEqual(replacementDimensions.clientWidth);
  for (const control of [
    page.getByLabel("New weekly capacity (minutes)"),
    page.getByRole("button", { name: "Preview Growth Plan replacement" }),
    page.getByRole("button", { name: "Confirm and replace Growth Plan" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openSetupFixture(page);
  const setupDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(setupDimensions.scrollWidth).toBeLessThanOrEqual(setupDimensions.clientWidth);
  for (const control of [
    page.getByLabel("Target"),
    page.getByLabel("Weekly capacity (minutes)"),
    page.getByRole("button", { name: "Confirm and create Growth Plan" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openActivityFixture(page);
  const activityDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(activityDimensions.scrollWidth).toBeLessThanOrEqual(activityDimensions.clientWidth);
  for (const control of [
    page.getByLabel("Personal activity"),
    page.getByLabel("Estimated minutes"),
    page.getByLabel("Energy (optional)"),
    page.getByRole("button", { name: "Confirm and add activity" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openMultiTrackActivityFixture(page);
  const destinationRegion = page.getByRole("region", { name: "Choose destination Track" });
  for (const control of [
    destinationRegion.getByLabel("Learning Track"),
    destinationRegion.getByRole("button", { name: "Load activity choices" }),
    page.getByRole("region", { name: "Add useful work" }).getByLabel("Personal activity"),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openTrackCreationFixture(page);
  const creationRegion = page.getByRole("region", { name: "Create another Learning Track" });
  const creationReview = page.getByRole("region", { name: "Review Learning Track creation" });
  for (const control of [
    creationRegion.getByLabel("Target"),
    creationRegion.getByLabel("Track title"),
    creationRegion.getByLabel("Priority (0–100)"),
    creationRegion.getByLabel("Default session (minutes)"),
    creationReview.getByRole("button", { name: "Confirm and create Learning Track" }),
  ]) {
    const controlBox = await control.boundingBox();
    expect(controlBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await openTerminalFixture(page);
  const terminalDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(terminalDimensions.scrollWidth).toBeLessThanOrEqual(terminalDimensions.clientWidth);
  const terminalRegion = page.getByRole("region", {
    name: "Complete or archive a Learning Track",
  });
  for (const control of [
    terminalRegion.getByLabel("Track", { exact: true }),
    terminalRegion.locator('label:has(input[value="complete_track"])'),
    terminalRegion.locator('label:has(input[value="archive_track"])'),
    terminalRegion.getByRole("button", { name: "Preview terminal change" }),
    terminalRegion.getByRole("link", { name: "Next history page" }),
    page.getByRole("button", { name: "Complete this Track" }),
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

  await openFixture(page, "?preview=track-cadence");
  const cadenceControl = page.getByRole("button", { name: "Confirm cadence" });
  await cadenceControl.focus();
  const cadenceStyles = await cadenceControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(cadenceStyles.outlineStyle).not.toBe("none");
  expect(cadenceStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openFixture(page, "?preview=plan-replacement");
  const replacementControl = page.getByRole("button", { name: "Confirm and replace Growth Plan" });
  await replacementControl.focus();
  const replacementStyles = await replacementControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(replacementStyles.outlineStyle).not.toBe("none");
  expect(replacementStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openSetupFixture(page);
  const setupControl = page.getByRole("button", { name: "Confirm and create Growth Plan" });
  await setupControl.focus();
  const setupStyles = await setupControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(setupStyles.outlineStyle).not.toBe("none");
  expect(setupStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openActivityFixture(page);
  const activityControl = page.getByRole("button", { name: "Confirm and add activity" });
  await activityControl.focus();
  const activityStyles = await activityControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(activityStyles.outlineStyle).not.toBe("none");
  expect(activityStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openMultiTrackActivityFixture(page);
  const destinationControl = page
    .getByRole("region", { name: "Choose destination Track" })
    .getByRole("button", { name: "Load activity choices" });
  await destinationControl.focus();
  const destinationStyles = await destinationControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(destinationStyles.outlineStyle).not.toBe("none");
  expect(destinationStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openTrackCreationFixture(page);
  const creationControl = page
    .getByRole("region", { name: "Review Learning Track creation" })
    .getByRole("button", {
      name: "Confirm and create Learning Track",
    });
  await creationControl.focus();
  const creationStyles = await creationControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(creationStyles.outlineStyle).not.toBe("none");
  expect(creationStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);

  await openTerminalFixture(page);
  const terminalControl = page.getByRole("button", { name: "Complete this Track" });
  await terminalControl.focus();
  const terminalStyles = await terminalControl.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(terminalStyles.outlineStyle).not.toBe("none");
  expect(terminalStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);
  const terminalRadio = page.getByLabel("Complete Track");
  await terminalRadio.focus();
  const terminalRadioStyles = await terminalRadio.evaluate((element) => ({
    outlineStyle: getComputedStyle(element).outlineStyle,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));
  expect(terminalRadioStyles.outlineStyle).not.toBe("none");
  expect(terminalRadioStyles.transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/u);
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

  await openFixture(page, "?preview=track-cadence");
  const cadenceResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(cadenceResults.violations).toEqual([]);

  await openFixture(page, "?preview=plan-replacement");
  const replacementResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(replacementResults.violations).toEqual([]);

  await openSetupFixture(page);
  const setupResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(setupResults.violations).toEqual([]);

  await openActivityFixture(page);
  const activityResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(activityResults.violations).toEqual([]);

  await openMultiTrackActivityFixture(page);
  const multiTrackActivityResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(multiTrackActivityResults.violations).toEqual([]);

  await openTrackCreationFixture(page);
  const creationResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(creationResults.violations).toEqual([]);

  await openTerminalFixture(page);
  const terminalResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(terminalResults.violations).toEqual([]);
});

test("shows exact activity admission consequences and all fail-closed source states", async ({
  page,
}) => {
  await openActivityFixture(page);
  const comparison = page.getByLabel("Exact activity admission preview");
  await expect(comparison).toContainText("SQL practice");
  await expect(comparison).toContainText("45 minutes");
  await expect(comparison).toContainText("2 → 3 / 200");
  await expect(comparison).toContainText("4 (unchanged)");
  await expect(page.getByRole("button", { name: "Confirm and add activity" })).toBeEnabled();

  await openActivityFixture(page, "activity-blocked");
  await expect(page.getByText(/The Plan has reached its 200-activity limit/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and add activity" })).toHaveCount(0);

  for (const [kind, copy, explore] of [
    ["activity-empty", /No accepted personal activity/iu, true],
    ["activity-limit", /already has 200 current activities/iu, false],
    ["activity-overflow", /More than 200 personal activities/iu, true],
    ["activity-unavailable", /Current Track choices are temporarily unavailable/iu, false],
  ] as const) {
    await openActivityFixture(page, kind);
    await expect(page.getByText(copy)).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview activity" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Explore" })).toHaveCount(explore ? 1 : 0);
  }
});

test("loads one destination portfolio and binds the exact Track in a V2 preview", async ({
  page,
}) => {
  await openMultiTrackActivityFixture(page, "activity-v2-unselected");
  const destinationRegion = page.getByRole("region", { name: "Choose destination Track" });
  await expect(destinationRegion.getByLabel("Learning Track").locator("option")).toHaveCount(2);
  await expect(destinationRegion.getByLabel("Learning Track")).toHaveValue("track:system-design");
  await expect(
    page.getByText(/Choose a current Track above to load its bounded activity choices/iu),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview activity" })).toHaveCount(0);

  await openMultiTrackActivityFixture(page);
  await expect(destinationRegion.getByLabel("Learning Track")).toHaveValue("track:algorithms");
  const activityRegion = page.getByRole("region", { name: "Add useful work" });
  await expect(activityRegion).toContainText("Algorithms");
  await expect(activityRegion.getByLabel("Personal activity")).toHaveValue(
    "activity:graph-practice",
  );
  await expect(activityRegion.locator('input[name="trackKey"]')).toHaveValue("track:algorithms");
  const comparison = page.getByLabel("Exact activity admission preview");
  await expect(comparison).toContainText("Graph practice");
  await expect(comparison).toContainText("Algorithms");
  await expect(page.getByRole("button", { name: "Confirm and add activity" })).toBeEnabled();

  await openMultiTrackActivityFixture(page, "activity-v2-stale");
  await expect(destinationRegion.getByLabel("Learning Track")).toHaveValue("track:system-design");
  await expect(page.getByText(/destination Track is no longer current/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and add activity" })).toHaveCount(0);

  await openMultiTrackActivityFixture(page, "activity-v2-blocked");
  await expect(page.getByText(/The Plan has reached its 200-activity limit/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and add activity" })).toHaveCount(0);

  for (const [kind, copy, explore] of [
    ["activity-v2-empty", /No accepted personal activity/iu, true],
    ["activity-v2-limit", /already has 200 current activities/iu, false],
    ["activity-v2-overflow", /More than 200 personal activities/iu, true],
  ] as const) {
    await openMultiTrackActivityFixture(page, kind);
    await expect(page.getByText(copy)).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview activity" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Explore" })).toHaveCount(explore ? 1 : 0);
  }
});

test("shows an exact first-Plan setup preview and keeps its confirmation keyboard-operable", async ({
  page,
}) => {
  await openSetupFixture(page);
  const comparison = page.getByLabel("Exact first Growth Plan preview");
  await expect(comparison).toContainText("Not created");
  await expect(comparison).toContainText("600 minutes");
  await expect(comparison).toContainText("50");
  await expect(page.getByText(/initial Track has no activities/iu)).toBeVisible();
  await page.getByLabel("Target").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Weekly capacity (minutes)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Default session (minutes)")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("First Track priority")).toBeFocused();
  await page.getByRole("button", { name: "Confirm and create Growth Plan" }).focus();
  await expect(page.getByRole("button", { name: "Confirm and create Growth Plan" })).toBeFocused();
});

test("shows exact Track creation consequences and fail-closed source states", async ({ page }) => {
  await openTrackCreationFixture(page);
  const comparison = page.getByLabel("Exact Learning Track creation preview");
  await expect(comparison).toContainText("Track order");
  await expect(comparison).toContainText("Algorithms sprint");
  await expect(comparison).toContainText("45 minutes");
  await expect(page.getByText(/starts empty/iu)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm and create Learning Track" }),
  ).toBeEnabled();

  await openTrackCreationFixture(page, "track-create-blocked");
  await expect(
    page.getByRole("region", { name: "Review Learning Track creation" }).getByRole("alert"),
  ).toContainText("already at 30 current Tracks");
  await expect(page.getByRole("button", { name: "Confirm and create Learning Track" })).toHaveCount(
    0,
  );

  for (const [kind, copy, targetsLink] of [
    ["track-create-no-goals", /No active Targets are available/iu, true],
    ["track-create-overflow", /More than 20 active Goals/iu, true],
    ["track-create-limit", /already has 30 current Tracks/iu, false],
  ] as const) {
    await openTrackCreationFixture(page, kind);
    await expect(page.getByText(copy)).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview Learning Track" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Targets" })).toHaveCount(targetsLink ? 1 : 0);
  }
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

test("shows exact soft cadence consequences without inventing progress or capacity", async ({
  page,
}) => {
  await openFixture(page, "?preview=track-cadence");
  const comparison = page.getByLabel("Exact Learning Track cadence preview");
  await expect(comparison).toContainText("System design");
  await expect(comparison).toContainText("2 sessions per week");
  await expect(comparison).toContainText("3 sessions per week");
  await expect(comparison).toContainText("Cadence deficit");
  await expect(page.getByText(/A value of 0 means no cadence target/iu)).toBeVisible();
  await expect(
    page.getByText(/does not reserve minutes, prove Mastery, or block planning/iu),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm cadence" })).toBeEnabled();
});

test("shows exact Growth Plan replacement consequences and retained history", async ({ page }) => {
  await openFixture(page, "?preview=plan-replacement");
  const region = page.getByRole("region", { name: "Replace this Growth Plan" });
  await expect(region).toContainText("archives");
  const comparison = page.getByLabel("Exact Growth Plan replacement preview");
  await expect(comparison).toContainText(
    "3 total · 1 active · 1 paused · 1 completed · 0 archived",
  );
  await expect(comparison).toContainText("ARCHIVED · version 5");
  await expect(comparison).toContainText("Recalculation pending");
  await expect(comparison).toContainText(/Preserved: archived Plan and its Tracks/u);
  await expect(page.getByText(/Its Learning Tracks stay with the archived Plan/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm and replace Growth Plan" })).toBeEnabled();

  await page.getByLabel("New weekly capacity (minutes)").fill("300");
  await expect(page.getByRole("button", { name: "Confirm and replace Growth Plan" })).toHaveCount(
    0,
  );
});

test("shows exact terminal Track consequences and keeps archived history read-only", async ({
  page,
}) => {
  await openTerminalFixture(page);
  const comparison = page.getByLabel("Exact terminal Learning Track preview");
  await expect(comparison).toContainText("System design");
  await expect(comparison).toContainText("ACTIVE");
  await expect(comparison).toContainText("COMPLETED");
  await expect(comparison).toContainText("Terminal history");
  await expect(page.getByText(/proves no Mastery or readiness/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete this Track" })).toBeEnabled();

  const terminalRegion = page.getByRole("region", {
    name: "Complete or archive a Learning Track",
  });
  const nextPage = terminalRegion.getByRole("link", { name: "Next history page" });
  await expect(nextPage).toHaveAttribute(
    "href",
    "/dev/plan-fixture?preview=terminal-history-page-2",
  );
  await nextPage.click();
  await expect(page).toHaveURL(/preview=terminal-history-page-2$/u);
  await expect(
    page.getByRole("option", { name: /Retired distributed systems course/iu }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Complete this Track" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Next history page" })).toHaveCount(0);

  await openTerminalFixture(page);
  const firstPageRegion = page.getByRole("region", {
    name: "Complete or archive a Learning Track",
  });
  await firstPageRegion
    .getByLabel("Track", { exact: true })
    .selectOption("track:database-foundations");
  await expect(firstPageRegion.getByLabel("Archive Track")).toBeChecked();
  await expect(firstPageRegion.getByLabel("Complete Track")).toHaveCount(0);

  await firstPageRegion
    .getByLabel("Track", { exact: true })
    .selectOption("track:legacy-cloud-course");
  await expect(firstPageRegion.getByText(/archived Track is read-only/iu)).toBeVisible();
  await expect(
    firstPageRegion.getByRole("button", { name: "Preview terminal change" }),
  ).toHaveCount(0);
});
