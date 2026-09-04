import { asJsonObject, asString, type JsonObject } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export interface InterviewCampaignDeadlineBeforeV1 {
  readonly localDate: string;
  readonly timeZone: string;
}

export interface InterviewCampaignDeadlineAfterV1 {
  readonly localDate: string;
  readonly timeZone: string;
  readonly at: string;
}

export interface InterviewCampaignDeadlineCampaignBeforeV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT" | "ACTIVE";
  readonly aggregateVersion: string;
  readonly deadline: InterviewCampaignDeadlineBeforeV1;
}

export interface InterviewCampaignDeadlineCampaignAfterV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT" | "ACTIVE";
  readonly aggregateVersion: string;
  readonly deadline: InterviewCampaignDeadlineAfterV1;
}

export interface InterviewCampaignDeadlineChangePreviewV1 {
  readonly contract: {
    readonly name: "InterviewCampaignDeadlineChangePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: "change_campaign_deadline";
  readonly commandType: "targets.change_interview_campaign_deadline_v1";
  readonly reason: string;
  readonly before: InterviewCampaignDeadlineCampaignBeforeV1;
  readonly after: InterviewCampaignDeadlineCampaignAfterV1;
  readonly canApply: true;
  readonly blockingReasons: readonly never[];
  readonly warnings: readonly never[];
  readonly previewDigest: string;
}

export interface InterviewCampaignDeadlineChangeApplyResultV1 {
  readonly contract: {
    readonly name: "InterviewCampaignDeadlineChangeApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly campaign: InterviewCampaignDeadlineCampaignAfterV1;
  readonly emittedEventIds: readonly [string];
}

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function campaignKeyBinds(campaign: JsonObject): boolean {
  return campaign.campaignKey === `campaign:${String(campaign.campaignId).toLowerCase()}`;
}

function transitionConsistent(before: JsonObject, after: JsonObject): boolean {
  if (
    before.campaignId !== after.campaignId ||
    before.campaignKey !== after.campaignKey ||
    before.title !== after.title ||
    before.lifecycle !== after.lifecycle
  ) {
    return false;
  }
  return BigInt(String(after.aggregateVersion)) === BigInt(String(before.aggregateVersion)) + 1n;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const before = asJsonObject(root.before, "deadline before state");
  const after = asJsonObject(root.after, "deadline after state");
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
  if (!transitionConsistent(before, after)) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_DEADLINE_TRANSITION",
        "/after",
        "Changing a deadline must advance the campaign by exactly one version and change nothing else.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const campaign = asJsonObject(root.campaign, "deadline apply campaign");
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
  return violations;
}

export function interviewCampaignDeadlineControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Interview Campaign deadline control response");
  const contract = asJsonObject(root.contract, "Interview Campaign deadline contract");
  const name = asString(contract.name);
  if (name === "InterviewCampaignDeadlineChangePreviewV1") return previewSemanticViolations(root);
  if (name === "InterviewCampaignDeadlineChangeApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "INTERVIEW_CAMPAIGN_CONTRACT",
      "/contract/name",
      "Unsupported Interview Campaign deadline contract.",
    ),
  ];
}

export function validateInterviewCampaignDeadlineControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("interview-campaign-deadline-control-v1", value);
  return structural.valid
    ? validationResult(interviewCampaignDeadlineControlSemanticViolations(value))
    : structural;
}

export class InterviewCampaignDeadlineContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Interview Campaign deadline response failed its contract.");
    this.name = "InterviewCampaignDeadlineContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateInterviewCampaignDeadlineControlV1(value);
  if (!validation.valid) throw new InterviewCampaignDeadlineContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new InterviewCampaignDeadlineContractError([
      semanticViolation(
        "INTERVIEW_CAMPAIGN_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeInterviewCampaignDeadlineChangePreviewV1(
  value: unknown,
): InterviewCampaignDeadlineChangePreviewV1 {
  return decodeNamed<InterviewCampaignDeadlineChangePreviewV1>(
    value,
    "InterviewCampaignDeadlineChangePreviewV1",
  );
}

export function decodeInterviewCampaignDeadlineChangeApplyResultV1(
  value: unknown,
): InterviewCampaignDeadlineChangeApplyResultV1 {
  return decodeNamed<InterviewCampaignDeadlineChangeApplyResultV1>(
    value,
    "InterviewCampaignDeadlineChangeApplyResultV1",
  );
}
