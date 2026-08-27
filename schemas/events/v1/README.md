# Evidence, Mastery, and Review event contracts v1

`evidence-event.schema.json` is the fixed, privacy-minimized outbox contract consumed by
`mastery.evidence_projection_v1`.

It carries only workspace and immutable evidence/correction identifiers, competency scope, and the
observation watermark. Activity bodies, scratch text, notes, provider payloads, reliability,
confidence, arbitrary consumer names, and calculated Mastery state are deliberately excluded. The
worker treats the event as a wake-up signal and reloads authoritative Evidence rows before running
the versioned engine.

`mastery-event.schema.json` is emitted only when the current competency-state pointer advances. It
contains projection identity, generation, watermark, level, and calculation versions, but no
supporting evidence identifiers or private bodies. Review and Targets may consume this versioned
fact through their own fixed deliveries when those Phase 3 projections are implemented.

`review-event.schema.json` is emitted only as `review.item_changed` when the current Review subject
projection advances. It carries the structured competency/dimension identity, positive subject
version, effective UTC due instant when current, unique active reason types, and projection status.
Inactive and suppressed projections carry neither an effective due instant nor active reasons.
Internal `review.input_changed` wake-ups are deliberately excluded from this public registry.
Evidence identifiers and bodies, notes, URLs, arbitrary consumer names, activity content, and
user-supplied HTML are forbidden.
