# Preparation Pack contract v1

This directory defines the Draft 2020-12 contract for PANDO's untrusted, file-based Preparation Pack boundary.

## Versioning and resolution

- `v1/` is the compatibility-major directory.
- `preparation-context`, `manifest`, `target-profile`, and `preparation-plan` are independently versioned. Their root `schema_version` and version-bearing canonical `$id` are currently `1.0.0`.
- Every schema has a stable canonical `$id`, but every cross-schema `$ref` is a relative local file reference.
- The current root schema files are immutable `1.0.0` artifacts. A compatible revision is added beside them under a version-suffixed filename and a new version-bearing `$id`; it never replaces an older registered schema. Manifest descriptors select the exact document `$id` and version.
- A validator must preload all `*.schema.json` files from this directory, resolve only those local resources, and reject remote loading.
- The accepted runtime configuration from ADR-0005 is Ajv Draft 2020-12 strict mode plus `ajv-formats`, with coercion, defaults, and unknown-field removal disabled. This change does not add that runtime dependency or parser.

`additionalProperties: false` applies at every object boundary. Tagged competency references distinguish exact canonical catalog versions from pack-local personal proposals.

## Pack variants, files, and fingerprints

A Preparation Pack is a confirmed **large-plan authoring proposal**. It supports substantial Growth Plan design or an Interview Campaign, not conversational state lookup or direct semantic command execution.

The discriminated `preparation-plan.kind` variants are:

- `growth_plan_change`: root files are `manifest.json`, `preparation-plan.json`, `rationale.md`, and `sources.md`.
- `interview_campaign_change`: the same files plus `target-profile.json`.

A `growth_plan_change` must not contain a Target Profile reference, role, requirements, interview stages, or deadline. Its structured provenance registry lives in `preparation-plan.json`. An `interview_campaign_change` requires an exact workspace-draft Target Profile reference and deadline; its structured source registry remains in `target-profile.json`.

After removal of at most one common enclosing directory, no other root entry is accepted. The manifest target uses domain kinds (`growth_plan` or `interview_campaign`) and must match the corresponding plan-change variant.

This contract intentionally does not define `AgentContext`, a repository graph index, or a `ChangeSet`/command batch. Those require separate compact, version-checked contracts so a chat agent cannot bypass preview, confirmation, authorization, or ordinary domain commands.

The manifest lists the variant's non-manifest files in lexicographic order. Each descriptor contains the exact raw UTF-8 byte length and lowercase SHA-256 digest. The manifest cannot list or hash itself and cannot provide the server-owned pack content fingerprint.

`preparation-context.json` is exchanged separately. Its `context_fingerprint` is calculated by removing the `context_fingerprint` member, applying RFC 8785 JSON Canonicalization Scheme, encoding as UTF-8, and taking lowercase SHA-256. The canonicalization label is `pando-preparation-context-v1`. The manifest copies that metadata verbatim; semantic validation compares it with the supplied/exported context.

The server-owned pack content fingerprint uses `pando-pack-content-v1`: hash the exact accepted bytes of every variant root file individually with SHA-256; sort by normalized root path; serialize each tuple as UTF-8 `path`, NUL, lowercase digest, NUL, decimal byte length, LF; concatenate the tuples; then take lowercase SHA-256. It is never trusted from uploaded JSON.

## Validation layers

JSON Schema enforces bounded structure, types, versions, exact descriptor paths, checksum syntax, tagged reference shape, and workspace-draft disposition. A separate semantic validator must check:

- canonical references against the exported catalog version;
- proposed, requirement, source, phase, milestone, activity, and cross-file reference existence;
- unique identifiers and prerequisite acyclicity;
- date and effort ordering, group cardinality, and combined proposal limits;
- raw-byte checksums, byte lengths, context fingerprint, and cross-file versions;
- manifest domain kind, plan-change discriminator, deadline, file set, and Target Profile presence agree;
- absence of evidence, mastery, readiness, canonical publication, or tenant authority.

Archive validation precedes structural validation and enforces ADR-0005 path normalization, encoding, entry-type, size, count, nesting, and compression limits. Workspace retention quota is a separate authenticated state check.

The v1 hard limits are: 1 MiB compressed archive; 4 MiB total uncompressed; 8 archive entries; 1 MiB per entry; 100:1 maximum compression ratio; JSON nesting 32; 200 target requirements; 500 proposed competencies plus activities in aggregate; and a 5-second validation timeout. Retention permits at most 20 accepted packs or 50 MiB per workspace, whichever is reached first.

The committed runtime harness lives in `src/shared/contracts/preparation-pack.ts`,
`preparation-archive.ts`, and `schema-registry.ts`. It executes strict local-only Ajv structure,
RFC 8785 context and content fingerprints, raw-byte descriptor integrity, cross-file references,
variant coherence, DAG/date/effort/cardinality rules, archive-metadata normalization, hard limits,
and retention predicates. `tests/contract/preparation-pack.test.ts` materializes every RFC 6902,
boundary, archive, retention, and malicious descriptor in the fixture matrix.

The harness consumes already parsed JSON and archive-entry metadata. A streaming ZIP byte parser,
upload timeout enforcement, authenticated workspace quota lookup, private storage, preview,
confirmation, persistence, and cleanup job remain ingestion/application work; the metadata harness
must be called by that parser and is not itself a claim that arbitrary ZIP bytes are safely opened.
