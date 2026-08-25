import { spawn as spawnChild } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });

export class InterruptedError extends Error {
  constructor(signal) {
    super(`Database gate interrupted by ${signal}`);
    this.name = "InterruptedError";
    this.signal = signal;
  }
}

export function createOnceAsync(operation) {
  let result;
  return (...args) => {
    result ??= Promise.resolve().then(() => operation(...args));
    return result;
  };
}

function isContained(rootPath, candidatePath) {
  const pathFromRoot = relative(rootPath, candidatePath);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`))
  );
}

async function inspectSourceEntry(path, expectedKind, sourceRootReal) {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link or junction in Supabase allowlist: ${path}`);
  }
  if (
    (expectedKind === "file" && !entry.isFile()) ||
    (expectedKind === "directory" && !entry.isDirectory())
  ) {
    throw new Error(`Expected a regular ${expectedKind} in Supabase allowlist: ${path}`);
  }
  const resolvedEntry = await realpath(path);
  if (!isContained(sourceRootReal, resolvedEntry)) {
    throw new Error(`Supabase allowlist entry escapes its source root: ${path}`);
  }
  return { entry, resolvedEntry };
}

function sameFileIdentity(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
  );
}

async function copyValidatedFile(source, destination, sourceRootReal) {
  const before = await inspectSourceEntry(source, "file", sourceRootReal);
  await copyFile(source, destination);
  const after = await inspectSourceEntry(source, "file", sourceRootReal);
  if (
    before.resolvedEntry !== after.resolvedEntry ||
    !sameFileIdentity(before.entry, after.entry)
  ) {
    throw new Error(`Supabase allowlist file changed while it was copied: ${source}`);
  }
}

async function copyValidatedDirectory(source, destination, sourceRootReal, relativeRoot = "") {
  await inspectSourceEntry(source, "directory", sourceRootReal);
  await mkdir(destination, { recursive: true });
  const copiedFiles = [];
  const entries = await readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const directoryEntry of entries) {
    const sourceEntry = join(source, directoryEntry.name);
    const destinationEntry = join(destination, directoryEntry.name);
    const relativeEntry = join(relativeRoot, directoryEntry.name);
    const entry = await lstat(sourceEntry);

    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link or junction in Supabase allowlist: ${sourceEntry}`);
    }
    if (entry.isDirectory()) {
      copiedFiles.push(
        ...(await copyValidatedDirectory(
          sourceEntry,
          destinationEntry,
          sourceRootReal,
          relativeEntry,
        )),
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Refusing special filesystem entry in Supabase allowlist: ${sourceEntry}`);
    }

    await copyValidatedFile(sourceEntry, destinationEntry, sourceRootReal);
    copiedFiles.push({
      relativePath: relativeEntry,
      source: sourceEntry,
      destination: destinationEntry,
    });
  }

  return copiedFiles;
}

export async function copyValidatedSupabaseInputs({ sourceSupabase, destinationSupabase }) {
  const sourceRootStat = await lstat(sourceSupabase);
  if (sourceRootStat.isSymbolicLink() || !sourceRootStat.isDirectory()) {
    throw new Error(`Supabase source root must be a real directory: ${sourceSupabase}`);
  }
  const sourceRootReal = await realpath(sourceSupabase);
  await mkdir(destinationSupabase, { recursive: true });

  await copyValidatedFile(
    join(sourceSupabase, "config.toml"),
    join(destinationSupabase, "config.toml"),
    sourceRootReal,
  );
  await copyValidatedDirectory(
    join(sourceSupabase, "migrations"),
    join(destinationSupabase, "migrations"),
    sourceRootReal,
  );
  await copyValidatedFile(
    join(sourceSupabase, "seed.sql"),
    join(destinationSupabase, "seed.sql"),
    sourceRootReal,
  );

  const sourceTests = join(sourceSupabase, "tests");
  await inspectSourceEntry(sourceTests, "directory", sourceRootReal);
  const copiedTests = await copyValidatedDirectory(
    join(sourceTests, "database"),
    join(destinationSupabase, "tests", "database"),
    sourceRootReal,
  );
  const executableTests = copiedTests.filter(
    ({ relativePath }) => relativePath.endsWith(".sql") || relativePath.endsWith(".pg"),
  );
  if (executableTests.length === 0) throw new Error("No database pgTAP files were found");

  return {
    executableTests,
    sourceTests: join(sourceTests, "database"),
  };
}

export function setProjectId(config, value) {
  const matches = [...config.matchAll(/^project_id\s*=\s*"[^"]+"\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error("Expected exactly one project_id in copied Supabase config");
  }
  return config.replace(matches[0][0], `project_id = "${value}"`);
}

export function setDbPort(config, port) {
  const lines = config.replace(/\r\n/g, "\n").split("\n");
  const sectionStart = lines.findIndex((line) => /^\s*\[db\]\s*$/.test(line));
  if (sectionStart === -1) {
    return `${lines.join("\n").trimEnd()}\n\n[db]\nport = ${port}\n`;
  }

  let sectionEnd = lines.findIndex(
    (line, index) => index > sectionStart && /^\s*\[[^\]]+\]\s*$/.test(line),
  );
  if (sectionEnd === -1) sectionEnd = lines.length;
  const portIndex = lines.findIndex(
    (line, index) => index > sectionStart && index < sectionEnd && /^\s*port\s*=/.test(line),
  );
  if (portIndex === -1) lines.splice(sectionStart + 1, 0, `port = ${port}`);
  else lines[portIndex] = `port = ${port}`;
  return lines.join("\n");
}

export function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate an isolated database port")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function terminateChild(child, graceMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let closed = false;
  const closedPromise = new Promise((resolveClose) => {
    child.once("close", () => {
      closed = true;
      resolveClose();
    });
  });

  child.kill("SIGTERM");
  await Promise.race([closedPromise, delay(graceMilliseconds)]);
  if (closed) return;

  child.kill("SIGKILL");
  await Promise.race([
    closedPromise,
    delay(graceMilliseconds).then(() => {
      throw new Error("Timed out terminating active Supabase CLI child");
    }),
  ]);
}

export function createSupabaseRunner({
  supabaseCli,
  workdir,
  env = process.env,
  stdout = process.stdout,
  spawnImpl = spawnChild,
  terminateGraceMilliseconds = 5_000,
}) {
  let active;
  let interruptedSignal;
  let interruptPromise = Promise.resolve();

  function run(args, { quiet = false, protectedFromInterrupt = false } = {}) {
    if (active) throw new Error("Refusing concurrent Supabase CLI children");
    if (interruptedSignal && !protectedFromInterrupt) {
      throw new InterruptedError(interruptedSignal);
    }
    if (!quiet) stdout.write(`\n> supabase@2.115.0 ${args.join(" ")}\n`);

    return new Promise((resolveRun, rejectRun) => {
      const child = spawnImpl(process.execPath, [supabaseCli, "--workdir", workdir, ...args], {
        cwd: workdir,
        env: { ...env, CI: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
        stdio: quiet ? "ignore" : "inherit",
        shell: false,
      });
      const current = { child, protectedFromInterrupt };
      active = current;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (active === current) active = undefined;
        if (error) rejectRun(error);
        else resolveRun();
      };
      child.once("error", finish);
      child.once("close", (code, signal) => {
        if (code === 0) finish();
        else {
          finish(
            new Error(
              `Supabase CLI failed with code ${code ?? "none"}, signal ${signal ?? "none"}`,
            ),
          );
        }
      });
    });
  }

  function requestInterrupt(signal) {
    if (interruptedSignal) return interruptPromise;
    interruptedSignal = signal;
    const current = active;
    if (!current || current.protectedFromInterrupt) return interruptPromise;
    interruptPromise = terminateChild(current.child, terminateGraceMilliseconds);
    return interruptPromise;
  }

  return {
    run,
    requestInterrupt,
    hasActiveChild: () => active !== undefined,
    interruptedSignal: () => interruptedSignal,
  };
}

export function installSignalLatch({ processObject = process, onSignal }) {
  let receivedSignal;
  let signalWork = Promise.resolve();
  let signalError;

  const handler = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    signalWork = Promise.resolve()
      .then(() => onSignal(signal))
      .catch((error) => {
        signalError = error;
      });
  };
  const onSigint = () => handler("SIGINT");
  const onSigterm = () => handler("SIGTERM");
  processObject.on("SIGINT", onSigint);
  processObject.on("SIGTERM", onSigterm);

  return {
    dispose() {
      processObject.removeListener("SIGINT", onSigint);
      processObject.removeListener("SIGTERM", onSigterm);
    },
    receivedSignal: () => receivedSignal,
    async wait() {
      await signalWork;
      if (signalError) throw signalError;
    },
  };
}

function assertSafeScratch(path, tempRoot) {
  const resolvedPath = resolve(path);
  const resolvedTemp = resolve(tempRoot);
  if (
    dirname(resolvedPath) !== resolvedTemp ||
    !basename(resolvedPath).startsWith("pando-database-gate-")
  ) {
    throw new Error(`Refusing to clean an unexpected scratch path: ${resolvedPath}`);
  }
}

async function validatePinnedCli(root, expectedCliVersion) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const installedCli = JSON.parse(
    await readFile(join(root, "node_modules", "supabase", "package.json"), "utf8"),
  );
  if (
    packageJson.devDependencies?.supabase !== expectedCliVersion ||
    installedCli.version !== expectedCliVersion
  ) {
    throw new Error(
      `verify:db requires the reviewed exact Supabase CLI version ${expectedCliVersion}`,
    );
  }
}

function combineErrors(primaryError, cleanupError) {
  if (primaryError && cleanupError) {
    return new AggregateError(
      [primaryError, cleanupError],
      "Database gate and cleanup both failed",
    );
  }
  return primaryError ?? cleanupError;
}

export async function runDatabaseGateCli({
  root,
  supabaseCli = join(root, "node_modules", "supabase", "dist", "supabase.js"),
  expectedCliVersion = "2.115.0",
  tempRoot = tmpdir(),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  processObject = process,
  spawnImpl = spawnChild,
  terminateGraceMilliseconds = 5_000,
  allocatePort = findFreePort,
} = {}) {
  await validatePinnedCli(root, expectedCliVersion);
  const projectId = `pando-database-gate-${randomBytes(6).toString("hex")}`;
  let scratch;
  let workdir;
  let runner;
  let cleanupRequired = false;
  let primaryError;
  let cleanupError;

  const cleanup = createOnceAsync(async () => {
    if (!scratch) return;
    let stopError;
    if (cleanupRequired) {
      if (!runner) {
        stopError = new Error("Cannot clean an isolated project before the runner is initialized");
      } else {
        await runner
          .run(["stop", "--project-id", projectId, "--no-backup"], {
            quiet: true,
            protectedFromInterrupt: true,
          })
          .catch((error) => {
            stopError = error;
          });
      }
    }
    assertSafeScratch(scratch, tempRoot);
    await rm(scratch, { recursive: true, force: true });
    if (stopError) throw stopError;
  });

  const signalLatch = installSignalLatch({
    processObject,
    onSignal: async (signal) => {
      const hadActiveChild = runner?.hasActiveChild() ?? false;
      if (runner) await runner.requestInterrupt(signal);
      if (hadActiveChild) await cleanup();
    },
  });
  const throwIfInterrupted = () => {
    const signal = signalLatch.receivedSignal();
    if (signal) throw new InterruptedError(signal);
  };

  try {
    throwIfInterrupted();
    scratch = await mkdtemp(join(tempRoot, "pando-database-gate-"));
    throwIfInterrupted();
    workdir = join(scratch, "project");
    runner = createSupabaseRunner({
      supabaseCli,
      workdir,
      env,
      stdout,
      spawnImpl,
      terminateGraceMilliseconds,
    });

    const prepared = await copyValidatedSupabaseInputs({
      sourceSupabase: join(root, "supabase"),
      destinationSupabase: join(workdir, "supabase"),
    });
    throwIfInterrupted();

    const dbPort = await allocatePort();
    throwIfInterrupted();
    const configPath = join(workdir, "supabase", "config.toml");
    const copiedConfig = await readFile(configPath, "utf8");
    const isolatedConfig = setDbPort(setProjectId(copiedConfig, projectId), dbPort);
    if (!isolatedConfig.includes(`project_id = "${projectId}"`)) {
      throw new Error("Refusing to start a non-isolated Supabase project");
    }
    await writeFile(configPath, isolatedConfig);
    throwIfInterrupted();

    const explicitTests = prepared.executableTests.map(({ destination }) =>
      relative(workdir, destination).split(sep).join("/"),
    );
    stdout.write(
      `Database gate will run ${explicitTests.length} explicit pgTAP files in isolated project ${projectId}:\n` +
        prepared.executableTests.map(({ source }) => `- ${relative(root, source)}`).join("\n") +
        "\n",
    );

    cleanupRequired = true;
    await runner.run(["db", "start"]);
    await runner.run(["db", "reset", "--local"]);
    await runner.run(["test", "db", ...explicitTests, "--local"]);
    await runner.run(["db", "lint", "--local", "--level", "warning", "--fail-on", "warning"]);
  } catch (error) {
    primaryError = error;
  } finally {
    await signalLatch.wait().catch((error) => {
      primaryError = combineErrors(primaryError, error);
    });
    await cleanup().catch((error) => {
      cleanupError = error;
    });
    signalLatch.dispose();
  }

  const receivedSignal = signalLatch.receivedSignal();
  if (receivedSignal) {
    if (cleanupError) stderr.write(`Database gate cleanup failed: ${cleanupError.message}\n`);
    return SIGNAL_EXIT_CODES[receivedSignal];
  }

  const finalError = combineErrors(primaryError, cleanupError);
  if (finalError) throw finalError;
  stdout.write("\nPhase 0 database migration, pgTAP, and lint gate passed\n");
  return 0;
}
