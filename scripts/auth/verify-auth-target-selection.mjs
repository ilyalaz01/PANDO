import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  createOnceAsync,
  copyValidatedSupabaseInputs,
  findFreePort,
  installSignalLatch,
  setDbPort,
  setProjectId,
  SIGNAL_EXIT_CODES,
} from "../database/verify-database-core.mjs";
import {
  cleanupAuthGate,
  combineAuthGateErrors,
  formatAuthGateError,
} from "./verify-auth-target-selection-core.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const supabaseCli = join(root, "node_modules", "supabase", "dist", "supabase.js");
const nextCli = join(root, "node_modules", "next", "dist", "bin", "next");
const scratch = await mkdtemp(join(tmpdir(), "pando-auth-gate-"));
const workdir = join(scratch, "project");
const projectId = `pando-auth-gate-${randomBytes(6).toString("hex")}`;

let browser;
let nextServer;
let activeCaptureChild;
let supabaseStartAttempted = false;
let supabaseStarted = false;
let primaryError;
let cleanupError;

function setTomlValue(config, section, key, value) {
  const lines = config.replace(/\r\n/g, "\n").split("\n");
  const sectionPattern = new RegExp(`^\\s*\\[${section.replaceAll(".", "\\.")}\\]\\s*$`, "u");
  const sectionStart = lines.findIndex((line) => sectionPattern.test(line));
  if (sectionStart === -1) {
    return `${lines.join("\n").trimEnd()}\n\n[${section}]\n${key} = ${value}\n`;
  }
  let sectionEnd = lines.findIndex(
    (line, index) => index > sectionStart && /^\s*\[[^\]]+\]\s*$/u.test(line),
  );
  if (sectionEnd === -1) sectionEnd = lines.length;
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`, "u");
  const keyIndex = lines.findIndex(
    (line, index) => index > sectionStart && index < sectionEnd && keyPattern.test(line),
  );
  if (keyIndex === -1) lines.splice(sectionStart + 1, 0, `${key} = ${value}`);
  else lines[keyIndex] = `${key} = ${value}`;
  return lines.join("\n");
}

function runCapture(program, args, { cwd = root, env = process.env, label } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    if (activeCaptureChild) {
      rejectRun(new Error("Refusing concurrent captured auth-gate children"));
      return;
    }
    let child;
    try {
      child = spawn(program, args, {
        cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      rejectRun(error);
      return;
    }
    activeCaptureChild = child;
    let stdout = "";
    let stderr = "";
    let childError;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      childError = error;
    });
    child.once("close", (code, signal) => {
      if (activeCaptureChild === child) activeCaptureChild = undefined;
      if (childError) rejectRun(childError);
      else if (code === 0) resolveRun({ stdout, stderr });
      else
        rejectRun(
          new Error(`${label ?? basename(program)} failed (${code ?? signal ?? "unknown"})`),
        );
    });
  });
}

function spawnQuiet(program, args, { cwd = root, env = process.env } = {}) {
  return spawn(program, args, {
    cwd,
    env,
    shell: false,
    stdio: "ignore",
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 5_000);
    child.once("close", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("PANDO auth gate server exited before becoming ready");
    }
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("PANDO auth gate server did not become ready");
}

function requireStatusValue(status, key) {
  const value = status[key];
  if (typeof value !== "string" || value.length < 1) {
    throw new Error(`Supabase status omitted ${key}`);
  }
  return value;
}

function normalizeGeneratedTypes(value) {
  return `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;
}

function assertSafeScratch() {
  if (dirname(scratch) !== resolve(tmpdir()) || !basename(scratch).startsWith("pando-auth-gate-")) {
    throw new Error(`Refusing to clean unexpected auth-gate scratch: ${scratch}`);
  }
}

async function closeRuntime() {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => browser?.close()),
    stopChild(nextServer),
    stopChild(activeCaptureChild),
  ]);
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "auth runtime cleanup failed");
}

const cleanup = createOnceAsync(() =>
  cleanupAuthGate({
    supabaseStartAttempted,
    closeRuntime,
    stopSupabase: () =>
      runCapture(
        process.execPath,
        [supabaseCli, "--workdir", workdir, "stop", "--project-id", projectId, "--no-backup"],
        {
          cwd: workdir,
          env: { ...process.env, CI: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
          label: supabaseStarted
            ? "isolated Supabase auth cleanup"
            : "isolated Supabase partial-start cleanup",
        },
      ),
    removeScratch: async () => {
      assertSafeScratch();
      await rm(scratch, { recursive: true, force: true });
    },
    projectId,
    workdir,
  }),
);
const signalLatch = installSignalLatch({
  onSignal: async () => cleanup(),
});

try {
  await copyValidatedSupabaseInputs({
    sourceSupabase: join(root, "supabase"),
    destinationSupabase: join(workdir, "supabase"),
  });
  const [dbPort, apiPort, appPort] = await Promise.all([
    findFreePort(),
    findFreePort(),
    findFreePort(),
  ]);
  const configPath = join(workdir, "supabase", "config.toml");
  let config = await readFile(configPath, "utf8");
  config = setProjectId(config, projectId);
  config = setDbPort(config, dbPort);
  config = setTomlValue(config, "api", "port", apiPort);
  config = setTomlValue(config, "auth", "site_url", `"http://127.0.0.1:${appPort}"`);
  config = setTomlValue(config, "auth", "jwt_expiry", "60");
  await writeFile(configPath, config);

  const supabaseEnvironment = {
    ...process.env,
    CI: "1",
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
  supabaseStartAttempted = true;
  await runCapture(
    process.execPath,
    [
      supabaseCli,
      "--workdir",
      workdir,
      "start",
      "--exclude",
      "realtime,storage-api,imgproxy,studio,postgres-meta,mailpit,edge-runtime,logflare,vector,supavisor",
    ],
    { cwd: workdir, env: supabaseEnvironment, label: "isolated Supabase auth stack" },
  );
  supabaseStarted = true;

  const statusResult = await runCapture(
    process.execPath,
    [supabaseCli, "--workdir", workdir, "status", "-o", "json"],
    { cwd: workdir, env: supabaseEnvironment, label: "Supabase auth status" },
  );
  const status = JSON.parse(statusResult.stdout);
  const apiUrl = requireStatusValue(status, "API_URL");
  const publishableKey = requireStatusValue(status, "ANON_KEY");
  const serviceRoleKey = requireStatusValue(status, "SERVICE_ROLE_KEY");

  const generatedTypes = await runCapture(
    process.execPath,
    [supabaseCli, "--workdir", workdir, "gen", "types", "typescript", "--local", "--schema", "api"],
    { cwd: workdir, env: supabaseEnvironment, label: "Supabase database type generation" },
  );
  const generatedTypePath = join(root, "src", "shared", "supabase", "database.generated.ts");
  const committedGeneratedTypes = await readFile(generatedTypePath, "utf8");
  assert.equal(
    normalizeGeneratedTypes(committedGeneratedTypes),
    normalizeGeneratedTypes(generatedTypes.stdout),
    "generated Supabase database types must match the migrated api schema",
  );

  const ownerEmail = `owner-${randomBytes(6).toString("hex")}@pando.test`;
  const ownerPassword = `Pando-${randomBytes(18).toString("base64url")}`;
  const authProbe = createClient(apiUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const blockedSignup = await authProbe.auth.signUp({
    email: `blocked-${randomBytes(6).toString("hex")}@pando.test`,
    password: ownerPassword,
  });
  assert.notEqual(blockedSignup.error, null, "public email sign-up must remain disabled");
  assert.equal(blockedSignup.data.user, null, "blocked sign-up must not create a user");
  assert.equal(blockedSignup.data.session, null, "blocked sign-up must not create a session");
  const blockedAnonymousSignIn = await authProbe.auth.signInAnonymously();
  assert.notEqual(
    blockedAnonymousSignIn.error,
    null,
    "public anonymous sign-in must remain disabled",
  );
  assert.equal(
    blockedAnonymousSignIn.data.user,
    null,
    "blocked anonymous sign-in must not create a user",
  );
  assert.equal(
    blockedAnonymousSignIn.data.session,
    null,
    "blocked anonymous sign-in must not create a session",
  );
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUser = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  });
  assert.equal(createdUser.error, null, "isolated owner provisioning must succeed");
  const authProbeResult = await authProbe.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  });
  assert.equal(
    authProbeResult.error,
    null,
    "synthetic owner must authenticate through public Auth",
  );
  await authProbe.auth.signOut({ scope: "local" });

  const appEnvironment = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  };
  await runCapture(process.execPath, [nextCli, "build"], {
    cwd: root,
    env: appEnvironment,
    label: "PANDO production build for auth gate",
  });
  nextServer = spawnQuiet(
    process.execPath,
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(appPort)],
    { cwd: root, env: appEnvironment },
  );
  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForHttp(`${baseUrl}/sign-in`, nextServer);

  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  const signInOutcome = await Promise.race([
    page.waitForURL(/\/start$/u).then(() => "authenticated"),
    page
      .locator('form [role="status"]')
      .filter({ hasText: /\S/u })
      .waitFor()
      .then(() => "error"),
  ]);
  if (signInOutcome !== "authenticated") {
    const publicStatus = await page.locator('form [role="status"]').textContent();
    throw new Error(
      `browser sign-in failed with public status: ${publicStatus?.trim() || "empty"}`,
    );
  }
  await page.getByRole("heading", { name: /Choose the outcome/u }).waitFor();
  const authCookiesBeforeRefresh = (await context.cookies())
    .filter((cookie) => cookie.name.includes("-auth-token"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .sort();
  assert.ok(authCookiesBeforeRefresh.length > 0, "browser sign-in must persist an auth cookie");
  const refreshResponse = await page.goto(`${baseUrl}/start`);
  assert.equal(
    refreshResponse?.status(),
    200,
    "near-expiry session refresh must stay authenticated",
  );
  const refreshHeaders = await refreshResponse.headersArray();
  const refreshCacheControl = refreshHeaders.find(
    ({ name }) => name.toLowerCase() === "cache-control",
  )?.value;
  assert.match(
    refreshCacheControl ?? "",
    /private.*no-store|no-store.*private/u,
    "refreshed authenticated response must remain private and non-cacheable",
  );
  assert.ok(
    refreshHeaders.some(
      ({ name, value }) => name.toLowerCase() === "set-cookie" && value.includes("-auth-token"),
    ),
    "near-expiry session refresh must write the rotated auth cookie",
  );
  const authCookiesAfterRefresh = (await context.cookies())
    .filter((cookie) => cookie.name.includes("-auth-token"))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .sort();
  assert.notDeepEqual(
    authCookiesAfterRefresh,
    authCookiesBeforeRefresh,
    "near-expiry session refresh must rotate the browser auth cookie",
  );
  await page.getByRole("heading", { name: /Choose the outcome/u }).waitFor();

  await Promise.all([
    page.waitForURL(/\/start\?goal=/u),
    page.getByRole("button", { name: "Use this target" }).click(),
  ]);
  assert.equal(
    new URL(page.url()).searchParams.get("goal"),
    "goal:nvidia-python-verification-base-v1",
  );
  await page.getByText("Selected readiness goal").waitFor();
  await page.reload();
  await page.getByText("Selected readiness goal").waitFor();
  await Promise.all([
    page.waitForURL(/\/start\?goal=/u),
    page.getByRole("button", { name: "Use this target" }).click(),
  ]);
  assert.equal(
    new URL(page.url()).searchParams.get("goal"),
    "goal:nvidia-python-verification-base-v1",
    "an identical browser retry must reuse the derived readiness goal",
  );

  await Promise.all([
    page.waitForURL(/\/explore\?goal=/u),
    page.getByRole("link", { name: "Explore this target" }).click(),
  ]);
  assert.equal(
    new URL(page.url()).searchParams.get("goal"),
    "goal:nvidia-python-verification-base-v1",
    "live Explore must preserve the exact selected readiness goal",
  );
  await page.getByRole("heading", { name: "See the roots beneath your next move." }).waitFor();
  await page.getByText("Projection state · Not materialized").waitFor();
  assert.ok(
    (await page.locator('[data-explore-view="map"]').count()) > 0,
    "live Explore must render the authorized target structure",
  );
  assert.equal(
    await page.getByText(/Representative Phase 0 fixture/u).count(),
    0,
    "production Explore must never substitute the representative fixture",
  );
  const exploreAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(exploreAccessibility.violations, [], "authenticated /explore must pass axe");

  await page.goto(
    `${baseUrl}/start?goal=${encodeURIComponent("goal:nvidia-python-verification-base-v1")}`,
  );
  await page.getByText("Selected readiness goal").waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    motionDuration: getComputedStyle(document.documentElement)
      .getPropertyValue("--motion-duration-standard")
      .trim(),
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    "authenticated /start must not overflow",
  );
  assert.equal(dimensions.motionDuration, "80ms", "authenticated /start must honor reduced motion");
  const targetButtonBox = await page.getByRole("button", { name: "Use this target" }).boundingBox();
  assert.ok(
    targetButtonBox !== null && targetButtonBox.height >= 48,
    "target selection must preserve a 48px mobile touch target",
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(accessibility.violations, [], "authenticated /start must pass axe");
  const keyboardPage = await context.newPage();
  await keyboardPage.goto(page.url());
  await keyboardPage.getByRole("heading", { name: /Choose the outcome/u }).waitFor();
  await keyboardPage.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await keyboardPage.keyboard.press("Tab");
  await keyboardPage.evaluate(() => document.body.removeAttribute("tabindex"));
  assert.equal(
    await keyboardPage
      .getByRole("link", { name: "Skip to target selection" })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await keyboardPage.keyboard.press("Enter");
  assert.equal(
    await keyboardPage.locator("main").evaluate((node) => node === document.activeElement),
    true,
  );
  await keyboardPage.close();

  const verifier = createClient(apiUrl, publishableKey, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const verifierSignIn = await verifier.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  });
  assert.equal(verifierSignIn.error, null, "user-scoped verification login must succeed");
  const source = await verifier.rpc("get_target_selection_source_v1");
  assert.equal(source.error, null, "user-scoped target source must load after browser selection");
  assert.equal(source.data?.workspace?.workspaceKind, "personal");
  assert.deepEqual(
    source.data?.readinessGoals?.map((goal) => goal.readinessGoalKey),
    ["goal:nvidia-python-verification-base-v1"],
  );
  const liveExploreSource = await verifier.rpc("get_current_explore_source_v1", {
    p_readiness_goal_key: "goal:nvidia-python-verification-base-v1",
  });
  assert.equal(liveExploreSource.error, null, "zero-workspace Explore source must load");
  assert.equal(liveExploreSource.data?.contract?.name, "ExploreSourceV1");
  const liveTargetContext = await verifier.rpc("get_explore_target_context_v1", {
    p_readiness_goal_key: "goal:nvidia-python-verification-base-v1",
  });
  assert.equal(liveTargetContext.error, null, "zero-workspace target context must load");
  assert.equal(liveTargetContext.data?.contract?.name, "ExploreTargetContextV1");

  await Promise.all([
    page.waitForURL(/\/sign-in$/u),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
  await page.goto(`${baseUrl}/start`);
  assert.match(page.url(), /\/sign-in\?status=session-required$/u);
  await context.close();
} catch (error) {
  primaryError = error;
} finally {
  await signalLatch.wait().catch(() => undefined);
  await cleanup().catch((error) => {
    cleanupError = error;
  });
  signalLatch.dispose();
}

const finalError = combineAuthGateErrors(primaryError, cleanupError);
const receivedSignal = signalLatch.receivedSignal();
if (receivedSignal) {
  if (finalError) {
    process.stderr.write(`PANDO auth gate interrupted:\n${formatAuthGateError(finalError)}\n`);
  }
  process.exitCode = SIGNAL_EXIT_CODES[receivedSignal];
} else if (finalError) {
  throw finalError;
} else {
  process.stdout.write(
    "isolated auth, personal-workspace, target-selection, reload, refresh, and sign-out gate passed\n",
  );
}
