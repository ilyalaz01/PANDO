# Evidence, Mastery, Review, Target Readiness, and Planning event contracts v1

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

`readiness-event.schema.json` contains exactly the two Targets-owned readiness facts:
`targets.readiness_projection_changed` and `targets.readiness_refresh_scheduled`. The changed event
contains only goal/profile/snapshot identity, projection and source watermarks, calculation
versions, status, confidence, and the bounded readiness interval. The scheduled event contains only
the goal, source snapshot, deterministic input fingerprint, and due instant. Goal-created and
Mastery wake events retain their existing owner schemas. Evidence bodies, notes, attempt results,
provider payloads, arbitrary consumers, and UI/domain-composition data are forbidden.

`planning-event.schema.json` contains the privacy-minimized `planning.input_changed` v1 variants
for initial Growth Plan creation and admission of one accepted Overlay activity to a Learning
Track. It carries only aggregate, attribution, and candidate identifiers plus safe versions.
Titles, competency mappings, duration, energy, notes, evidence, URLs, and arbitrary
consumer routing are forbidden; the Planning worker reloads authoritative inputs.
