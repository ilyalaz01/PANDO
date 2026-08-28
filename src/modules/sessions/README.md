# Sessions

Owns focus-session lifecycle and time budgets, but not attempts, evidence, or competency truth.

## Implemented Phase 2 boundary

`sessions.focus_sessions` persists the single-active-session MVP lifecycle:
`active → completed | stopped`. Its private owner functions are invoked only by the purpose-specific
Focus coordinator. The browser receives no table access and cannot choose a workspace or user.
The routed public Focus wrappers remain in `api`, while their unrouteable lifecycle implementations
reside in the private `sessions` schema.

Starting and ending Focus are operational facts. They never become evidence by themselves. The
terminal command updates the Sessions row atomically with the Evidence-owned attempt, command
receipt, and any qualifying evidence/outbox work coordinated by the public Focus command.
