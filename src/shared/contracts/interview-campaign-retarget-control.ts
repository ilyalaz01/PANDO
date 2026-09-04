import { asJsonObject, asString, type JsonObject, type JsonValue } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export interface InterviewCampaignRetargetBeforeGoalV1 {
  readonly readinessGoalId: string;
  readonly readinessGoalKey: string;
  readonly title: string;
}

export interface InterviewCampaignRetargetAfterGoalV1 {
  readonly readinessGoalId: string;
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE";
  readonly aggregateVersion: string;
}

export interface InterviewCampaignRetargetCampaignBeforeV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT" | "ACTIVE";
  readonly aggregateVersion: string;
  readonly readinessGoal: InterviewCampaignRetargetBeforeGoalV1;
}

export interface InterviewCampaignRetargetCampaignAfterV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT" | "ACTIVE";
  readonly aggregateVersion: string;
  readonly readinessGoal: InterviewCampaignRetargetAfterGoalV1;
  readonly revisionNumber: number;
}

export interface InterviewCampaignRetargetPreviewV1 {
  readonly contract: {
    readonly name: "InterviewCampaignRetargetPreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: "change_campaign_target";
  readonly commandType: "targets.retarget_interview_campaign_v1";
  readonly reason: string;
  readonly before: InterviewCampaignRetargetCampaignBeforeV1;
  readonly after: InterviewCampaignRetargetCampaignAfterV1;
  readonly retained: { readonly previousReadinessGoal: true; readonly newReadinessGoal: true };
  readonly canApply: true;
  readonly blockingReasons: readonly never[];
  readonly warnings: readonly never[];
  readonly previewDigest: string;
}

export interface InterviewCampaignRetargetApplyResultV1 {
  readonly contract: {
    readonly name: "InterviewCampaignRetargetApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly campaign: InterviewCampaignRetargetCampaignAfterV1;
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
  const before = asJsonObject(root.before, "retarget before state");
  const after = asJsonObject(root.after, "retarget after state");
  const beforeGoal = asJsonObject(before.readinessGoal, "retarget previous goal");
  const afterGoal = asJsonObject(after.readinessGoal, "retarget new goal");
  const violations: ContractViolation[] = [];

  if (!campaignKeyBinds(before) || !campaignKeyBinds(after)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_KEY_BINDING",
        "/",
        "The campaign key must bind the campaign's own derived identity.",
      ),
    );
  }
  if (!isLowercase(beforeGoal.readinessGoalId) || !isLowercase(afterGoal.readinessGoalId)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_UUID_CASE",
        "/",
        "Interview Campaign retarget UUID values must use their exact lowercase representation.",
      ),
    );
  }
  if (beforeGoal.readinessGoalId === afterGoal.readinessGoalId) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_RETARGET_SAME_GOAL",
        "/after/readinessGoal",
        "A retarget must select a different Readiness Goal from the current one.",
      ),
    );
  }
  if (
    before.campaignId !== after.campaignId ||
    before.title !== after.title ||
    before.lifecycle !== after.lifecycle ||
    BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n
  ) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_RETARGET_TRANSITION",
        "/after",
        "Retargeting must advance the campaign by exactly one version and change nothing else.",
      ),
    );
  }
  if (typeof after.revisionNumber !== "number" || after.revisionNumber < 1) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_RETARGET_REVISION",
        "/after/revisionNumber",
        "The revision number must be a positive integer.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const campaign = asJsonObject(root.campaign, "retarget apply campaign");
  const goal = asJsonObject(campaign.readinessGoal, "retarget apply goal");
  const violations: ContractViolation[] = [];
  if (!campaignKeyBinds(campaign)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_KEY_BINDING",
        "/campaign/campaignKey",
        "The campaign key must bind the campaign's own derived identity.",
      ),
    );
  }
  if (!isLowercase(root.commandId) || !isLowercase(goal.readinessGoalId)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_UUID_CASE",
        "/",
        "Interview Campaign retarget apply-result UUID values must use their exact lowercase representation.",
      ),
    );
  }
  return violations;
}

export function interviewCampaignRetargetControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Interview Campaign retarget control response");
  const contract = asJsonObject(root.contract, "Interview Campaign retarget contract");
  const name = asString(contract.name);
  if (name === "InterviewCampaignRetargetPreviewV1") return previewSemanticViolations(root);
  if (name === "InterviewCampaignRetargetApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "INTERVIEW_CAMPAIGN_CONTRACT",
      "/contract/name",
      "Unsupported Interview Campaign retarget contract.",
    ),
  ];
}

export function validateInterviewCampaignRetargetControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("interview-campaign-retarget-control-v1", value);
  return structural.valid
    ? validationResult(interviewCampaignRetargetControlSemanticViolations(value))
    : structural;
}

export class InterviewCampaignRetargetContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Interview Campaign retarget response failed its contract.");
    this.name = "InterviewCampaignRetargetContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateInterviewCampaignRetargetControlV1(value);
  if (!validation.valid) throw new InterviewCampaignRetargetContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new InterviewCampaignRetargetContractError([
      semanticViolation(
        "INTERVIEW_CAMPAIGN_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeInterviewCampaignRetargetPreviewV1(
  value: unknown,
): InterviewCampaignRetargetPreviewV1 {
  return decodeNamed<InterviewCampaignRetargetPreviewV1>(
    value,
    "InterviewCampaignRetargetPreviewV1",
  );
}

export function decodeInterviewCampaignRetargetApplyResultV1(
  value: unknown,
): InterviewCampaignRetargetApplyResultV1 {
  return decodeNamed<InterviewCampaignRetargetApplyResultV1>(
    value,
    "InterviewCampaignRetargetApplyResultV1",
  );
}
