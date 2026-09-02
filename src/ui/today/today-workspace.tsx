import Link from "next/link";

import type { ExpectedBenefitCode } from "../../modules/planning/domain/planning-types";
import type {
  ReadablePlanSnapshot,
  TodayActionSelectionV1,
  TodayWorkspaceV1,
} from "./server/today-workspace-v1";
import styles from "./today.module.css";

type ReadablePlannedAction = ReadablePlanSnapshot["actions"][number];

const benefitLabels: Record<ExpectedBenefitCode, string> = {
  RESUME_ACTIVE_FOCUS: "Continue work already in progress",
  REDUCE_MANDATORY_BLOCKER: "Reduce a mandatory blocker",
  VERIFY_MANDATORY_REQUIREMENT: "Verify a mandatory requirement",
  COMPLETE_OVERDUE_REVIEW: "Complete an overdue review",
  COMPLETE_DUE_REVIEW: "Complete a review due today",
  REDUCE_TARGET_GAP: "Reduce a target gap",
  REDUCE_UNCERTAINTY: "Replace uncertainty with evidence",
  PROTECT_TRACK_CADENCE: "Protect the track's weekly cadence",
  ADVANCE_CAMPAIGN: "Advance the active interview campaign",
  ADVANCE_GROWTH_TRACK: "Advance a long-term learning track",
};

const emptyStateCopy: Record<
  Exclude<ReadablePlanSnapshot["recommendationState"], "CURRENT">,
  {
    readonly title: string;
    readonly detail: string;
    readonly href: string;
    readonly action: string;
  }
> = {
  NO_PLAN: {
    title: "Your daily plan is not initialized yet.",
    detail: "Choose a target and set up a Growth Plan before PANDO recommends work.",
    href: "/start",
    action: "Set up a target",
  },
  PLAN_PAUSED: {
    title: "Your Growth Plan is paused.",
    detail: "PANDO is preserving its history and is not ranking target work while it is paused.",
    href: "/start",
    action: "Review plan setup",
  },
  NO_CAPACITY: {
    title: "The current week has no remaining planned capacity.",
    detail:
      "Due Review work remains available, or you can inspect activities without changing the plan.",
    href: "/review",
    action: "Open Review",
  },
  NO_CANDIDATES: {
    title: "No eligible activity matches the current plan.",
    detail: "Explore accepted activities and mappings; PANDO will not invent a recommendation.",
    href: "/explore",
    action: "Open Explore",
  },
};

export interface TodayActionViewV1 {
  readonly action: ReadablePlannedAction;
  readonly selection: TodayActionSelectionV1;
}

/** Preserves the Planning contract's positional, rank, and candidate correlation fail-closed. */
export function correlateTodayActions(
  workspace: TodayWorkspaceV1,
): readonly TodayActionViewV1[] | null {
  if (workspace.projectionState !== "CURRENT") return [];
  const actions = workspace.snapshot?.plan.actions;
  if (actions === undefined || actions.length !== workspace.actionSelections.length) return null;
  const seen = new Set<string>();
  const result: TodayActionViewV1[] = [];
  for (const [index, action] of actions.entries()) {
    const selection = workspace.actionSelections[index];
    if (
      selection === undefined ||
      selection.rank !== action.rank ||
      selection.candidateKey !== action.candidateKey ||
      seen.has(selection.selectionRef)
    ) {
      return null;
    }
    seen.add(selection.selectionRef);
    result.push({ action, selection });
  }
  return result;
}

function formatEnergy(energy: ReadablePlannedAction["energy"]): string {
  return energy === null ? "Any energy" : `${energy.toLowerCase()} energy`;
}

function ActionCard({
  item,
  primary,
}: {
  readonly item: TodayActionViewV1;
  readonly primary: boolean;
}) {
  const { action, selection } = item;
  const href = `/focus?${new URLSearchParams({ selection: selection.selectionRef }).toString()}`;
  return (
    <article className={primary ? styles.primaryCard : styles.actionCard}>
      <div className={styles.actionHeading}>
        <div>
          <p className={styles.eyebrow}>
            {primary ? "Next best action" : `Alternative ${action.rank}`}
          </p>
          <h2>{action.title}</h2>
        </div>
        <span className={styles.duration}>{action.durationMinutes} min</span>
      </div>
      <p className={styles.benefit}>{benefitLabels[action.expectedBenefit]}</p>
      <p className={styles.reason}>{action.reason}</p>
      <div className={styles.actionFooter}>
        <span>{formatEnergy(action.energy)}</span>
        <Link className={primary ? styles.primaryLink : styles.secondaryLink} href={href}>
          {action.actionKind === "RESUME" ? "Resume Focus" : "Open in Focus"}
        </Link>
      </div>
    </article>
  );
}

function ReadOnlyAction({ action }: { readonly action: ReadablePlannedAction }) {
  return (
    <article className={styles.readOnlyCard}>
      <div className={styles.actionHeading}>
        <h3>{action.title}</h3>
        <span className={styles.duration}>{action.durationMinutes} min</span>
      </div>
      <p className={styles.reason}>{action.reason}</p>
      <p className={styles.readOnlyLabel}>Reference only — reload before starting</p>
    </article>
  );
}

function PlanContext({ plan }: { readonly plan: ReadablePlanSnapshot }) {
  const deadline = plan.nearestDeadline;
  const criticalGap = plan.readiness.find((item) => item.criticalGap !== null)?.criticalGap ?? null;
  return (
    <section className={styles.contextPanel} aria-labelledby="today-context-title">
      <div>
        <p className={styles.eyebrow}>Why this plan looks this way</p>
        <h2 id="today-context-title">Current constraints</h2>
      </div>
      <dl className={styles.metrics}>
        <div>
          <dt>Weekly capacity</dt>
          <dd>
            {plan.capacity.weeklyCapacityMinutes === null
              ? "Not configured"
              : `${plan.capacity.remainingMinutesThisWeek ?? 0} of ${plan.capacity.weeklyCapacityMinutes} min remain`}
          </dd>
        </div>
        <div>
          <dt>Meaningful work completed</dt>
          <dd>{plan.capacity.consumedMinutesThisWeek} min this week</dd>
        </div>
        <div>
          <dt>Reviews</dt>
          <dd>
            {plan.reviewSummary.overdueCount} overdue · {plan.reviewSummary.dueTodayCount} due today
          </dd>
        </div>
        <div>
          <dt>Nearest deadline</dt>
          <dd>
            {deadline === null ? (
              "No active campaign deadline"
            ) : (
              <>
                {deadline.title} ·{" "}
                <time dateTime={deadline.deadlineAt}>
                  {new Date(deadline.deadlineAt).toLocaleDateString()}
                </time>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Critical blocker</dt>
          <dd>
            {criticalGap === null
              ? "No critical gap in the current readiness inputs"
              : `${criticalGap.dimension.toLowerCase().replaceAll("_", " ")} · ${criticalGap.gapCode.toLowerCase().replaceAll("_", " ")}`}
          </dd>
        </div>
      </dl>
      <div className={styles.contextLinks}>
        <Link href="/review">Open Review</Link>
        <Link href="/explore">Open Explore</Link>
      </div>
    </section>
  );
}

function DegradedSnapshot({ workspace }: { readonly workspace: TodayWorkspaceV1 }) {
  if (!workspace.lastKnownSafe || workspace.snapshot === null) return null;
  return (
    <section className={styles.degraded} aria-labelledby="previous-plan-title">
      <div>
        <p className={styles.eyebrow}>Last known safe plan</p>
        <h2 id="previous-plan-title">Previous recommendations, for context only</h2>
        <p>PANDO removed every Start and Resume action until recalculation succeeds.</p>
      </div>
      <div className={styles.readOnlyGrid}>
        {workspace.snapshot.plan.actions.map((action) => (
          <ReadOnlyAction action={action} key={`${action.rank}:${action.candidateKey}`} />
        ))}
      </div>
      <PlanContext plan={workspace.snapshot.plan} />
    </section>
  );
}

function CurrentWorkspace({ workspace }: { readonly workspace: TodayWorkspaceV1 }) {
  const items = correlateTodayActions(workspace);
  if (items === null || workspace.snapshot === null) {
    return (
      <section className={styles.stateCard} role="alert">
        <p className={styles.eyebrow}>Today unavailable</p>
        <h1>The recommendation links could not be verified.</h1>
        <p>Nothing was changed. Reload the current Planning projection before choosing work.</p>
        <Link className={styles.secondaryLink} href="/today">
          Try again
        </Link>
      </section>
    );
  }
  if (items.length === 0) {
    const copy =
      emptyStateCopy[
        workspace.snapshot.plan.recommendationState as Exclude<
          ReadablePlanSnapshot["recommendationState"],
          "CURRENT"
        >
      ];
    return (
      <>
        <section className={styles.stateCard}>
          <p className={styles.eyebrow}>No ranked action</p>
          <h1>{copy.title}</h1>
          <p>{copy.detail}</p>
          <Link className={styles.secondaryLink} href={copy.href}>
            {copy.action}
          </Link>
        </section>
        <PlanContext plan={workspace.snapshot.plan} />
      </>
    );
  }
  return (
    <>
      <section className={styles.currentIntro} aria-labelledby="today-title">
        <p className={styles.eyebrow}>Today</p>
        <h1 id="today-title">Choose useful work with a clear reason.</h1>
        <p>Open one recommendation, review its evidence goal, then deliberately start Focus.</p>
      </section>
      <ActionCard item={items[0]!} primary />
      {items.length > 1 ? (
        <section className={styles.alternatives} aria-labelledby="alternatives-title">
          <div>
            <p className={styles.eyebrow}>Other good choices</p>
            <h2 id="alternatives-title">Alternatives</h2>
          </div>
          <div className={styles.alternativeGrid}>
            {items.slice(1).map((item) => (
              <ActionCard item={item} key={item.selection.selectionRef} primary={false} />
            ))}
          </div>
        </section>
      ) : null}
      <PlanContext plan={workspace.snapshot.plan} />
    </>
  );
}

export function TodayWorkspace({ workspace }: { readonly workspace: TodayWorkspaceV1 }) {
  if (workspace.projectionState === "CURRENT") return <CurrentWorkspace workspace={workspace} />;
  if (workspace.projectionState === "NOT_STARTED") {
    return (
      <section className={styles.stateCard}>
        <p className={styles.eyebrow}>Today is getting ready</p>
        <h1>Set up your first daily plan.</h1>
        <p>
          Choose a target and initialize a Growth Plan. PANDO will keep missing evidence Unknown.
        </p>
        <Link className={styles.primaryLink} href="/start">
          Choose a target
        </Link>
      </section>
    );
  }
  const failed = workspace.projectionState === "ERROR";
  return (
    <>
      <section className={styles.stateCard} role={failed ? "alert" : "status"}>
        <p className={styles.eyebrow}>
          {failed ? "Calculation needs attention" : "Plan rebuilding"}
        </p>
        <h1>
          {failed ? "Today could not refresh the plan." : "Today is checking changed inputs."}
        </h1>
        <p>
          {failed
            ? "No command is assumed to have succeeded. Retry the authorized Planning read."
            : workspace.reason === "SNAPSHOT_EXPIRED"
              ? "The previous snapshot expired, so PANDO removed its actions until a fresh plan exists."
              : "A safe previous plan may be shown below, but it cannot start work while inputs are changing."}
        </p>
        <div className={styles.stateActions}>
          <Link className={styles.secondaryLink} href="/today">
            Try again
          </Link>
          <Link className={styles.secondaryLink} href="/review">
            Open Review
          </Link>
        </div>
      </section>
      <DegradedSnapshot workspace={workspace} />
    </>
  );
}
