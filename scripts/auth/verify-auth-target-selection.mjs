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

async function loadCurrentTargetReadiness({
  client,
  baseUrl,
  dispatchSecret,
  readinessGoalKey,
  label,
}) {
  const dispatches = [];
  let result = await client.rpc("get_target_readiness_v1", {
    p_readiness_goal_key: readinessGoalKey,
  });
  assert.equal(result.error, null, `${label} readiness must load`);
  for (let attempt = 0; attempt < 2 && result.data?.projectionState !== "CURRENT"; attempt += 1) {
    if (attempt > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 6_000));
    const response = await fetch(`${baseUrl}/api/internal/target-readiness`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dispatchSecret}` },
    });
    assert.equal(response.status, 200, `${label} readiness recovery wake-up must succeed`);
    dispatches.push(await response.json());
    result = await client.rpc("get_target_readiness_v1", {
      p_readiness_goal_key: readinessGoalKey,
    });
    assert.equal(result.error, null, `${label} recovered readiness must load`);
  }
  assert.equal(
    result.data?.projectionState,
    "CURRENT",
    `${label} readiness must become current; dispatches=${JSON.stringify(dispatches)} state=${JSON.stringify(result.data)}`,
  );
  return result.data;
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

  const internalDispatchSecret = `auth-gate-${randomBytes(24).toString("base64url")}`;
  const appEnvironment = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    PANDO_INTERNAL_DISPATCH_SECRET: internalDispatchSecret,
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

  const readinessVerifier = createClient(apiUrl, publishableKey, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const readinessVerifierSignIn = await readinessVerifier.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  });
  assert.equal(readinessVerifierSignIn.error, null, "readiness verifier login must succeed");
  const readinessGoalKey = "goal:nvidia-python-verification-base-v1";
  const initialReadiness = await loadCurrentTargetReadiness({
    client: readinessVerifier,
    baseUrl,
    dispatchSecret: internalDispatchSecret,
    readinessGoalKey,
    label: "initial Unknown",
  });
  assert.equal(initialReadiness.snapshot?.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(initialReadiness.snapshot?.coverage, 0, "Unknown inputs must not invent coverage");
  assert.ok(
    initialReadiness.inputs?.every((input) => input.value === "UNKNOWN"),
    "a new goal must preserve every evidence-free input as Unknown",
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
  await page.getByText("Readiness · CURRENT").waitFor();
  assert.equal(
    await page.getByText("≈0%").count(),
    0,
    "low-coverage Unknown readiness must not be shown as a point estimate",
  );
  assert.ok(
    (await page.locator('[data-explore-view="map"]').count()) > 0,
    "live Explore must render the authorized target structure",
  );
  assert.equal(
    await page.getByText(/Representative Phase 0 fixture/u).count(),
    0,
    "production Explore must never substitute the representative fixture",
  );

  const inspectGap = page.getByRole("button", { name: /^Inspect /u }).first();
  await inspectGap.waitFor();
  await inspectGap.click();
  const selectedOutlineGap = page.locator('[data-explore-view="outline"][aria-pressed="true"]');
  await selectedOutlineGap.waitFor();
  assert.equal(
    await selectedOutlineGap.count(),
    1,
    "an Explore readiness gap must select exactly one Outline competency",
  );
  assert.equal(
    await selectedOutlineGap.evaluate((element) => document.activeElement === element),
    true,
    "an Explore readiness gap must move keyboard focus to its selected Outline competency",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const readinessMobileAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    readinessMobileAccessibility.violations,
    [],
    "authenticated mobile Explore readiness must pass axe",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Map" }).click();

  const competencyButton = page.getByRole("button", { name: /Error handling, competency/u });
  await competencyButton.click();
  const privateNote = page.getByLabel("Private note");
  await privateNote.waitFor();
  const noteBody = "Auth gate: rehearse failure modes before the next interview.";
  await privateNote.fill(noteBody);
  await page.getByRole("button", { name: /Save note|Update note/u }).click();
  await page.getByRole("status").filter({ hasText: "Note saved." }).waitFor();

  await page.reload();
  await page.getByRole("heading", { name: "See the roots beneath your next move." }).waitFor();
  await page.getByRole("button", { name: /Error handling, competency/u }).click();
  const persistedNote = page.getByLabel("Private note");
  await persistedNote.waitFor();
  assert.equal(
    await persistedNote.inputValue(),
    noteBody,
    "the note must survive a browser reload",
  );

  const activityTitle = "Implement Python failure handling";
  await page.getByLabel("New activity").fill(activityTitle);
  await page.getByLabel("Activity type").selectOption("MANUAL_CODING");
  await Promise.all([
    page.waitForURL(/\/explore\?goal=.*&activity=activity%3Acustom-/u),
    page.getByRole("button", { name: "Add activity" }).click(),
  ]);
  const activityKey = new URL(page.url()).searchParams.get("activity") ?? "";
  assert.match(
    activityKey,
    /^activity:custom-[0-9a-f]{32}$/u,
    "a browser command must navigate to its server-accepted custom activity",
  );
  await page.getByRole("heading", { level: 2, name: activityTitle }).waitFor();
  await page.reload();
  await page.getByRole("heading", { level: 2, name: activityTitle }).waitFor();

  const focusLink = page.getByRole("link", { name: "Start focus session" });
  const focusHref = await focusLink.getAttribute("href");
  assert.ok(focusHref?.startsWith("/focus?"), "Explore must expose a real Focus route");
  assert.equal(new URL(focusHref, page.url()).searchParams.get("activity"), activityKey);
  await Promise.all([
    page.waitForURL(/\/focus\?goal=.*&activity=/u).catch((error) => {
      throw new Error(`Explore did not navigate to Focus; current URL: ${page.url()}`, {
        cause: error,
      });
    }),
    focusLink.click(),
  ]);
  assert.equal(new URL(page.url()).searchParams.get("activity"), activityKey);
  await page.getByRole("heading", { level: 1, name: activityTitle }).waitFor();
  await page.getByText(/Produce a working result/iu).waitFor();
  await page.getByRole("button", { name: "Start focus session" }).click();
  await page.getByText("Focus is active").waitFor();
  await page.getByRole("heading", { level: 1, name: activityTitle }).waitFor();
  await page.getByText(/Produce a working result/iu).waitFor();
  await page.getByRole("button", { name: "Complete and save result" }).click();
  await page.getByText("observed success", { exact: false }).waitFor();

  const phase2Verifier = createClient(apiUrl, publishableKey, {
    db: { schema: "api" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const phase2VerifierSignIn = await phase2Verifier.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  });
  assert.equal(phase2VerifierSignIn.error, null, "Phase 2 verifier login must succeed");
  let focusAfterCompletion = await phase2Verifier.rpc("get_focus_workspace_v1", {
    p_readiness_goal_key: "goal:nvidia-python-verification-base-v1",
    p_activity_key: activityKey,
  });
  assert.equal(focusAfterCompletion.error, null, "completed Focus workspace must load");
  if (focusAfterCompletion.data?.projectionState === "pending") {
    await new Promise((resolveWait) => setTimeout(resolveWait, 6_000));
    const recoveryResponse = await fetch(`${baseUrl}/api/internal/mastery-projection`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalDispatchSecret}` },
    });
    assert.equal(recoveryResponse.status, 200, "authorized Mastery recovery wake-up must succeed");
    focusAfterCompletion = await phase2Verifier.rpc("get_focus_workspace_v1", {
      p_readiness_goal_key: "goal:nvidia-python-verification-base-v1",
      p_activity_key: activityKey,
    });
    assert.equal(focusAfterCompletion.error, null, "recovered Focus workspace must load");
  }
  if (focusAfterCompletion.data?.projectionState !== "current") {
    const workerAdmin = createClient(apiUrl, serviceRoleKey, {
      db: { schema: "api" },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const health = await workerAdmin.rpc("get_mastery_projection_health_v1");
    assert.fail(
      `Mastery projection did not become current; health=${JSON.stringify(health.data)} error=${health.error?.code ?? "none"}`,
    );
  }
  assert.equal(focusAfterCompletion.data?.masteryState?.achievementLevel, "COMPLETED");
  assert.equal(focusAfterCompletion.data?.history?.[0]?.outcome, "SUCCESS");
  assert.equal(focusAfterCompletion.data?.history?.[0]?.evidenceValid, true);
  const evidenceId = focusAfterCompletion.data?.history?.[0]?.evidenceId;
  assert.match(evidenceId ?? "", /^[0-9a-f-]{36}$/u, "completion must persist evidence");

  const readinessAfterCompletion = await loadCurrentTargetReadiness({
    client: readinessVerifier,
    baseUrl,
    dispatchSecret: internalDispatchSecret,
    readinessGoalKey,
    label: "post-evidence",
  });
  const completedReadinessInput = readinessAfterCompletion.inputs?.find(
    (input) =>
      input.competencyRef === "competency:python-error-handling" &&
      input.dimension === "APPLICATION",
  );
  assert.equal(completedReadinessInput?.value, "KNOWN");
  assert.equal(completedReadinessInput?.achievementLevel, "COMPLETED");
  assert.notEqual(
    readinessAfterCompletion.snapshot?.inputFingerprint,
    initialReadiness.snapshot?.inputFingerprint,
    "new evidence must publish a new readiness input generation",
  );

  const reviewRecoveryResponse = await fetch(`${baseUrl}/api/internal/review-projection`, {
    method: "POST",
    headers: { Authorization: `Bearer ${internalDispatchSecret}` },
  });
  assert.equal(reviewRecoveryResponse.status, 200, "authorized Review wake-up must succeed");
  const reviewDispatches = [await reviewRecoveryResponse.json()];
  let reviewAfterCompletion = await phase2Verifier.rpc("get_review_workspace_v1", {});
  assert.equal(reviewAfterCompletion.error, null, "Review workspace must load after evidence");
  if (reviewAfterCompletion.data?.projectionState !== "current") {
    await new Promise((resolveWait) => setTimeout(resolveWait, 6_000));
    const recoveryResponse = await fetch(`${baseUrl}/api/internal/review-projection`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalDispatchSecret}` },
    });
    assert.equal(recoveryResponse.status, 200, "Review recovery retry must succeed");
    reviewDispatches.push(await recoveryResponse.json());
    reviewAfterCompletion = await phase2Verifier.rpc("get_review_workspace_v1", {});
  }
  assert.equal(reviewAfterCompletion.error, null, "recovered Review workspace must load");
  if (reviewAfterCompletion.data?.projectionState !== "current") {
    const workerAdmin = createClient(apiUrl, serviceRoleKey, {
      db: { schema: "api" },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const health = await workerAdmin.rpc("get_review_projection_health_v1");
    assert.fail(
      `Review projection did not become current; dispatches=${JSON.stringify(reviewDispatches)} health=${JSON.stringify(health.data)} error=${health.error?.code ?? "none"}`,
    );
  }
  assert.equal(reviewAfterCompletion.data?.items?.length, 1, "one subject becomes one Review item");
  const reviewItem = reviewAfterCompletion.data?.items?.[0];
  assert.equal(reviewItem?.subjectRef, "competency:python-error-handling/application");
  assert.equal(reviewItem?.focus?.activityKey, activityKey);
  assert.deepEqual(
    reviewItem?.reasons?.map((reason) => reason.reasonType).sort(),
    ["RETENTION_RISK", "VERIFICATION_NEEDED"],
    "one qualifying completion must expose both current Review reasons",
  );

  const focusUrl = page.url();
  await page.goto(`${baseUrl}/review`);
  await page.getByRole("heading", { name: "Refresh what needs proof." }).waitFor();
  await page.getByRole("heading", { level: 3, name: activityTitle }).waitFor();
  await page.getByText("Retention risk", { exact: true }).waitFor();
  await page.getByText("Verification needed", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reviewDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    reviewDimensions.scrollWidth <= reviewDimensions.clientWidth,
    "authenticated Review must not overflow a 390px viewport",
  );
  const reviewAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(reviewAccessibility.violations, [], "authenticated /review must pass axe");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(focusUrl);
  await page.getByRole("heading", { level: 1, name: activityTitle }).waitFor();

  await page.getByRole("button", { name: "Correct this evidence" }).click();
  await page
    .getByLabel("Why is this evidence incorrect?")
    .fill("The auth gate intentionally invalidates this synthetic observation.");
  await page.getByRole("button", { name: "Invalidate evidence" }).click();
  await page.getByText("Evidence invalidated; original preserved").waitFor();
  const focusAfterInvalidation = await phase2Verifier.rpc("get_focus_workspace_v1", {
    p_readiness_goal_key: "goal:nvidia-python-verification-base-v1",
    p_activity_key: activityKey,
  });
  assert.equal(focusAfterInvalidation.error, null, "invalidated Focus workspace must load");
  assert.equal(focusAfterInvalidation.data?.projectionState, "current");
  assert.equal(focusAfterInvalidation.data?.masteryState?.achievementLevel, "NOT_STARTED");
  assert.equal(
    focusAfterInvalidation.data?.history?.[0]?.evidenceId,
    evidenceId,
    "invalidation must preserve the original evidence identifier",
  );
  assert.equal(focusAfterInvalidation.data?.history?.[0]?.evidenceValid, false);

  const readinessAfterInvalidation = await loadCurrentTargetReadiness({
    client: readinessVerifier,
    baseUrl,
    dispatchSecret: internalDispatchSecret,
    readinessGoalKey,
    label: "post-invalidation",
  });
  const invalidatedReadinessInput = readinessAfterInvalidation.inputs?.find(
    (input) =>
      input.competencyRef === "competency:python-error-handling" &&
      input.dimension === "APPLICATION",
  );
  assert.equal(invalidatedReadinessInput?.value, "UNKNOWN");
  assert.equal(invalidatedReadinessInput?.achievementLevel, "NOT_STARTED");

  const invalidationReviewRecovery = await fetch(`${baseUrl}/api/internal/review-projection`, {
    method: "POST",
    headers: { Authorization: `Bearer ${internalDispatchSecret}` },
  });
  assert.equal(invalidationReviewRecovery.status, 200, "Review invalidation wake-up must succeed");
  const reviewAfterInvalidation = await phase2Verifier.rpc("get_review_workspace_v1", {});
  assert.equal(
    reviewAfterInvalidation.error,
    null,
    "Review workspace must load after invalidation",
  );
  assert.equal(reviewAfterInvalidation.data?.projectionState, "current");
  assert.deepEqual(
    reviewAfterInvalidation.data?.items,
    [],
    "invalidated evidence removes its inactive unsuppressed Review subject from the queue",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const focusDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    focusDimensions.scrollWidth <= focusDimensions.clientWidth,
    "authenticated Focus must not overflow a 390px viewport",
  );
  const focusAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(focusAccessibility.violations, [], "authenticated /focus must pass axe");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${baseUrl}/explore?goal=${encodeURIComponent("goal:nvidia-python-verification-base-v1")}`,
  );
  await page.getByRole("heading", { name: "See the roots beneath your next move." }).waitFor();
  await page.getByRole("button", { name: /Error handling, competency/u }).click();
  await page.getByText(activityTitle).waitFor();
  const exploreAccessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(exploreAccessibility.violations, [], "authenticated /explore must pass axe");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const exploreDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    exploreDimensions.scrollWidth <= exploreDimensions.clientWidth,
    "authenticated competency overlay must not overflow a 390px viewport",
  );
  for (const controlName of [/Update note/u, /Add activity/u]) {
    const box = await page.getByRole("button", { name: controlName }).boundingBox();
    assert.ok(box !== null && box.height >= 48, `${controlName} must preserve a 48px touch target`);
  }

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
  const overlayDetail = await verifier.rpc("get_current_competency_overlay_v1", {
    p_readiness_goal_key: "goal:nvidia-python-verification-base-v1",
    p_competency_ref: "competency:python-error-handling",
  });
  assert.equal(overlayDetail.error, null, "current-session competency overlay must load");
  assert.equal(
    overlayDetail.data?.note?.body,
    noteBody,
    "the browser note must persist in Overlay",
  );
  assert.deepEqual(
    overlayDetail.data?.customActivities?.map((activity) => activity.title),
    [activityTitle],
    "the browser custom activity must persist in Overlay",
  );

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
    "isolated auth, target selection, overlay note/activity persistence, reload, refresh, and sign-out gate passed\n",
  );
}
