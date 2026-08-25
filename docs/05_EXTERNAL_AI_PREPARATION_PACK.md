# PANDO — External AI Preparation Pack v0.3

## 1. Decision

The MVP does not pay for an embedded LLM API. Complex vacancy analysis or major long-term plan design is performed occasionally through the product owner's existing ChatGPT Work access. ChatGPT generates a structured file pack; the application validates, imports, and executes it.

This avoids ongoing token cost without weakening the deterministic daily product.

Important limitation: a ChatGPT subscription is subject to the product's current usage limits and does not guarantee literally unlimited computation. The architecture therefore treats ChatGPT as an optional external authoring tool, not a runtime dependency.

Preparation Pack is the asynchronous bulk-authoring boundary for a substantial new target profile or initial/reworked plan. It is deliberately separate from the live Agent Control protocol. Small operational changes—cancel a campaign, pause a track, change capacity/deadline, or ask for an explanation—use `AgentControlContextV1` and a confirmed ChangeSet instead of regenerating or editing pack files.

## 2. User flow

### Create a goal

1. In PANDO, click `New Goal → Download preparation context`.
2. The app creates `preparation-context.json` with current skills/evidence, catalog IDs, deadline, availability, and optional prior goals.
3. Open the matching prompt from PANDO's Prompt Library in ChatGPT Work.
4. Attach or reference:
   - the vacancy text/link/copy;
   - recruiter information and interview stages;
   - `preparation-context.json`;
   - the pack schema and generation instructions.
5. ChatGPT Work researches or analyzes as requested and generates the versioned pack files. With repository access it may write them into `imports/preparation/<goal-slug>/`; otherwise the user downloads them as a ZIP or selects the files.
6. In PANDO, click `Import Preparation Pack` and upload the ZIP/files in the browser. A local watcher may detect the same folder only in development or a personal self-hosted setup.
7. Review the preview:
   - extracted mandatory and bonus requirements;
   - sources and unsupported assumptions;
   - competency mappings;
   - deadline/capacity assumptions;
   - proposed activities and initial weekly strategy.
8. Click `Accept`, edit individual items, or reject the pack.

After acceptance, PANDO operates normally without AI: Today recommendations, readiness, reviews, evidence, and schedule adaptation are calculated server-side by deterministic engines.

### Create or revise the long-term Growth Plan

The same mechanism can generate a non-vacancy pack such as:

- algorithms/LeetCode with a daily or weekly cadence;
- Python and practical engineering such as parsing logs;
- machine learning theory and StatQuest-based learning activities;
- projects, recall, and periodic verification.

This pack has no mandatory interview deadline. It defines desired direction, balance, milestones, and cadence. The application converts it into adaptive near-term work.

### Add an Interview Campaign later

When an interview appears, ChatGPT Work receives the existing Growth Plan and evidence context plus the vacancy and deadline. It generates a campaign pack containing temporary requirements and priority overrides. Importing it does not create a second isolated learning history and does not delete the global plan.

## 3. Pack contents

Recommended pack layout (directory or ZIP root):

```text
imports/preparation/nvidia-verification-2026-09/
  manifest.json
  target-profile.json
  preparation-plan.json
  sources.md
  rationale.md
```

### `manifest.json`

- pack schema version;
- unique pack ID and generation timestamp;
- target title and deadline;
- generator label/model when known;
- input context fingerprint;
- list and checksums of pack files.

### `target-profile.json`

- role/company/vacancy metadata;
- mandatory, preferred, and differentiating requirements;
- interview stages;
- mappings to existing competency IDs;
- proposed new competencies separately marked as suggestions;
- weights, floors, criticality, confidence, and source references;
- unknowns and assumptions.

The imported profile is a workspace-scoped draft. Proposed competencies are also workspace-scoped drafts. Neither can mutate the canonical Catalog or a curated Target Profile.

### `preparation-plan.json`

- total time/capacity assumptions;
- phases and milestones, not an immutable daily calendar;
- proposed activities with effort ranges and competency impact;
- minimum viable path and optional stretch path;
- initial reviews and mock checkpoints;
- explicit items excluded because they do not fit.

### `sources.md`

Human-verifiable source list. Each factual vacancy/company requirement maps to a source or is explicitly labeled as user-provided or unconfirmed.

### `rationale.md`

Plain-language explanation of priorities, trade-offs, uncertainty, and what should change if the preparation window changes.

## 4. Import rules

The importer must:

- validate against versioned JSON schemas;
- reject unknown canonical IDs unless declared as proposed additions;
- reject cycles in prerequisite proposals;
- validate dates, durations, enum values, and requirement rules;
- preserve source and confidence for every imported claim;
- label unsupported assertions as `Unconfirmed` rather than fact;
- never import evidence claiming the user completed something;
- never directly set `Verified`, `Mastered`, or readiness;
- produce a preview/diff before commands are executed;
- be idempotent by pack ID and content fingerprint;
- retain the original pack for audit and re-import diagnosis.
- stage profile/requirement proposals in Targets and new competency/activity/resource proposals in User Overlay;
- translate accepted Growth Plan, track, capacity, and cadence proposals into ordinary Planning
  commands; Integrations never owns the resulting plan;
- publish accepted personal content only in the importing workspace;
- require a separate curator workflow for promotion into canonical catalog/template/profile versions.

The model output is untrusted input, even when produced by a strong model.

## 5. Adaptive planning after import

The pack provides an initial strategy and candidate activities. It does not permanently assign every future day. This applies both to the Growth Plan and Interview Campaigns.

The application recalculates the near-term plan when:

- an activity takes more or less time than expected;
- the user skips a day;
- new evidence shows a topic is already strong or unexpectedly weak;
- availability or interview date changes;
- a review becomes urgent;
- the user adds or removes a constraint.

Most changes require no new ChatGPT call. Re-run the external workflow only for substantial reinterpretation, such as a new vacancy, new recruiter information, a radically changed deadline, or a request for a deeply redesigned strategy.

## 6. Prompt contract for ChatGPT Work

The repository should eventually contain `prompts/generate-preparation-pack.md`. It must instruct the model to:

- use only schema-supported fields;
- distinguish sourced facts, user statements, interpretations, and assumptions;
- use existing competency IDs where valid;
- propose rather than invent missing catalog items;
- respect deadline and weekly capacity;
- create minimum and stretch paths;
- preserve `Unknown` when evidence is absent;
- never fabricate user achievements;
- output valid files without commentary outside the pack;
- run local schema validation when Work has repository access and correct failures before handoff.

Users access these workflows through the in-app Prompt Library rather than browsing repository files manually. The prompt page supplies the copyable instruction, required-input checklist, expected output, and browser upload/verification steps.

## 7. Future embedded AI

Later, the same contract can be used by an API-backed provider. The application would send `PreparationContext` and receive the same `PreparationPack`; validation and confirmation would remain unchanged.

This means the zero-cost MVP is not throwaway architecture. It defines the stable boundary that any future model provider must follow.
