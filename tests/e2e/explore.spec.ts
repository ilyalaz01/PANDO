import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const graphTraversal = /Graph traversal, competency/;

async function mapPositions(page: import("@playwright/test").Page) {
  return page.locator('[data-explore-view="map"]').evaluateAll((elements) =>
    elements
      .map((element) => ({
        id: element.getAttribute("data-explore-node-id"),
        x: element.getAttribute("data-position-x"),
        y: element.getAttribute("data-position-y"),
      }))
      .sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "")),
  );
}

test("renders the representative payload and preserves selection/focus between Map and Outline", async ({
  page,
}) => {
  await page.goto("/explore");

  await expect(page.getByText(/Representative Phase 0 fixture: 25 nodes/)).toBeVisible();
  await expect(page.locator('[data-explore-view="map"]')).toHaveCount(25);

  const mapNode = page.getByRole("button", { name: graphTraversal });
  await mapNode.click();
  await expect(mapNode).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Graph traversal" })).toBeVisible();

  await page.getByRole("button", { name: "Outline" }).click();
  const outlineNode = page.getByRole("button", { name: graphTraversal });
  await expect(outlineNode).toHaveAttribute("aria-pressed", "true");
  await expect(outlineNode).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /Hash tables, competency/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator('[data-explore-view="outline"][tabindex="0"]')).toHaveAttribute(
    "data-explore-focus-order",
    "25",
  );
});

test("supports bypass navigation and reload-stable server positions", async ({ page }) => {
  await page.goto("/explore");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to competency explorer" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  const before = await mapPositions(page);
  expect(before).toHaveLength(25);
  await page.reload();
  await expect(page.locator('[data-explore-view="map"]')).toHaveCount(25);
  expect(await mapPositions(page)).toEqual(before);
});

test("uses the compact fallback on mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");

  await expect(page.getByTestId("mobile-map-fallback")).toBeVisible();
  await expect(page.getByTestId("explore-map")).toBeHidden();
  await page.getByRole("button", { name: "Use accessible outline" }).click();
  await expect(page.getByTestId("explore-outline")).toBeVisible();
  await expect(page.locator('[data-explore-view="outline"]')).toHaveCount(25);

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test("honors reduced motion and forced-colors focus/selection", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto("/explore");

  const node = page.getByRole("button", { name: /Algorithms, domain summary/ });
  await node.focus();
  await node.click();
  const styles = await node.evaluate((element) => {
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
  await page.goto("/explore");
  const mapResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(mapResults.violations).toEqual([]);

  await page.getByRole("button", { name: "Outline" }).click();
  const outlineResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(outlineResults.violations).toEqual([]);
});

test("keeps representative map zoom p95 and long-task budgets", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore");
  await expect(page.locator('[data-explore-view="map"]')).toHaveCount(25);

  const result = await page.evaluate(async () => {
    const longTasks: number[] = [];
    const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
    const observer = longTaskSupported
      ? new PerformanceObserver((list) => {
          longTasks.push(...list.getEntries().map((entry) => entry.duration));
        })
      : null;
    observer?.observe({ entryTypes: ["longtask"] });

    const control = document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in map"]');
    if (!control) throw new Error("Zoom control not found");
    control.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      control.click();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(performance.now() - startedAt);
    }
    observer?.disconnect();
    samples.sort((a, b) => a - b);
    return {
      p95: samples[Math.ceil(samples.length * 0.95) - 1] ?? 0,
      longestTask: Math.max(0, ...longTasks),
      longTaskSupported,
      renderedNodes: document.querySelectorAll('[data-explore-view="map"]').length,
    };
  });

  console.info(
    `[explore-browser-budget] zoom-p95-ms=${result.p95.toFixed(3)} longest-task-ms=${result.longestTask.toFixed(3)} rendered-nodes=${result.renderedNodes}`,
  );
  expect(result.longTaskSupported).toBe(true);
  expect(result.renderedNodes).toBe(25);
  expect(result.p95).toBeLessThanOrEqual(32);
  expect(result.longestTask).toBeLessThanOrEqual(100);
});
