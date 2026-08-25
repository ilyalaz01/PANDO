# Software Engineering Guidelines — PANDO

Status: normative engineering baseline v1.1  
Date: 2026-08-25  
Audience: human developers, reviewers, Codex/AI agents, QA, security, and operations

## 0. Purpose and interpretation

This document defines how the product is designed, implemented, reviewed, tested, secured, released, and operated. It replaces the uploaded generic `Software Project Guidelines — Dr. Yoram Segal v3.00` for this repository.

It is intentionally modeled on publicly documented practices from Google Engineering Practices, Google SRE, the Amazon Builders' Library, AWS Well-Architected, NIST SSDF, OWASP ASVS, and WCAG. It does **not** claim to reproduce private internal rules at Google or Amazon.

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` have their RFC 2119 meanings.

### 0.1 Precedence

Use this order when instructions conflict:

1. Explicit current product-owner instruction.
2. `docs/00_PRODUCT_CONSTITUTION.md`.
3. `docs/01_DOMAIN_MODEL.md`.
4. `docs/02_PRODUCT_AND_UX_SPEC.md`.
5. `docs/03_SYSTEM_ARCHITECTURE.md`.
6. `docs/04_MVP_DELIVERY_PLAN.md`.
7. `docs/05_EXTERNAL_AI_PREPARATION_PACK.md` and `docs/06_PROMPT_LIBRARY_UX.md`.
8. This engineering guideline.
9. ADRs, module documentation, and source-code conventions.

An agent MUST stop, identify the conflict, and request or propose a resolution when a lower-level rule cannot satisfy a higher-level rule. It MUST NOT silently reinterpret product semantics.

### 0.2 Right-sized rigor

High standards do not mean maximum ceremony. Documentation, review, testing, reliability, and security effort MUST be proportional to user impact, reversibility, data sensitivity, and operational risk.

The project MUST avoid both:

- under-engineering that creates unsafe or unverifiable behavior; and
- speculative abstractions, documents, services, or extension points that solve no current requirement.

## 1. Engineering principles

### 1.1 Customer outcome before implementation output

- Every change MUST connect to a user problem, acceptance criterion, reliability need, or risk reduction.
- Lines of code, number of documents, test count, and AI output volume are not success metrics.
- Agents MUST NOT invent productivity multipliers or claim quality from generated code volume.

### 1.2 Correctness and evidence

- Product states that affect mastery, readiness, scheduling, or recommendations MUST be deterministic, versioned, reproducible, and explainable.
- The evidence ledger and correction history MUST preserve auditability.
- Missing information MUST remain `Unknown`; it MUST NOT be converted into a fabricated zero or fact.

### 1.3 Simplicity and reversibility

- Prefer the simplest design that satisfies current requirements and known scale.
- Prefer reversible decisions when cost and quality are otherwise comparable.
- Hard-to-reverse choices require an ADR and explicit migration/exit strategy.
- Do not introduce microservices, a graph database, a plugin framework, or a generic SDK without demonstrated need and approval.

### 1.4 Secure and private by default

- Minimize collected data, permissions, secrets, external dependencies, and data exposure.
- Treat user data, imported files, URLs, provider events, browser input, and model output as untrusted.
- Authorization is enforced server-side and tested independently of UI behavior.

### 1.5 Ownership includes operation

- A feature is not complete merely because it works locally.
- The owner is responsible for tests, migrations, observability, rollback/roll-forward, documentation, degraded states, and supportability appropriate to the release stage.

## 2. Canonical documentation system

### 2.1 Required project documents

The eight Markdown documents under `docs/`—the index plus `00` through `06`—are the approved product and architecture baseline. This file is the ninth, implementation-governance document. `docs/README.md` is the canonical complete index.

The repository root SHOULD additionally contain, once implementation begins:

- `README.md` — setup, local development, validation, deployment, troubleshooting, and project status;
- `AGENTS.md` — concise repository-local instructions for coding agents;
- `CONTRIBUTING.md` — contribution and review workflow when there is more than one contributor;
- `SECURITY.md` — vulnerability reporting and security expectations before public release;
- `LICENSE` — before public distribution.

### 2.2 ADRs

Create an Architecture Decision Record only for a durable or costly decision, such as:

- framework/runtime or deployment platform;
- domain/module boundary;
- persistence technology or data ownership;
- authentication/authorization model;
- public API/event/schema contract;
- queue/job infrastructure;
- sensitive-data handling;
- an important third-party dependency;
- a breaking or destructive migration;
- a deliberate exception to these guidelines.

An ADR MUST contain context, decision, alternatives, consequences, security/privacy impact, migration/rollback considerations, owner, date, and status.

Small local implementation choices do not need ADRs.

### 2.3 Design documents

A focused design document is REQUIRED before implementation when a change:

- crosses multiple bounded contexts;
- changes an authoritative data model or calculation policy;
- introduces concurrency, asynchronous delivery, or distributed failure modes;
- affects tenancy, authentication, deletion, privacy, or billing;
- requires a risky migration;
- materially changes a critical user journey;
- cannot be safely understood in the pull-request description.

Do not create a separate PRD for every class, algorithm, cache, or endpoint. One design document may cover a coherent mechanism and its contracts.

### 2.4 Living documentation

- Documentation MUST change in the same review as the behavior it describes.
- Generated API/schema documentation SHOULD come from source definitions.
- Operational components MUST have concise runbooks covering symptoms, diagnosis, mitigation, rollback, and escalation.
- Screens and component states SHOULD be maintained in Storybook or an equivalent executable catalog; static screenshots are supplemental.
- Stale documents MUST be corrected or clearly marked obsolete.

## 3. Repository and architecture rules

### 3.1 Architecture baseline

- Start as the modular monolith defined in `docs/03_SYSTEM_ARCHITECTURE.md`.
- Domain modules MUST communicate through explicit commands, queries, and versioned events/contracts.
- A module MUST NOT write another module's owned tables directly.
- Postgres is the initial authoritative datastore; graph structure is represented relationally unless evidence proves that inadequate.
- The UI renderer is a projection, never the domain model.

### 3.2 Repository layout

The exact framework-specific layout is selected in Phase 0 and recorded in an ADR. Regardless of framework, the repository MUST clearly separate:

```text
project-root/
  src/ or apps/               product code
    modules/                  bounded-context/domain modules
    ui/                       user-interface projections
    shared/                   deliberately small cross-cutting code
  db/ or supabase/            migrations, policies, and database tests
  tests/                      integration, contract, E2E, security, performance
  schemas/                    Preparation Pack and external contract schemas
  prompts/                    versioned Prompt Library definitions
  docs/                       product, architecture, ADRs, runbooks
  scripts/                    repeatable developer and operational tasks
  .github/workflows/          CI/CD when GitHub is used
```

Do not force Python package files, notebooks, `uv`, an SDK directory, or `__init__.py` into a non-Python stack.

### 3.3 Dependency direction

- Domain logic MUST NOT depend on UI frameworks or provider SDKs.
- Infrastructure/provider adapters depend on domain-owned interfaces, not the reverse.
- Shared code MUST represent a genuinely shared stable concept; it MUST NOT become a dumping ground.
- Cyclic module dependencies are prohibited.

### 3.4 Public interfaces

Business capabilities need clear module/application interfaces, but a universal SDK facade is not mandatory.

Create an SDK only when an actual external or multi-client consumer requires a supported programmatic interface. UI, background jobs, and API handlers MUST remain thin and delegate authoritative behavior to application/domain services.

## 4. Change workflow for humans and agents

For every non-trivial task:

1. Read `docs/README.md`, this file, and the documents relevant to the change.
2. Inspect current code, tests, migrations, repository instructions, and uncommitted changes.
3. Restate the intended outcome, constraints, acceptance criteria, and unknowns.
4. Create or update a short execution plan.
5. Implement the smallest coherent vertical change.
6. Add or update risk-appropriate tests in the same change.
7. Run the required validation suite.
8. Self-review the complete diff for correctness, simplicity, security, privacy, accessibility, operations, and documentation.
9. Report exactly what changed, what was verified, and what remains unresolved.

Agents MUST NOT:

- claim that a test, build, migration, deployment, or manual check passed when it was not run;
- overwrite unrelated user changes;
- perform destructive data or Git operations without explicit authorization and a recoverable plan;
- change product semantics merely to make implementation easier;
- add dependencies, services, abstractions, or scope without explaining the need;
- hide uncertainty or silently invent missing requirements;
- use generated output as evidence that the product works.

## 5. Change and review standards

### 5.1 Small, coherent changes

- Each pull request/change list SHOULD implement one coherent outcome.
- Related tests and documentation belong in the same change.
- Refactoring SHOULD be separated from behavior changes when separation makes review safer.
- Every intermediate merged change MUST keep the build and supported workflows usable.
- There is no universal file or pull-request line limit. Cohesion, cognitive load, risk, and reviewability determine size.
- A large human-written diff MUST explain why it cannot be safely split and how it will be reviewed.

### 5.2 Required change description

Every material change MUST state:

- problem and intended user/system outcome;
- scope and explicit non-scope;
- design summary and affected modules/contracts;
- test evidence;
- security/privacy/data impact;
- migration and rollback/roll-forward plan when applicable;
- screenshots or recordings for meaningful UI changes;
- remaining risks or follow-ups.

### 5.3 Review requirements

Reviewers inspect:

- design and product correctness;
- user-visible behavior and failure states;
- unnecessary complexity and speculative generalization;
- domain ownership and dependency direction;
- data integrity, migrations, and backward compatibility;
- authorization, privacy, injection, secrets, and supply-chain risk;
- concurrency, retries, idempotency, and partial failure;
- test validity, not merely test existence;
- accessibility, localization readiness, and motion behavior;
- observability, operability, and rollback safety;
- documentation and naming.

For a solo project, an independent AI review MAY provide a second pass, but the product owner MUST approve high-risk changes involving authentication, RLS, destructive migration, user-data deletion, production credentials, or release configuration.

## 6. Code quality

### 6.1 Readability and cohesion

- Names MUST express domain meaning.
- Functions and modules SHOULD have one coherent responsibility and explicit inputs/outputs.
- Comments explain rationale, invariants, non-obvious trade-offs, or external constraints—not a line-by-line translation of code.
- Public or complex interfaces require documentation; trivial private functions do not require ceremonial docstrings.
- Dead code, commented-out implementations, placeholder branches, and unexplained TODOs MUST NOT enter the main branch.

### 6.2 Complexity and reuse

- Prefer composition and plain functions/modules over inheritance and mixins.
- Duplication may be temporarily clearer than a premature abstraction. Extract shared behavior when the concept and variation points are understood.
- Patterns are tools, not requirements. Do not implement a plugin system, base-class hierarchy, repository abstraction, or generic event framework without a present use case.
- A long file is a review signal, not an automatic defect. Split when responsibilities, ownership, testing, or navigation improve—not to satisfy an arbitrary line count.

### 6.3 Errors

- Domain errors MUST be typed/structured and distinguish validation, authorization, conflict, transient dependency, and internal failure.
- User-facing messages MUST be actionable and MUST NOT reveal secrets or internal stack traces.
- Do not catch an error unless the code can add context, translate it, retry safely, compensate, or terminate cleanly.
- Never silently swallow an error.

### 6.4 Tooling

- One canonical formatter, linter, type checker, and package manager is selected per language and enforced in CI.
- Lockfiles MUST be committed for reproducible application builds.
- Python MAY use `uv`; JavaScript/TypeScript MAY use the package manager selected in the Phase 0 ADR. No tool is mandated before the stack is chosen.
- Warnings introduced by a change MUST be fixed or explicitly justified.

## 7. Configuration, secrets, and dependencies

### 7.1 Configuration

- Environment-specific values and secrets MUST be outside source control.
- Stable domain constants, enums, safe defaults, and mathematical constants MAY live in code.
- Configuration MUST be typed/schema-validated at startup and fail with an actionable error.
- A sample environment file MUST contain placeholders only.
- Configuration formats require explicit schema/versioning only when compatibility across versions matters; Git already versions ordinary files.

### 7.2 Secrets

- Secrets MUST NOT appear in source, fixtures, logs, screenshots, prompts, analytics, or client bundles.
- Production secrets MUST use a managed secret store and least-privilege access.
- Secret scanning MUST run before merge and in CI.
- Suspected exposure triggers immediate revocation/rotation; deleting the Git line is insufficient.

### 7.3 Dependencies and supply chain

- Add a dependency only after reviewing maintenance, license, security posture, bundle/runtime cost, and exit cost.
- Pin/lock resolved versions and automate vulnerability/update reporting.
- Production builds SHOULD be reproducible and produce provenance/SBOM information when deployment begins.
- Critical provider behavior MUST be wrapped behind a project-owned adapter and contract tests.

## 8. API, integration, and asynchronous work

### 8.1 External clients

Each external provider SHOULD have a centralized project-owned client/adapter handling applicable concerns:

- authentication;
- explicit connection and request timeouts;
- response/schema validation;
- rate limits and provider quotas;
- bounded retries with exponential backoff and jitter;
- idempotency and deduplication;
- metrics and safe structured logs;
- circuit breaking or graceful degradation when justified.

A single global `ApiGatekeeper` for unrelated providers is not mandatory. Requests MUST NOT be placed into an unbounded queue. When capacity is exhausted, use bounded queues, backpressure, prioritization, expiration, and a visible failure/degraded state.

### 8.2 API and event contracts

- Contracts MUST be versioned when independently deployed consumers exist.
- Breaking changes require migration strategy and consumer coordination.
- APIs use explicit authentication/authorization, validation, pagination for unbounded collections, stable error shapes, and correlation IDs.
- Retries are allowed only when the operation is idempotent or protected by an idempotency key.
- Event consumers MUST handle duplicates, late delivery, and safe reprocessing.
- Inbox/outbox processing MUST expose lag, failures, retries, and dead letters.

### 8.3 Provider independence

- Manual workflows remain supported as specified in the product documents.
- No unofficial LeetCode scraping/private API is allowed.
- Provider outage MUST NOT corrupt evidence or block unrelated core workflows.

## 9. Data engineering and migrations

### 9.1 Ownership and integrity

- Tables and write paths MUST have explicit module ownership.
- Database constraints enforce invariants that must hold regardless of application code.
- Important commands, evidence imports, and outbox writes MUST be transactional.
- Timestamps, identifiers, tenancy, provenance, and calculation versions follow `docs/01_DOMAIN_MODEL.md`.

### 9.2 Multi-tenancy

- Every user/workspace-owned row MUST have explicit ownership.
- Supabase-exposed tables MUST have Row Level Security enabled before user data is stored.
- RLS policies require positive and negative cross-tenant tests.
- Service/secret keys that bypass RLS MUST remain on controlled backend infrastructure.

### 9.3 Migrations

- Migrations are immutable after shared application.
- Forward and backward compatibility MUST be considered for rolling deployments.
- Prefer expand → migrate/backfill → contract for schema or data-format changes.
- Destructive changes require verified backup/restore, impact analysis, explicit approval, and a roll-forward/rollback plan.
- Backfills MUST be resumable, observable, idempotent, bounded, and safe under concurrent traffic.
- Production-like upgrade/downgrade paths SHOULD be tested for high-risk changes.

### 9.4 Privacy and lifecycle

- Classify personal and sensitive fields before production use.
- Define retention, export, correction, and deletion behavior before public launch.
- Logs and analytics MUST minimize or redact personal content.
- Deletion across authoritative data, projections, provider links, and backups requires a documented lifecycle.

## 10. Testing strategy

### 10.1 Risk-based test portfolio

Tests MUST match failure risk:

- unit tests for deterministic rules and transformations;
- property-based tests for DAG invariants, idempotency, scheduler merging, overlay upgrades, and calculation boundaries;
- integration tests against a real local/test Postgres or equivalent for transactions, migrations, and RLS;
- contract tests for providers, events, schemas, and Preparation Packs;
- end-to-end tests for critical user journeys;
- accessibility and keyboard tests;
- visual regression for important component states;
- performance tests using representative graph and event datasets;
- security tests for authorization, tenant isolation, validation, and malicious imports.

Do not mock all external dependencies by default. Prefer realistic fakes, local emulators, test containers, and contract tests. Mock narrow boundaries only when the real dependency is unsafe, nondeterministic, expensive, or unavailable.

### 10.2 Product-critical test requirements

The following require focused automated tests before release:

- append-only evidence and correction semantics;
- mastery/readiness versioning and mandatory floors;
- `Unknown`, stale, and confidence behavior;
- planner ranking explanations and campaign/base-plan interaction;
- unified-review deduplication;
- template/overlay three-way merge;
- import rejection for malformed, hostile, or hallucinated Preparation Packs;
- inbox/outbox idempotency and delayed/duplicate events;
- RLS and authorization across tenants;
- destructive or compatibility-sensitive migrations.

### 10.3 Coverage

Coverage is a guardrail, not proof of correctness.

- CI MUST publish line and branch coverage.
- Changed production code SHOULD maintain at least 85% line and 80% branch coverage.
- Critical deterministic engines, authorization/RLS helpers, and import validation SHOULD maintain at least 90% branch coverage plus invariant/property tests.
- Generated code and declarative styling may be excluded only in documented configuration.
- A lower threshold requires an explicit review note explaining risk and compensating verification.
- Coverage MUST NOT be raised with meaningless assertions or implementation-coupled tests.

### 10.4 Test quality

- Tests assert externally meaningful behavior and failure modes.
- Tests MUST be deterministic, isolated, and parallel-safe where the suite runs in parallel.
- Flaky tests are defects: fix, quarantine with owner/deadline, or remove if invalid.
- Tests MUST demonstrate they fail for the intended broken behavior when practical.
- Test data MUST contain no production secrets or personal data.

## 11. Security engineering

### 11.1 Secure development baseline

- Use NIST SSDF as lifecycle guidance and OWASP ASVS as the web-control verification baseline.
- Threat-model authentication, authorization, RLS, file/URL import, AI pack ingestion, provider tokens, admin operations, and data export/deletion.
- Validate input at trust boundaries and encode output for its destination.
- Use framework protections for CSRF, XSS, injection, session security, and secure headers.
- Apply least privilege to database roles, service accounts, CI, storage, and provider scopes.
- Sensitive actions require audit records and appropriate re-authentication/confirmation.

### 11.2 Automated security gates

CI SHOULD include:

- secret scanning;
- dependency vulnerability and license checks;
- static analysis appropriate to the stack;
- schema/migration and RLS tests;
- build artifact integrity checks;
- container/IaC scanning when those artifacts exist.

Critical exploitable findings block release. Exceptions require owner, rationale, mitigation, expiry date, and tracking issue.

### 11.3 AI and imported-content security

- Model output is untrusted data, never an authorized command.
- Preparation Packs MUST pass versioned schema validation, semantic validation, provenance checks, idempotency checks, diff preview, and user confirmation.
- Imported content cannot create completed evidence, `Verified`, `Mastered`, readiness truth, canonical graph mutations, executable code, or privileged configuration.
- Prompts MUST NOT contain provider secrets or unrestricted user/database dumps.
- URL metadata retrieval MUST defend against SSRF, unsafe redirects, excessive payloads, and unsupported schemes.

## 12. UX, accessibility, and design system

- Target WCAG 2.2 AA for supported user journeys.
- All core actions MUST work by keyboard.
- Status MUST NOT rely on color alone.
- Focus visibility, target size, labels, error association, and screen-reader semantics require automated plus manual verification.
- Drag interactions MUST have a non-drag alternative.
- Respect system reduced-motion preferences and the product's `Full / Reduced / Off` modes.
- Loading, empty, stale, offline/retry, partial failure, provider outage, AI unavailable, and permission-denied states are part of feature acceptance.
- Design tokens, component states, interaction contracts, motion tokens, and accessibility rules live in the repository—not in an agent prompt.
- Meaningful UI changes require responsive checks and representative screenshots/recordings in review.

## 13. Performance and capacity

- Define performance budgets for critical journeys and representative datasets before performance is called acceptable.
- Measure before optimizing; do not add caching, concurrency, denormalization, or infrastructure from intuition alone.
- Track percentiles and user-visible latency, not averages alone.
- Graph tests MUST distinguish total catalog size from visible rendered subgraph size.
- Background work MUST have bounded concurrency, timeouts, cancellation/expiry behavior, and resource limits.
- Capacity claims such as “supports millions of users” require a workload model, test method, observed results, bottleneck analysis, and safety margin.
- Cost analysis uses current provider pricing, dated assumptions, formulas, and low/base/high scenarios. Fabricated model names, token counts, or prices are prohibited.

## 14. Observability, reliability, and incidents

### 14.1 Observability

Production-capable paths MUST provide enough telemetry to answer:

- Is the user journey succeeding?
- Which dependency or component is failing?
- What changed recently?
- Who/what is affected?
- Can the operation be retried or repaired safely?

Use structured logs, metrics, traces where useful, correlation IDs, projection lag, queue depth, job failures, provider freshness, and calculation versions. Never log secrets or unnecessarily log user content.

### 14.2 SLOs and alerts

- Define SLIs/SLOs for critical user journeys only when production expectations and measurement points are understood.
- Early targets MUST be labeled provisional.
- Alerts SHOULD represent actionable user impact or imminent error-budget risk, not ordinary debug conditions.
- Every production alert needs an owner and runbook.
- Error-budget policy MAY control release velocity after real production data exists; it MUST NOT be fabricated for an MVP without telemetry.

### 14.3 Incidents

- Significant incidents require timeline, impact, contributing factors, detection/response analysis, recovery, and owned corrective actions.
- Postmortems are blameless and focus on system/process improvement.
- Repeated incidents, failed restores, security events, or large error-budget consumption escalate priority over feature work.

## 15. CI/CD and release engineering

### 15.1 Continuous integration

The main branch MUST be protected by the stack-appropriate subset of:

- formatting/linting;
- type checking;
- unit, property, integration, contract, and selected E2E tests;
- schema and migration validation;
- RLS/authorization tests;
- accessibility checks;
- security/dependency/secret checks;
- production build;
- coverage thresholds;
- documentation/link/schema checks.

No release is created from a revision with required checks failing.

### 15.2 Deployment safety

- Build artifacts MUST be immutable and traceable to source revision.
- Deployments SHOULD be automated and use preview/staging environments as the product matures.
- Risky changes SHOULD use feature flags, staged/canary rollout, health evaluation, and automatic/manual rollback criteria.
- Database and contract changes MUST tolerate mixed versions during rollout when rolling deployment is used.
- Every release needs a tested rollback or roll-forward strategy; destructive data changes cannot rely on application rollback alone.
- Post-deployment smoke checks validate critical user journeys and migration health.

### 15.3 Versioning

- Git is the source history; do not duplicate a `1.00` version constant across every code/config file.
- Use semantic versions for externally consumed releases/contracts when compatibility promises exist.
- Database migrations, schemas, events, prompts, templates, profiles, and calculation policies retain their own compatibility versions because old data/consumers may remain.

## 16. Agent-specific execution contract

An implementation agent MUST begin by stating which phase/acceptance criterion it is advancing. It MUST keep a live plan for multi-step work and keep no more than one step in progress.

Before editing, the agent MUST:

- inspect repository instructions and relevant source/tests;
- check for existing user changes;
- identify authoritative module ownership;
- resolve unstable external facts using primary sources;
- surface any permission, security, legal, or product-semantic blocker.

During implementation, the agent MUST:

- make minimal, reviewable changes;
- use existing patterns unless an approved change improves them;
- preserve backward compatibility or document the transition;
- update tests and docs with behavior;
- avoid destructive commands and broad rewrites;
- validate generated files and schema outputs.

At handoff, the agent MUST report:

- outcome and affected files/modules;
- tests/checks actually run and their results;
- migrations/configuration/manual steps;
- known limitations and risks;
- the next smallest safe step.

## 17. Stop-the-line conditions

An agent or developer MUST stop the requested implementation and escalate when:

- product documents conflict on a material semantic rule;
- a change would destroy or rewrite evidence/history without an approved migration;
- RLS/authorization is absent for exposed user-owned data;
- a destructive migration lacks backup/restore and explicit approval;
- a credential or sensitive user data may have been exposed;
- an integration appears to require prohibited scraping or terms violation;
- required tests reveal data corruption, cross-tenant access, or non-idempotent retries;
- release health cannot be observed or safely rolled forward/back for the risk involved;
- the requested action exceeds current authorization.

## 18. Definition of Done

A feature is done only when all applicable items are true:

- [ ] User outcome and acceptance criteria are satisfied.
- [ ] Product semantics match the canonical documents.
- [ ] Design/ADR exists if triggered by Sections 2.2–2.3.
- [ ] Code is cohesive, readable, typed where supported, and free of speculative abstractions.
- [ ] Relevant automated tests cover success, failure, boundaries, and invariants.
- [ ] Required CI checks pass.
- [ ] Authorization, RLS, privacy, secret, and input-trust boundaries are verified.
- [ ] Migrations are compatible, tested, observable, and recoverable.
- [ ] Loading, empty, stale, degraded, and error states are implemented.
- [ ] Keyboard, reduced-motion, responsive, and accessibility requirements pass.
- [ ] Logs/metrics/runbooks are sufficient for the release stage.
- [ ] Rollback or roll-forward behavior is documented and feasible.
- [ ] Documentation, schemas, prompts, and contracts are updated.
- [ ] No unresolved critical/high security issue or silent test failure remains.
- [ ] The handoff states exactly what was verified and what was not.

## 19. Deliberate changes from the uploaded generic guideline

The following original rules were removed or replaced because they are not universally professional and can harm this product:

| Removed/replaced rule | New rule |
|---|---|
| Every code/test file ≤150 lines | Split by cohesion and reviewability; no arbitrary universal line cap. |
| Mandatory SDK for all business logic | Explicit module/application interfaces; SDK only for real external consumers. |
| Mandatory OOP, inheritance, and mixins | Prefer the simplest paradigm; composition/functions before inheritance. |
| Separate PRD for every mechanism | ADR/design document only when risk, scope, or irreversibility warrants it. |
| Full documentation approval before any code | Right-sized design first; small reversible experiments/prototypes are allowed and labeled. |
| Universal strict TDD | Tests accompany behavior; test-first is encouraged where it improves design, not performed ceremonially. |
| Mock every external dependency | Realistic integration/contract tests plus narrow mocks where justified. |
| Fixed 85% coverage proves quality | Risk-based coverage thresholds plus property, integration, security, and E2E tests. |
| One global API gatekeeper and FIFO overflow | Provider-owned adapters, bounded retry/queues, backpressure, priority, and degradation. |
| Every value externalized to config | Externalize environment/operational settings; keep stable domain constants and safe defaults in code. |
| Version `1.00` duplicated everywhere | Git history plus semantic/contract versions only where compatibility matters. |
| `uv` mandatory for every project | One stack-appropriate package manager and committed lockfile. |
| Research notebooks/sensitivity analysis mandatory | Required only for research, calibration, or data-science questions that benefit from them. |
| Plugin architecture mandatory | Extension points only after a real second implementation/use case appears. |
| Token-cost tables with example numbers | Use dated primary pricing and explicit calculations; never fabricate values. |

## 20. Public references

These sources informed the standard; repository rules above remain the normative requirements for this product.

1. [Google Engineering Practices — Code Review](https://google.github.io/eng-practices/review/)
2. [Google Engineering Practices — Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)
3. [Google Engineering Practices — What to Look For](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
4. [Google SRE — Release Engineering](https://sre.google/sre-book/release-engineering/)
5. [Google SRE Workbook — Monitoring](https://sre.google/workbook/monitoring/)
6. [Google SRE Workbook — Error Budget Policy](https://sre.google/workbook/error-budget-policy/)
7. [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/userguide/waf.html)
8. [Amazon Builders' Library — Ensuring Rollback Safety During Deployments](https://aws.amazon.com/builders-library/ensuring-rollback-safety-during-deployments/)
9. [Amazon Builders' Library — Automating Safe, Hands-Off Deployments](https://aws.amazon.com/builders-library/automating-safe-hands-off-deployments/)
10. [NIST SP 800-218 — Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
11. [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
12. [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
13. [Semantic Versioning 2.0.0](https://semver.org/)
14. [RFC 2119 — Requirement Keywords](https://www.rfc-editor.org/rfc/rfc2119)
