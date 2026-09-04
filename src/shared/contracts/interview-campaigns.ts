import { asArray, asJsonObject, asString } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type InterviewCampaignLifecycleV1 = "DRAFT" | "ACTIVE" | "ENDED" | "CANCELLED";

export type InterviewCampaignCapabilityV1 =
  | "start_campaign"
  | "end_campaign"
  | "change_campaign_deadline"
  | "change_campaign_target"
  | "cancel_campaign";

export interface InterviewCampaignReadinessGoalSummaryV1 {
  readonly readinessGoalKey: string;
  readonly title: string;
}

export interface InterviewCampaignDeadlineSummaryV1 {
  readonly localDate: string;
  readonly timeZone: string;
  readonly at: string;
  readonly passed: boolean;
  readonly daysUntil: number;
}

export interface InterviewCampaignSummaryV1 {
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: InterviewCampaignLifecycleV1;
  readonly readinessGoal: InterviewCampaignReadinessGoalSummaryV1;
  readonly deadline: InterviewCampaignDeadlineSummaryV1;
  readonly aggregateVersion: string;
  readonly capabilities: readonly InterviewCampaignCapabilityV1[];
}

export interface InterviewCampaignsV1 {
  readonly contract: { readonly name: "InterviewCampaignsV1"; readonly version: "1.0.0" };
  readonly campaigns: readonly InterviewCampaignSummaryV1[];
}

const EXPECTED_CAPABILITIES: Readonly<Record<InterviewCampaignLifecycleV1, readonly string[]>> = {
  DRAFT: [
    "cancel_campaign",
    "change_campaign_deadline",
    "change_campaign_target",
    "start_campaign",
  ],
  ACTIVE: ["cancel_campaign", "change_campaign_deadline", "change_campaign_target", "end_campaign"],
  ENDED: [],
  CANCELLED: [],
};

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

export function interviewCampaignsSemanticViolations(value: unknown): readonly ContractViolation[] {
  const root = asJsonObject(value, "Interview Campaigns response");
  const violations: ContractViolation[] = [];
  const campaigns = asArray(root.campaigns);
  campaigns.forEach((item, index) => {
    const campaign = asJsonObject(item, "campaign summary");
    const lifecycle = asString(campaign.lifecycle) as InterviewCampaignLifecycleV1 | undefined;
    const capabilities = asArray(campaign.capabilities)
      .map((code) => asString(code))
      .filter((code): code is string => code !== undefined)
      .slice()
      .sort();
    const expected = lifecycle === undefined ? undefined : EXPECTED_CAPABILITIES[lifecycle];
    if (expected === undefined || capabilities.join(",") !== expected.slice().sort().join(",")) {
      violations.push(
        semanticViolation(
          "INTERVIEW_CAMPAIGN_CAPABILITIES",
          `/campaigns/${index}/capabilities`,
          "Capabilities must exactly match the campaign's lifecycle state.",
        ),
      );
    }
  });
  return violations;
}

export function validateInterviewCampaignsV1(value: unknown): ValidationResult {
  const structural = validateSchema("interview-campaigns-v1", value);
  return structural.valid
    ? validationResult(interviewCampaignsSemanticViolations(value))
    : structural;
}

export class InterviewCampaignsContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Interview Campaigns response failed its contract.");
    this.name = "InterviewCampaignsContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

export function decodeInterviewCampaignsV1(value: unknown): InterviewCampaignsV1 {
  const validation = validateInterviewCampaignsV1(value);
  if (!validation.valid) throw new InterviewCampaignsContractError(validation.violations);
  return value as InterviewCampaignsV1;
}
