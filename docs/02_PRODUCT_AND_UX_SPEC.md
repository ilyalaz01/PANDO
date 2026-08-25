# PANDO — Product and UX Specification v0.3

## 1. Primary users and jobs

Initial user: a technical candidate preparing for a specific software/AI/verification interview while combining algorithms, Python, systems knowledge, projects, and spaced review.

Primary jobs:

- understand the path and current gaps;
- choose a useful action for the available time;
- study or practice without interface overhead;
- preserve credible proof of progress;
- remember what is decaying;
- adapt the plan as goals, deadlines, and energy change.

## 2. Information architecture

Primary navigation:

- `Today`
- `Explore`
- `Review`
- `Plan`
- `Prompt Library`
- profile/settings/integrations

`Agent Control` does not require an embedded model or an in-app chat surface. When an authenticated connector is configured, ChatGPT Work or Codex can explain and manage the same plan through the external control interface. The optional in-app `Learning Partner` remains separately feature-flagged. Every agent action has a complete manual UI path.

For MVP onboarding, `New Goal` supports `Import Preparation Pack`. The user downloads `preparation-context.json`, generates the pack externally with the prepared prompt, and uploads the resulting pack in the browser. PANDO shows a human-readable preview of target requirements, assumptions, workspace-scoped competency drafts, schedule constraints, and proposed activities before activation. Repository-folder detection may exist in development but is not part of the hosted user flow.

The first onboarding choice is:

- `Build my long-term plan`; or
- `Prepare for an interview`.

These are not mutually exclusive. The dashboard shows an always-available Growth Plan and any active Interview Campaign above it.

`Focus Session` is entered from Today, Explore, Review, Plan, or an enabled Learning Partner and behaves as a distraction-minimized mode.

## 3. Today

Today is the default daily surface.

It shows:

1. One `Next Best Action` with duration, expected benefit, and plain-language reason.
2. Two to four alternatives for different duration/energy modes.
3. Due and overdue reviews.
4. Nearest goal/deadline and critical blocker.
5. Weekly capacity and completed meaningful work.

With no active interview, recommendations balance the user's long-term tracks—for example daily LeetCode practice, Python/systems work, and machine-learning study. With an active campaign, Today labels campaign-critical actions and still shows any protected base-plan activity.

Example:

```text
Today — 2h available
1. NVIDIA campaign: Linux log-parsing exercise — 45m
2. Core algorithms: one LeetCode problem — 35m
3. ML growth: StatQuest logistic regression lesson + recall — 30m
```

Track ratios are preferences, not rigid quotas. The planner adapts to actual completion time, evidence, skipped days, reviews, and deadlines.

Required actions:

- start;
- replace with another recommendation;
- explain why;
- adjust available time/energy;
- defer;
- edit plan.

Acceptance criteria:

- A user can start useful work in at most two deliberate actions after opening Today.
- Every recommendation exposes structured reasons derived from planner output.
- If no profile or evidence exists, the screen provides a clear onboarding action rather than fake precision.

## 4. Explore: Map and Outline

Explore has two projections of the same state.

### Map

- Stable deterministic competency layout.
- Semantic zoom: domains → groups → competencies → selected activities.
- Target filters emphasize requirements and critical paths.
- Right inspector explains competency, prerequisites, evidence, state, activities, and impact.
- Only the visible or contextually necessary subgraph is rendered.
- Activities do not all appear as permanent graph nodes.

### Outline

- Search, filters, sorting, dates, readiness state, overdue state.
- Fast editing and bulk operations where safe.
- Same selected item, target, query, filter, detail level, and inspector as Map.

Map/Outline switching must not feel like navigation to another product.

## 5. Focus Session

Required elements:

- clear activity goal and expected evidence;
- resource or external launch action;
- optional timer;
- notes/scratch area;
- completion or stop action;
- minimal result capture.

After completion, default behavior is non-blocking confirmation. Optional quick feedback:

- used a hint;
- felt difficult;
- repeat later;
- do not recommend again.

Ask a clarifying question only when it materially changes evidence quality. Do not show a mandatory questionnaire after every activity.

## 6. Review Center

Sections:

- Due today
- Overdue
- Upcoming
- Personal reminders
- Suppressed/excluded

Each item shows all reasons for its schedule. If retention and a personal reminder coincide, present one item with both reasons.

The notification bell is for events such as import completion, provider failure, template update, or deadline warning. It is not the only home for reviews.

## 7. Readiness and competency inspector

Readiness presentation must include:

- score or bounded estimate when justified;
- estimate confidence;
- profile/version/date context;
- domain breakdown;
- mandatory blockers;
- unknown and stale areas;
- strongest recent evidence;
- actions with highest expected improvement.

Example format:

```text
Readiness: ≈74 / 100 — confidence Medium
Status: Not ready
Blocking requirement: Networking floor not met
Unknown: Behavioral
Stale: 14 competencies
```

The competency inspector keeps Self-confidence visually separate from objective dimensions.

## 8. Conversational control and optional Learning Partner

ChatGPT Work or Codex may act as PANDO's external text/voice control surface when the user connects the authenticated PANDO tools. PANDO supplies facts and deterministic previews; the external model interprets the user's language. No model runs inside PANDO for this workflow.

The agent can:

- explain the whole current plan or one goal from the compact control context;
- answer what changed, what is blocked, what is due, and why Today recommends an action;
- create a long-term track or a deadline-driven campaign;
- pause, resume, complete, end, cancel, supersede, or reprioritize plans through lifecycle commands;
- change deadline, weekly capacity, availability, cadence, target, country, university, specialty, or other structured constraints;
- preview a multi-part replan and apply it atomically after confirmation;
- fetch detailed evidence or target information only when the question needs it.

The interaction contract is:

1. Read one compact control summary and expand only relevant resources.
2. Translate the user's intent into semantic operations; ask only for missing information that materially changes the result.
3. Generate a deterministic preview tied to current aggregate versions and input watermark.
4. Explain what will stop, remain, move, or be created, including capacity impact and retained history.
5. Obtain explicit confirmation for the exact preview.
6. Apply one idempotent change set through the ordinary command boundary and report the resulting revision.

For example, “the interview was cancelled” previews cancellation of the active Interview Campaign, removal of its temporary overrides, restoration of the base Growth Plan allocation, and retention of all evidence. “I need to change university and specialty in three months” creates or supersedes the relevant goal, records the deadline and constraints, previews capacity trade-offs, and leaves unrelated tracks intact unless the user confirms otherwise.

The manual Plan, Today, Review, Targets, and Settings UI exposes equivalent read and mutation capabilities. Connector or model unavailability never blocks manual use. The in-app Learning Partner remains optional and may be absent entirely.

Preparation Packs remain the low-cost bulk-authoring/import path for substantial new profiles or plans. They do not replace the live Agent Control context or change-set protocol.

## 9. Adding custom resources

For a pasted URL, the system may retrieve allowed metadata and propose:

- title/type/duration/thumbnail;
- likely competencies;
- duplicate candidates;
- effort estimate;
- activity type.

AI-generated mappings remain `suggested` until confirmed by the user or curator. Failed metadata retrieval falls back to a minimal manual form.

## 10. Mobile behavior

Mobile prioritizes:

- Today;
- Review queue;
- Focus Session;
- quick completion and notes;
- Learning Partner when enabled;
- a compact current-path view.

The full DAG is viewable but is not the primary editing surface. Desktop supports full Map and Outline management. The MVP release gate requires mobile-quality responsive Today, Review, Focus, notes, and pack upload/preview; full graph editing remains desktop-first.

## 11. Motion and accessibility contract

- Map positions remain stable between sessions unless structure or personal position changes.
- Drag uses local physics; invalid drops return clearly without changing data.
- Completion animation is brief and never blocks navigation.
- Motion modes: `Full`, `Reduced`, `Off`; system preference initializes the default.
- All state is communicated with text/icon/shape, not color alone.
- Keyboard users can navigate nodes, open inspector, choose actions, and complete focus/review flows.
- Focus order, labels, contrast, hit targets, and zoom controls are tested.
- Interrupting an animation leaves the UI in a valid state.

## 12. Empty, loading, error, and degraded states

Every surface must explicitly design:

- first-time empty state;
- no evidence / `Unknown` state;
- stale calculation state;
- provider disconnected/failing;
- offline or retry state where supported;
- partial import with rejected records;
- template update conflict;
- AI unavailable;
- calculation error.

Never replace these with fabricated zeros or indefinite spinners.

## 13. Gamification rules

Reward meaningful evidence:

- first learning unlocks a path;
- delayed successful reproduction strengthens it;
- application in a different context has greater visual weight;
- stale knowledge fades but history remains;
- significant milestones receive animation.

Do not grant major rewards for opening a resource, clicking complete without evidence, or maintaining a coercive streak. Consistency may be shown without punishing one missed day.

## 14. Prompt Library

The app contains a user-friendly catalog of prepared ChatGPT Work workflows. Each prompt page explains when to use it, what information to attach, what files it will create or update, and what to do after generation.

The user should not need to understand schemas or repository architecture. The primary action is `Copy prompt`; the page also provides a short checklist such as interview date, vacancy text, recruiter notes, available weekly hours, and known interview stages.

Prompt Library is specified in [`06_PROMPT_LIBRARY_UX.md`](06_PROMPT_LIBRARY_UX.md).
