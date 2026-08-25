---
name: graphify
description: Query or refresh PANDO's repository knowledge graph when work concerns codebase architecture, file relationships, dependency paths, or cross-file impact. This is developer orientation only; never use it as live product state or authorization.
---

# Graphify for PANDO

Graphify is a third-party repository index. PANDO pins the reviewed baseline to `graphifyy==0.9.50`. Do not install hooks or let an installer rewrite `AGENTS.md`.

## Query first

If `graphify-out/graph.json` exists, start with a bounded query instead of broad file reads:

```shell
graphify query "<question>" --budget 1500
```

Use `graphify path`, `graphify explain`, or `graphify affected` for a narrower relationship question. Cite source locations from the result, then verify decisive claims in the authoritative source files before editing.

If the command is not on PATH, use the reviewed isolated installation or `uvx --from graphifyy==0.9.50 graphify`. Do not silently upgrade the pinned version.

## Refresh

Refresh only when the user asks for Graphify, the graph is missing, or material repository changes make it stale. Respect `.graphifyignore` and `.gitignore`.

- Code-only deterministic refresh is local and has no model/API cost.
- Documentation semantic extraction can consume agent/model tokens. State the corpus size and cost expectation first, then follow the installed upstream Graphify skill's chunked extraction rules.
- Never enable Git hooks, watch mode, URL fetching, global graph merge, database extraction, or remote backends unless the user explicitly requests that separate side effect.
- Never send PANDO content to an external semantic backend without explicit approval.

Run the graph health diagnostic after a rebuild. Surface dangling, missing, collapsed, or self-loop warnings instead of hiding them.

## PANDO boundaries

Always exclude secrets, local credentials, `.env*`, production exports, user imports, raw evidence, notes, caches, build output, and generated control snapshots.

Keep these concepts separate:

- competency DAG: Catalog authority;
- GraphProjectionV1: Map/Outline UI response;
- AgentControlContextV1: compact live user-state response;
- Graphify graph: regenerable code/document index.

A Graphify node or edge is never a PANDO command, permission, domain fact, or reason to mutate live state.
