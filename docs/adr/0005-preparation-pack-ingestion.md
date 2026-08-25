# ADR-0005 — Preparation Pack contract and ingestion

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

Preparation Packs cross an untrusted file boundary from an external AI-assisted workflow. The hosted product accepts browser upload, must preserve the original accepted pack, must preview changes before activation, and must never promote unknown content directly into the canonical catalog.

## Decision

- JSON Schema Draft 2020-12 is the structural source of truth.
- Validate with Ajv in strict mode plus ajv-formats. Bundle and resolve only local schemas; disable coercion, automatic defaults, and unknown-field removal.
- Version preparation-context, manifest, target-profile, and preparation-plan schemas independently.
- Run separate structural and semantic validators. Semantic validation checks identifiers, references, DAG cycles, cardinality, weights, dates, version compatibility, target ownership, and personal-content staging.
- Parse ZIP data in memory with streaming limits using fflate. Never extract uploaded archives to the filesystem.
- Render Markdown as plain text in preview for MVP. Do not execute or render embedded HTML.

Accepted ZIP root entries are:

- manifest.json;
- target-profile.json;
- preparation-plan.json;
- sources.md;
- rationale.md.

A single enclosing top-level directory may be removed. Reject any other entry, duplicate normalized path, absolute path, parent traversal, NUL, symlink, encrypted member, non-UTF-8 JSON or Markdown, or case-colliding filename.

Hard upload limits:

- compressed archive at most 1 MiB;
- total uncompressed content at most 4 MiB;
- at most 8 archive entries;
- each entry at most 1 MiB;
- compression ratio at most 100 to 1;
- JSON nesting at most 32;
- at most 200 target requirements;
- at most 500 proposed competency or activity records;
- validation timeout 5 seconds.

The manifest does not hash itself. The server computes a content fingerprint from stable sorted path, SHA-256 digest, and byte length tuples.

Flow:

1. authenticate and apply workspace quota;
2. read the bounded upload;
3. structurally and semantically validate;
4. compute content fingerprint;
5. upload the exact accepted bytes to a private, content-addressed Supabase Storage path with overwrite disabled;
6. call one database command that records the immutable pack, validation report, preview proposal, storage reference, command receipt, and outbox event;
7. require explicit human confirmation before activation.

An object uploaded before a failed database transaction is an orphan, not authoritative state. A bounded cleanup job removes unreferenced objects after a safety delay.

Workspace retention quota is 20 accepted packs or 50 MiB, whichever arrives first. Reaching the quota blocks new imports and offers explicit deletion of superseded raw packs only when canonical retention rules allow it; imported decisions and audit records remain.

## Alternatives considered

- Store ZIP bytes in Postgres bytea: simpler atomic reference, but consumes the smaller database allowance and bloats backups.
- Direct signed browser upload before validation: efficient for large files, but unnecessary at the 1 MiB cap and leaves a larger quarantine surface.
- Cloudflare R2 as primary pack storage: viable, but adds another primary provider when Supabase Storage already fits the MVP.
- Directory watcher as canonical flow: rejected by the hosted product decision.

## Consequences

- Pack validation is deterministic, fixture-driven, and independent of the AI tool that authored the files.
- Storage and database cannot share one transaction, so content addressing, overwrite prevention, and orphan cleanup are mandatory.
- Unknown competencies and target profiles enter a personal proposal namespace and require confirmation.

## Security and privacy

- Upload endpoints rate-limit by user and workspace and reject before expensive work where possible.
- Logs contain fingerprint, sizes, schema versions, and error codes, not pack bodies.
- Storage buckets are private. Download requires an authorized short-lived server-mediated URL.
- Original packs, validation reports, and activation decisions are auditable.

## Migration and rollback

Schema versions remain readable after a new version is introduced. Imports always preserve the original bytes and normalized preview, so a parser can be rerun. Storage can migrate to R2 or another object store behind the same content-addressed adapter without changing the pack contract.
