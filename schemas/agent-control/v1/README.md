# Agent Control contracts v1

These Draft 2020-12 schemas define the compact external-client boundary accepted by ADR-0008.

- `control-context.schema.json` is a minimized, versioned read projection. The valid root fixture must remain at most 12 KiB as UTF-8 JSON.
- `change-set.schema.json` describes a proposal, exact deterministic preview, confirmation binding, and final revision reference.
- JSON Schema validates bounded structure. A semantic validator must also enforce authenticated workspace ownership, deterministic ordering, root size, reference existence, operation/argument compatibility, bounded-context ownership, lifecycle/cardinality rules, expected aggregate versions, base watermark, preview digest/expiry, confirmation binding, idempotency, and all-or-nothing application.
- Reads/proposals never persist domain state. `apply_change_set` cannot alter the preview and never accepts arbitrary SQL, table names, file paths, or event bodies.
- These contracts are distinct from Preparation Pack, GraphProjectionV1, the competency DAG, and Graphify repository output.

The committed runtime harness lives in `src/shared/contracts/agent-control.ts`. It executes strict
Ajv structure, the 12 KiB root budget, compact-reference/cardinality checks, operation/argument
compatibility, lifecycle-state coherence, confirmation binding, explicit-clock expiry, and optional
workspace/aggregate-version checks. `tests/contract/agent-control.test.ts` runs valid and adversarial
vectors through that boundary.

This still does not claim a deployed MCP surface or applied command transaction. OAuth membership,
current aggregate lookup, preview-digest recomputation (whose canonical digest recipe is not yet
specified), idempotency receipts, authorization, and all-or-nothing database application require the
Phase 4/5 application boundary and database state.
