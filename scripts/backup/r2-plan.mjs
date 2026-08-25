import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";

const MAGIC = Buffer.from("PANDO-BACKUP-V1\n");
const MAX_HEADER_BYTES = 64 * 1024;
const TAG_BYTES = 16;

const values = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--") || !process.argv[i + 1]) throw new Error("Expected named arguments");
  values[key.slice(2)] = process.argv[++i];
}
const input = resolve(values.input ?? "");
const accountId = values["account-id"] ?? "";
const bucket = values.bucket ?? "";
if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error("Invalid Cloudflare account id");
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Invalid R2 bucket");

const info = await stat(input);
if (!info.isFile() || info.size < MAGIC.length + 4 + 2 + TAG_BYTES + 1)
  throw new Error("R2 adapter requires a complete encrypted PANDO backup");
const handle = await open(input, "r");
let header;
let payloadOffset;
try {
  const fixed = Buffer.alloc(MAGIC.length + 4);
  if (
    (await handle.read(fixed, 0, fixed.length, 0)).bytesRead !== fixed.length ||
    !fixed.subarray(0, MAGIC.length).equals(MAGIC)
  )
    throw new Error("R2 adapter accepts only an encrypted PANDO backup");
  const headerLength = fixed.readUInt32BE(MAGIC.length);
  if (headerLength < 2 || headerLength > MAX_HEADER_BYTES)
    throw new Error("Invalid encrypted backup header");
  const headerBytes = Buffer.alloc(headerLength);
  if ((await handle.read(headerBytes, 0, headerLength, fixed.length)).bytesRead !== headerLength)
    throw new Error("Truncated encrypted backup header");
  header = JSON.parse(headerBytes);
  payloadOffset = fixed.length + headerLength;
} finally {
  await handle.close();
}
if (
  header.format !== "pando.encrypted-logical-backup.v1" ||
  header.cipher !== "aes-256-gcm" ||
  header.kdf?.name !== "scrypt" ||
  header.kdf?.N !== 32768 ||
  header.kdf?.r !== 8 ||
  header.kdf?.p !== 1 ||
  !/^[a-f0-9]{32}$/.test(header.backup_id) ||
  header.boundary !== "phase0-relational-plus-storage-manifest" ||
  typeof header.created_at !== "string" ||
  Number.isNaN(Date.parse(header.created_at)) ||
  new Date(header.created_at).toISOString() !== header.created_at
)
  throw new Error("Invalid encrypted backup metadata");
const salt = Buffer.from(header.kdf.salt ?? "", "base64");
const nonce = Buffer.from(header.nonce ?? "", "base64");
if (
  salt.length !== 16 ||
  salt.toString("base64") !== header.kdf.salt ||
  nonce.length !== 12 ||
  nonce.toString("base64") !== header.nonce
)
  throw new Error("Invalid encrypted backup parameters");
if (info.size <= payloadOffset + TAG_BYTES)
  throw new Error("Encrypted backup ciphertext is empty or truncated");

const key = "pando/logical/" + header.created_at.slice(0, 10) + "/" + header.backup_id + ".pando";
process.stdout.write(
  JSON.stringify({
    adapter: "cloudflare-r2-s3.v1",
    endpoint: "https://" + accountId + ".r2.cloudflarestorage.com",
    bucket,
    key,
    backup_id: header.backup_id,
    encrypted_before_adapter: true,
    overwrite: "must-fail",
    live_upload_implemented: false,
  }) + "\n",
);
