# ExploreTargetContextV1 server query contract

`ExploreTargetContextV1` is the strict, authenticated, server-only DTO that supplies exact Target
requirements and the bounded Catalog/User Overlay node closure for one persisted Readiness Goal.
The public `api.get_explore_target_context_v1(goal_key)` RPC accepts no workspace, profile, catalog,
or roadmap identifier. Identity derives the current personal workspace; Targets resolves the goal
and immutable profile/rule tree; Catalog resolves the roadmap plus required prerequisite/domain
closure; User Overlay resolves only required accepted personal competencies.

This contract is deliberately separate from `ExploreSourceV1`. It adds the missing target scope and
requirement semantics without changing the existing structural snapshot. It is still **not** a
complete `GraphProjectionV1` input: live Explore must additionally receive versioned Mastery
projections, a Targets-owned readiness result with the same watermark, and an explicit clock.
Until those owners exist, `/explore` correlates both owner DTOs into the strict
[`ExploreStructuralProjectionV1`](../../explore-structural-projection/v1/README.md). That response
contains exact structure and requirement definitions but no fabricated Mastery/readiness state.

## Deterministic closure

The canonical closure is:

1. exact roadmap membership, when the profile has a roadmap;
2. every canonical node directly referenced by a target requirement;
3. every transitive incoming `PREREQUISITE_OF` ancestor of those nodes;
4. the domain parent of every included competency.

Required nodes are never hidden because a roadmap omitted them. A null roadmap produces the
requirement/prerequisite/domain closure only. Canonical nodes and relevant prerequisite edges carry
the descriptions and rationales that `ExploreSourceV1` intentionally does not expose. Required
workspace-overlay nodes must still be accepted in the same current workspace; an archived or
missing required personal node fails closed.

All identity arrays use unsigned ASCII lexical ordering. The runtime validator independently checks
ordering, uniqueness, global Catalog/Overlay stable-ID separation, node-prefix/type correlation,
rule reachability/acyclicity, member shapes, weights, `K_OF_N`, mandatory floors, root weighted
threshold correlation, node/reference closure, workspace correlation, and the prerequisite DAG.
Target publication enforces the root weighted-threshold invariant before the profile becomes
immutable.

## Security and compatibility

- The server verifies the Supabase session and calls this RPC with the same request-scoped,
  publishable-key client fixed to the `api` schema. A service-role client is forbidden.
- Unknown and foreign goals return the same safe access failure. Owner queries repeat authentication
  and workspace membership checks; revoked membership invalidates the next read.
- The response excludes notes, provenance bodies, evidence, mastery, readiness, hidden proposals,
  provider data, client viewport state, and unrestricted history.
- The DAL binds the decoded goal key to the requested selector and never accepts workspace scope
  from the browser or URL.
- This read performs no mutation, command receipt, or outbox append.

The marker is `{ "name": "ExploreTargetContextV1", "version": "1.0.0" }`. Any field or ownership
change requires an intentional schema, SQL, decoder, fixture, and consumer update.
