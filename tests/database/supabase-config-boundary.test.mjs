import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function readSection(source, sectionName) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const header = `[${sectionName}]`;
  const headerIndexes = lines.flatMap((line, index) => (line.trim() === header ? [index] : []));
  assert.deepEqual(headerIndexes.length, 1, `${header} must occur exactly once`);
  const start = headerIndexes[0] + 1;
  const endOffset = lines.slice(start).findIndex((line) => /^\s*\[/.test(line));
  return lines.slice(start, endOffset === -1 ? lines.length : start + endOffset);
}

function readStringArray(sectionLines, key) {
  const matches = sectionLines.flatMap((line) => {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(\\[.*\\])\\s*$`));
    return match ? [match[1]] : [];
  });
  assert.equal(matches.length, 1, `${key} must occur exactly once in [api]`);
  const value = JSON.parse(matches[0]);
  assert.ok(Array.isArray(value) && value.every((entry) => typeof entry === "string"));
  return value;
}

function readBoolean(sectionLines, key) {
  const matches = sectionLines.flatMap((line) => {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)\\s*$`));
    return match ? [match[1] === "true"] : [];
  });
  assert.equal(matches.length, 1, `${key} must occur exactly once`);
  return matches[0];
}

test("Supabase Data API exposes only the purpose-specific api schema", async () => {
  const source = await readFile(resolve(root, "supabase/config.toml"), "utf8");
  const api = readSection(source, "api");

  assert.ok(api.some((line) => /^\s*enabled\s*=\s*true\s*$/.test(line)));
  assert.deepEqual(readStringArray(api, "schemas"), ["api"]);
  assert.deepEqual(readStringArray(api, "extra_search_path"), ["extensions"]);
});

test("Supabase Auth is invite-only while the email/password provider remains usable", async () => {
  const source = await readFile(resolve(root, "supabase/config.toml"), "utf8");
  const auth = readSection(source, "auth");
  const email = readSection(source, "auth.email");

  assert.equal(readBoolean(auth, "enabled"), true);
  assert.equal(readBoolean(auth, "enable_signup"), false);
  assert.equal(readBoolean(auth, "enable_anonymous_sign_ins"), false);
  assert.equal(readBoolean(email, "enable_signup"), true);
  assert.equal(readBoolean(email, "enable_confirmations"), true);
});
