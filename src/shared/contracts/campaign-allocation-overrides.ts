import { asArray, asJsonObject, asString } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type CampaignAllocationOverrideLifecycleV1 = "ACTIVE" | "SUPERSEDED" | "REMOVED";

export type CampaignAllocationOverrideCapabilityV1 =
  "change_campaign_allocation_override" | "remove_campaign_allocation_override";

export interface CampaignAllocationOverrideSummaryV1 {
  readonly overrideKey: string;
  readonly campaignKey: string;
  readonly learningTrack: { readonly trackKey: string; readonly title: string };
  readonly lifecycle: CampaignAllocationOverrideLifecycleV1;
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
  readonly aggregateVersion: string;
  readonly capabilities: readonly CampaignAllocationOverrideCapabilityV1[];
}

export interface CampaignAllocationOverridesV1 {
  readonly contract: { readonly name: "CampaignAllocationOverridesV1"; readonly version: "1.0.0" };
  readonly overrides: readonly CampaignAllocationOverrideSummaryV1[];
}

const EXPECTED_CAPABILITIES: Readonly<
  Record<CampaignAllocationOverrideLifecycleV1, readonly string[]>
> = {
  ACTIVE: ["change_campaign_allocation_override", "remove_campaign_allocation_override"],
  SUPERSEDED: [],
  REMOVED: [],
};

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

export function campaignAllocationOverridesSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Campaign allocation overrides response");
  const violations: ContractViolation[] = [];
  const overrides = asArray(root.overrides);
  overrides.forEach((item, index) => {
    const override = asJsonObject(item, "campaign allocation override summary");
    const lifecycle = asString(override.lifecycle) as
      CampaignAllocationOverrideLifecycleV1 | undefined;
    const capabilities = asArray(override.capabilities)
      .map((code) => asString(code))
      .filter((code): code is string => code !== undefined)
      .slice()
      .sort();
    const expected = lifecycle === undefined ? undefined : EXPECTED_CAPABILITIES[lifecycle];
    if (expected === undefined || capabilities.join(",") !== expected.slice().sort().join(",")) {
      violations.push(
        semanticViolation(
          "CAMPAIGN_ALLOCATION_OVERRIDE_CAPABILITIES",
          `/overrides/${index}/capabilities`,
          "Capabilities must exactly match the override's lifecycle state.",
        ),
      );
    }
  });
  return violations;
}

export function validateCampaignAllocationOverridesV1(value: unknown): ValidationResult {
  const structural = validateSchema("campaign-allocation-overrides-v1", value);
  return structural.valid
    ? validationResult(campaignAllocationOverridesSemanticViolations(value))
    : structural;
}

export class CampaignAllocationOverridesContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Campaign allocation overrides response failed its contract.");
    this.name = "CampaignAllocationOverridesContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

export function decodeCampaignAllocationOverridesV1(value: unknown): CampaignAllocationOverridesV1 {
  const validation = validateCampaignAllocationOverridesV1(value);
  if (!validation.valid) throw new CampaignAllocationOverridesContractError(validation.violations);
  return value as CampaignAllocationOverridesV1;
}
