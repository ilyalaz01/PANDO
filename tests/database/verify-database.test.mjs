import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  copyValidatedSupabaseInputs,
  createOnceAsync,
  installSignalLatch,
  runDatabaseGateCli,
  SIGNAL_EXIT_CODES,
} from "../../scripts/database/verify-database-core.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function createSourceFixture(parent) {
  const sourceSupabase = join(parent, "supabase");
  await mkdir(join(sourceSupabase, "migrations"), { recursive: true });
  await mkdir(join(sourceSupabase, "tests", "database", "nested"), { recursive: true });
  await writeFile(join(sourceSupabase, "config.toml"), 'project_id = "fixture"\n');
  await writeFile(join(sourceSupabase, "seed.sql"), "-- empty\n");
  await writeFile(join(sourceSupabase, "migrations", "001.sql"), "select 1;\n");
  await writeFile(join(sourceSupabase, "tests", "database", "001.test.sql"), "select 1;\n");
  await writeFile(join(sourceSupabase, "tests", "database", "nested", "002.pg"), "select 1;\n");
  await writeFile(join(sourceSupabase, "tests", "database", "notes.txt"), "not executable\n");
  return sourceSupabase;
}

async function pathExists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function waitForFile(path, timeoutMilliseconds = 10_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await pathExists(path)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for fixture file: ${path}`);
}

test("memoizes cleanup so concurrent callers execute it exactly once", async () => {
  let calls = 0;
  const cleanup = createOnceAsync(async () => {
    calls += 1;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    return "clean";
  });
  const [first, second, third] = await Promise.all([cleanup(), cleanup(), cleanup()]);
  assert.deepEqual([first, second, third], ["clean", "clean", "clean"]);
  assert.equal(calls, 1);
});

test("signal latch accepts only the first signal and maps conventional exit codes", async () => {
  const processObject = new EventEmitter();
  const received = [];
  const latch = installSignalLatch({
    processObject,
    onSignal: async (signal) => {
      received.push(signal);
    },
  });

  processObject.emit("SIGTERM");
  processObject.emit("SIGINT");
  await latch.wait();
  latch.dispose();

  assert.deepEqual(received, ["SIGTERM"]);
  assert.equal(latch.receivedSignal(), "SIGTERM");
  assert.deepEqual(SIGNAL_EXIT_CODES, { SIGINT: 130, SIGTERM: 143 });
  assert.equal(processObject.listenerCount("SIGINT"), 0);
  assert.equal(processObject.listenerCount("SIGTERM"), 0);
});

test("a pre-child signal prevents spawn and removes its exact scratch directory", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "pando-db-early-signal-test-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const processObject = new EventEmitter();
  let spawnAttempted = false;

  const exitCode = await runDatabaseGateCli({
    root,
    tempRoot,
    processObject,
    stdout: { write() {} },
    stderr: { write() {} },
    allocatePort: async () => {
      processObject.emit("SIGTERM");
      return 54_321;
    },
    spawnImpl: () => {
      spawnAttempted = true;
      throw new Error("Supabase CLI must not spawn after an early signal");
    },
  });

  assert.equal(exitCode, 143);
  assert.equal(spawnAttempted, false);
  assert.deepEqual(await readdir(tempRoot), []);
});

test("copies only validated regular inputs and enumerates the exact recursive pgTAP set", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pando-db-allowlist-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const sourceSupabase = await createSourceFixture(join(scratch, "source"));
  const destinationSupabase = join(scratch, "destination", "supabase");
  const prepared = await copyValidatedSupabaseInputs({ sourceSupabase, destinationSupabase });

  assert.deepEqual(
    prepared.executableTests.map(({ relativePath }) => relativePath.replaceAll("\\", "/")),
    ["001.test.sql", "nested/002.pg"],
  );
  assert.equal(
    await readFile(join(destinationSupabase, "tests", "database", "notes.txt"), "utf8"),
    "not executable\n",
  );
});

test("rejects a junction or symlink that escapes the migrations allowlist", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pando-db-junction-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const sourceSupabase = await createSourceFixture(join(scratch, "source"));
  const outside = join(scratch, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "escape.sql"), "select 'outside';\n");
  await symlink(
    outside,
    join(sourceSupabase, "migrations", "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    copyValidatedSupabaseInputs({
      sourceSupabase,
      destinationSupabase: join(scratch, "destination", "supabase"),
    }),
    /symbolic link or junction/,
  );
});

test(
  "rejects a special filesystem entry in an allowed directory",
  { skip: process.platform === "win32" },
  async (t) => {
    const scratch = await mkdtemp(join(tmpdir(), "pando-db-special-test-"));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const sourceSupabase = await createSourceFixture(join(scratch, "source"));
    const socketPath = join(sourceSupabase, "migrations", "special.socket");
    const server = createServer();
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(socketPath, resolveListen);
    });
    t.after(() => new Promise((resolveClose) => server.close(resolveClose)));

    await assert.rejects(
      copyValidatedSupabaseInputs({
        sourceSupabase,
        destinationSupabase: join(scratch, "destination", "supabase"),
      }),
      /special filesystem entry/,
    );
  },
);

async function assertSignalCleanup(t, deliverSignal) {
  const scratch = await mkdtemp(join(tmpdir(), "pando-db-signal-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const logPath = join(scratch, "commands.ndjson");
  const markerPath = join(scratch, "simulated-resource");
  const readyPath = join(scratch, "ready");
  await writeFile(logPath, "");
  const harness = join(root, "tests", "fixtures", "database", "run-gate-with-fake-cli.mjs");
  const child = spawn(process.execPath, [harness], {
    cwd: root,
    env: {
      ...process.env,
      PANDO_FAKE_SUPABASE_LOG: logPath,
      PANDO_FAKE_SUPABASE_MARKER: markerPath,
      PANDO_FAKE_SUPABASE_READY: readyPath,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  await waitForFile(readyPath);
  await deliverSignal(child);
  const [exitCode, signal] = await once(child, "close");
  assert.equal(signal, null, `unexpected subprocess signal; stdout=${stdout}; stderr=${stderr}`);
  assert.equal(exitCode, 143, `unexpected exit; stdout=${stdout}; stderr=${stderr}`);
  assert.equal(await pathExists(markerPath), false, "simulated container/volume was not removed");

  const commands = (await readFile(logPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(
    commands.filter(([group, command]) => group === "db" && command === "start").length,
    1,
  );
  assert.equal(commands.filter(([command]) => command === "stop").length, 1);
  assert.equal(commands.length, 2, `unexpected command set: ${JSON.stringify(commands)}`);
}

test("SIGTERM terminates the active child, cleans once, and exits conventionally", async (t) => {
  await assertSignalCleanup(
    t,
    (child) =>
      new Promise((resolveSend, rejectSend) => {
        child.send({ signal: "SIGTERM" }, (error) => (error ? rejectSend(error) : resolveSend()));
      }),
  );
});

test(
  "an OS SIGTERM terminates the active child and leaves no simulated resource",
  { skip: process.platform === "win32" },
  async (t) => {
    await assertSignalCleanup(t, (child) => {
      assert.equal(child.kill("SIGTERM"), true);
    });
  },
);
