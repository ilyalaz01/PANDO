# Target readiness contracts v1

`target-readiness.schema.json` is the authenticated Targets-owned detail returned for one current
personal-workspace readiness goal. It includes lifecycle and aggregate version, exact immutable
profile identifiers, explicit projection state/reason, the last safe snapshot when one exists,
persisted ordered gaps, and at most 250 minimized calculation inputs. Supporting and contradicting
evidence values are opaque UUID references only, capped independently at eight of each kind per
input. Evidence bodies, notes, attempt/provider content, and `domainBreakdown` are excluded;
Explore composes domain structure separately.

`planning-readiness-input.schema.json` is a strict fail-closed union. `CURRENT` contains one
minimized current snapshot. `UNAVAILABLE` contains a reason and a null snapshot. Planning never
receives stale snapshot detail, rule evaluations, explanation codes, calculation inputs, or
evidence identifiers from this contract.

Both schemas use Draft 2020-12, reject unknown fields, bound all arrays and intervals, and preserve
bigint identities as decimal strings.
