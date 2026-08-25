# Agent Control contracts v1

These Draft 2020-12 schemas define the compact external-client boundary accepted by ADR-0008.

- `control-context.schema.json` is a minimized, versioned read projection. The valid root fixture must remain at most 12 KiB as UTF-8 JSON.
- `change-set.schema.json` describes a proposal, exact deterministic preview, confirmation binding, and final revision reference.
- JSON Schema validates bounded structure. A semantic validator must also enforce authenticated workspace ownership, deterministic ordering, root size, reference existence, operation/argument compatibility, bounded-context ownership, lifecycle/cardinality rules, expected aggregate versions, base watermark, preview digest/expiry, confirmation binding, idempotency, and all-or-nothing application.
- Reads/proposals never persist domain state. `apply_change_set` cannot alter the preview and never accepts arbitrary SQL, table names, file paths, or event bodies.
- These contracts are distinct from Preparation Pack, GraphProjectionV1, the competency DAG, and Graphify repository output.

The committed fixtures cover a compact live summary and the cancelled-interview preview. Runtime Ajv/semantic harness work is tracked by the Phase 0 quality gates; until it exists these schemas are accepted design contracts, not a claim of a deployed MCP surface.
