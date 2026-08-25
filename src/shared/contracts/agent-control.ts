import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  hasDuplicates,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

const ROOT_CONTEXT_MAX_BYTES = 12 * 1024;

function objects(value: JsonValue | undefined): JsonObject[] {
  return asArray(value).filter(isJsonObject);
}

function add(violations: ContractViolation[], code: string, path: string, message: string): void {
  if (!violations.some((item) => item.code === code && item.path === path)) {
    violations.push({ code, path, message });
  }
}

export interface AgentControlContextValidationOptions {
  readonly expectedWorkspaceId?: string;
  readonly maximumSerializedBytes?: number;
}

export function validateAgentControlContextSemantics(
  value: unknown,
  options: AgentControlContextValidationOptions = {},
): ValidationResult {
  const context = asJsonObject(value, "AgentControlContextV1");
  const violations: ContractViolation[] = [];
  const maximumBytes = options.maximumSerializedBytes ?? ROOT_CONTEXT_MAX_BYTES;
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximumBytes) {
    add(
      violations,
      "AGENT_CONTEXT_SIZE_LIMIT",
      "/",
      `Root control context exceeds ${maximumBytes} UTF-8 bytes.`,
    );
  }

  const workspace = asJsonObject(context.workspace, "workspace");
  if (
    options.expectedWorkspaceId !== undefined &&
    asString(workspace.workspace_id) !== options.expectedWorkspaceId
  ) {
    add(
      violations,
      "AGENT_CONTEXT_WORKSPACE_MISMATCH",
      "/workspace/workspace_id",
      "The authorized workspace must match the control projection workspace.",
    );
  }

  const goals = objects(context.goals);
  const goalIds = goals.map((goal) => asString(goal.goal_id)!);
  if (hasDuplicates(goalIds)) {
    add(violations, "AGENT_CONTEXT_DUPLICATE_GOAL", "/goals", "Goal IDs must be unique.");
  }

  const detailRefs = objects(context.detail_refs);
  const detailIds = detailRefs.map((detail) => asString(detail.ref)!);
  if (hasDuplicates(detailIds)) {
    add(
      violations,
      "AGENT_CONTEXT_DUPLICATE_DETAIL_REF",
      "/detail_refs",
      "Detail references must be unique.",
    );
  }
  const blockers = objects(context.blockers);
  for (const [index, blocker] of blockers.entries()) {
    const detailRef = asString(blocker.detail_ref);
    if (detailRef !== undefined && !detailIds.includes(detailRef)) {
      add(
        violations,
        "AGENT_CONTEXT_DETAIL_REF_MISSING",
        `/blockers/${index}/detail_ref`,
        "Blocker detail_ref must resolve within detail_refs.",
      );
    }
  }

  const activeCampaign = context.active_campaign;
  if (isJsonObject(activeCampaign)) {
    if (asString(activeCampaign.status) !== "active") {
      add(
        violations,
        "AGENT_CONTEXT_ACTIVE_CAMPAIGN_STATUS",
        "/active_campaign/status",
        "active_campaign must have active lifecycle status.",
      );
    }
    const readinessGoalId = asString(activeCampaign.readiness_goal_id);
    const readinessGoal = goals.find((goal) => asString(goal.goal_id) === readinessGoalId);
    if (readinessGoal === undefined || asString(readinessGoal.kind) !== "readiness") {
      add(
        violations,
        "AGENT_CONTEXT_READINESS_GOAL_MISSING",
        "/active_campaign/readiness_goal_id",
        "An active campaign must reference a readiness goal in the root summary.",
      );
    }
    if (readinessGoal !== undefined && readinessGoal.deadline !== activeCampaign.deadline) {
      add(
        violations,
        "AGENT_CONTEXT_CAMPAIGN_DEADLINE_MISMATCH",
        "/active_campaign/deadline",
        "Campaign and summarized readiness-goal deadlines must agree.",
      );
    }
  }

  if (isJsonObject(context.growth_plan)) {
    const growthPlan = context.growth_plan;
    const tracks = objects(growthPlan.tracks);
    const trackIds = tracks.map((track) => asString(track.track_id)!);
    if (hasDuplicates(trackIds)) {
      add(
        violations,
        "AGENT_CONTEXT_DUPLICATE_TRACK",
        "/growth_plan/tracks",
        "Track IDs must be unique.",
      );
    }
    const protectedMinutes = tracks.reduce(
      (total, track) => total + (asNumber(track.protected_minimum_minutes) ?? 0),
      0,
    );
    if (protectedMinutes > (asNumber(growthPlan.weekly_capacity_minutes) ?? 0)) {
      add(
        violations,
        "AGENT_CONTEXT_PROTECTED_MINIMUM_EXCEEDS_CAPACITY",
        "/growth_plan/tracks",
        "Protected track minima cannot exceed summarized weekly capacity.",
      );
    }
  }

  return validationResult(violations);
}

export function validateAgentControlContext(
  value: unknown,
  options: AgentControlContextValidationOptions = {},
): ValidationResult {
  const structural = validateSchema("agent-control-context", value);
  return structural.valid ? validateAgentControlContextSemantics(value, options) : structural;
}

interface OperationContract {
  readonly required: readonly string[];
  readonly allowed: readonly string[];
  readonly aggregate: "create" | "existing";
}

const operationContracts: Readonly<Record<string, OperationContract>> = {
  create_goal: {
    required: ["title", "goal_kind"],
    allowed: ["title", "goal_kind", "deadline", "target_profile_version_id"],
    aggregate: "create",
  },
  supersede_goal: {
    required: ["goal_id", "lifecycle_reason"],
    allowed: ["goal_id", "lifecycle_reason", "title", "deadline", "target_profile_version_id"],
    aggregate: "existing",
  },
  start_campaign: {
    required: ["title", "goal_id", "deadline", "target_profile_version_id"],
    allowed: ["title", "goal_id", "deadline", "target_profile_version_id", "allocation_minutes"],
    aggregate: "create",
  },
  end_campaign: lifecycleContract("campaign_id"),
  cancel_campaign: lifecycleContract("campaign_id"),
  change_campaign_deadline: existingContract(
    ["campaign_id", "deadline"],
    ["campaign_id", "deadline"],
  ),
  change_campaign_target: existingContract(
    ["campaign_id", "target_profile_version_id"],
    ["campaign_id", "target_profile_version_id"],
  ),
  pause_growth_plan: lifecycleContract(),
  resume_growth_plan: lifecycleContract(),
  archive_growth_plan: lifecycleContract(),
  create_track: existingContract(
    ["title", "priority"],
    ["title", "priority", "cadence_per_week", "protected_minimum_minutes"],
  ),
  pause_track: lifecycleContract("track_id"),
  resume_track: lifecycleContract("track_id"),
  complete_track: lifecycleContract("track_id"),
  archive_track: lifecycleContract("track_id"),
  set_default_capacity: existingContract(["weekly_capacity_minutes"], ["weekly_capacity_minutes"]),
  set_availability: existingContract(["date", "available_minutes"], ["date", "available_minutes"]),
  set_track_cadence: existingContract(
    ["track_id", "cadence_per_week"],
    ["track_id", "cadence_per_week", "protected_minimum_minutes"],
  ),
  set_allocation: existingContract(
    ["campaign_id", "track_id", "allocation_minutes"],
    ["campaign_id", "track_id", "allocation_minutes"],
  ),
  accept_staged_personal_content: existingContract(["staged_item_ids"], ["staged_item_ids"]),
};

function lifecycleContract(idField?: string): OperationContract {
  const required = idField === undefined ? ["lifecycle_reason"] : [idField, "lifecycle_reason"];
  return { required, allowed: required, aggregate: "existing" };
}

function existingContract(
  required: readonly string[],
  allowed: readonly string[],
): OperationContract {
  return { required, allowed, aggregate: "existing" };
}

export interface AgentChangeSetValidationOptions {
  readonly aggregateVersions?: Readonly<Record<string, number>>;
  readonly now?: Date;
}

export function validateAgentChangeSetSemantics(
  value: unknown,
  options: AgentChangeSetValidationOptions = {},
): ValidationResult {
  const changeSet = asJsonObject(value, "PlanChangeSetV1");
  const violations: ContractViolation[] = [];
  const operations = objects(changeSet.operations);
  const operationIds = operations.map((operation) => asString(operation.operation_id)!);
  if (hasDuplicates(operationIds)) {
    add(
      violations,
      "AGENT_CHANGE_SET_DUPLICATE_OPERATION",
      "/operations",
      "Operation IDs must be unique within a change set.",
    );
  }

  for (const [index, operation] of operations.entries()) {
    const type = asString(operation.operation_type)!;
    const contract = operationContracts[type];
    const argumentsValue = asJsonObject(operation.arguments, "operation arguments");
    if (contract === undefined) continue;
    for (const field of contract.required) {
      if (!(field in argumentsValue)) {
        add(
          violations,
          "AGENT_CHANGE_SET_ARGUMENT_REQUIRED",
          `/operations/${index}/arguments/${field}`,
          `${type} requires argument ${field}.`,
        );
      }
    }
    for (const field of Object.keys(argumentsValue)) {
      if (!contract.allowed.includes(field)) {
        add(
          violations,
          "AGENT_CHANGE_SET_ARGUMENT_FORBIDDEN",
          `/operations/${index}/arguments/${field}`,
          `${type} does not accept argument ${field}.`,
        );
      }
    }
    const aggregateRef = asString(operation.aggregate_ref);
    const expectedVersion = asNumber(operation.expected_version);
    if (
      contract.aggregate === "create" &&
      (aggregateRef !== undefined || expectedVersion !== undefined)
    ) {
      add(
        violations,
        "AGENT_CHANGE_SET_CREATE_AGGREGATE_VERSION",
        `/operations/${index}`,
        "Creation operations must not claim an existing aggregate or version.",
      );
    }
    if (
      contract.aggregate === "existing" &&
      (aggregateRef === undefined || expectedVersion === undefined)
    ) {
      add(
        violations,
        "AGENT_CHANGE_SET_EXPECTED_VERSION_REQUIRED",
        `/operations/${index}`,
        "Existing-aggregate operations require aggregate_ref and expected_version.",
      );
    }
    if (
      aggregateRef !== undefined &&
      options.aggregateVersions?.[aggregateRef] !== undefined &&
      options.aggregateVersions[aggregateRef] !== expectedVersion
    ) {
      add(
        violations,
        "AGENT_CHANGE_SET_STALE_AGGREGATE_VERSION",
        `/operations/${index}/expected_version`,
        "The expected aggregate version is stale.",
      );
    }
  }

  const status = asString(changeSet.status);
  const preview = isJsonObject(changeSet.preview) ? changeSet.preview : undefined;
  const confirmation = isJsonObject(changeSet.confirmation) ? changeSet.confirmation : undefined;
  const result = isJsonObject(changeSet.result) ? changeSet.result : undefined;
  if (
    status === "draft" &&
    (preview !== undefined || confirmation !== undefined || result !== undefined)
  ) {
    add(
      violations,
      "AGENT_CHANGE_SET_DRAFT_HAS_EFFECTS",
      "/status",
      "A draft cannot contain preview, confirmation, or result state.",
    );
  }
  if (
    status === "previewed" &&
    (preview === undefined || confirmation !== undefined || result !== undefined)
  ) {
    add(
      violations,
      "AGENT_CHANGE_SET_PREVIEW_STATE_INVALID",
      "/status",
      "A previewed change set has one preview and no confirmation or result.",
    );
  }
  if (
    status === "applied" &&
    (preview === undefined || confirmation === undefined || result === undefined)
  ) {
    add(
      violations,
      "AGENT_CHANGE_SET_APPLIED_STATE_INVALID",
      "/status",
      "An applied change set requires preview, confirmation, and result.",
    );
  }
  if ((status === "rejected" || status === "expired") && result !== undefined) {
    add(
      violations,
      "AGENT_CHANGE_SET_TERMINAL_RESULT_FORBIDDEN",
      "/result",
      "Rejected or expired proposals cannot have an applied result.",
    );
  }
  if (
    preview !== undefined &&
    confirmation !== undefined &&
    preview.preview_digest !== confirmation.preview_digest
  ) {
    add(
      violations,
      "AGENT_CHANGE_SET_CONFIRMATION_DIGEST_MISMATCH",
      "/confirmation/preview_digest",
      "Confirmation must bind to the exact preview digest.",
    );
  }
  if (
    preview !== undefined &&
    options.now !== undefined &&
    Date.parse(asString(preview.expires_at)!) <= options.now.getTime() &&
    status !== "expired"
  ) {
    add(
      violations,
      "AGENT_CHANGE_SET_PREVIEW_EXPIRED",
      "/preview/expires_at",
      "An expired preview cannot remain actionable.",
    );
  }
  if (
    result !== undefined &&
    (asNumber(result.resulting_projection_watermark) ?? -1) <=
      (asNumber(changeSet.base_projection_watermark) ?? -1)
  ) {
    add(
      violations,
      "AGENT_CHANGE_SET_RESULT_WATERMARK_INVALID",
      "/result/resulting_projection_watermark",
      "An applied result must advance the projection watermark.",
    );
  }

  return validationResult(violations);
}

export function validateAgentChangeSet(
  value: unknown,
  options: AgentChangeSetValidationOptions = {},
): ValidationResult {
  const structural = validateSchema("agent-change-set", value);
  return structural.valid ? validateAgentChangeSetSemantics(value, options) : structural;
}
