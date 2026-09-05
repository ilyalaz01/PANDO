import { asArray, asJsonObject, asString, isJsonObject, type JsonObject } from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type CampaignLifecycleCoordinationOperationV1 =
  "start_campaign" | "end_campaign" | "cancel_campaign";

export interface CampaignLifecycleCoordinationCampaignBeforeV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "DRAFT" | "ACTIVE";
  readonly aggregateVersion: string;
}

export interface CampaignLifecycleCoordinationCampaignAfterV1 {
  readonly campaignId: string;
  readonly campaignKey: string;
  readonly title: string;
  readonly lifecycle: "ACTIVE" | "ENDED" | "CANCELLED";
  readonly aggregateVersion: string;
}

export interface CampaignLifecycleCoordinationOverrideIntentV1 {
  readonly trackKey: string;
  readonly expectedTrackVersion: string;
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
}

export interface CampaignLifecycleCoordinationInstalledPreviewV1 {
  readonly overrideKey: string;
  readonly learningTrack: { readonly trackKey: string; readonly expectedVersion: string };
  readonly lifecycle: "ACTIVE";
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
  readonly aggregateVersion: "1";
}

export interface CampaignLifecycleCoordinationClosedPreviewV1 {
  readonly overrideKey: string;
  readonly lifecycle: "SUPERSEDED";
}

export interface CampaignLifecycleCoordinationInstalledResultV1 {
  readonly overrideKey: string;
  readonly learningTrack: { readonly trackKey: string; readonly title: string };
  readonly lifecycle: "ACTIVE";
  readonly priorityOverride: number | null;
  readonly protectedMinimumMinutesOverride: number | null;
  readonly cadencePerWeekOverride: number | null;
  readonly aggregateVersion: "1";
}

export interface CampaignLifecycleCoordinationClosedResultV1 {
  readonly overrideKey: string;
  readonly lifecycle: "SUPERSEDED";
  readonly aggregateVersion: string;
}

export type CampaignLifecycleCoordinationBlockingReasonV1 =
  | {
      readonly code: "ALLOCATION_OVERRIDE_NO_CURRENT_PLAN" | "ALLOCATION_OVERRIDE_EXCEEDS_CAPACITY";
    }
  | {
      readonly code:
        | "ALLOCATION_OVERRIDE_TRACK_VERSION_STALE"
        | "ALLOCATION_OVERRIDE_TRACK_NOT_ACTIVE"
        | "ALLOCATION_OVERRIDE_TRACK_ALREADY_OVERRIDDEN";
      readonly trackKey: string;
    };

export interface CampaignLifecycleCoordinationPreviewV1 {
  readonly contract: {
    readonly name: "CampaignLifecycleCoordinationPreviewV1";
    readonly version: "1.0.0";
  };
  readonly operation: CampaignLifecycleCoordinationOperationV1;
  readonly commandType: "agent_control.coordinate_campaign_lifecycle_v1";
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly campaign: {
    readonly before: CampaignLifecycleCoordinationCampaignBeforeV1;
    readonly after: CampaignLifecycleCoordinationCampaignAfterV1;
  };
  readonly overrides: {
    readonly installed: readonly CampaignLifecycleCoordinationInstalledPreviewV1[];
    readonly closed: readonly CampaignLifecycleCoordinationClosedPreviewV1[];
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly CampaignLifecycleCoordinationBlockingReasonV1[];
  readonly warnings: readonly never[];
  readonly previewDigest: string;
}

export interface CampaignLifecycleCoordinationApplyResultV1 {
  readonly contract: {
    readonly name: "CampaignLifecycleCoordinationApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly campaign: CampaignLifecycleCoordinationCampaignAfterV1;
  readonly overrides: readonly (
    CampaignLifecycleCoordinationInstalledResultV1 | CampaignLifecycleCoordinationClosedResultV1
  )[];
  readonly emittedEventIds: readonly string[];
}

const VALID_TRANSITIONS: Readonly<
  Record<CampaignLifecycleCoordinationOperationV1, { readonly from: string; readonly to: string }>
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
  const expected = VALID_TRANSITIONS[operation as CampaignLifecycleCoordinationOperationV1];
  return expected !== undefined && expected.from === before && expected.to === after;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const campaign = asJsonObject(root.campaign, "coordination campaign");
  const before = asJsonObject(campaign.before, "coordination campaign before state");
  const after = asJsonObject(campaign.after, "coordination campaign after state");
  const overrides = asJsonObject(root.overrides, "coordination overrides");
  const installed = asArray(overrides.installed);
  const closed = asArray(overrides.closed);
  const violations: ContractViolation[] = [];

  if (!campaignKeyBinds(before) || !campaignKeyBinds(after)) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_KEY_BINDING",
        "/campaign",
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
        "CAMPAIGN_COORDINATION_TRANSITION",
        "/campaign/after",
        "A lifecycle change must advance the campaign by exactly one version and change nothing else.",
      ),
    );
  }
  if (
    !transitionIsValid(String(root.operation), String(before.lifecycle), String(after.lifecycle))
  ) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_OPERATION",
        "/operation",
        "The operation must match the released draft/active/ended/cancelled transition table.",
      ),
    );
  }
  if (root.operation !== "start_campaign" && installed.length > 0) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_OVERRIDE_SCOPE",
        "/overrides/installed",
        "Overrides may only be installed by start_campaign.",
      ),
    );
  }
  if (root.operation === "start_campaign" && closed.length > 0) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_OVERRIDE_SCOPE",
        "/overrides/closed",
        "start_campaign never closes an existing override.",
      ),
    );
  }
  const blockers = asArray(root.blockingReasons);
  if (root.canApply !== (blockers.length === 0)) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_APPLICABILITY",
        "/canApply",
        "Applicability must exactly reflect the reported blocking reasons.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const campaign = asJsonObject(root.campaign, "coordination apply campaign");
  const violations: ContractViolation[] = [];
  if (!campaignKeyBinds(campaign)) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_KEY_BINDING",
        "/campaign/campaignKey",
        "The campaign key must bind the campaign's own derived identity.",
      ),
    );
  }
  const overrides = asArray(root.overrides).filter(isJsonObject);
  const installedCount = overrides.filter((item) => "learningTrack" in item).length;
  if (installedCount !== 0 && installedCount !== overrides.length) {
    violations.push(
      semanticViolation(
        "CAMPAIGN_COORDINATION_OVERRIDE_SHAPE",
        "/overrides",
        "One apply either installs overrides or closes them, never both.",
      ),
    );
  }
  return violations;
}

export function campaignLifecycleCoordinationControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "Campaign lifecycle coordination control response");
  const contract = asJsonObject(root.contract, "Campaign lifecycle coordination contract");
  const name = asString(contract.name);
  if (name === "CampaignLifecycleCoordinationPreviewV1") return previewSemanticViolations(root);
  if (name === "CampaignLifecycleCoordinationApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "CAMPAIGN_COORDINATION_CONTRACT",
      "/contract/name",
      "Unsupported campaign lifecycle coordination contract.",
    ),
  ];
}

export function validateCampaignLifecycleCoordinationControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("campaign-lifecycle-coordination-control-v1", value);
  return structural.valid
    ? validationResult(campaignLifecycleCoordinationControlSemanticViolations(value))
    : structural;
}

export class CampaignLifecycleCoordinationContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Campaign lifecycle coordination response failed its contract.");
    this.name = "CampaignLifecycleCoordinationContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateCampaignLifecycleCoordinationControlV1(value);
  if (!validation.valid) {
    throw new CampaignLifecycleCoordinationContractError(validation.violations);
  }
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new CampaignLifecycleCoordinationContractError([
      semanticViolation(
        "CAMPAIGN_COORDINATION_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeCampaignLifecycleCoordinationPreviewV1(
  value: unknown,
): CampaignLifecycleCoordinationPreviewV1 {
  return decodeNamed<CampaignLifecycleCoordinationPreviewV1>(
    value,
    "CampaignLifecycleCoordinationPreviewV1",
  );
}

export function decodeCampaignLifecycleCoordinationApplyResultV1(
  value: unknown,
): CampaignLifecycleCoordinationApplyResultV1 {
  return decodeNamed<CampaignLifecycleCoordinationApplyResultV1>(
    value,
    "CampaignLifecycleCoordinationApplyResultV1",
  );
}
