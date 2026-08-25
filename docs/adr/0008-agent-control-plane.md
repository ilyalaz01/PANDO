# ADR-0008 — External Agent Control Plane

Status: Accepted
Date: 2026-08-25
Owner: PANDO product owner

## Context

PANDO must be convenient to operate through short typed or voice instructions in ChatGPT Work or Codex. A user should be able to say that an interview disappeared, a university or specialty changed, a new country is being considered, or a deadline is three months away, then receive an accurate explanation and a safe replan.

The repository can help an agent understand product architecture, but repository visibility is not a live-state or authorization boundary. Copying personal plan state into Git would create privacy, staleness, conflict, and correctness problems. Direct model access to tables would bypass domain ownership, RLS, idempotency, outbox behavior, audit, and UI parity.

The operating budget is USD 10 per month. PANDO therefore cannot require its own paid inference provider.

## Decision

### External client, not embedded model

ChatGPT Work, Codex, voice, the browser UI, and future clients use the same PANDO application boundary. The external client interprets natural language; PANDO exposes deterministic reads, previews, and commands. PANDO stores no external conversation transcript and calls no LLM for this workflow.

This decision does not supersede ADR-0007. An embedded provider remains deferred and optional.

### Layered read context

Add a versioned `AgentControlContextV1` read projection:

- the root summary is capped at 12 KiB serialized JSON;
- it includes stable identifiers, aggregate versions, projection watermark, active goals/campaign, tracks, deadlines, capacity, protected minima, blockers, unknown/stale counts, and near-term actions;
- it links to narrowly scoped detail resources for one goal, track, campaign, target, explanation, or evidence summary;
- it supports ETag and `changed_since` refresh;
- it excludes raw evidence bodies, notes, secrets, provider payloads, unrelated history, and unrestricted database rows.

The context is rebuildable and never authoritative.

### Preview, confirm, apply

Every persisted agent change is a `PlanChangeSet` containing semantic operations owned by the relevant bounded contexts. A deterministic preview reports before/after meaning, Today/capacity impact, retained history, warnings, material unknowns, expected aggregate versions, and base watermark.

Confirmation is bound to the exact preview digest and expiry. `ApplyPlanChangeSet` verifies the OAuth user, workspace membership, confirmation, expected versions, watermark, and idempotency key, then applies all owning-context commands, the plan revision, command receipt, and outbox events atomically. A stale, expired, unauthorized, or partially invalid proposal applies nothing.

MVP agent operations preserve history through lifecycle transitions such as pause, resume, complete, end, cancel, archive, and supersede. Destructive deletion is not exposed.

### Tool and transport boundary

Provide focused read and proposal tools, with a single confirmed apply tool:

- reads: `get_control_summary`, `get_goal_context`, `explain_today`, `get_change_status`;
- proposals: `preview_create_goal`, `preview_change_goal`, `preview_close_goal`, `preview_change_set`;
- mutation: `apply_change_set`.

The hosted adapter uses Streamable HTTP MCP with OAuth 2.1 user authorization. A local PANDO CLI adapter lets Codex call the same hosted application services. Neither surface accepts arbitrary SQL, table names, file paths, event bodies, or caller-selected workspace authority.

Voice is an input mode of the connected client. It receives no extra permissions and follows the same preview and confirmation contract.

### Repository orientation and Graphify

The accepted module owners, interaction forms, and task reading routes are recorded in
[ADR-0009](0009-module-topology-and-projection-ownership.md) and the
[module topology](../design/MODULE_TOPOLOGY.md).

The repository contains `AGENTS.md`, project-local skills, schemas, fixtures, and a Graphify map so coding agents can navigate with low context cost. Graphify is pinned and run with a secret-safe ignore policy. Generated graph data:

- is derived from repository code and approved documentation only;
- is regenerable and may be stale;
- is not the competency DAG, GraphProjection UI contract, Agent Control context, or live user state;
- cannot authorize or apply a product change;
- must be verified against authoritative source files before edits.

No Graphify hook is installed automatically. Refresh is an explicit command or CI check.

### Preparation Pack boundary

Preparation Pack remains the browser-uploaded bulk-authoring format for substantial new profiles or initial/reworked plans. It is not used for small live operations. Both flows eventually reach the same previewed domain command boundary.

## Alternatives considered

- Store live plan files in the repository: rejected for privacy, staleness, merge conflicts, and bypass of domain invariants.
- Give an agent direct Supabase/table access: rejected because it bypasses RLS-safe application commands, ownership, audit, and outbox atomicity.
- Use Graphify as the live state graph: rejected because it indexes repository artifacts and is neither transactional nor user-authorized.
- Build an in-app LLM first: rejected for cost, retention, provider dependency, and duplicated control behavior.
- Use only Preparation Packs: rejected because regenerating files is too heavy for ordinary changes and cannot provide efficient conversational reads.
- Expose one generic mutation tool: rejected because broad payloads are harder to authorize, confirm, test, and explain.

## Consequences

- Short natural-language and voice interactions become practical without a PANDO inference bill.
- UI and agent behavior cannot drift because both call the same application commands.
- A compact read projection and selective expansion reduce token usage without hiding versions or uncertainty.
- MCP/OAuth and command contracts become required release work.
- The repository graph improves development navigation but does not solve live-state retrieval.
- Multi-operation changes require a deliberate atomic coordinator and versioned audit model.

## Security and privacy

OAuth subject and server-side membership resolve the workspace; a model-provided workspace identifier never grants access. Read and write tools have separate scopes. Ordinary commands never use the Supabase service role. Cross-workspace negative tests, preview-digest binding, expiry, optimistic concurrency, idempotency, rate limits, and audit metadata are mandatory.

Skills, Graphify output, logs, previews, and telemetry contain no tokens, secrets, raw evidence bodies, private notes, production exports, or external conversation transcripts. Tool descriptions and error messages avoid leaking whether a foreign identifier exists.

## Migration and rollback

The Agent Control adapter is additive. Disabling MCP or revoking its OAuth client leaves the manual UI and Preparation Pack flow fully functional. Read projections can be rebuilt. Unapplied or expired change sets may be removed by retention policy; applied plan revisions and domain history remain.

A future transport may replace MCP or the local CLI without changing `AgentControlContextV1`, ChangeSet semantics, or owning-context commands. A future embedded model must use the same contracts and separately satisfy ADR-0007.

## References

- [OpenAI: MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: define focused tools](https://developers.openai.com/plugins/plan/tools)
- [OpenAI: MCP authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: plugin skills](https://developers.openai.com/plugins/concepts/skills)
- [OpenAI: Voice](https://learn.chatgpt.com/docs/features/voice)
- [Graphify](https://github.com/Graphify-Labs/graphify) — third-party repository mapping tool
