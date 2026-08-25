import { createHash } from "node:crypto";

import { canonicalizeEx } from "json-canonicalize";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asJsonObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

export function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalize(value: JsonValue): string {
  return canonicalizeEx(value, { undefinedInArrayToNull: false });
}

export function asciiCompare(left: string, right: string): number {
  const leftBytes = Buffer.from(left, "ascii");
  const rightBytes = Buffer.from(right, "ascii");
  return Buffer.compare(leftBytes, rightBytes);
}

export function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || asciiCompare(values[index - 1]!, value) <= 0,
  );
}

export function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function referenceKey(reference: JsonObject): string | undefined {
  const kind = asString(reference.kind);
  if (kind === "canonical") return asString(reference.competency_id);
  if (kind === "proposed") return asString(reference.proposed_competency_id);
  return undefined;
}

export function maximumJsonNesting(value: JsonValue): number {
  if (!Array.isArray(value) && !isJsonObject(value)) return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...children.map(maximumJsonNesting));
}
