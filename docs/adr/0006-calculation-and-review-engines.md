# ADR-0006 — Calculation and review engines

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

Mastery, readiness, review, and planning are derived projections. They must be explainable, reproducible after corrections, and useful before statistically calibrated data exists. A sophisticated adaptive algorithm would imply precision that the single-user MVP cannot validate.

## Decision

- Implement each calculation as a pure TypeScript function with immutable inputs, an explicit policy object, and an explicit clock.
- The engine cannot read the database, browser state, environment variables, current time, or network.
- Persist engine version, policy version, input watermark, relevant template and target-profile versions, output snapshot, explanation, and supporting or contradicting evidence identifiers.
- Keep state application in a transactional database command that rechecks the expected input watermark.
- Use the accepted [Mastery and Readiness Policy v0.1](../policies/MASTERY_READINESS_POLICY_V0.1.md).
- Use the accepted [Review Policy v0.1](../policies/REVIEW_POLICY_V0.1.md).
- Do not use FSRS in MVP. The review scheduler is a transparent table-driven policy. FSRS may later influence Recall only after enough review history and an evaluation plan exist.
- Golden fixtures and property tests are release artifacts. A policy change creates a new version; it does not rewrite historical evidence.

## Alternatives considered

- FSRS immediately: strong for calibrated spaced repetition, but adds parameters and state semantics that current data cannot tune or validate.
- Hidden weighted score or machine-learned readiness: rejected because it violates explainability and would overstate evidence.
- Database triggers containing product algorithms: rejected because they hide cross-context coupling and make versioned replay harder.
- Recompute directly in UI: rejected because clients would disagree and auditability would be lost.

## Consequences

- Initial coefficients are deliberately provisional and transparent.
- Recalculation can create a new projection generation without modifying evidence.
- SelfConfidence remains separate and cannot increase objective mastery or readiness.
- A failed event can create a known weak estimate while the achievement level remains NOT_STARTED.

## Security and privacy

Calculation payloads use only the minimum evidence fields needed. Explanations reference evidence identifiers and safe summaries; full private notes remain behind an authorized inspector query. Golden fixtures use synthetic data only.

## Migration and rollback

Every output is keyed by engine and policy version. A new policy runs side by side on fixtures and optionally as a shadow projection before activation. Rollback switches the active policy version and rebuilds projections from immutable evidence.
