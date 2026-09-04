import { asJsonObject, asString, type JsonObject } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type InterviewCampaignLifecycleOperationV1 =
  "start_campaign" | "end_campaign" | "cancel_campaign";

export interface InterviewCampaignLifecycleCampaignBeforeV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT" | "ACTIVE";
  readonly aggregateVersion: string;
}

export interface InterviewCampaignLifecycleCampaignAfterV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "ENDED" | "CANCELLED";
  readonly aggregateVersion: string;
}

export interface InterviewCampaignLifecyclePreviewV1 {
  readonly contract: {
    readonly name: "InterviewCampaignLifecyclePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: InterviewCampaignLifecycleOperationV1;
  readonly commandType: "targets.change_interview_campaign_lifecycle_v1";
  readonly reason: string;
  readonly before: InterviewCampaignLifecycleCampaignBeforeV1;
  readonly after: InterviewCampaignLifecycleCampaignAfterV1;
  readonly canApply: true;
  readonly blockingReasons: readonly never[];
  readonly warnings: readonly never[];
  readonly previewDigest: string;
}

export interface InterviewCampaignLifecycleApplyResultV1 {
  readonly contract: {
    readonly name: "InterviewCampaignLifecycleApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly campaign: InterviewCampaignLifecycleCampaignAfterV1;
  readonly emittedEventIds: readonly [string];
}

const VALID_TRANSITIONS: Readonly<
  Record<InterviewCampaignLifecycleOperationV1, { readonly from: string; readonly to: string }>
> = {
  start_campaign: { from: "DRAFT", to: "ACTIVE" },
  end_campaign: { from: "ACTIVE", to: "ENDED" },
  cancel_campaign: { from: "DRAFT", to: "CANCELLED" },
};

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function campaignKeyBinds(campaign: JsonObject): boolean {
  return campaign.campaignKey === `campaign:${String(campaign.campaignId).toLowerCase()}`;
}

function transitionIsValid(operation: string, before: string, after: string): boolean {
  if (operation === "cancel_campaign") {
    return (before === "DRAFT" || before === "ACTIVE") && after === "CANCELLED";
  }
  const expected = VALID_TRANSITIONS[operation as InterviewCampaignLifecycleOperationV1];
  return expected !== undefined && expected.from === before && expected.to === after;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const before = asJsonObject(root.before, "lifecycle before state");
  const after = asJsonObject(root.after, "lifecycle after state");
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
  if (
    before.campaignId !== after.campaignId ||
    before.title !== after.title ||
    BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n
  ) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_LIFECYCLE_TRANSITION",
        "/after",
        "A lifecycle change must advance the campaign by exactly one version and change nothing else.",
      ),
    );
  }
  if (
    !transitionIsValid(String(root.operation), String(before.lifecycle), String(after.lifecycle))
  ) {
    violations.push(
      semanticViolation(
        "INTERVIEW_CAMPAIGN_LIFECYCLE_OPERATION",
        "/operation",
        "The operation must match the released draft/active/ended/cancelled transition table.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const campaign = asJsonObject(root.campaign, "lifecycle apply campaign");
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

export function interviewCampaignLifecycleControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Interview Campaign lifecycle control response");
  const contract = asJsonObject(root.contract, "Interview Campaign lifecycle contract");
  const name = asString(contract.name);
  if (name === "InterviewCampaignLifecyclePreviewV1") return previewSemanticViolations(root);
  if (name === "InterviewCampaignLifecycleApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "INTERVIEW_CAMPAIGN_CONTRACT",
      "/contract/name",
      "Unsupported Interview Campaign lifecycle contract.",
    ),
  ];
}

export function validateInterviewCampaignLifecycleControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("interview-campaign-lifecycle-control-v1", value);
  return structural.valid
    ? validationResult(interviewCampaignLifecycleControlSemanticViolations(value))
    : structural;
}

export class InterviewCampaignLifecycleContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Interview Campaign lifecycle response failed its contract.");
    this.name = "InterviewCampaignLifecycleContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateInterviewCampaignLifecycleControlV1(value);
  if (!validation.valid) throw new InterviewCampaignLifecycleContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new InterviewCampaignLifecycleContractError([
      semanticViolation(
        "INTERVIEW_CAMPAIGN_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeInterviewCampaignLifecyclePreviewV1(
  value: unknown,
): InterviewCampaignLifecyclePreviewV1 {
  return decodeNamed<InterviewCampaignLifecyclePreviewV1>(
    value,
    "InterviewCampaignLifecyclePreviewV1",
  );
}

export function decodeInterviewCampaignLifecycleApplyResultV1(
  value: unknown,
): InterviewCampaignLifecycleApplyResultV1 {
  return decodeNamed<InterviewCampaignLifecycleApplyResultV1>(
    value,
    "InterviewCampaignLifecycleApplyResultV1",
  );
}
