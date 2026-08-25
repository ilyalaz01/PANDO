# Bounded contexts

Each directory below reserves one owner from the canonical Domain Model. The complete interaction
map, derived contract ownership, cross-context flows, and task reading routes are in the
[module topology](../../docs/design/MODULE_TOPOLOGY.md).

| Module directory | Canonical owner      |
| ---------------- | -------------------- |
| identity         | Identity & Workspace |
| catalog          | Catalog              |
| targets          | Targets              |
| overlay          | User Overlay         |
| sessions         | Sessions             |
| integrations     | Integrations         |
| evidence         | Evidence             |
| mastery          | Mastery              |
| review           | Review               |
| planning         | Planning             |
| agent-control    | Agent Control        |

This foundation adds no authoritative state or business behavior. When a module gains code, it uses
this internal shape:

```text
module-name/
  domain/          pure entities, policies, values, and events
  application/     commands, queries, and purpose-specific orchestration
  infrastructure/  framework, persistence, and provider adapters
```

Dependencies point inward: infrastructure may implement domain-owned interfaces; domain code may
not import React, Next.js, browser state, time, network, environment variables, another module, or
another module's infrastructure.

Cross-context interaction is limited to owning-module commands, bounded queries, versioned events,
and read-only projection composition. A coordinator may make a named workflow atomic, but it cannot
move domain rules or authoritative ownership out of the participating modules. Shared code is not a
fifth interaction form.
