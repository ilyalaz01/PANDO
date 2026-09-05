import { asJsonObject, asString, type JsonObject } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type CampaignAllocationOverrideOperationV1 =
  "change_campaign_allocation_override" | "remove_campaign_allocation_override";

export interface CampaignAllocationOverrideLearningTrackV1 {
  readonly trackKey: string;
  readonly title: string;
}

export interface CampaignAllocationOverrideStateV1 {
  readonly overrideId: string;
  readonly overrideKey: string;
  readonly lifecycle: "ACTIVE" | "REMOVED";
  readonly aggregateVersion: string;
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
}

export interface CampaignAllocationOverrideChangePreviewV1 {
  readonly contract: {
    readonly name: "CampaignAllocationOverrideChangePreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: CampaignAllocationOverrideOperationV1;
  readonly commandType: "planning.change_campaign_allocation_override_v1";
  readonly reason: string;
  readonly campaignKey: string;
  readonly learningTrack: CampaignAllocationOverrideLearningTrackV1;
  readonly before: CampaignAllocationOverrideStateV1;
  readonly after: CampaignAllocationOverrideStateV1;
  readonly canApply: boolean;
  readonly blockingReasons: readonly { readonly code: "ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY" }[];
  readonly warnings: readonly never[];
  readonly previewDigest: string;
}

export interface CampaignAllocationOverrideChangeApplyResultV1 {
  readonly contract: {
    readonly name: "CampaignAllocationOverrideChangeApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly override: CampaignAllocationOverrideStateV1;
  readonly emittedEventIds: readonly [string];
}

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function overrideKeyBinds(state: JsonObject): boolean {
  return state.overrideKey === `override:${String(state.overrideId).toLowerCase()}`;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const before = asJsonObject(root.before, "override before state");
  const after = asJsonObject(root.after, "override after state");
  const violations: ContractViolation[] = [];

  if (!overrideKeyBinds(before) || !overrideKeyBinds(after)) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_KEY_BINDING",
        "/",
        "The override key must bind the override's own derived identity.",
      ),
    );
  }
  if (
    before.overrideId !== after.overrideId ||
    BigInt(String(after.aggregateVersion)) !== BigInt(String(before.aggregateVersion)) + 1n
  ) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_TRANSITION",
        "/after",
        "A change must keep the same override identity and advance it by exactly one version.",
      ),
    );
  }
  const expectedLifecycle =
    root.operation === "remove_campaign_allocation_override" ? "REMOVED" : "ACTIVE";
  if (before.lifecycle !== "ACTIVE" || after.lifecycle !== expectedLifecycle) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_OPERATION",
        "/operation",
        "The operation must match the released change/remove lifecycle transition.",
      ),
    );
  }
  if (
    root.operation === "remove_campaign_allocation_override" &&
    (after.priorityOverride !== before.priorityOverride ||
      after.protectedMinimumMinutesOverride !== before.protectedMinimumMinutesOverride ||
      after.cadencePerWeekOverride !== before.cadencePerWeekOverride)
  ) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_REMOVAL_VALUES",
        "/after",
        "Removal must retain the override's recorded values unchanged as history.",
      ),
    );
  }
  const blockers = Array.isArray(root.blockingReasons) ? root.blockingReasons : [];
  if (root.canApply !== (blockers.length === 0)) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_APPLICABILITY",
        "/canApply",
        "Applicability must exactly reflect the reported blocking reasons.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const override = asJsonObject(root.override, "override apply result");
  const violations: ContractViolation[] = [];
  if (!overrideKeyBinds(override)) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_KEY_BINDING",
        "/override/overrideKey",
        "The override key must bind the override's own derived identity.",
      ),
    );
  }
  return violations;
}

export function campaignAllocationOverrideControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Campaign allocation override control response");
  const contract = asJsonObject(root.contract, "Campaign allocation override contract");
  const name = asString(contract.name);
  if (name === "CampaignAllocationOverrideChangePreviewV1") return previewSemanticViolations(root);
  if (name === "CampaignAllocationOverrideChangeApplyResultV1") {
    return applySemanticViolations(root);
  }
  return [
    semanticViolation(
      "CAMPAIGN_ALLOCATION_OVERRIDE_CONTRACT",
      "/contract/name",
      "Unsupported campaign allocation override contract.",
    ),
  ];
}

export function validateCampaignAllocationOverrideControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("campaign-allocation-override-control-v1", value);
  return structural.valid
    ? validationResult(campaignAllocationOverrideControlSemanticViolations(value))
    : structural;
}

export class CampaignAllocationOverrideContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Campaign allocation override response failed its contract.");
    this.name = "CampaignAllocationOverrideContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateCampaignAllocationOverrideControlV1(value);
  if (!validation.valid) throw new CampaignAllocationOverrideContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new CampaignAllocationOverrideContractError([
      semanticViolation(
        "CAMPAIGN_ALLOCATION_OVERRIDE_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeCampaignAllocationOverrideChangePreviewV1(
  value: unknown,
): CampaignAllocationOverrideChangePreviewV1 {
  return decodeNamed<CampaignAllocationOverrideChangePreviewV1>(
    value,
    "CampaignAllocationOverrideChangePreviewV1",
  );
}

export function decodeCampaignAllocationOverrideChangeApplyResultV1(
  value: unknown,
): CampaignAllocationOverrideChangeApplyResultV1 {
  return decodeNamed<CampaignAllocationOverrideChangeApplyResultV1>(
    value,
    "CampaignAllocationOverrideChangeApplyResultV1",
  );
}
