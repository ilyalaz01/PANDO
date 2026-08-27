# Evidence

Owns attempts and the immutable normalized evidence ledger.

## Implemented Phase 2 boundary

Evidence persists `ActivityAttempt`, a per-subject ledger watermark, normalized manual
observations, and append-only invalidation corrections. A start, stop, or completion-only result is
operational history and does not enter the ledger. Only an explicit observed success or failure is
normalized through the activity owner's accepted mapping.

The client cannot supply workspace, user, competency, mapping confidence, source reliability, or an
outbox consumer. The Focus coordinator derives them server-side and commits an evidence observation,
ledger advance, privacy-minimized event, fixed Mastery delivery, and command receipt atomically.
Observation and correction rows reject updates and deletes; invalidation preserves the original.
