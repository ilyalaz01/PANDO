import { asArray, asJsonObject, asNumber, asString, isJsonObject } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";

export const preparationPackLimits = {
  compressedBytes: 1_048_576,
  totalUncompressedBytes: 4_194_304,
  entryCount: 8,
  entryUncompressedBytes: 1_048_576,
  compressionRatio: 100,
  jsonNesting: 32,
  validationMilliseconds: 5_000,
  retainedPackCount: 20,
  retainedBytes: 52_428_800,
} as const;

const acceptedRootEntries = new Set([
  "manifest.json",
  "preparation-plan.json",
  "rationale.md",
  "sources.md",
  "target-profile.json",
]);

function reject(code: string, path: string, message: string): ValidationResult {
  return validationResult([{ code, path, message }]);
}

function normalizedArchivePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isAbsoluteArchivePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
}

export function validateArchiveEntries(value: unknown): ValidationResult {
  const metadata = asJsonObject(value, "archive metadata");
  const entries = asArray(metadata.entries).filter(isJsonObject);
  const paths = entries.map((entry) => asString(entry.path) ?? "");

  const nulIndex = paths.findIndex((path) => path.includes("\0"));
  if (nulIndex >= 0) {
    return reject(
      "ARCHIVE_NUL_PATH",
      `/entries/${nulIndex}/path`,
      "NUL is forbidden in archive paths.",
    );
  }
  const absoluteIndex = paths.findIndex(isAbsoluteArchivePath);
  if (absoluteIndex >= 0) {
    return reject(
      "ARCHIVE_ABSOLUTE_PATH",
      `/entries/${absoluteIndex}/path`,
      "Absolute archive paths are forbidden.",
    );
  }
  const normalized = paths.map(normalizedArchivePath);
  const traversalIndex = normalized.findIndex((path) => path.split("/").includes(".."));
  if (traversalIndex >= 0) {
    return reject(
      "ARCHIVE_PARENT_TRAVERSAL",
      `/entries/${traversalIndex}/path`,
      "Parent traversal is forbidden in archive paths.",
    );
  }
  const symlinkIndex = entries.findIndex((entry) => asString(entry.kind) === "symlink");
  if (symlinkIndex >= 0) {
    return reject(
      "ARCHIVE_SYMLINK",
      `/entries/${symlinkIndex}/kind`,
      "Symlink entries are forbidden.",
    );
  }
  const encryptedIndex = entries.findIndex((entry) => entry.encrypted === true);
  if (encryptedIndex >= 0) {
    return reject(
      "ARCHIVE_ENCRYPTED_MEMBER",
      `/entries/${encryptedIndex}/encrypted`,
      "Encrypted archive members are forbidden.",
    );
  }
  const duplicateIndex = normalized.findIndex((path, index) => normalized.indexOf(path) !== index);
  if (duplicateIndex >= 0) {
    return reject(
      "ARCHIVE_DUPLICATE_NORMALIZED_PATH",
      `/entries/${duplicateIndex}/path`,
      "Normalized archive paths must be unique.",
    );
  }
  const lowerPaths = normalized.map((path) => path.toLocaleLowerCase("en-US"));
  const caseCollisionIndex = lowerPaths.findIndex(
    (path, index) => lowerPaths.indexOf(path) !== index,
  );
  if (caseCollisionIndex >= 0) {
    return reject(
      "ARCHIVE_CASE_COLLISION",
      `/entries/${caseCollisionIndex}/path`,
      "Archive paths must not collide by case.",
    );
  }

  const splitPaths = normalized.map((path) => path.split("/"));
  const nested = splitPaths.some((parts) => parts.length > 1);
  const commonRoot = nested ? splitPaths[0]?.[0] : undefined;
  if (
    nested &&
    (commonRoot === undefined ||
      splitPaths.some((parts) => parts.length !== 2 || parts[0] !== commonRoot))
  ) {
    return reject(
      "ARCHIVE_MULTIPLE_ROOTS",
      "/entries",
      "At most one common enclosing archive directory may be removed.",
    );
  }
  const rootNames = splitPaths.map((parts) => (nested ? parts[1]! : parts[0]!));
  const unsupportedIndex = entries.findIndex(
    (entry, index) =>
      asString(entry.kind) !== "file" || !acceptedRootEntries.has(rootNames[index]!),
  );
  if (unsupportedIndex >= 0) {
    return reject(
      "ARCHIVE_UNSUPPORTED_ENTRY",
      `/entries/${unsupportedIndex}`,
      "The archive contains an unsupported entry.",
    );
  }
  const encodingIndex = entries.findIndex(
    (entry) => asString(entry.encoding)?.toLocaleLowerCase("en-US") !== "utf-8",
  );
  if (encodingIndex >= 0) {
    return reject(
      "ARCHIVE_NON_UTF8",
      `/entries/${encodingIndex}/encoding`,
      "Preparation Pack JSON and Markdown must be UTF-8.",
    );
  }
  return validationResult([]);
}

export interface ArchiveLimitInput {
  readonly compressed_bytes?: number;
  readonly total_uncompressed_bytes?: number;
  readonly entry_count?: number;
  readonly largest_entry_uncompressed_bytes?: number;
  readonly uncompressed_bytes?: number;
  readonly maximum_json_nesting?: number;
  readonly elapsed_milliseconds?: number;
}

export function validateArchiveLimits(input: ArchiveLimitInput): ValidationResult {
  const violations: ContractViolation[] = [];
  const add = (code: string, path: string, message: string): void => {
    violations.push({ code, path, message });
  };
  if ((input.compressed_bytes ?? 0) > preparationPackLimits.compressedBytes) {
    add("ARCHIVE_COMPRESSED_LIMIT", "/compressed_bytes", "Compressed archive exceeds 1 MiB.");
  }
  if ((input.total_uncompressed_bytes ?? 0) > preparationPackLimits.totalUncompressedBytes) {
    add(
      "ARCHIVE_UNCOMPRESSED_LIMIT",
      "/total_uncompressed_bytes",
      "Archive content exceeds 4 MiB uncompressed.",
    );
  }
  if ((input.entry_count ?? 0) > preparationPackLimits.entryCount) {
    add("ARCHIVE_ENTRY_COUNT_LIMIT", "/entry_count", "Archive contains more than eight entries.");
  }
  if (
    (input.largest_entry_uncompressed_bytes ?? 0) > preparationPackLimits.entryUncompressedBytes
  ) {
    add(
      "ARCHIVE_ENTRY_SIZE_LIMIT",
      "/largest_entry_uncompressed_bytes",
      "An archive entry exceeds 1 MiB.",
    );
  }
  if (
    input.compressed_bytes !== undefined &&
    input.uncompressed_bytes !== undefined &&
    input.uncompressed_bytes > input.compressed_bytes * preparationPackLimits.compressionRatio
  ) {
    add(
      "ARCHIVE_COMPRESSION_RATIO",
      "/uncompressed_bytes",
      "Archive compression ratio exceeds 100:1.",
    );
  }
  if ((input.maximum_json_nesting ?? 0) > preparationPackLimits.jsonNesting) {
    add("JSON_NESTING_LIMIT", "/maximum_json_nesting", "JSON nesting exceeds 32 levels.");
  }
  if ((input.elapsed_milliseconds ?? 0) > preparationPackLimits.validationMilliseconds) {
    add("VALIDATION_TIMEOUT", "/elapsed_milliseconds", "Validation exceeded five seconds.");
  }
  return validationResult(violations);
}

export interface RetentionQuotaInput {
  readonly accepted_pack_count: number;
  readonly attempted_new_packs: number;
  readonly retained_bytes?: number;
  readonly attempted_pack_bytes?: number;
}

export function validateRetentionQuota(input: RetentionQuotaInput): ValidationResult {
  if (
    input.accepted_pack_count + input.attempted_new_packs >
    preparationPackLimits.retainedPackCount
  ) {
    return reject(
      "WORKSPACE_PACK_COUNT_QUOTA",
      "/accepted_pack_count",
      "Workspace retention permits at most 20 accepted packs.",
    );
  }
  if (
    (input.retained_bytes ?? 0) + (input.attempted_pack_bytes ?? 0) >
    preparationPackLimits.retainedBytes
  ) {
    return reject(
      "WORKSPACE_PACK_BYTES_QUOTA",
      "/retained_bytes",
      "Workspace retention permits at most 50 MiB of accepted pack bytes.",
    );
  }
  return validationResult([]);
}

export function archiveLimitInput(value: unknown): ArchiveLimitInput {
  const input = asJsonObject(value, "archive limit input");
  const numeric = (field: string): Record<string, number> => {
    const fieldValue = asNumber(input[field]);
    return fieldValue === undefined ? {} : { [field]: fieldValue };
  };
  return {
    ...numeric("compressed_bytes"),
    ...numeric("total_uncompressed_bytes"),
    ...numeric("entry_count"),
    ...numeric("largest_entry_uncompressed_bytes"),
    ...numeric("uncompressed_bytes"),
    ...numeric("maximum_json_nesting"),
    ...numeric("elapsed_milliseconds"),
  };
}
