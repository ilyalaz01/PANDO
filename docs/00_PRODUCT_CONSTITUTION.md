# PANDO — Product Constitution v0.2

## 1. Product purpose

The product helps a person answer four questions:

1. What capability does my target role require?
2. What do I actually know, based on evidence rather than checkmarks?
3. What should I do next with the time and energy I have?
4. Why did the system reach that conclusion?

The product succeeds when users become more interview-ready and can inspect the evidence behind that claim. It does not succeed merely because users open the app, maintain a streak, or color many nodes green.

## 2. Non-negotiable principles

### P1 — Evidence before status

An activity does not directly mutate mastery. It creates an evidence event. Competency state, readiness, reviews, and UI state are recalculated from evidence.

### P2 — History is preserved

Evidence is append-only. Corrections create explicit correction or invalidation records. Agents must not overwrite an old attempt to make the current state look cleaner.

### P3 — Knowledge and work are different graphs

- Competencies and prerequisites form the canonical knowledge DAG.
- Activities and resources are ways to acquire or demonstrate competencies.
- Goals and target profiles project requirements onto the knowledge DAG.
- User sessions and attempts form an activity history.

These object types must not be collapsed into one universal `node` concept at the domain layer, even if the UI renders several of them visually.

### P4 — Readiness is not offer probability

Readiness means the degree to which available evidence meets a selected target profile. The UI must never label it as the probability of receiving an offer.

### P5 — Unknown is not zero

No evidence means `Unknown`. Weak, stale, and strong are evidence-derived states. The product must not punish missing data by pretending it proves incompetence.

### P6 — AI is advisory

The deterministic system owns prerequisites, score calculation, review dates, blockers, and plan ranking. The Learning Partner may explain, summarize, ask, and propose changes. User confirmation is required before a proposal changes persisted plans, mappings, or graph overlays.

### P7 — The app works without AI

Users can browse, select activities, edit their plan, record results, review, and inspect readiness without conversing with the Learning Partner.

### P8 — Daily utility is primary

The graph explains the landscape. `Today`, `Focus Session`, and `Review Center` perform daily work. The graph is not the only or default answer to “what next?”

### P9 — Templates evolve without destroying user work

Curated roadmap templates and target profiles are versioned. User changes live in an overlay. Template upgrades preserve notes, custom activities, exclusions, reminders, and accepted personal mappings.

### P10 — Integrations are optional adapters

No external provider is the product’s source of truth. Manual evidence entry remains a supported fallback. An integration failure must degrade gracefully and visibly.

### P11 — Accessibility and calm motion are product behavior

Spatial stability, keyboard operation, readable status beyond color, and `Full / Reduced / Off` motion modes are required. Animation cannot block actions or change meaning.

### P12 — Explainability accompanies every important number

Readiness and recommendation surfaces show inputs, freshness, confidence, blockers, and next actions. A user must be able to challenge or correct source data.

### P13 — AI access is replaceable and bring-your-own

The MVP must not require the product owner to pay per-token API costs. Structured vacancy analysis and initial planning can be produced externally through ChatGPT Work and imported as files. A future built-in AI provider may improve convenience but cannot become required for the core product.

### P14 — Continuous growth and interview campaigns coexist

The product is useful without an active vacancy or interview. A user maintains a long-term Growth Plan across durable career tracks. A time-bounded Interview Campaign temporarily changes weights, deadlines, and minimums but does not replace, reset, or delete the Growth Plan or prior evidence.

### P15 — Hosted product, portable import boundary

PANDO is a hosted responsive web application in the MVP. External AI authoring exchanges versioned files through browser download/upload. Repository-folder writing and local file watching may accelerate development or personal use, but the core onboarding and import flow cannot depend on local filesystem access.

### P16 — Personal imports do not mutate the canonical catalog

Imported target profiles and proposed competencies begin as workspace-scoped drafts. Accepted personal content may participate in that workspace's planning and readiness, but only a separate curator workflow can publish it as canonical template or catalog content.

## 3. Product boundaries

### In scope

- Career and interview readiness goals.
- Curated competency graphs and role/company target profiles.
- Activities, resources, attempts, evidence, retention, reviews, deadlines.
- Explainable readiness and deterministic planning.
- PyPrep as a bounded learning provider.
- Manual coding practice evidence and external resource links.
- AI Learning Partner as an optional interaction layer.

### Out of scope until separately approved

- Recruitment marketplace or applicant tracking system.
- Claims that a score predicts an offer.
- Automated scraping of platforms whose terms disallow it.
- Copying protected problem statements or solutions into the product.
- Automatically modifying canonical graphs from LLM output.
- Medical, psychological, or biometric inference from study behavior.

## 4. Product language

Use these terms consistently:

| Term | Meaning |
|---|---|
| Outcome Goal | Real-world result, e.g. “Receive an NVIDIA offer”; completed only by a real outcome event. |
| Readiness Goal | Computable preparation target for a role/interview. |
| Growth Plan | Ongoing portfolio of learning tracks without a required end date, such as algorithms, Python, systems, and machine learning. |
| Interview Campaign | Temporary deadline-driven preparation layer for a concrete interview or vacancy. |
| Learning Track | Long-running area with its own desired cadence and outcomes. |
| Target Profile | Versioned requirements, weights, floors, stages, and sources for a readiness goal. |
| Competency | A demonstrable capability, not a learning item. |
| Activity | Something the user does to learn or demonstrate competencies. |
| Resource | Material used by an activity. |
| Evidence Event | Immutable record that an activity produced an observable result. |
| Review | Scheduled opportunity to refresh or verify a competency/activity. |
| Readiness | Evidence/profile alignment, with uncertainty. |
| Confidence | Reliability of the estimate, not the user’s self-confidence. |
| Self-confidence | User-reported feeling, stored and displayed separately. |

## 5. Decision hierarchy

When a trade-off appears, prioritize in this order:

1. Correct and auditable evidence.
2. User control and truthful uncertainty.
3. Daily usefulness and low friction.
4. Explainability.
5. Accessibility and performance.
6. Visual delight.

## 6. Guardrail tests

Reject or redesign a feature if any answer is “yes”:

- Can a click create `Mastered` without sufficient evidence?
- Can an LLM silently change readiness or the canonical graph?
- Does a provider outage make the core workflow unusable?
- Does a missing datapoint display as a proven zero?
- Can a high average hide a mandatory critical blocker?
- Does a template update overwrite a user’s work?
- Does the interface require the graph or chat for every action?
- Is a precise-looking score shown without confidence and explanation?
- Are users rewarded mainly for opening or checking off content?
