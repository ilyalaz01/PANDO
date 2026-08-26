import "server-only";

import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  hasDuplicates,
  isSorted,
} from "../../../shared/contracts/json";
import {
  type ContractViolation,
  type ValidationResult,
  validationResult,
} from "../../../shared/contracts/result";
import { validateSchema } from "../../../shared/contracts/schema-registry";

export interface TargetSelectionWorkspaceV1 {
  readonly workspaceId: string;
  readonly workspaceKind: "personal";
  readonly displayName: string;
  readonly membershipRole: "member" | "owner";
}

export interface TargetSelectionProfileV1 {
  readonly profileVersionKey: string;
  readonly profileSeriesKey: string;
  readonly scope: "canonical" | "workspace";
  readonly roleTitle: string;
  readonly companyName: string | null;
  readonly versionNumber: number;
  readonly baseProfileVersionKey: string | null;
  readonly catalogVersionKey: string;
  readonly roadmapVersionKey: string | null;
  readonly sourceSummary: string;
  readonly freshnessStatus: "initial_curated_assumption" | "reviewed" | "stale";
  readonly reviewedAt: string;
}

export interface TargetSelectionReadinessGoalV1 {
  readonly readinessGoalKey: string;
  readonly title: string;
  readonly profileVersionKey: string;
  readonly profileRoleTitle: string;
  readonly lifecycle: "active" | "archived" | "completed" | "paused";
  readonly aggregateVersion: string;
}

export interface TargetSelectionSourceV1 {
  readonly contract: {
    readonly name: "TargetSelectionSourceV1";
    readonly version: "1.0.0";
  };
  readonly workspace: TargetSelectionWorkspaceV1 | null;
  readonly profiles: readonly TargetSelectionProfileV1[];
  readonly readinessGoals: readonly TargetSelectionReadinessGoalV1[];
}

function addViolation(
  violations: ContractViolation[],
  code: string,
  path: string,
  message: string,
): void {
  violations.push({ code, path, message });
}

function validateSemantics(value: unknown): ValidationResult {
  const source = asJsonObject(value, "TargetSelectionSourceV1");
  const profiles = asArray(source.profiles).map((profile) =>
    asJsonObject(profile, "Target selection profile"),
  );
  const goals = asArray(source.readinessGoals).map((goal) =>
    asJsonObject(goal, "Target selection readiness goal"),
  );
  const violations: ContractViolation[] = [];
  const profileKeys = profiles.map((profile) => asString(profile.profileVersionKey)!);
  const goalKeys = goals.map((goal) => asString(goal.readinessGoalKey)!);

  if (source.workspace === null && (profiles.length > 0 || goals.length > 0)) {
    addViolation(
      violations,
      "TARGET_SELECTION_MISSING_WORKSPACE_STATE",
      "/workspace",
      "An unbootstrapped session cannot expose workspace-owned target state.",
    );
  }
  if (!isSorted(profileKeys)) {
    addViolation(
      violations,
      "TARGET_SELECTION_PROFILES_NOT_SORTED",
      "/profiles",
      "Profiles must be sorted by profileVersionKey.",
    );
  }
  if (hasDuplicates(profileKeys)) {
    addViolation(
      violations,
      "TARGET_SELECTION_PROFILE_DUPLICATE",
      "/profiles",
      "Profile version keys must be unique.",
    );
  }
  if (!isSorted(goalKeys)) {
    addViolation(
      violations,
      "TARGET_SELECTION_GOALS_NOT_SORTED",
      "/readinessGoals",
      "Readiness goals must be sorted by readinessGoalKey.",
    );
  }
  if (hasDuplicates(goalKeys)) {
    addViolation(
      violations,
      "TARGET_SELECTION_GOAL_DUPLICATE",
      "/readinessGoals",
      "Readiness goal keys must be unique.",
    );
  }
  return validationResult(violations);
}

export function validateTargetSelectionSourceV1(value: unknown): ValidationResult {
  const structural = validateSchema("target-selection-source", value);
  return structural.valid ? validateSemantics(value) : structural;
}

export class TargetSelectionContractError extends Error {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Target selection source failed its contract.");
    this.name = "TargetSelectionContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function nullableString(value: unknown): string | null {
  return value === null ? null : asString(value as never)!;
}

export function decodeTargetSelectionSourceV1(value: unknown): TargetSelectionSourceV1 {
  const validation = validateTargetSelectionSourceV1(value);
  if (!validation.valid) throw new TargetSelectionContractError(validation.violations);

  const source = asJsonObject(value, "TargetSelectionSourceV1");
  const workspaceValue = source.workspace;
  const workspace =
    workspaceValue === null
      ? null
      : (() => {
          const item = asJsonObject(workspaceValue, "Target selection workspace");
          return {
            workspaceId: asString(item.workspaceId)!,
            workspaceKind: "personal" as const,
            displayName: asString(item.displayName)!,
            membershipRole: asString(item.membershipRole)! as "member" | "owner",
          };
        })();

  return {
    contract: { name: "TargetSelectionSourceV1", version: "1.0.0" },
    workspace,
    profiles: asArray(source.profiles).map((profileValue) => {
      const profile = asJsonObject(profileValue, "Target selection profile");
      return {
        profileVersionKey: asString(profile.profileVersionKey)!,
        profileSeriesKey: asString(profile.profileSeriesKey)!,
        scope: asString(profile.scope)! as "canonical" | "workspace",
        roleTitle: asString(profile.roleTitle)!,
        companyName: nullableString(profile.companyName),
        versionNumber: asNumber(profile.versionNumber)!,
        baseProfileVersionKey: nullableString(profile.baseProfileVersionKey),
        catalogVersionKey: asString(profile.catalogVersionKey)!,
        roadmapVersionKey: nullableString(profile.roadmapVersionKey),
        sourceSummary: asString(profile.sourceSummary)!,
        freshnessStatus: asString(
          profile.freshnessStatus,
        )! as TargetSelectionProfileV1["freshnessStatus"],
        reviewedAt: asString(profile.reviewedAt)!,
      };
    }),
    readinessGoals: asArray(source.readinessGoals).map((goalValue) => {
      const goal = asJsonObject(goalValue, "Target selection readiness goal");
      return {
        readinessGoalKey: asString(goal.readinessGoalKey)!,
        title: asString(goal.title)!,
        profileVersionKey: asString(goal.profileVersionKey)!,
        profileRoleTitle: asString(goal.profileRoleTitle)!,
        lifecycle: asString(goal.lifecycle)! as TargetSelectionReadinessGoalV1["lifecycle"],
        aggregateVersion: asString(goal.aggregateVersion)!,
      };
    }),
  };
}
