import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const supabaseCli = join(root, "node_modules", "supabase", "dist", "supabase.js");
const scratch = await mkdtemp(join(tmpdir(), "pando-database-gate-"));
const workdir = join(scratch, "project");
const projectId = `pando-database-gate-${randomBytes(6).toString("hex")}`;
let cleanupRequired = false;
let verificationPassed = false;

function assertSafeScratch(path) {
  const resolvedPath = resolve(path);
  const resolvedTemp = resolve(tmpdir());
  if (
    dirname(resolvedPath) !== resolvedTemp ||
    !basename(resolvedPath).startsWith("pando-database-gate-")
  ) {
    throw new Error(`Refusing to clean an unexpected scratch path: ${resolvedPath}`);
  }
}

function setProjectId(config, value) {
  const matches = [...config.matchAll(/^project_id\s*=\s*"[^"]+"\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error("Expected exactly one project_id in copied Supabase config");
  }
  return config.replace(matches[0][0], `project_id = "${value}"`);
}

function setDbPort(config, port) {
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

function findFreePort() {
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

function runSupabase(args, { quiet = false } = {}) {
  if (!quiet) process.stdout.write(`\n> supabase@2.115.0 ${args.join(" ")}\n`);
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [supabaseCli, "--workdir", workdir, ...args], {
      cwd: workdir,
      env: { ...process.env, CI: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
      stdio: quiet ? "ignore" : "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolveRun();
      else {
        reject(
          new Error(`Supabase CLI failed with code ${code ?? "none"}, signal ${signal ?? "none"}`),
        );
      }
    });
  });
}

async function listPgTapTests(directory) {
  const tests = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...(await listPgTapTests(path)));
    else if (entry.isFile() && (entry.name.endsWith(".sql") || entry.name.endsWith(".pg"))) {
      tests.push(path);
    }
  }
  return tests.sort();
}

try {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const installedCli = JSON.parse(
    await readFile(join(root, "node_modules", "supabase", "package.json"), "utf8"),
  );
  if (packageJson.devDependencies?.supabase !== "2.115.0" || installedCli.version !== "2.115.0") {
    throw new Error("verify:db requires the reviewed exact Supabase CLI version 2.115.0");
  }

  const sourceTests = join(root, "supabase", "tests", "database");
  const pgTapTests = await listPgTapTests(sourceTests);
  if (pgTapTests.length === 0) throw new Error("No database pgTAP files were found");

  const copiedSupabase = join(workdir, "supabase");
  await mkdir(join(copiedSupabase, "tests"), { recursive: true });
  await cp(join(root, "supabase", "config.toml"), join(copiedSupabase, "config.toml"));
  await cp(join(root, "supabase", "migrations"), join(copiedSupabase, "migrations"), {
    recursive: true,
  });
  await cp(join(root, "supabase", "seed.sql"), join(copiedSupabase, "seed.sql"));
  await cp(sourceTests, join(copiedSupabase, "tests", "database"), { recursive: true });

  const dbPort = await findFreePort();
  const configPath = join(workdir, "supabase", "config.toml");
  const copiedConfig = await readFile(configPath, "utf8");
  const isolatedConfig = setDbPort(setProjectId(copiedConfig, projectId), dbPort);
  if (!isolatedConfig.includes(`project_id = "${projectId}"`)) {
    throw new Error("Refusing to start a non-isolated Supabase project");
  }
  await writeFile(configPath, isolatedConfig);

  process.stdout.write(
    `Database gate will run ${pgTapTests.length} pgTAP files in isolated project ${projectId}:\n` +
      pgTapTests.map((path) => `- ${relative(root, path)}`).join("\n") +
      "\n",
  );

  cleanupRequired = true;
  await runSupabase(["db", "start"]);
  await runSupabase(["db", "reset", "--local"]);
  await runSupabase(["test", "db", "supabase/tests/database", "--local"]);
  await runSupabase(["db", "lint", "--local", "--level", "warning", "--fail-on", "warning"]);
  verificationPassed = true;
  process.stdout.write("\nPhase 0 database migration, pgTAP, and lint gate passed\n");
} finally {
  let cleanupError;
  if (cleanupRequired) {
    await runSupabase(["stop", "--project-id", projectId, "--no-backup"], { quiet: true }).catch(
      (error) => {
        cleanupError = error;
      },
    );
  }
  assertSafeScratch(scratch);
  await rm(scratch, { recursive: true, force: true });
  if (cleanupError) {
    if (verificationPassed) throw cleanupError;
    process.stderr.write(`Isolated Supabase cleanup warning: ${cleanupError.message}\n`);
  }
}
