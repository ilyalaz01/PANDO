# Evidence and Mastery event contracts v1

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
