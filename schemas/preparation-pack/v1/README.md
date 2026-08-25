# Preparation Pack contract v1

This directory is the executable Draft 2020-12 contract for PANDO's untrusted, file-based Preparation Pack boundary.

## Versioning and resolution

- `v1/` is the compatibility-major directory.
- `preparation-context`, `manifest`, `target-profile`, and `preparation-plan` are independently versioned. Their root `schema_version` and version-bearing canonical `$id` are currently `1.0.0`.
- Every schema has a stable canonical `$id`, but every cross-schema `$ref` is a relative local file reference.
- The current root schema files are immutable `1.0.0` artifacts. A compatible revision is added beside them under a version-suffixed filename and a new version-bearing `$id`; it never replaces an older registered schema. Manifest descriptors select the exact document `$id` and version.
- A validator must preload all `*.schema.json` files from this directory, resolve only those local resources, and reject remote loading.
- The accepted runtime configuration from ADR-0005 is Ajv Draft 2020-12 strict mode plus `ajv-formats`, with coercion, defaults, and unknown-field removal disabled. This change does not add that runtime dependency or parser.

`additionalProperties: false` applies at every object boundary. Tagged competency references distinguish exact canonical catalog versions from pack-local personal proposals.

## Files and fingerprints

A pack contains exactly these root files after removal of at most one common enclosing directory:

1. `manifest.json`
2. `preparation-plan.json`
3. `rationale.md`
4. `sources.md`
5. `target-profile.json`

The manifest lists the four non-manifest files in lexicographic order. Each descriptor contains the exact raw UTF-8 byte length and lowercase SHA-256 digest. The manifest cannot list or hash itself and cannot provide the server-owned pack content fingerprint.

`preparation-context.json` is exchanged separately. Its `context_fingerprint` is calculated by removing the `context_fingerprint` member, applying RFC 8785 JSON Canonicalization Scheme, encoding as UTF-8, and taking lowercase SHA-256. The canonicalization label is `pando-preparation-context-v1`. The manifest copies that metadata verbatim; semantic validation compares it with the supplied/exported context.

The server-owned pack content fingerprint uses `pando-pack-content-v1`: hash the exact accepted bytes of all five files individually with SHA-256; sort by normalized root path; serialize each tuple as UTF-8 `path`, NUL, lowercase digest, NUL, decimal byte length, LF; concatenate the tuples; then take lowercase SHA-256. It is never trusted from uploaded JSON.

## Validation layers

JSON Schema enforces bounded structure, types, versions, exact descriptor paths, checksum syntax, tagged reference shape, and workspace-draft disposition. A separate semantic validator must check:

- canonical references against the exported catalog version;
- proposed, requirement, source, phase, milestone, activity, and cross-file reference existence;
- unique identifiers and prerequisite acyclicity;
- date and effort ordering, group cardinality, and combined proposal limits;
- raw-byte checksums, byte lengths, context fingerprint, and cross-file versions;
- absence of evidence, mastery, readiness, canonical publication, or tenant authority.

Archive validation precedes structural validation and enforces ADR-0005 path normalization, encoding, entry-type, size, count, nesting, and compression limits. Workspace retention quota is a separate authenticated state check.

The v1 hard limits are: 1 MiB compressed archive; 4 MiB total uncompressed; 8 archive entries; 1 MiB per entry; 100:1 maximum compression ratio; JSON nesting 32; 200 target requirements; 500 proposed competencies plus activities in aggregate; and a 5-second validation timeout. Retention permits at most 20 accepted packs or 50 MiB per workspace, whichever is reached first.

No compatible validator is installed in the repository yet and root package/config changes are outside this outcome. `tests/fixtures/preparation-pack/fixture-matrix.json` therefore provides the deterministic valid, invalid, boundary, semantic, archive, retention, and malicious matrix for the future Ajv/import harness.
