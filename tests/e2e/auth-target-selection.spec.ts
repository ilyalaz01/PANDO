import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("exposes only the invite-only sign-in journey and supports keyboard bypass", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in to PANDO" }).click();

  await expect(page).toHaveURL(/\/sign-in$/u);
  await expect(page.getByRole("heading", { name: "Return to your roots." })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "autocomplete",
    "email",
  );
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.getByRole("link", { name: /sign up|register|create account/iu })).toHaveCount(
    0,
  );

  await page.reload();
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to sign in" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("redirects an unauthenticated start request without reflecting an attacker-controlled return URL", async ({
  page,
}) => {
  await page.goto("/start?next=https%3A%2F%2Fevil.example%2Fsteal");

  await expect(page).toHaveURL(/\/sign-in\?status=(?:unavailable|session-required)$/u);
  await expect(page.getByRole("heading", { name: "Return to your roots." })).toBeVisible();
  expect(page.url()).not.toContain("evil.example");
});

test("keeps sign-in responsive, reduced-motion aware, and free of detectable WCAG A/AA issues", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sign-in");

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    motionDuration: getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-duration-standard")
      .trim(),
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.motionDuration).toBe("80ms");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
