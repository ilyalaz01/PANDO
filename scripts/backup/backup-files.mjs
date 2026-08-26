import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function stageBackupMember(source, target, name) {
  let handle;
  if (process.platform === "win32") {
    const before = await lstat(source);
    if (!before.isFile() || before.isSymbolicLink())
      throw Error(`Backup member ${name} must be a regular non-symlink file`);
    handle = await open(source, fsConstants.O_RDONLY);
  } else {
    handle = await open(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  }

  try {
    const before = await handle.stat();
    if (!before.isFile()) throw Error(`Backup member ${name} must be a regular file`);
    const digest = createHash("sha256");
    let observed = 0;
    const hasher = new Transform({
      transform(chunk, _encoding, callback) {
        observed += chunk.length;
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(source, { fd: handle.fd, autoClose: false, start: 0 }),
      hasher,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    const after = await handle.stat();
    if (observed !== before.size || after.size !== before.size)
      throw Error(`Backup member ${name} changed while it was staged`);
    return { name, path: target, bytes: observed, sha256: digest.digest("hex") };
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

export async function publishExtractedMembers(files, output, memberNames, copy = copyFile) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  let claimed = false;
  try {
    await mkdir(output, { mode: 0o700 });
    claimed = true;
    for (const memberName of memberNames) {
      await copy(join(files, memberName), join(output, memberName), fsConstants.COPYFILE_EXCL);
    }
  } catch (cause) {
    if (claimed) {
      throw new Error(`Extraction failed; incomplete output was preserved at ${output}`, {
        cause,
      });
    }
    throw cause;
  }
}
