import "server-only";

import { createHash } from "node:crypto";

import { asArray, asJsonObject, asNumber, asString } from "../../../shared/contracts/json";
import type { Json, PandoSupabaseClient } from "../../../shared/supabase/database";
import { createPandoInternalProjectionClient } from "../../../shared/supabase/internal-server";
import { SupabaseInternalConfigurationError } from "../../../shared/supabase/internal-config";
import { foldReviewSchedule } from "../domain/fold-review-schedule";
import { REVIEW_POLICY_V0_1 } from "../domain/review-policy-v0.1";
import {
  REVIEW_ACTION_TYPES,
  type ReviewActionEventInput,
  type ReviewReasonSourceEventInput,
} from "../domain/review-schedule-types";
import { ReviewInputError } from "../domain/review-types";
import {
  deriveMasteryReviewSources,
  type MasteryReviewReasonIdentity,
  type MasteryReviewSignal,
} from "./derive-mastery-review-sources";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_REF =
  /^competency:[a-z0-9][a-z0-9-]{1,100}\/(knowledge|recall|application|interview_execution)$/u;
const COMPETENCY_REF = /^competency:[a-z0-9][a-z0-9-]{1,100}$/u;
const POSITIVE_BIGINT = /^[1-9][0-9]{0,18}$/u;
const NON_NEGATIVE_BIGINT = /^(0|[1-9][0-9]{0,18})$/u;
const DIMENSIONS = ["KNOWLEDGE", "RECALL", "APPLICATION", "INTERVIEW_EXECUTION"] as const;
const ACHIEVEMENT_LEVELS = ["NOT_STARTED", "COMPLETED", "VERIFIED", "MASTERED"] as const;
const REVIEW_REASON_TYPES = [
  "RETENTION_RISK",
  "PERSONAL_REMINDER",
  "GOAL_DEADLINE",
  "VERIFICATION_NEEDED",
] as const;
const SOURCE_KINDS = ["MASTERY", "PERSONAL_REMINDER"] as const;
export const REVIEW_HANDLER_TIMEOUT_MS = 20_000;

class ReviewProjectionRpcError extends Error {
  constructor(
    readonly rpcCode: string | undefined,
    readonly contractErrorCode: string | undefined,
  ) {
    super("Review projection RPC failed.");
    this.name = "ReviewProjectionRpcError";
  }
}

const CONTRACT_ERROR_CODES = new Map<string, string>([
  ["review event contract is invalid", "EVENT_CONTRACT_REJECTED"],
  ["review projection subjects are invalid", "SUBJECT_BATCH_REJECTED"],
  ["review projection omitted or added an authoritative subject", "SUBJECT_SET_REJECTED"],
  ["review projection subject is invalid", "SUBJECT_CONTRACT_REJECTED"],
  ["review projection subject does not match authoritative input", "SUBJECT_AUTHORITY_REJECTED"],
  ["review input watermark transition is invalid", "WATERMARK_TRANSITION_REJECTED"],
  ["review projection Mastery pointer is not authoritative", "MASTERY_POINTER_REJECTED"],
  [
    "review projection Mastery source changes are not authoritative",
    "MASTERY_SOURCE_CHANGES_REJECTED",
  ],
  ["review Mastery source event is invalid", "MASTERY_SOURCE_EVENT_REJECTED"],
  ["review projection result is invalid", "PROJECTION_RESULT_REJECTED"],
  ["review projection replay identity sets are not authoritative", "REPLAY_SET_REJECTED"],
  ["review projection reasons are not authoritative", "REASONS_REJECTED"],
  ["review projection inactive calculation is not authoritative", "INACTIVE_ITEM_REJECTED"],
  ["review projection active calculation is not authoritative", "ACTIVE_ITEM_REJECTED"],
]);

class ReviewProjectionInputContractError extends TypeError {
  constructor() {
    super("Review projection input did not match its transport contract.");
    this.name = "ReviewProjectionInputContractError";
  }
}

class ReviewHandlerTimeoutError extends Error {
  constructor() {
    super("Review projection handler exceeded its execution deadline.");
    this.name = "ReviewHandlerTimeoutError";
  }
}

export interface ReviewDispatchSummary {
  readonly configured: boolean;
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
}

interface FocusReference {
  readonly readinessGoalKey: string;
  readonly activityKey: string;
  readonly activityTitle: string;
}

interface TransportMasterySignal extends MasteryReviewSignal {
  readonly snapshotId: string;
  readonly inputWatermark: string;
  readonly projectionVersion: string;
  readonly focus: FocusReference | null;
}

interface ProjectionSubjectInput {
  readonly subjectId: string;
  readonly subjectRef: string;
  readonly competencyRef: string;
  readonly dimension: (typeof DIMENSIONS)[number];
  readonly currentInputWatermark: string;
  readonly focus: FocusReference | null;
  readonly masterySignal: TransportMasterySignal | null;
  readonly reasonIdentities: readonly MasteryReviewReasonIdentity[];
  readonly sourceEvents: readonly ReviewReasonSourceEventInput[];
  readonly actionEvents: readonly ReviewActionEventInput[];
}

interface ProjectionInput {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly calculatedAsOf: string;
  readonly subjects: readonly ProjectionSubjectInput[];
}

interface ReviewClaim {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly eventPosition: number;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

function stringMatching(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function nullableStringMatching(value: unknown, pattern: RegExp, label: string): string | null {
  return value === null ? null : stringMatching(value, pattern, label);
}

function instant(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} is invalid`);
  return new Date(milliseconds).toISOString();
}

function nullableInstant(value: unknown, label: string): string | null {
  return value === null ? null : instant(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`);
  return value;
}

function focusReference(value: unknown, label: string): FocusReference | null {
  if (value === null) return null;
  const item = asJsonObject(value, label);
  const readinessGoalKey = asString(item.readinessGoalKey);
  const activityKey = asString(item.activityKey);
  const activityTitle = asString(item.activityTitle);
  if (
    readinessGoalKey === undefined ||
    !/^goal:[a-z0-9][a-z0-9-]{1,100}$/u.test(readinessGoalKey) ||
    activityKey === undefined ||
    !/^activity:[a-z0-9][a-z0-9-]{1,100}$/u.test(activityKey) ||
    activityTitle === undefined ||
    activityTitle.trim() !== activityTitle ||
    activityTitle.length < 1 ||
    activityTitle.length > 200
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return { readinessGoalKey, activityKey, activityTitle };
}

function sourceEvent(value: unknown, index: number): ReviewReasonSourceEventInput {
  const item = asJsonObject(value, `sourceEvents[${index}]`);
  const sourceRevision = asNumber(item.sourceRevision);
  if (sourceRevision === undefined || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1) {
    throw new TypeError("source revision is invalid");
  }
  return {
    eventId: stringMatching(item.eventId, UUID, "source event ID"),
    reasonId: stringMatching(item.reasonId, UUID, "reason ID"),
    sourceKey: stringMatching(item.sourceKey, /^.{1,240}$/u, "source key"),
    sourceRevision,
    sourceKind: oneOf(item.sourceKind, SOURCE_KINDS, "source kind"),
    subjectId: stringMatching(item.subjectId, UUID, "source subject ID"),
    reason: oneOf(item.reason, REVIEW_REASON_TYPES, "source reason"),
    occurrenceId: stringMatching(item.occurrenceId, UUID, "occurrence ID"),
    baseDueAt: instant(item.baseDueAt, "base due time"),
    sourceActive: boolean(item.sourceActive, "source active"),
  };
}

function actionEvent(value: unknown, index: number): ReviewActionEventInput {
  const item = asJsonObject(value, `actionEvents[${index}]`);
  const actionRevision = asNumber(item.actionRevision);
  if (actionRevision === undefined || !Number.isSafeInteger(actionRevision) || actionRevision < 1) {
    throw new TypeError("action revision is invalid");
  }
  return {
    actionId: stringMatching(item.actionId, UUID, "action ID"),
    actionRevision,
    sourceKey: stringMatching(item.sourceKey, /^.{1,240}$/u, "action source key"),
    occurrenceId: stringMatching(item.occurrenceId, UUID, "action occurrence ID"),
    action: oneOf(item.action, REVIEW_ACTION_TYPES, "action"),
    occurredAt: instant(item.occurredAt, "action occurrence time"),
    targetDueAt: nullableInstant(item.targetDueAt, "action target due time"),
  };
}

function masterySignal(value: unknown): TransportMasterySignal | null {
  if (value === null) return null;
  const item = asJsonObject(value, "masterySignal");
  return {
    achievementLevel: oneOf(item.achievementLevel, ACHIEVEMENT_LEVELS, "mastery achievement level"),
    latestQualifyingSuccessAt: nullableInstant(
      item.latestQualifyingSuccessAt,
      "latest qualifying success",
    ),
    latestSupportingEvidenceId: nullableStringMatching(
      item.latestSupportingEvidenceId,
      UUID,
      "latest supporting evidence ID",
    ),
    snapshotId: stringMatching(item.snapshotId, UUID, "mastery snapshot ID"),
    inputWatermark: stringMatching(item.inputWatermark, POSITIVE_BIGINT, "mastery watermark"),
    projectionVersion: stringMatching(
      item.projectionVersion,
      POSITIVE_BIGINT,
      "mastery projection version",
    ),
    focus: focusReference(item.focus, "mastery focus"),
  };
}

function projectionSubject(value: unknown, index: number): ProjectionSubjectInput {
  const item = asJsonObject(value, `subjects[${index}]`);
  const subjectId = stringMatching(item.subjectId, UUID, "subject ID");
  const subjectRef = stringMatching(item.subjectRef, SUBJECT_REF, "subject ref");
  const competencyRef = stringMatching(item.competencyRef, COMPETENCY_REF, "competency ref");
  const dimension = oneOf(item.dimension, DIMENSIONS, "dimension");
  if (subjectRef !== `${competencyRef}/${dimension.toLowerCase()}`) {
    throw new TypeError("Review subject identity is inconsistent");
  }
  const reasonIdentities = asArray(item.reasonIdentities).map((value, identityIndex) => {
    const identity = asJsonObject(value, `reasonIdentities[${identityIndex}]`);
    return {
      reasonId: stringMatching(identity.reasonId, UUID, "identity reason ID"),
      sourceKey: stringMatching(identity.sourceKey, /^.{1,240}$/u, "identity source key"),
      reason: oneOf(
        identity.reason,
        ["RETENTION_RISK", "VERIFICATION_NEEDED"] as const,
        "identity reason",
      ),
    };
  });
  const sourceEvents = asArray(item.sourceEvents).map(sourceEvent);
  if (sourceEvents.some((event) => event.subjectId !== subjectId)) {
    throw new TypeError("Review source belongs to another subject");
  }
  return {
    subjectId,
    subjectRef,
    competencyRef,
    dimension,
    currentInputWatermark: stringMatching(
      item.currentInputWatermark,
      NON_NEGATIVE_BIGINT,
      "current Review watermark",
    ),
    focus: focusReference(item.focus, "Review focus"),
    masterySignal: masterySignal(item.masterySignal),
    reasonIdentities,
    sourceEvents,
    actionEvents: asArray(item.actionEvents).map(actionEvent),
  };
}

function decodeProjectionInput(value: unknown): ProjectionInput {
  const item = asJsonObject(value, "Review projection input");
  const workspaceId = stringMatching(item.workspaceId, UUID, "workspace ID");
  const subjects = asArray(item.subjects).map(projectionSubject);
  if (
    subjects.length > 4 ||
    new Set(subjects.map(({ subjectId }) => subjectId)).size !== subjects.length
  ) {
    throw new TypeError("Review subjects are duplicated or unbounded");
  }
  return {
    eventId: stringMatching(item.eventId, UUID, "Review input event ID"),
    workspaceId,
    calculatedAsOf: instant(item.calculatedAsOf, "calculation clock"),
    subjects,
  };
}

function stableUuid(scope: string): string {
  const value = createHash("md5").update(scope, "utf8").digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

function prepareSubject(input: ProjectionInput, subject: ProjectionSubjectInput): Json | null {
  const newSourceEvents =
    subject.masterySignal === null
      ? []
      : deriveMasteryReviewSources({
          subjectId: subject.subjectId,
          signal: subject.masterySignal,
          identities: subject.reasonIdentities,
          sourceEvents: subject.sourceEvents,
          createEventId: (identity, sourceRevision) =>
            stableUuid(
              `${input.eventId}:${subject.subjectId}:${identity.sourceKey}:${sourceRevision}`,
            ),
        });
  const currentWatermark = Number(subject.currentInputWatermark);
  if (!Number.isSafeInteger(currentWatermark)) {
    throw new ReviewProjectionInputContractError();
  }
  const nextWatermark = currentWatermark + (newSourceEvents.length > 0 ? 1 : 0);
  if (nextWatermark < 1 || !Number.isSafeInteger(nextWatermark)) return null;
  const focus = subject.masterySignal === null ? subject.focus : subject.masterySignal.focus;
  const state = foldReviewSchedule(
    {
      workspaceId: input.workspaceId,
      subjectId: subject.subjectId,
      inputWatermark: String(nextWatermark),
      sourceEvents: [...subject.sourceEvents, ...newSourceEvents],
      actionEvents: subject.actionEvents,
    },
    REVIEW_POLICY_V0_1,
    { asOf: input.calculatedAsOf },
  );
  return {
    subjectId: subject.subjectId,
    subjectRef: subject.subjectRef,
    competencyRef: subject.competencyRef,
    dimension: subject.dimension,
    expectedInputWatermark: subject.currentInputWatermark,
    nextInputWatermark: String(nextWatermark),
    masterySnapshotId: subject.masterySignal?.snapshotId ?? null,
    masteryInputWatermark: subject.masterySignal?.inputWatermark ?? null,
    masteryProjectionVersion: subject.masterySignal?.projectionVersion ?? null,
    focus: focus as unknown as Json,
    newSourceEvents: newSourceEvents as unknown as Json,
    state: state as unknown as Json,
  };
}

async function awaitWithAbort<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return await operation;
  if (signal.aborted) throw signal.reason;
  let rejectOnAbort: ((reason?: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort?.(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function checkedRpc(
  client: PandoSupabaseClient,
  name:
    | "claim_review_item_projection_v1"
    | "load_review_item_projection_v1"
    | "complete_review_item_projection_v1"
    | "fail_review_item_projection_v1",
  parameters: Record<string, Json> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const request = client.rpc(name as never, parameters as never) as unknown as
    | PromiseLike<{ data: unknown; error: unknown | null }>
    | {
        abortSignal?: (
          requestSignal: AbortSignal,
        ) => PromiseLike<{ data: unknown; error: unknown | null }>;
      };
  const operation =
    signal !== undefined && "abortSignal" in request && typeof request.abortSignal === "function"
      ? request.abortSignal(signal)
      : (request as PromiseLike<{ data: unknown; error: unknown | null }>);
  const result = await awaitWithAbort(operation, signal);
  if (result.error !== null) {
    const error = asJsonObject(result.error, "Review projection RPC error");
    const message = asString(error.message);
    throw new ReviewProjectionRpcError(
      asString(error.code),
      message === undefined ? undefined : CONTRACT_ERROR_CODES.get(message),
    );
  }
  return result.data;
}

function decodeClaim(value: unknown, index: number): ReviewClaim {
  const item = asJsonObject(value, `claims[${index}]`);
  const eventPosition = asNumber(item.event_position);
  if (eventPosition === undefined || !Number.isSafeInteger(eventPosition) || eventPosition < 1) {
    throw new TypeError("Review claim position is invalid");
  }
  return {
    deliveryId: stringMatching(item.delivery_id, UUID, "delivery ID"),
    leaseToken: stringMatching(item.lease_token, UUID, "lease token"),
    eventPosition,
  };
}

function classifyFailure(error: unknown): Readonly<{
  failureClass: "TRANSIENT" | "INVALID_CONTRACT";
  errorCode: string;
}> {
  if (error instanceof ReviewHandlerTimeoutError) {
    return { failureClass: "TRANSIENT", errorCode: "HANDLER_TIMEOUT" };
  }
  if (error instanceof ReviewProjectionInputContractError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PROJECTION_INPUT" };
  }
  if (error instanceof ReviewInputError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_REVIEW_INPUT" };
  }
  if (error instanceof TypeError) {
    return { failureClass: "INVALID_CONTRACT", errorCode: "INVALID_PROJECTION_RESULT" };
  }
  if (
    error instanceof ReviewProjectionRpcError &&
    error.rpcCode !== undefined &&
    (/^22/u.test(error.rpcCode) || error.rpcCode === "23514" || error.rpcCode === "PGRST102")
  ) {
    return {
      failureClass: "INVALID_CONTRACT",
      errorCode: error.contractErrorCode ?? "PROJECTION_CONTRACT_REJECTED",
    };
  }
  return { failureClass: "TRANSIENT", errorCode: "DISPATCH_FAILED" };
}

async function failDelivery(
  client: PandoSupabaseClient,
  claim: ReviewClaim,
  failureClass: "TRANSIENT" | "STALE_INPUT" | "INVALID_CONTRACT",
  errorCode: string,
  signal?: AbortSignal,
): Promise<void> {
  await checkedRpc(
    client,
    "fail_review_item_projection_v1",
    {
      p_delivery_id: claim.deliveryId,
      p_lease_token: claim.leaseToken,
      p_failure_class: failureClass,
      p_error_code: errorCode,
    },
    signal,
  );
}

async function processClaim(
  client: PandoSupabaseClient,
  claim: ReviewClaim,
): Promise<"completed" | "retried"> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new ReviewHandlerTimeoutError()),
    REVIEW_HANDLER_TIMEOUT_MS,
  );
  try {
    let input: ProjectionInput;
    try {
      input = decodeProjectionInput(
        await checkedRpc(
          client,
          "load_review_item_projection_v1",
          { p_delivery_id: claim.deliveryId, p_lease_token: claim.leaseToken },
          controller.signal,
        ),
      );
    } catch (error) {
      if (error instanceof ReviewProjectionRpcError) throw error;
      throw new ReviewProjectionInputContractError();
    }
    const subjects = input.subjects
      .map((subject) => prepareSubject(input, subject))
      .filter((subject): subject is Json => subject !== null);
    const applied = await checkedRpc(
      client,
      "complete_review_item_projection_v1",
      {
        p_delivery_id: claim.deliveryId,
        p_lease_token: claim.leaseToken,
        p_expected_event_position: claim.eventPosition,
        p_subjects: subjects,
      },
      controller.signal,
    );
    if (applied !== true) {
      await failDelivery(client, claim, "STALE_INPUT", "STALE_REVIEW_INPUT", controller.signal);
      return "retried";
    }
    return "completed";
  } catch (error) {
    const failure = classifyFailure(error);
    try {
      await failDelivery(
        client,
        claim,
        failure.failureClass,
        failure.errorCode,
        controller.signal.aborted ? AbortSignal.timeout(2_000) : controller.signal,
      );
    } catch {
      // The durable lease is reclaimed after expiry; never bypass the worker boundary.
    }
    return "retried";
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchReviewItemProjection(
  client: PandoSupabaseClient,
): Promise<ReviewDispatchSummary> {
  const rawClaims = await checkedRpc(client, "claim_review_item_projection_v1");
  if (!Array.isArray(rawClaims)) throw new TypeError("Review claim response must be an array");
  const claims = rawClaims.map(decodeClaim);
  const outcomes = await Promise.all(claims.map((claim) => processClaim(client, claim)));
  const completed = outcomes.filter((outcome) => outcome === "completed").length;
  return {
    configured: true,
    claimed: claims.length,
    completed,
    retried: outcomes.length - completed,
  };
}

export async function dispatchReviewItemProjectionIfConfigured(): Promise<ReviewDispatchSummary> {
  try {
    return await dispatchReviewItemProjection(createPandoInternalProjectionClient());
  } catch (error) {
    if (error instanceof SupabaseInternalConfigurationError) {
      return { configured: false, claimed: 0, completed: 0, retried: 0 };
    }
    return { configured: true, claimed: 0, completed: 0, retried: 1 };
  }
}
