# PANDO — Prompt Library UX v0.3

## 1. Purpose

Prompt Library is the no-API bridge between the application and ChatGPT Work. It lets a non-technical user choose a situation, copy one prepared prompt, provide a small clearly explained set of inputs, and receive project-compatible files.

For short live changes, a connected ChatGPT Work/Codex client uses Agent Control tools instead of file generation. Prompt Library remains the guided bulk-authoring path and includes a clear `Use connected assistant` action when the requested change fits the live protocol.

The product must never assume the user knows which schema, folder, or architecture document to mention.

## 2. Navigation and page structure

The main navigation contains `Prompt Library`.

The landing page shows scenario cards grouped by purpose:

- `Start or improve my long-term plan`
- `I was invited to an interview`
- `The interview date or availability changed`
- `The interview or external goal was cancelled`
- `I received new recruiter information`
- `Rebalance my learning tracks`
- `Review my recent progress and redesign the next month`
- `Add a new learning area or resource series`
- `Repair or validate an imported plan`

Each card shows:

- plain-language purpose;
- when to use it;
- estimated user effort;
- what information is needed;
- which project files it may create or modify.

## 3. Individual prompt page

Every prompt page contains the following blocks in this order.

### A. What this will do

One short concrete result, for example:

> Creates a temporary interview campaign while preserving your global learning plan.

### B. Before you copy

A compact checklist with required and optional inputs. Example for an interview:

Required:

- interview date or best-known time window;
- full vacancy text or screenshots/files;
- company and role name;
- how many hours per week are realistically available.

Useful if known:

- recruiter email and described interview stages;
- technologies mentioned verbally;
- names/roles of interviewers;
- personal weak areas or topics to preserve in the global plan;
- travel, exams, work shifts, or unavailable days.

### C. Copy prompt

- Large read-only prompt preview.
- Primary `Copy prompt` button.
- Confirmation state: `Copied — now open ChatGPT Work`.
- Optional `Copy checklist with prompt` enabled by default.
- Prompt version and last-updated date visible but not visually dominant.

The copied prompt tells ChatGPT Work to use the supplied PANDO contract and exported context, ask only materially necessary questions, generate valid pack files, validate them when repository tools are available, and summarize what changed. Direct project-folder access is optional.

### D. What to attach or paste

Bullet list matching the scenario. Do not hide required inputs inside the prompt body.

### E. What happens next

1. In PANDO, download the current preparation context.
2. Open ChatGPT Work and attach the context plus the requested vacancy/materials.
3. Paste the copied prompt and let Work create or update the Preparation Pack.
4. Download the resulting ZIP/files, or use the generated repository folder when Work has project access.
5. Return to PANDO and click `Import Preparation Pack`.
6. Upload the pack, then review and accept the diff.

### F. Expected result

Show filenames and a human explanation, not raw schema details. Example:

> A new interview campaign will appear beside your global plan. No existing progress will be deleted.

### G. Troubleshooting

- Work cannot see the project folder; use attachments and download the resulting files instead.
- Vacancy information is incomplete.
- The browser upload cannot find or accept the generated pack.
- Pack failed validation.
- User wants to undo the import.

## 4. Core interview prompt behavior

The `I was invited to an interview` prompt must instruct ChatGPT Work to:

- read the project's architecture and current Growth Plan context;
- analyze only the supplied vacancy/recruiter information and clearly sourced research if explicitly requested;
- distinguish mandatory, preferred, differentiating, and unknown requirements;
- preserve existing evidence and long-term tracks;
- create a deadline-driven Interview Campaign overlay;
- calculate capacity assumptions and state what does not fit;
- protect any user-selected minimum global cadence;
- create minimum and stretch preparation paths;
- write a valid Preparation Pack into the configured folder when repository access is available;
- produce a downloadable valid Preparation Pack when no project folder is available;
- validate files locally when tools are available;
- never fabricate completed activities or mastery.

## 5. Prompt versioning and safety

Prompts are versioned repository content, not hard-coded text scattered through UI components.

Each prompt definition contains:

- stable prompt ID and version;
- title, description, category, and input checklist;
- compatible Preparation Pack schema versions;
- copyable prompt body;
- expected file operations;
- safety/invariant reminders;
- changelog and test fixtures.

The application records which prompt version produced a pack when that metadata is available. Generated files are still untrusted and must pass normal validation and confirmation.

## 6. User experience principles

- One scenario per card; avoid a giant universal prompt.
- Explain the outcome before showing technical instructions.
- Required inputs are short bullet points.
- Do not ask users to edit JSON manually.
- Do not imply that copying the prompt has already changed the project.
- Preserve the global plan unless the user explicitly asks to replace it.
- Make incomplete information acceptable: ChatGPT must mark uncertainty instead of inventing details.
- Always show how to return to the app and finish the import.

## 7. MVP acceptance criteria

1. A user can find the interview scenario without knowing product terminology.
2. The page clearly separates required from optional information.
3. The prompt copies in one action and includes project-specific output instructions.
4. A user knows where to paste it and what to do afterward.
5. ChatGPT Work output can be uploaded in the browser, validated, previewed, and accepted by the product without local filesystem access.
6. Existing Growth Plan and evidence survive campaign creation.
7. Prompt versions and pack schema compatibility are testable.
