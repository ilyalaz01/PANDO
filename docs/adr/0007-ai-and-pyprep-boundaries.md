# ADR-0007 — Embedded AI and PyPrep boundaries

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

## Context

The MVP must work without an AI API and without a live PyPrep source. The current operating budget is USD 10 per month, and PANDO contains personal learning and interview data. External authoring and provider normalization must not become hidden sources of truth.

## Decision

### Embedded AI

- Do not integrate an embedded AI model or provider in MVP.
- Store no AI conversation history because PANDO conducts no embedded AI conversation.
- An authenticated external ChatGPT Work/Codex Agent Control client is allowed by [ADR-0008](0008-agent-control-plane.md): language interpretation stays outside PANDO and every read/write uses the ordinary authorized product boundary.
- The external Preparation Pack workflow remains provider-neutral, file-based, versioned, previewed, and explicitly confirmed.
- Prompts and exported context minimize personal data and remain useful with any capable external tool.
- A future embedded AI feature requires a superseding ADR with a named outcome, provider comparison, data-flow diagram, consent, retention and deletion policy, monthly hard cap, observability, evaluation fixtures, and a complete non-AI fallback.
- Initial spend gate: do not enable paid inference while total infrastructure budget is USD 10 or while the feature is a release convenience rather than a required outcome.

### PyPrep

- Treat PyPrep as an external bounded context through a versioned contract, integration inbox, normalized events, idempotency, and a tested mock.
- Never read or write PyPrep-owned tables directly from PANDO domain modules.
- Physical database sharing, if ever chosen for deployment convenience, does not change logical ownership or permit cross-schema table coupling.
- Ship manual evidence entry and file import regardless of live PyPrep availability.

## Alternatives considered

- Provider-specific built-in assistant: rejected for cost, retention, privacy, and product-dependency reasons.
- Shared database table access to PyPrep: rejected because it couples release, schema, ownership, and failure domains.
- Live PyPrep as a release gate: rejected by the canonical release scope.

## Consequences

- AI runtime cost is USD 0 and AI outage cannot break the product.
- External output quality is controlled by contract validation and human confirmation, not provider trust.
- Live PyPrep can be added without changing the evidence contract.

## Security and privacy

Preparation context export is explicit, minimized, and user-controlled. It excludes secrets and unrelated free-form evidence by default. PyPrep credentials are scoped, rotated, and kept in the integration adapter. Raw provider events remain in the integration inbox and do not enter the evidence ledger until normalized.

## Migration and rollback

An embedded provider is an optional adapter behind the existing Preparation Pack contract and can be disabled without losing core behavior. PyPrep adapters version independently; rollback stops ingestion at the inbox while manual workflows continue.
