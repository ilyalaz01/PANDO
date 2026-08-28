# Planning Prerequisite Satisfaction Policy v0.1

Status: Accepted initial deterministic policy
Owner: Mastery classification; Catalog structure; Planning aggregation
Policy version: `mastery-prerequisite-satisfaction/0.1`
Engine version: `mastery-prerequisite-engine/0.1.0`

## 1. Purpose

This policy turns Catalog-owned direct blocking prerequisite edges and Mastery-owned current
competency estimates into the tri-state prerequisite input consumed by Planning. It does not infer
new evidence, change achievement levels, or add requirements that are absent from the exact
Catalog version.

The policy is deliberately conservative. Missing or unusable state remains `UNKNOWN`; it never
becomes zero, `NOT_STARTED`, or satisfied by default.

## 2. Structure and bounds

- Only direct incoming blocking `PREREQUISITE_OF` edges in the candidate's exact Catalog version
  participate. Transitive closure is not inferred.
- Candidate origin must be present and unambiguous. If an accepted workspace-owned personal
  competency and any competency in the candidate's exact Catalog version share one text reference,
  the owner boundary fails the projection rather than applying canonical edges to a possibly
  personal node. It also fails when neither owner recognizes the reference. Future personal-content
  admission/import commands must reject collisions.
- A candidate may have at most 20 direct blocking prerequisites.
- One Planning source bundle may request at most 200 distinct candidate/version pairs and 500
  distinct prerequisite competency references. Exceeding a bound fails the projection for retry;
  no edge or state is silently truncated.
- Catalog returns prerequisite references in canonical code-point order. Mastery returns exactly
  one classification for every distinct requested reference.

## 3. Per-competency Mastery classification

The calculation is the pure TypeScript Mastery engine named above. SQL only returns the bounded,
content-fenced source projection: projection identity and clock metadata plus the seven minimized
dimension fields required below. It returns no evidence identifiers, explanations, or bodies. The
engine reads no database, environment, network, filesystem, browser state, or implicit clock.

The Mastery owner classifies its latest materialized current projection that was published no later
than the Planning attempt's persisted `claimAsOf` clock. The classifier validates that projection
as one internally consistent output of the accepted Mastery engine, then re-evaluates every
dimension's freshness at `claimAsOf`. A dimension is fresh through, and including, its exact policy
boundary:

    lastMeaningfulEvidenceAt + dimension freshness window

It becomes stale immediately after that instant. The freshness windows and qualifying evidence are
those of `mastery-readiness-policy/0.1`.

This is an eventually consistent projection boundary, not a second Evidence calculation inside
Planning. Evidence accepted, corrected, or invalidated after the current Mastery projection's input
watermark is reflected when the Mastery worker publishes the next projection; that publication
wakes Planning and changes the content fence. Until then, Planning may use only the last
materialized Mastery projection, never inspect Evidence directly or claim that pending Evidence was
already incorporated.

One prerequisite competency is:

- `SATISFIED` when at least one dimension is Known, currently Fresh, Strong, and has achievement
  `COMPLETED`, `VERIFIED`, or `MASTERED`;
- `BLOCKED` when there is no satisfying dimension and at least one dimension is Known, currently
  Fresh, and Weak;
- `UNKNOWN` otherwise, including no current projection, a projection published after the claim
  clock, unsupported engine/policy metadata, malformed state, no relevant evidence, or stale-only
  evidence.

`COMPLETED` is the initial positive threshold because Catalog edges do not declare a required
dimension or achievement level, and the accepted Mastery policy defines it as the first qualifying
successful event. Requiring `VERIFIED` or `MASTERED`, or a particular dimension, would be a new
versioned product rule.

When both positive and weak current dimensions exist, the positive witness wins. The edge names a
competency rather than a required dimension, so one current Strong completion is sufficient under
v0.1.

## 4. Candidate aggregation

- no direct blocking prerequisites: `SATISFIED`;
- any `BLOCKED` prerequisite: `BLOCKED`;
- otherwise any `UNKNOWN` prerequisite: `UNKNOWN`;
- otherwise all prerequisites are `SATISFIED`, so the candidate is `SATISFIED`.

Planning records total, satisfied, blocked, and unknown counts next to the tri-state value. Its pure
engine verifies that the counts sum exactly and deterministically imply the stated value before
eligibility or ranking. `BLOCKED` remains ineligible; `UNKNOWN` remains eligible with the existing
visible penalty and warning.

## 5. Clock, revision, and privacy rules

The engine returns the earliest inclusive freshness boundary among the witnesses that determine
each non-Unknown classification. Planning caps snapshot validity at the earliest returned boundary
and refreshes one millisecond after it.

The Mastery source answer is workspace-scoped, exact-reference-scoped, bounded, and content-hashed.
Its revision, the classifier engine version, this policy version, and the derived bounded counts
travel in the normalized Planning input and therefore in the canonical input fingerprint. Planning
receives no Evidence identifiers or bodies and has no direct Mastery table grant.

Any semantic, threshold, precedence, freshness, or aggregation change requires a new policy
version and representative golden comparison.
