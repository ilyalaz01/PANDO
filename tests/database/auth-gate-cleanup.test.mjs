import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupAuthGate,
  combineAuthGateErrors,
  formatAuthGateError,
} from "../../scripts/auth/verify-auth-target-selection-core.mjs";

test("preserves a failed start and failed stop while retaining the recovery scratch", async () => {
  const startError = new Error("docker start denied");
  const stopError = new Error("docker stop denied");
  let scratchRemoved = false;

  const cleanupError = await cleanupAuthGate({
    supabaseStartAttempted: true,
    closeRuntime: async () => {},
    stopSupabase: async () => {
      throw stopError;
    },
    removeScratch: async () => {
      scratchRemoved = true;
    },
    projectId: "pando-auth-gate-test",
    workdir: "C:\\Temp\\pando-auth-gate-test\\project",
  }).then(
    () => assert.fail("cleanup must report the failed stop"),
    (error) => error,
  );

  const finalError = combineAuthGateErrors(startError, cleanupError);
  assert.ok(finalError instanceof AggregateError);
  assert.deepEqual(finalError.errors, [startError, cleanupError]);
  assert.match(cleanupError.message, /pando-auth-gate-test/u);
  assert.match(cleanupError.message, /docker stop denied/u);
  assert.equal(scratchRemoved, false, "failed stop retains the exact recovery workdir");
  const interruptDiagnostic = formatAuthGateError(finalError);
  assert.match(interruptDiagnostic, /PANDO auth gate and cleanup both failed/u);
  assert.match(interruptDiagnostic, /docker start denied/u);
  assert.match(interruptDiagnostic, /pando-auth-gate-test/u);
  assert.match(interruptDiagnostic, /C:\\Temp\\pando-auth-gate-test\\project/u);
  assert.match(interruptDiagnostic, /docker stop denied/u);
});

test("removes the scratch after a successful attempted start cleanup", async () => {
  const calls = [];
  await cleanupAuthGate({
    supabaseStartAttempted: true,
    closeRuntime: async () => calls.push("runtime"),
    stopSupabase: async () => calls.push("supabase"),
    removeScratch: async () => calls.push("scratch"),
    projectId: "pando-auth-gate-test",
    workdir: "C:\\Temp\\pando-auth-gate-test\\project",
  });
  assert.deepEqual(calls, ["runtime", "supabase", "scratch"]);
});
