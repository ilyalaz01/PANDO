import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { findFreePort, setDbPort, setProjectId } from "../database/verify-database-core.mjs";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cli = join(root, "node_modules", "supabase", "dist", "supabase.js");
function run(program, args, options = {}) {
  return new Promise((done, fail) => {
    const child = spawn(program, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    if (options.input) {
      child.stdin.end(options.input);
    } else child.stdin.end();
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? done(out)
        : fail(new Error(program + " failed (" + code + "): " + (out + "\n" + err).slice(-6000))),
    );
  });
}
const supa = (workdir, args) =>
  run(process.execPath, [cli, "--workdir", workdir, ...args], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
const scrypt = promisify(scryptCallback);
const BUNDLE_MAGIC = Buffer.from("PANDO-BUNDLE-V1\n");
const BACKUP_MAGIC = Buffer.from("PANDO-BACKUP-V1\n");
const PHASE0_MEMBER_NAMES = [
  "database-schema.sql",
  "auth-data.sql",
  "database-data.sql",
  "storage-manifest.json",
];
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function settledSummary(results) {
  return results
    .map((result) =>
      result.status === "fulfilled" ? "fulfilled" : `rejected: ${String(result.reason)}`,
    )
    .join("; ");
}
function encodedLength(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}
async function encryptMalformedFixture(rawBundle, output, secretPath, outer) {
  const passphrase = await readFile(secretPath);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  let key;
  try {
    key = Buffer.from(
      await scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 67108864 }),
    );
    const header = Buffer.from(
      JSON.stringify({
        format: "pando.encrypted-logical-backup.v1",
        cipher: "aes-256-gcm",
        kdf: { name: "scrypt", N: 32768, r: 8, p: 1, salt: salt.toString("base64") },
        nonce: nonce.toString("base64"),
        ...outer,
      }) + "\n",
    );
    const prefix = Buffer.concat([BACKUP_MAGIC, encodedLength(header.length), header]);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(prefix);
    const ciphertext = Buffer.concat([cipher.update(rawBundle), cipher.final()]);
    await writeFile(output, Buffer.concat([prefix, ciphertext, cipher.getAuthTag()]), {
      mode: 0o600,
    });
  } finally {
    passphrase.fill(0);
    if (key) key.fill(0);
    salt.fill(0);
    nonce.fill(0);
  }
}
function rawBundle(manifest) {
  const header = Buffer.from(JSON.stringify(manifest) + "\n");
  return Buffer.concat([BUNDLE_MAGIC, encodedLength(header.length), header]);
}
async function expectInvalidBundle(backup, env, fixtureName, raw, outer, pattern) {
  const fixture = join(scratch, fixtureName + ".pando");
  const fixtureOutput = join(scratch, fixtureName + "-out");
  await encryptMalformedFixture(raw, fixture, secret, outer);
  await assert.rejects(
    run(
      process.execPath,
      [backup, "--command", "open", "--input", fixture, "--output", fixtureOutput],
      { env },
    ),
    pattern,
  );
  assert.equal(
    await stat(fixtureOutput).then(
      () => true,
      () => false,
    ),
    false,
  );
}
const scratch = await mkdtemp(join(tmpdir(), "pando-backup-gate-")),
  workdir = join(scratch, "project"),
  project = "pando-backup-gate-" + randomBytes(4).toString("hex"),
  secret = join(scratch, "secret"),
  archive = join(scratch, "gate.pando"),
  opened = join(scratch, "opened");
let started = false;
try {
  await mkdir(workdir);
  await cp(join(root, "supabase"), join(workdir, "supabase"), { recursive: true });
  const config = await readFile(join(workdir, "supabase", "config.toml"), "utf8");
  const dbPort = await findFreePort();
  const isolatedConfig = setDbPort(setProjectId(config, project), dbPort);
  if (!isolatedConfig.includes('project_id = "' + project + '"')) {
    throw new Error("Refusing to start a non-isolated Supabase project");
  }
  await writeFile(join(workdir, "supabase", "config.toml"), isolatedConfig);
  await writeFile(secret, randomBytes(48), { mode: 0o600 });
  const env = { ...process.env, PANDO_BACKUP_PASSPHRASE_FILE: secret };
  started = true;
  await supa(workdir, [
    "start",
    "--exclude",
    "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ]);
  const sql = `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','alice@pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}','{}',clock_timestamp(),clock_timestamp()),
 ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','bob@pando.test','',clock_timestamp(),'{"provider":"email","providers":["email"]}','{}',clock_timestamp(),clock_timestamp());
 set role authenticated;select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',false);select api.bootstrap_personal_workspace('gate-alice','Alice');
 reset role;set role authenticated;select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aud":"authenticated"}',false);select api.bootstrap_personal_workspace('gate-bob','Bob');reset role;`;
  await run(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_" + project,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql },
  );
  const schema = join(scratch, "schema.sql"),
    auth = join(scratch, "auth.sql"),
    data = join(scratch, "data.sql"),
    storage = join(scratch, "storage.json");
  const schemas =
    "api,identity,catalog,targets,overlay,sessions,evidence,mastery,review,planning,integrations,outbox";
  await supa(workdir, ["db", "dump", "--local", "--schema", schemas, "--file", schema]);
  await supa(workdir, ["db", "dump", "--local", "--schema", "auth", "--data-only", "--file", auth]);
  await supa(workdir, [
    "db",
    "dump",
    "--local",
    "--schema",
    schemas,
    "--data-only",
    "--file",
    data,
  ]);
  await writeFile(
    storage,
    JSON.stringify({
      format: "pando.storage-manifest.v1",
      generated_at: new Date().toISOString(),
      objects: [
        {
          bucket: "preparation-packs",
          path: "gate/object",
          bytes: 4,
          sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        },
      ],
    }),
  );
  const backup = join(root, "scripts", "backup", "pando-backup.mjs");
  const sealArguments = [
    backup,
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
  ];
  const validStorageObject = {
    bucket: "preparation-packs",
    path: "gate/object",
    bytes: 4,
    sha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
  };
  async function expectInvalidStorage(objects, name, pattern) {
    const invalidManifest = join(scratch, name + ".json");
    const invalidOutput = join(scratch, name + ".pando");
    await writeFile(
      invalidManifest,
      JSON.stringify({
        format: "pando.storage-manifest.v1",
        generated_at: new Date().toISOString(),
        objects,
      }),
    );
    const invalidArguments = [...sealArguments];
    invalidArguments[invalidArguments.indexOf("--storage-manifest") + 1] = invalidManifest;
    invalidArguments[invalidArguments.length - 1] = invalidOutput;
    await assert.rejects(run(process.execPath, invalidArguments, { env }), pattern);
    assert.equal(
      await stat(invalidOutput).then(
        () => true,
        () => false,
      ),
      false,
    );
  }
  await expectInvalidStorage(
    [{ ...validStorageObject, bucket: "" }],
    "empty-storage-bucket",
    /Invalid storage object/,
  );
  await expectInvalidStorage(
    [{ ...validStorageObject, path: "" }],
    "empty-storage-path",
    /Invalid storage object/,
  );
  await expectInvalidStorage(
    [{ ...validStorageObject, bytes: -1 }],
    "negative-storage-bytes",
    /Invalid storage object/,
  );
  await expectInvalidStorage(
    [validStorageObject, { ...validStorageObject }],
    "duplicate-storage-key",
    /Duplicate storage object key/,
  );
  const sealRace = await Promise.allSettled([
    run(process.execPath, sealArguments, { env }),
    run(process.execPath, sealArguments, { env }),
  ]);
  const sealSuccesses = sealRace.filter((result) => result.status === "fulfilled");
  const sealFailures = sealRace.filter((result) => result.status === "rejected");
  assert.equal(sealSuccesses.length, 1, settledSummary(sealRace));
  assert.equal(sealFailures.length, 1, settledSummary(sealRace));
  assert.match(String(sealFailures[0].reason), /Refusing to overwrite existing backup/);
  const sealResult = JSON.parse(sealSuccesses[0].value);

  const existingArchive = join(scratch, "foreign-existing.pando");
  await writeFile(existingArchive, "foreign archive");
  await assert.rejects(
    run(process.execPath, [...sealArguments.slice(0, -1), existingArchive], { env }),
    /Refusing to overwrite existing backup/,
  );
  assert.equal(await readFile(existingArchive, "utf8"), "foreign archive");

  const r2Plan = JSON.parse(
    await run(process.execPath, [
      join(root, "scripts", "backup", "r2-plan.mjs"),
      "--input",
      archive,
      "--account-id",
      "00000000000000000000000000000000",
      "--bucket",
      "pando-backups",
    ]),
  );
  assert.equal(r2Plan.backup_id, sealResult.backup_id);
  assert.match(r2Plan.key, new RegExp("/" + sealResult.backup_id + "\\.pando$"));

  const openArguments = [backup, "--command", "open", "--input", archive, "--output", opened];
  const openRace = await Promise.allSettled([
    run(process.execPath, openArguments, { env }),
    run(process.execPath, openArguments, { env }),
  ]);
  const openSuccesses = openRace.filter((result) => result.status === "fulfilled");
  const openFailures = openRace.filter((result) => result.status === "rejected");
  assert.equal(openSuccesses.length, 1, settledSummary(openRace));
  assert.equal(openFailures.length, 1, settledSummary(openRace));
  assert.match(String(openFailures[0].reason), /EEXIST/);

  const foreignOpen = join(scratch, "foreign-open");
  await mkdir(foreignOpen);
  await writeFile(join(foreignOpen, "sentinel"), "foreign directory");
  await assert.rejects(
    run(
      process.execPath,
      [backup, "--command", "open", "--input", archive, "--output", foreignOpen],
      { env },
    ),
    /EEXIST/,
  );
  assert.equal(await readFile(join(foreignOpen, "sentinel"), "utf8"), "foreign directory");
  assert.equal(
    JSON.parse(await readFile(join(opened, "storage-manifest.json"), "utf8")).objects.length,
    1,
  );
  await supa(workdir, ["stop", "--no-backup"]);
  started = false;
  started = true;
  await supa(workdir, [
    "start",
    "--exclude",
    "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ]);
  const restore = join(workdir, "supabase", "restore");
  await mkdir(restore);
  await cp(join(opened, "auth-data.sql"), join(restore, "auth.sql"));
  await cp(join(opened, "database-data.sql"), join(restore, "data.sql"));
  await supa(workdir, [
    "db",
    "reset",
    "--local",
    "--sql-paths",
    "restore/auth.sql",
    "--sql-paths",
    "restore/data.sql",
  ]);
  const check = await run(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_" + project,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `select w.workspace_id from identity.workspaces w join identity.users u on u.user_id=w.created_by_user_id where u.auth_user_id='10000000-0000-4000-8000-000000000001' \\gset
select (select count(*) from identity.users)||','||(select count(*) from identity.workspaces)||','||(select count(*) from outbox.events)||','||(select count(*) from outbox.events where event_name='identity.workspace_bootstrapped' and event_schema_version=1);
set role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',false);
select api.get_workspace(:'workspace_id');`,
    },
  );
  const checkLines = check.trim().split(/\r?\n/);
  assert.equal(checkLines[0], "2,2,2,2");
  const restoredWorkspace = JSON.parse(checkLines.at(-1));
  assert.equal(restoredWorkspace.display_name, "Alice");
  assert.equal(restoredWorkspace.workspace_kind, "personal");
  const deniedSql = `select w.workspace_id from identity.workspaces w join identity.users u on u.user_id=w.created_by_user_id where u.auth_user_id='10000000-0000-4000-8000-000000000002' \\gset
set role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aud":"authenticated"}',false);
select api.get_workspace(:'workspace_id');`;
  await assert.rejects(
    run(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_" + project,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: deniedSql },
    ),
    /workspace is not accessible/,
  );
  const tampered = Buffer.from(await readFile(archive));
  tampered[Math.floor(tampered.length / 2)] ^= 1;
  const bad = join(scratch, "tampered.pando");
  await writeFile(bad, tampered);
  await assert.rejects(
    run(
      process.execPath,
      [backup, "--command", "open", "--input", bad, "--output", join(scratch, "bad")],
      { env },
    ),
    /failed/,
  );
  const truncated = join(scratch, "truncated.pando");
  await writeFile(truncated, tampered.subarray(0, 20));
  await assert.rejects(
    run(
      process.execPath,
      [backup, "--command", "open", "--input", truncated, "--output", join(scratch, "truncated")],
      { env },
    ),
    /failed/,
  );
  await assert.rejects(
    run(process.execPath, [
      join(root, "scripts", "backup", "r2-plan.mjs"),
      "--input",
      truncated,
      "--account-id",
      "00000000000000000000000000000000",
      "--bucket",
      "pando-backups",
    ]),
    /complete encrypted PANDO backup/,
  );
  const matchingOuter = {
    backup_id: "outer-backup-id",
    boundary: "phase0-relational-plus-storage-manifest",
  };
  const validInner = {
    format: "pando.logical-backup-bundle.v1",
    backup_id: matchingOuter.backup_id,
    boundary: matchingOuter.boundary,
    members: PHASE0_MEMBER_NAMES.map((name) => ({ name, bytes: 0, sha256: EMPTY_SHA256 })),
  };
  await expectInvalidBundle(
    backup,
    env,
    "oversized-bundle-header",
    Buffer.concat([BUNDLE_MAGIC, encodedLength(1024 * 1024 + 1), Buffer.alloc(2)]),
    matchingOuter,
    /Invalid bundle header length/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "invalid-bundle-format",
    rawBundle({ ...validInner, format: "not-pando" }),
    matchingOuter,
    /Invalid bundle manifest/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "members-not-array",
    rawBundle({ ...validInner, members: {} }),
    matchingOuter,
    /Invalid bundle manifest/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "too-many-members",
    rawBundle({
      ...validInner,
      members: Array.from({ length: 65 }, (_, index) => ({
        name: "member-" + index,
        bytes: 0,
        sha256: "0".repeat(64),
      })),
    }),
    matchingOuter,
    /Invalid bundle manifest/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "missing-member",
    rawBundle({ ...validInner, members: validInner.members.slice(0, 3) }),
    matchingOuter,
    /Invalid bundle manifest|Invalid Phase 0 bundle member set/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "duplicate-member",
    rawBundle({
      ...validInner,
      members: [...validInner.members.slice(0, 3), validInner.members[0]],
    }),
    matchingOuter,
    /Invalid Phase 0 bundle member set/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "extra-member",
    rawBundle({
      ...validInner,
      members: [...validInner.members, { name: "extra.sql", bytes: 0, sha256: EMPTY_SHA256 }],
    }),
    matchingOuter,
    /Invalid bundle manifest|Invalid Phase 0 bundle member set/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "truncated-member-pipeline",
    rawBundle({
      ...validInner,
      members: validInner.members.map((member, index) => ({
        ...member,
        bytes: index === 0 ? 1 : 0,
      })),
    }),
    matchingOuter,
    /Truncated bundle member/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "checksum-cleanup",
    rawBundle({
      ...validInner,
      members: validInner.members.map((member, index) => ({
        ...member,
        sha256: index === 0 ? "0".repeat(64) : member.sha256,
      })),
    }),
    matchingOuter,
    /Checksum mismatch/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "negative-member-size",
    rawBundle({
      ...validInner,
      members: PHASE0_MEMBER_NAMES.map((name, index) => ({
        name,
        bytes: index === 0 ? -1 : 0,
        sha256: EMPTY_SHA256,
      })),
    }),
    matchingOuter,
    /Unsafe member/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "backup-id-mismatch",
    rawBundle({ ...validInner, backup_id: "inner-backup-id" }),
    matchingOuter,
    /Encrypted header and bundle manifest disagree/,
  );
  await expectInvalidBundle(
    backup,
    env,
    "boundary-mismatch",
    rawBundle({ ...validInner, boundary: "different-boundary" }),
    matchingOuter,
    /Invalid bundle manifest/,
  );
  const noncanonicalOuter = {
    ...matchingOuter,
    boundary: "equal-but-noncanonical-boundary",
  };
  await expectInvalidBundle(
    backup,
    env,
    "equal-noncanonical-boundary",
    rawBundle({ ...validInner, boundary: noncanonicalOuter.boundary }),
    noncanonicalOuter,
    /Unsupported backup/,
  );
  process.stdout.write("encrypted backup clean-restore gate passed\n");
} finally {
  if (started) await supa(workdir, ["stop", "--no-backup"]).catch(() => {});
  await rm(scratch, { recursive: true, force: true });
}
