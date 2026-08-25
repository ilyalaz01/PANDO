---
name: pando-control
description: Explain or safely manage a user's live PANDO goals, campaigns, tracks, capacity, deadlines, and replanning through short text or voice intent. Use when a connected PANDO control tool is available; do not use repository or export-file edits as live-state mutations.
---

# PANDO Control

Treat ChatGPT Work/Codex as an authenticated client of PANDO, not as the source of truth.

## Start

1. Call `get_control_summary` once.
2. Expand only the goal, campaign, track, target, Today explanation, or evidence summary needed for the request.
3. If live PANDO tools are unavailable, explain that no state was changed. Never simulate a live change by editing repository files, schemas, fixtures, Graphify output, exports, or SQL.

For contract details, read [Agent Control Plane](../../../docs/design/AGENT_CONTROL_PLANE.md) only when the request needs a write, unusual lifecycle transition, or troubleshooting. For domain ownership, read [Domain Model](../../../docs/01_DOMAIN_MODEL.md).

## Reads

Answer from returned product state and identify its watermark/freshness when material. Keep Unknown distinct from zero. Do not infer completed work, mastery, readiness, or a deadline that is absent.

Use the root summary for broad explanation. Fetch raw/detail evidence only when the user's question actually requires it.

## Writes

Translate intent into semantic operations. Ask only for missing information that would materially change the result.

1. Call the most focused preview tool; use `preview_change_set` only for a genuinely atomic multi-operation scenario.
2. Summarize what will change, what remains, capacity/Today impact, warnings, and retained history.
3. Obtain explicit confirmation of that exact preview.
4. Call `apply_change_set` with the server preview token/digest, expected versions, base watermark, and a fresh idempotency key.
5. Report the resulting plan revision and pending recalculation state.

Never bypass preview or confirmation. Never change the proposal inside the apply call. On stale version/watermark, refresh context and preview again; do not retry the old preview.

## Lifecycle rules

Prefer reversible, history-preserving transitions:

- an unavailable interview becomes a cancelled campaign;
- a normally finished campaign becomes ended;
- temporary uncertainty becomes pause;
- replacement becomes supersede;
- completed work remains completed;
- archive hides inactive structure without deleting it.

Never directly set mastery, readiness, evidence, review dates, completed work, canonical catalog content, or another workspace's state.

## Intent examples

- “The interview was cancelled” → preview campaign cancellation, remove only campaign overrides, restore base allocation, retain goals/evidence, confirm, apply.
- “Switch university and specialty; three months” → resolve current goal, ask only for missing target/deadline facts, preview supersession/creation and capacity trade-offs; route substantial target research to Preparation Pack.
- “Stop interview prep; keep Python and ML” → cancel/end the campaign, not shared competencies or named retained tracks.

A voice request has exactly the same permissions and confirmation rules as typed input.
