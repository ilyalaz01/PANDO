# Bounded contexts

Each directory below reserves one owner from the canonical domain model. This foundation adds no
authoritative state or business behavior. When a module gains code, it uses this internal shape:

```text
module-name/
  domain/          pure entities, policies, values, and events
  application/     commands, queries, and orchestration
  infrastructure/  framework, persistence, and provider adapters
```

Dependencies point inward: infrastructure may implement domain-owned interfaces; domain code may
not import React, Next.js, browser state, time, network, environment variables, or another module's
infrastructure. Cross-module writes use commands and versioned events.
