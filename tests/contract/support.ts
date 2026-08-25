import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sha256, type JsonObject, type JsonValue } from "../../src/shared/contracts/json";
import type { PreparationPackInput } from "../../src/shared/contracts/preparation-pack";

export function fixturePath(relativePath: string): string {
  return resolve(process.cwd(), "tests", "fixtures", relativePath);
}

export function readJson(relativePath: string): JsonObject {
  return JSON.parse(readFileSync(fixturePath(relativePath), "utf8")) as JsonObject;
}

export function readFixtureBytes(relativePath: string): Uint8Array {
  return readFileSync(fixturePath(relativePath));
}

export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

interface JsonPatchOperation {
  readonly op: "add" | "copy" | "remove" | "replace";
  readonly path: string;
  readonly from?: string;
  readonly value?: JsonValue;
}

function pointerParts(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function location(root: JsonValue, pointer: string): [JsonObject | JsonValue[], string] {
  const parts = pointerParts(pointer);
  const key = parts.pop();
  if (key === undefined) throw new Error("Root replacement is not used by fixtures");
  let parent: JsonValue = root;
  for (const part of parts) {
    if (Array.isArray(parent)) parent = parent[Number(part)]!;
    else if (typeof parent === "object" && parent !== null) parent = parent[part]!;
    else throw new Error(`JSON pointer does not resolve: ${pointer}`);
  }
  if (!Array.isArray(parent) && (typeof parent !== "object" || parent === null)) {
    throw new Error(`JSON pointer parent is not a container: ${pointer}`);
  }
  return [parent, key];
}

function get(root: JsonValue, pointer: string): JsonValue {
  let current = root;
  for (const part of pointerParts(pointer)) {
    current = Array.isArray(current) ? current[Number(part)]! : (current as JsonObject)[part]!;
  }
  return current;
}

export function applyPatch<T extends JsonValue>(
  input: T,
  operations: readonly JsonPatchOperation[],
): T {
  const root = cloneJson(input);
  for (const operation of operations) {
    const [parent, key] = location(root, operation.path);
    if (operation.op === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      continue;
    }
    const value =
      operation.op === "copy" ? cloneJson(get(root, operation.from!)) : cloneJson(operation.value!);
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (operation.op === "add" || operation.op === "copy") parent.splice(index, 0, value);
      else parent[index] = value;
    } else {
      parent[key] = value;
    }
  }
  return root;
}

export function serializeJson(value: JsonValue): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadPreparationPack(
  variant: "growth-plan-minimal" | "minimal",
): PreparationPackInput {
  const root = `preparation-pack/valid/${variant}`;
  const manifest = readJson(`${root}/manifest.json`);
  const plan = readJson(`${root}/preparation-plan.json`);
  const context = readJson(`${root}/preparation-context.json`);
  const target = variant === "minimal" ? readJson(`${root}/target-profile.json`) : undefined;
  const fileNames = [
    "manifest.json",
    "preparation-plan.json",
    "rationale.md",
    "sources.md",
    ...(target === undefined ? [] : ["target-profile.json"]),
  ];
  const files = Object.fromEntries(
    fileNames.map((file) => [file, readFixtureBytes(`${root}/${file}`)]),
  );
  return {
    manifest,
    preparationPlan: plan,
    preparationContext: context,
    ...(target === undefined ? {} : { targetProfile: target }),
    files,
  };
}

export function replacePackDocument(
  pack: PreparationPackInput,
  fileName: "preparation-plan.json" | "target-profile.json",
  document: JsonObject,
): PreparationPackInput {
  const manifest = cloneJson(pack.manifest as JsonObject);
  const raw = serializeJson(document);
  const descriptors = manifest.files as JsonObject[];
  const descriptor = descriptors.find((item) => item.path === fileName);
  if (descriptor === undefined) throw new Error(`No manifest descriptor for ${fileName}`);
  descriptor.byte_length = raw.byteLength;
  (descriptor.checksum as JsonObject).digest = sha256(raw);
  return {
    ...pack,
    manifest,
    ...(fileName === "preparation-plan.json"
      ? { preparationPlan: document }
      : { targetProfile: document }),
    files: { ...pack.files, [fileName]: raw },
  };
}
