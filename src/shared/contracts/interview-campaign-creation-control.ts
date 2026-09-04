import { asJsonObject, asString, type JsonObject, type JsonValue } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export interface InterviewCampaignReadinessGoalRefV1 {
  readonly readinessGoalId: string;
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly aggregateVersion: string;
}

export interface InterviewCampaignDeadlineV1 {
  readonly localDate: string;
  readonly timeZone: string;
  readonly at: string;
}

export interface InterviewCampaignCreationStateV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT";
  readonly aggregateVersion: "1";
  readonly deadline: InterviewCampaignDeadlineV1;
}

export interface InterviewCampaignCreationPreviewV1 {
  readonly contract: {
    readonly name: "InterviewCampaignCreationPreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: "create_interview_campaign";
  readonly commandType: "targets.create_interview_campaign_v1";
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly readinessGoal: InterviewCampaignReadinessGoalRefV1;
  readonly after: InterviewCampaignCreationStateV1;
  readonly canApply: boolean;
  readonly blockingReasons: readonly { readonly code: "TARGETS_CREATE_IDENTITY_COLLISION" }[];
  readonly warnings: readonly never[];
  readonly previewDigest: string;
}

export interface InterviewCampaignCreationApplyResultV1 {
  readonly contract: {
    readonly name: "InterviewCampaignCreationApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly campaign: InterviewCampaignCreationStateV1;
  readonly emittedEventIds: readonly [string];
}

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function isLowercase(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value === value.toLowerCase();
}

function campaignKeyBinds(campaign: JsonObject): boolean {
  return campaign.campaignKey === `campaign:${String(campaign.campaignId).toLowerCase()}`;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const readinessGoal = asJsonObject(root.readinessGoal, "creation readiness goal");
  const after = asJsonObject(root.after, "creation after state");
  const violations: ContractViolation[] = [];

  if (!isLowercase(root.idempotencyKey) || !isLowercase(readinessGoal.readinessGoalId)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_UUID_CASE",
        "/",
        "Interview Campaign creation UUID values must use their exact lowercase representation.",
      ),
    );
  }
  if (!campaignKeyBinds(after)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_KEY_BINDING",
        "/after/campaignKey",
        "The campaign key must bind the campaign's own derived identity.",
      ),
    );
  }
  const blockers = Array.isArray(root.blockingReasons) ? root.blockingReasons : [];
  if (root.canApply !== (blockers.length === 0)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_APPLICABILITY",
        "/canApply",
        "Applicability must exactly reflect the reported blocking reasons.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const campaign = asJsonObject(root.campaign, "creation apply campaign");
  const eventIds = Array.isArray(root.emittedEventIds) ? root.emittedEventIds : [];
  const violations: ContractViolation[] = [];
  if (!isLowercase(root.commandId) || !eventIds.every(isLowercase)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_UUID_CASE",
        "/",
        "Interview Campaign creation apply-result UUID values must use their exact lowercase representation.",
      ),
    );
  }
  if (!campaignKeyBinds(campaign)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_KEY_BINDING",
        "/campaign/campaignKey",
        "The campaign key must bind the campaign's own derived identity.",
      ),
    );
  }
  return violations;
}

export function interviewCampaignCreationControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Interview Campaign creation control response");
  const contract = asJsonObject(root.contract, "Interview Campaign creation contract");
  const name = asString(contract.name);
  if (name === "InterviewCampaignCreationPreviewV1") return previewSemanticViolations(root);
  if (name === "InterviewCampaignCreationApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "INTERVIEW_CAMPAIGN_CONTRACT",
      "/contract/name",
      "Unsupported Interview Campaign creation contract.",
    ),
  ];
}

export function validateInterviewCampaignCreationControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("interview-campaign-creation-control-v1", value);
  return structural.valid
    ? validationResult(interviewCampaignCreationControlSemanticViolations(value))
    : structural;
}

export class InterviewCampaignCreationContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Interview Campaign creation response failed its contract.");
    this.name = "InterviewCampaignCreationContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateInterviewCampaignCreationControlV1(value);
  if (!validation.valid) throw new InterviewCampaignCreationContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new InterviewCampaignCreationContractError([
      semanticViolation(
        "INTERVIEW_CAMPAIGN_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeInterviewCampaignCreationPreviewV1(
  value: unknown,
): InterviewCampaignCreationPreviewV1 {
  return decodeNamed<InterviewCampaignCreationPreviewV1>(
    value,
    "InterviewCampaignCreationPreviewV1",
  );
}

export function decodeInterviewCampaignCreationApplyResultV1(
  value: unknown,
): InterviewCampaignCreationApplyResultV1 {
  return decodeNamed<InterviewCampaignCreationApplyResultV1>(
    value,
    "InterviewCampaignCreationApplyResultV1",
  );
}
