# PANDO — Phase 0 Technical Baseline

Status: Accepted  
Date: 2026-08-25  
Owner: PANDO product owner

This is a supporting implementation record. The nine canonical documents retain precedence.

## 1. Decision summary

| Area | Phase 0 decision | Record |
|---|---|---|
| Application | Next.js 16 App Router, React, strict TypeScript, Node.js 24 LTS, pnpm 11 | [ADR-0001](adr/0001-runtime-hosting-and-toolchain.md) |
| Hosting | Vercel Hobby for the personal non-commercial web app; Supabase Free for data services; Cloudflare R2 Standard for encrypted off-site backups | [ADR-0001](adr/0001-runtime-hosting-and-toolchain.md) |
| Auth and tenancy | Invite-only Supabase Auth, workspace membership in Postgres, RLS on every workspace-owned table | [ADR-0002](adr/0002-auth-data-access-and-tenancy.md) |
| Data access | Browser uses Supabase directly only for authentication. Domain reads and commands enter through the PANDO server boundary and purpose-specific API functions. | [ADR-0002](adr/0002-auth-data-access-and-tenancy.md) |
| Transactions and jobs | State mutation, command receipt, and outbox append occur in one Postgres RPC transaction. Postgres is the queue. | [ADR-0003](adr/0003-commands-outbox-and-jobs.md) |
| Graph | React Flow, deterministic Dagre layout, server-owned semantic projection, client-owned viewport state | [ADR-0004](adr/0004-graph-layout-and-query-boundary.md) |
| Preparation Pack | Strict JSON Schema plus semantic validation, bounded ZIP ingestion, private content-addressed Supabase Storage | [ADR-0005](adr/0005-preparation-pack-ingestion.md) |
| Calculations | Pure deterministic engines with versioned policy, explicit clock, watermarks, explanations, and stored snapshots | [ADR-0006](adr/0006-calculation-and-review-engines.md) |
| Mastery/readiness | Transparent ordinal levels and readiness intervals; Unknown never becomes zero | [Mastery policy](policies/MASTERY_READINESS_POLICY_V0.1.md) |
| Review | Table-driven scheduler; no FSRS in MVP | [Review policy](policies/REVIEW_POLICY_V0.1.md) |
| AI and PyPrep | No embedded AI or conversation retention in MVP; PyPrep is always an integration boundary | [ADR-0007](adr/0007-ai-and-pyprep-boundaries.md) |
| Agent Control | External ChatGPT Work/Codex clients over compact read resources and preview/confirm/apply ChangeSets; OAuth user scope; same commands as UI. Graphify is repository orientation only. | [ADR-0008](adr/0008-agent-control-plane.md) |

## 2. Repository shape

The first implementation chat creates a single-package modular monolith:

    src/
      app/
      modules/
        identity/
        catalog/
        targets/
        overlay/
        sessions/
        evidence/
        mastery/
        review/
        planning/
        integrations/
      shared/
      ui/
    supabase/
      migrations/
      seed.sql
      tests/
    schemas/
      events/v1/
      preparation-pack/v1/
    prompts/
    tests/
      contract/
      e2e/
      fixtures/
      performance/

Each module separates domain, application, and infrastructure concerns. Cross-module writes occur only through commands and versioned events. No monorepo, microservice, graph database, Redis, or ORM is introduced in Phase 0.

## 3. Cost envelope

Expected recurring infrastructure cost for the current single-user, personal, non-commercial MVP is USD 0 per month:

- Vercel Hobby: USD 0, subject to personal/non-commercial terms and platform limits;
- Supabase Free: USD 0, subject to database, storage, egress, function, inactivity, backup, and support limits;
- Cloudflare R2 Standard: expected USD 0 while encrypted backups stay inside its current monthly free allowance;
- GitHub repository and CI within the applicable free allowance;
- embedded AI and PANDO inference usage: USD 0 because language interpretation stays in the user's external ChatGPT Work/Codex session.

The product must show no availability promise while it runs on free tiers. Supabase Free can pause inactive projects and does not provide production-grade automatic backup or SLA. Cloudflare R2 Standard is the selected off-site destination for client-side-encrypted logical dumps and storage manifests. Before storing irreplaceable personal evidence, Phase 0 must provide the backup command, retention policy, secret recovery procedure, and a tested restore.

Budget guardrails:

- no paid service may be enabled without a superseding decision;
- warning at 350 MB Postgres usage and mandatory capacity review at 425 MB;
- Preparation Pack retention quota: 20 accepted packs or 50 MB per workspace, whichever arrives first;
- migrate away from Vercel Hobby before public commercial use;
- consider a persistent Node host only when measured serverless limits, not preference, justify its monthly cost.

## 4. Quality gates

Phase 0 does not exit until:

1. a clean checkout can start locally with one documented command and run tests with one documented command;
2. migrations rebuild the database from empty state;
3. two test identities prove positive and negative RLS isolation;
4. an injected failure between authoritative mutation and outbox append leaves neither committed;
5. duplicate commands and deliveries are idempotent;
6. an expired lease is reclaimed and a permanent failure reaches dead letter state;
7. a representative 25-node graph is keyboard accessible, stable across reloads, and meets the graph budget;
8. a valid and malicious Preparation Pack fixture exercise both schema and semantic validation;
9. mastery, readiness, and review golden fixtures are deterministic under an explicit clock;
10. an encrypted dump restores into a clean local database.
11. Agent Control context/change-set schemas and project skills validate; the root context fixture is at most 12 KiB; repository indexing excludes secrets, user exports, generated state, and production data.

Initial measurable budgets:

- Core Web Vitals at p75: LCP at most 2.5 s, INP at most 200 ms, CLS at most 0.1;
- warm Today and Review API p95 at most 500 ms;
- projection catch-up p95 at most 2 s;
- 25-node graph projection and layout p95 at most 250 ms and compressed payload at most 150 KB;
- Preparation Pack validation p95 at most 2 s, hard timeout 5 s;
- zero known WCAG 2.2 A/AA violations and zero serious or critical automated accessibility findings.

These are provisional engineering budgets, not product promises. Change them only from measured fixtures and record the reason.

## 5. Delivery lanes

Use a separate Codex Project task for each distinct outcome:

1. Foundation and executable skeleton.
2. Database contracts, tenancy, and outbox.
3. Catalog, Targets, overlay, and graph vertical slice.
4. Sessions, evidence, and calculation engines.
5. Review, readiness, planning, and Today.
6. Agent Control, Preparation Pack, and external integration contracts.
7. Release hardening, accessibility, performance, backup, and operations.

Only lanes with disjoint files and no unmet dependency run in parallel. Write-heavy work uses Git worktrees and separate branches. The main task owns architectural decisions, integration order, and final verification.

## 6. Decision review triggers

Review the baseline when any of the following occurs:

- public or commercial launch;
- more than one real workspace;
- a server request cannot complete within the documented budget;
- outbox catch-up p95 exceeds 30 seconds or a handler needs more than 20 seconds;
- graph fixtures exceed 500 total nodes, 150 rendered nodes, or 250 KB compressed;
- Postgres exceeds 350 MB or pack storage exceeds 70 percent of its allowance;
- a live PyPrep source becomes available;
- an embedded AI feature has a named user outcome, consent model, retention policy, monthly cap, and non-AI fallback.

## 7. Sources checked for Phase 0

- [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel limits](https://vercel.com/docs/limits)
- [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility)
- [React Flow layouting](https://reactflow.dev/learn/layouting/layouting)
- [JSON Schema specification](https://json-schema.org/specification)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI plugin skills](https://developers.openai.com/plugins/concepts/skills)
- [OpenAI Voice](https://learn.chatgpt.com/docs/features/voice)
- [Graphify](https://github.com/Graphify-Labs/graphify) — third-party repository orientation tool, pinned by project policy
