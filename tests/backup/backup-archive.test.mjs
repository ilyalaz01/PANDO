import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { publishExtractedMembers, stageBackupMember } from "../../scripts/backup/backup-files.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const backupCli = join(root, "scripts", "backup", "pando-backup.mjs");
const memberNames = [
  "auth-data.sql",
  "database-data.sql",
  "database-schema.sql",
  "storage-manifest.json",
];

function run(program, args, { env = process.env } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(program, args, {
      cwd: root,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (code, signal) => {
      if (code === 0) resolveRun(stdout);
      else {
        rejectRun(
          new Error(
            `backup CLI failed with code ${code ?? "none"}, signal ${signal ?? "none"}: ${stderr}`,
          ),
        );
      }
    });
  });
}

async function privateMode(path) {
  if (process.platform === "win32") return;
  assert.equal((await stat(path)).mode & 0o077, 0, `${path} is not private`);
}

test("sealed archive opens exactly once into four private members", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pando-backup-archive-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const secret = join(scratch, "secret");
  const schema = join(scratch, "schema.sql");
  const auth = join(scratch, "auth.sql");
  const data = join(scratch, "data.sql");
  const storage = join(scratch, "storage.json");
  const archive = join(scratch, "archive.pando");
  const opened = join(scratch, "opened");
  const foreign = join(scratch, "foreign");
  const contents = new Map([
    ["database-schema.sql", "-- schema\n"],
    ["auth-data.sql", "-- auth\n"],
    ["database-data.sql", "-- data\n"],
    ["storage-manifest.json", JSON.stringify({ format: "pando.storage-manifest.v1", objects: [] })],
  ]);

  await writeFile(secret, randomBytes(48), { mode: 0o600 });
  await writeFile(schema, contents.get("database-schema.sql"));
  await writeFile(auth, contents.get("auth-data.sql"));
  await writeFile(data, contents.get("database-data.sql"));
  await writeFile(storage, contents.get("storage-manifest.json"));
  const env = { ...process.env, PANDO_BACKUP_PASSPHRASE_FILE: secret };

  await run(
    process.execPath,
    [
      backupCli,
      "--command",
      "seal",
      "--schema",
      schema,
      "--auth-data",
      auth,
      "--data",
      data,
      "--storage-manifest",
      storage,
      "--output",
      archive,
    ],
    { env },
  );

  const openArguments = [backupCli, "--command", "open", "--input", archive, "--output", opened];
  const race = await Promise.allSettled([
    run(process.execPath, openArguments, { env }),
    run(process.execPath, openArguments, { env }),
  ]);
  const successes = race.filter((result) => result.status === "fulfilled");
  const failures = race.filter((result) => result.status === "rejected");
  assert.equal(successes.length, 1, JSON.stringify(race));
  assert.equal(failures.length, 1, JSON.stringify(race));
  assert.match(String(failures[0].reason), /EEXIST/);
  assert.deepEqual((await readdir(opened)).sort(), memberNames);
  await privateMode(opened);
  for (const memberName of memberNames) {
    assert.equal(await readFile(join(opened, memberName), "utf8"), contents.get(memberName));
    await privateMode(join(opened, memberName));
  }

  await mkdir(foreign, { mode: 0o700 });
  await writeFile(join(foreign, "sentinel"), "foreign");
  await assert.rejects(
    run(
      process.execPath,
      [backupCli, "--command", "open", "--input", archive, "--output", foreign],
      { env },
    ),
    /EEXIST/,
  );
  assert.equal(await readFile(join(foreign, "sentinel"), "utf8"), "foreign");
  assert.equal((await readdir(foreign)).length, 1);
  assert.equal(fsConstants.COPYFILE_EXCL > 0, true);
});
test("staging isolates bundle bytes from later source mutation", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pando-backup-stage-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const source = join(scratch, "source.sql");
  const staged = join(scratch, "staged.sql");
  await writeFile(source, "before\n");
  const member = await stageBackupMember(source, staged, "database-schema.sql");
  await writeFile(source, "after!\n");
  assert.equal(await readFile(member.path, "utf8"), "before\n");
  assert.equal(member.bytes, Buffer.byteLength("before\n"));
  assert.match(member.sha256, /^[a-f0-9]{64}$/);
});

test("post-claim path replacement is preserved on copy failure", async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), "pando-backup-publish-test-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const files = join(scratch, "files");
  const output = join(scratch, "output");
  const claimed = join(scratch, "claimed-by-pando");
  await mkdir(files);
  await writeFile(join(files, "member"), "data");
  const replacingCopy = async () => {
    await rename(output, claimed);
    await mkdir(output);
    await writeFile(join(output, "sentinel"), "foreign");
    throw new Error("injected copy failure");
  };
  await assert.rejects(
    publishExtractedMembers(files, output, ["member"], replacingCopy),
    /incomplete output was preserved/,
  );
  assert.equal(await readFile(join(output, "sentinel"), "utf8"), "foreign");
  assert.deepEqual(await readdir(claimed), []);
});
