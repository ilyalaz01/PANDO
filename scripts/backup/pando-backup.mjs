import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
} from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { publishExtractedMembers, stageBackupMember } from "./backup-files.mjs";
const scrypt = promisify(scryptCb);
const BM = Buffer.from("PANDO-BACKUP-V1\n"),
  PM = Buffer.from("PANDO-BUNDLE-V1\n");
const KDF = { N: 32768, r: 8, p: 1, maxmem: 67108864 };
const MAX_BUNDLE_HEADER_BYTES = 1024 * 1024;
const PHASE0_BOUNDARY = "phase0-relational-plus-storage-manifest";
const PHASE0_BUNDLE_MEMBERS = Object.freeze([
  "database-schema.sql",
  "auth-data.sql",
  "database-data.sql",
  "storage-manifest.json",
]);
const len = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const json = (v) => Buffer.from(JSON.stringify(v) + "\n");
function argv(values) {
  const out = {};
  for (let i = 0; i < values.length; i += 1) {
    if (!values[i].startsWith("--")) throw Error("Unexpected argument");
    const k = values[i].slice(2);
    out[k] = values[i + 1] && !values[i + 1].startsWith("--") ? values[++i] : true;
  }
  return out;
}
function need(a, k) {
  if (typeof a[k] !== "string") throw Error("Missing --" + k);
  return a[k];
}
async function secret() {
  const p = process.env.PANDO_BACKUP_PASSPHRASE_FILE;
  if (!p) throw Error("PANDO_BACKUP_PASSPHRASE_FILE must point to a secret file");
  let handle;
  if (process.platform === "win32") {
    const before = await lstat(p);
    if (!before.isFile() || before.isSymbolicLink())
      throw Error("Secret must be a regular non-symlink file");
    handle = await open(p, fsConstants.O_RDONLY);
  } else {
    handle = await open(p, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  }
  try {
    const i = await handle.stat();
    if (!i.isFile()) throw Error("Secret must be a regular file");
    if (process.platform !== "win32" && (i.mode & 0o077) !== 0)
      throw Error("Secret file permissions must be 0600 or stricter");
    const raw = await handle.readFile();
    let end = raw.length;
    if (end && raw[end - 1] === 10) end--;
    if (end && raw[end - 1] === 13) end--;
    const value = Buffer.from(raw.subarray(0, end));
    raw.fill(0);
    if (value.length < 20) {
      value.fill(0);
      throw Error("Secret must contain at least 20 bytes");
    }
    return value;
  } finally {
    await handle.close();
  }
}

async function pack(path, members, meta) {
  const indexed = [];
  for (const m of members) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(m.name)) throw Error("Unsafe member");
    indexed.push({ name: m.name, bytes: m.bytes, sha256: m.sha256 });
  }
  const body = json({ format: "pando.logical-backup-bundle.v1", ...meta, members: indexed });
  await writeFile(path, Buffer.concat([PM, len(body.length), body]), { flag: "wx", mode: 0o600 });
  for (const m of members)
    await pipeline(createReadStream(m.path), createWriteStream(path, { flags: "a" }));
}
async function encrypt(input, output, meta) {
  const pass = await secret();
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const temp = output + ".tmp-" + process.pid + "-" + randomBytes(16).toString("hex");
  let key;
  try {
    key = Buffer.from(await scrypt(pass, salt, 32, KDF));
    const head = json({
      format: "pando.encrypted-logical-backup.v1",
      cipher: "aes-256-gcm",
      kdf: { name: "scrypt", N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString("base64") },
      nonce: nonce.toString("base64"),
      ...meta,
    });
    const prefix = Buffer.concat([BM, len(head.length), head]);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(prefix);
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(temp, prefix, { flag: "wx", mode: 0o600 });
    await pipeline(createReadStream(input), cipher, createWriteStream(temp, { flags: "a" }));
    await appendFile(temp, cipher.getAuthTag());
    const tempHandle = await open(temp, "r+");
    try {
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    try {
      await link(temp, output);
    } catch (error) {
      if (error?.code === "EEXIST")
        throw new Error("Refusing to overwrite existing backup", { cause: error });
      throw error;
    }
    if (process.platform !== "win32") {
      let parentHandle;
      try {
        parentHandle = await open(dirname(output), fsConstants.O_RDONLY);
        await parentHandle.sync();
      } catch (cause) {
        throw new Error(
          "Backup was published but parent directory fsync failed; published output was preserved",
          { cause },
        );
      } finally {
        if (parentHandle) await parentHandle.close();
      }
    }
    return (await stat(output)).size;
  } finally {
    pass.fill(0);
    if (key) key.fill(0);
    salt.fill(0);
    nonce.fill(0);
    await rm(temp, { force: true });
  }
}
async function envelope(path) {
  const file = await stat(path);
  if (!file.isFile() || file.size < BM.length + 4 + 2 + 16 + 1)
    throw Error("Backup envelope is too small");
  const h = await open(path, "r");
  try {
    const fixed = Buffer.alloc(BM.length + 4);
    if (
      (await h.read(fixed, 0, fixed.length, 0)).bytesRead !== fixed.length ||
      !fixed.subarray(0, BM.length).equals(BM)
    )
      throw Error("Not a PANDO backup");
    const n = fixed.readUInt32BE(BM.length);
    if (n < 2 || n > 65536) throw Error("Invalid header");
    const bytes = Buffer.alloc(n);
    if ((await h.read(bytes, 0, n, fixed.length)).bytesRead !== n)
      throw Error("Truncated backup header");
    const header = JSON.parse(bytes);
    if (
      header.format !== "pando.encrypted-logical-backup.v1" ||
      header.cipher !== "aes-256-gcm" ||
      header.kdf?.name !== "scrypt" ||
      header.boundary !== PHASE0_BOUNDARY ||
      header.kdf?.N !== KDF.N ||
      header.kdf?.r !== KDF.r ||
      header.kdf?.p !== KDF.p
    )
      throw Error("Unsupported backup");
    return { header, prefix: Buffer.concat([fixed, bytes]), offset: fixed.length + n };
  } finally {
    await h.close();
  }
}
function decoded(value, expected, label) {
  if (typeof value !== "string") throw Error("Invalid " + label);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== expected || bytes.toString("base64") !== value)
    throw Error("Invalid " + label);
  return bytes;
}
async function decrypt(input, output) {
  const e = await envelope(input);
  const i = await stat(input);
  if (i.size <= e.offset + 16) throw Error("Backup ciphertext is empty or truncated");
  const h = await open(input, "r");
  const tag = Buffer.alloc(16);
  try {
    if ((await h.read(tag, 0, 16, i.size - 16)).bytesRead !== 16)
      throw Error("Truncated authentication tag");
  } finally {
    await h.close();
  }
  const salt = decoded(e.header.kdf.salt, 16, "scrypt salt");
  const nonce = decoded(e.header.nonce, 12, "AES-GCM nonce");
  const pass = await secret();
  let key;
  try {
    key = Buffer.from(await scrypt(pass, salt, 32, KDF));
    const d = createDecipheriv("aes-256-gcm", key, nonce);
    d.setAAD(e.prefix);
    d.setAuthTag(tag);
    await pipeline(
      createReadStream(input, { start: e.offset, end: i.size - 17 }),
      d,
      createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
    return e.header;
  } catch (cause) {
    await rm(output, { force: true });
    throw new Error("Backup authentication failed", { cause });
  } finally {
    pass.fill(0);
    if (key) key.fill(0);
    salt.fill(0);
    nonce.fill(0);
    tag.fill(0);
  }
}
async function unpack(path, directory) {
  const file = await stat(path);
  if (!file.isFile() || file.size < PM.length + 4 + 2) throw Error("Bundle is too small");
  const h = await open(path, "r");
  try {
    const fixed = Buffer.alloc(PM.length + 4);
    if (
      (await h.read(fixed, 0, fixed.length, 0)).bytesRead !== fixed.length ||
      !fixed.subarray(0, PM.length).equals(PM)
    )
      throw Error("Invalid bundle");
    const n = fixed.readUInt32BE(PM.length);
    if (n < 2 || n > MAX_BUNDLE_HEADER_BYTES) throw Error("Invalid bundle header length");
    const bytes = Buffer.alloc(n);
    if ((await h.read(bytes, 0, n, fixed.length)).bytesRead !== n)
      throw Error("Truncated backup header");
    const manifest = JSON.parse(bytes);
    if (
      manifest.format !== "pando.logical-backup-bundle.v1" ||
      typeof manifest.backup_id !== "string" ||
      manifest.boundary !== PHASE0_BOUNDARY ||
      !Array.isArray(manifest.members) ||
      manifest.members.length !== PHASE0_BUNDLE_MEMBERS.length
    )
      throw Error("Invalid bundle manifest");
    const memberNames = new Set(manifest.members.map((member) => member?.name));
    if (
      memberNames.size !== PHASE0_BUNDLE_MEMBERS.length ||
      PHASE0_BUNDLE_MEMBERS.some((name) => !memberNames.has(name))
    )
      throw Error("Invalid Phase 0 bundle member set");
    await mkdir(directory);
    let position = fixed.length + n;
    for (const m of manifest.members) {
      if (
        !/^[a-z0-9][a-z0-9._-]*$/.test(m?.name) ||
        !Number.isSafeInteger(m.bytes) ||
        m.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(m.sha256)
      )
        throw Error("Unsafe member");
      const memberEnd = position + m.bytes;
      if (!Number.isSafeInteger(memberEnd) || memberEnd > file.size)
        throw Error("Truncated bundle member");
      const target = join(directory, m.name);
      const digest = createHash("sha256");
      let observed = 0;
      if (m.bytes === 0) {
        await writeFile(target, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
      } else {
        const hasher = new Transform({
          transform(chunk, _encoding, callback) {
            observed += chunk.length;
            digest.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(
          createReadStream(path, {
            fd: h.fd,
            autoClose: false,
            start: position,
            end: memberEnd - 1,
          }),
          hasher,
          createWriteStream(target, { flags: "wx", mode: 0o600 }),
        );
      }
      if (observed !== m.bytes) throw Error("Truncated bundle member");
      position = memberEnd;
      if (digest.digest("hex") !== m.sha256) throw Error("Checksum mismatch");
    }
    if (position !== file.size) throw Error("Trailing bytes");
    return manifest;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await h.close();
  }
}
const a = argv(process.argv.slice(2)),
  command = need(a, "command"),
  output = resolve(need(a, "output"));
const scratch = await mkdtemp(join(tmpdir(), "pando-backup-"));
try {
  if (command === "seal") {
    const schema = resolve(need(a, "schema")),
      auth = resolve(need(a, "auth-data")),
      data = resolve(need(a, "data")),
      storage = resolve(need(a, "storage-manifest"));
    const stagedDirectory = join(scratch, "staged");
    await mkdir(stagedDirectory, { mode: 0o700 });
    const members = [];
    for (const member of [
      { name: "database-schema.sql", path: schema },
      { name: "auth-data.sql", path: auth },
      { name: "database-data.sql", path: data },
      { name: "storage-manifest.json", path: storage },
    ]) {
      members.push(
        await stageBackupMember(member.path, join(stagedDirectory, member.name), member.name),
      );
    }
    const stagedStorage = members.find((member) => member.name === "storage-manifest.json");
    const sm = JSON.parse(await readFile(stagedStorage.path, "utf8"));
    if (sm?.format !== "pando.storage-manifest.v1" || !Array.isArray(sm.objects))
      throw Error("Invalid storage manifest");
    const objectKeys = new Set();
    for (const o of sm.objects) {
      if (
        typeof o.bucket !== "string" ||
        o.bucket.length === 0 ||
        typeof o.path !== "string" ||
        o.path.length === 0 ||
        !Number.isSafeInteger(o.bytes) ||
        o.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(o.sha256)
      )
        throw Error("Invalid storage object");
      const objectKey = JSON.stringify([o.bucket, o.path]);
      if (objectKeys.has(objectKey)) throw Error("Duplicate storage object key");
      objectKeys.add(objectKey);
    }
    const id = randomBytes(16).toString("hex"),
      packed = join(scratch, "bundle");
    await pack(packed, members, { backup_id: id, boundary: PHASE0_BOUNDARY });
    const bytes = await encrypt(packed, output, {
      backup_id: id,
      created_at: new Date().toISOString(),
      boundary: PHASE0_BOUNDARY,
    });
    process.stdout.write(JSON.stringify({ backup_id: id, output, bytes }) + "\n");
  } else if (command === "open") {
    const packed = join(scratch, "bundle"),
      files = join(scratch, "files"),
      header = await decrypt(resolve(need(a, "input")), packed),
      manifest = await unpack(packed, files);
    if (header.backup_id !== manifest.backup_id || header.boundary !== manifest.boundary)
      throw Error("Encrypted header and bundle manifest disagree");
    await publishExtractedMembers(files, output, PHASE0_BUNDLE_MEMBERS);
    process.stdout.write(
      JSON.stringify({ backup_id: header.backup_id, output, members: manifest.members.length }) +
        "\n",
    );
  } else throw Error("Command must be seal or open");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
