import {
  asArray,
  asJsonObject,
  asNumber,
  asString,
  hasDuplicates,
  isSorted,
  type JsonObject,
  type JsonValue,
} from "./json";
import { type ContractViolation, type ValidationResult, validationResult } from "./result";
import { validateSchema } from "./schema-registry";

export type AvailabilityWindowOperationV1 =
  | "create_availability_window"
  | "change_availability_window"
  | "remove_availability_window";

export type AvailabilityWindowSourceState =
  | "AVAILABILITY_AVAILABLE"
  | "WINDOW_LIMIT_REACHED"
  | "NO_CURRENT_PLAN";

export interface AvailabilityWindowStateV1 {
  readonly windowKey: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly timeZone: string;
  readonly availableMinutes: number;
  readonly energy: "LOW" | "MEDIUM" | "HIGH" | null;
  readonly label: string | null;
  readonly lifecycle: "ACTIVE" | "REMOVED";
  readonly aggregateVersion: string;
}

export interface AvailabilityWindowPreviewStateV1 extends AvailabilityWindowStateV1 {
  readonly availabilityWindowId: string;
}

export type AvailabilityWindowSourceV1 =
  | {
      readonly contract: { readonly name: "AvailabilityWindowSourceV1"; readonly version: "1.0.0" };
      readonly state: "AVAILABILITY_AVAILABLE" | "WINDOW_LIMIT_REACHED";
      readonly capabilities: readonly AvailabilityWindowOperationV1[];
      readonly growthPlan: {
        readonly lifecycle: "ACTIVE" | "PAUSED";
        readonly weeklyCapacityMinutes: number;
        readonly aggregateVersion: string;
        readonly activeWindowCount: number;
        readonly removedWindowCount: number;
        readonly capacityUsesAvailability: boolean;
      };
      readonly availabilityWindows: readonly AvailabilityWindowStateV1[];
    }
  | {
      readonly contract: { readonly name: "AvailabilityWindowSourceV1"; readonly version: "1.0.0" };
      readonly state: "NO_CURRENT_PLAN";
      readonly capabilities: readonly [];
      readonly growthPlan: null;
      readonly availabilityWindows: readonly [];
    };

export interface AvailabilityWindowPreviewV1 {
  readonly contract: { readonly name: "AvailabilityWindowPreviewV1"; readonly version: "1.0.0" };
  readonly digestVersion: "availability-window-preview-digest/1.0.0";
  readonly identityVersion: "planning-create-identity/1.0.0";
  readonly operation: AvailabilityWindowOperationV1;
  readonly commandType: "planning.change_availability_window_v1";
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly expectedGrowthPlanVersion: string;
  readonly growthPlan: {
    readonly growthPlanId: string;
    readonly lifecycle: "ACTIVE" | "PAUSED";
    readonly weeklyCapacityMinutes: number;
    readonly aggregateVersion: string;
  };
  readonly before: {
    readonly activeWindowCount: number;
    readonly removedWindowCount: number;
    readonly activeWindowFingerprint: string;
    readonly window: AvailabilityWindowPreviewStateV1 | null;
  };
  readonly after: {
    readonly activeWindowCount: number;
    readonly window: AvailabilityWindowPreviewStateV1;
  };
  readonly canApply: boolean;
  readonly blockingReasons: readonly {
    readonly code:
      | "AVAILABILITY_WINDOW_OVERLAPS_EXISTING"
      | "AVAILABILITY_WINDOW_LIMIT_REACHED"
      | "AVAILABILITY_WINDOW_ALREADY_REMOVED"
      | "PLANNING_CREATE_IDENTITY_COLLISION";
  }[];
  readonly warnings: readonly { readonly code: "AVAILABILITY_NOT_YET_APPLIED_TO_CAPACITY" }[];
  readonly retained: {
    readonly growthPlan: true;
    readonly learningTracks: true;
    readonly activitiesAndEvidence: true;
    readonly mastery: true;
    readonly reviews: true;
    readonly planSnapshots: true;
  };
  readonly recalculationAfterApply: {
    readonly projectionState: "PENDING";
    readonly eventChangeKind: "AVAILABILITY_CHANGED";
    readonly consumerName: "planning.plan_snapshot_v1";
  };
  readonly previewDigest: string;
}

export interface AvailabilityWindowApplyResultV1 {
  readonly contract: {
    readonly name: "AvailabilityWindowApplyResultV1";
    readonly version: "1.0.0";
  };
  readonly commandId: string;
  readonly operation: AvailabilityWindowOperationV1;
  readonly availabilityWindow: AvailabilityWindowPreviewStateV1;
  readonly activeWindowCount: number;
  readonly projectionState: "PENDING";
  readonly planningDeliveryId: string;
  readonly emittedEventIds: readonly [string];
}

const MILLISECONDS_PER_DAY = 86_400_000;

function semanticViolation(code: string, path: string, message: string): ContractViolation {
  return { code, path, message };
}

function hasControlCharacters(value: JsonValue | undefined): boolean {
  return typeof value === "string" && /[\p{Cc}]/u.test(value);
}

function isLowercase(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value === value.toLowerCase();
}

function dayNumber(value: JsonValue | undefined): number {
  return Date.parse(`${String(value)}T00:00:00.000Z`) / MILLISECONDS_PER_DAY;
}

function rangeViolations(window: JsonObject, path: string): ContractViolation[] {
  const start = dayNumber(window.startsOn);
  const end = dayNumber(window.endsOn);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 365) {
    return [
      semanticViolation(
        "AVAILABILITY_WINDOW_RANGE",
        path,
        "A window must cover one to 366 ordered local days.",
      ),
    ];
  }
  return [];
}

function sourceSemanticViolations(root: JsonObject): ContractViolation[] {
  const violations: ContractViolation[] = [];
  if (root.state === "NO_CURRENT_PLAN") return violations;
  const plan = asJsonObject(root.growthPlan, "availability growth plan");
  const windows = asArray(root.availabilityWindows).map((item) =>
    asJsonObject(item, "availability window"),
  );
  const keys = windows.map((window) => String(window.windowKey));
  const order = windows.map((window) => `${String(window.startsOn)}|${String(window.windowKey)}`);

  if (!isSorted(order)) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_ORDER",
        "/availabilityWindows",
        "Availability windows must use stable start-date then window-key order.",
      ),
    );
  }
  if (hasDuplicates(keys)) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_DUPLICATE",
        "/availabilityWindows",
        "Availability window keys must be unique.",
      ),
    );
  }
  if (windows.some((window) => window.lifecycle !== "ACTIVE")) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_LIFECYCLE",
        "/availabilityWindows",
        "The availability source lists only active windows.",
      ),
    );
  }
  if (asNumber(plan.activeWindowCount) !== windows.length) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_COUNT",
        "/growthPlan/activeWindowCount",
        "The active window count must equal the listed windows.",
      ),
    );
  }
  for (const [index, window] of windows.entries()) {
    violations.push(...rangeViolations(window, `/availabilityWindows/${index}`));
    if (hasControlCharacters(window.label)) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_UNSAFE_TEXT",
          `/availabilityWindows/${index}/label`,
          "A window label must not contain control characters.",
        ),
      );
    }
  }
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    if (dayNumber(current.startsOn) <= dayNumber(previous.endsOn)) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_OVERLAP",
          `/availabilityWindows/${index}`,
          "Active availability windows must not overlap.",
        ),
      );
    }
  }
  const capabilities = asArray(root.capabilities).map(String);
  const expected =
    root.state === "WINDOW_LIMIT_REACHED"
      ? ["change_availability_window", "remove_availability_window"]
      : [
          "create_availability_window",
          "change_availability_window",
          "remove_availability_window",
        ];
  if (capabilities.length !== expected.length || capabilities.some((c, i) => c !== expected[i])) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_CAPABILITIES",
        "/capabilities",
        "Capabilities must exactly reflect the reported availability state.",
      ),
    );
  }
  return violations;
}

function previewSemanticViolations(root: JsonObject): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const plan = asJsonObject(root.growthPlan, "preview growth plan");
  const before = asJsonObject(root.before, "availability before");
  const after = asJsonObject(root.after, "availability after");
  const afterWindow = asJsonObject(after.window, "proposed window");
  const beforeWindow = before.window === null ? null : asJsonObject(before.window, "current window");
  const operation = String(root.operation);
  const activeBefore = asNumber(before.activeWindowCount) ?? 0;
  const activeAfter = asNumber(after.activeWindowCount) ?? 0;

  if (hasControlCharacters(root.reason) || hasControlCharacters(afterWindow.label)) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_UNSAFE_TEXT",
        "/reason",
        "Preview text must not contain control characters.",
      ),
    );
  }
  if (root.expectedGrowthPlanVersion !== plan.aggregateVersion) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_PLAN_VERSION",
        "/expectedGrowthPlanVersion",
        "The expected Plan version must bind the observed current Plan version.",
      ),
    );
  }
  if (
    !isLowercase(root.idempotencyKey) ||
    !isLowercase(plan.growthPlanId) ||
    !isLowercase(afterWindow.availabilityWindowId)
  ) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_UUID_CASE",
        "/",
        "Availability UUID values must use their exact lowercase representation.",
      ),
    );
  }
  if (afterWindow.windowKey !== `window:${String(afterWindow.availabilityWindowId)}`) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_KEY",
        "/after/window/windowKey",
        "A window key must bind its own UUID.",
      ),
    );
  }
  violations.push(...rangeViolations(afterWindow, "/after/window"));

  if (operation === "create_availability_window") {
    if (beforeWindow !== null) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_CREATE_STATE",
          "/before/window",
          "Creating a window has no current window state.",
        ),
      );
    }
    if (afterWindow.lifecycle !== "ACTIVE" || afterWindow.aggregateVersion !== "1") {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_CREATE_STATE",
          "/after/window",
          "A created window starts active at version one.",
        ),
      );
    }
    if (activeAfter !== activeBefore + 1) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_COUNT",
          "/after/activeWindowCount",
          "Creating a window adds exactly one active window.",
        ),
      );
    }
  } else {
    if (beforeWindow === null) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_TARGET",
          "/before/window",
          "Changing or removing a window requires its exact current state.",
        ),
      );
      return violations;
    }
    if (
      beforeWindow.windowKey !== afterWindow.windowKey ||
      beforeWindow.availabilityWindowId !== afterWindow.availabilityWindowId ||
      beforeWindow.timeZone !== afterWindow.timeZone
    ) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_TARGET",
          "/after/window",
          "A window keeps its identity and recorded time zone across edits.",
        ),
      );
    }
    if (
      afterWindow.aggregateVersion !== String(BigInt(String(beforeWindow.aggregateVersion)) + 1n)
    ) {
      violations.push(
        semanticViolation(
          "AVAILABILITY_WINDOW_VERSION",
          "/after/window/aggregateVersion",
          "An edited window advances by exactly one version.",
        ),
      );
    }
    if (operation === "change_availability_window") {
      if (afterWindow.lifecycle !== "ACTIVE" || activeAfter !== activeBefore) {
        violations.push(
          semanticViolation(
            "AVAILABILITY_WINDOW_CHANGE_STATE",
            "/after",
            "Changing a window keeps it active and keeps the active count.",
          ),
        );
      }
    } else {
      if (
        afterWindow.lifecycle !== "REMOVED" ||
        afterWindow.startsOn !== beforeWindow.startsOn ||
        afterWindow.endsOn !== beforeWindow.endsOn ||
        afterWindow.availableMinutes !== beforeWindow.availableMinutes ||
        afterWindow.energy !== beforeWindow.energy ||
        afterWindow.label !== beforeWindow.label ||
        activeAfter !== activeBefore - 1
      ) {
        violations.push(
          semanticViolation(
            "AVAILABILITY_WINDOW_REMOVE_STATE",
            "/after",
            "Removing a window changes only its lifecycle, version, and the active count.",
          ),
        );
      }
    }
  }

  const blockers = asArray(root.blockingReasons);
  if (root.canApply !== (blockers.length === 0)) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_APPLICABILITY",
        "/canApply",
        "Applicability must exactly reflect the reported blocking reasons.",
      ),
    );
  }
  return violations;
}

function applySemanticViolations(root: JsonObject): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const window = asJsonObject(root.availabilityWindow, "applied window");
  if (
    !isLowercase(root.commandId) ||
    !isLowercase(root.planningDeliveryId) ||
    !asArray(root.emittedEventIds).every(isLowercase) ||
    !isLowercase(window.availabilityWindowId)
  ) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_UUID_CASE",
        "/",
        "Applied-result UUID values must use their exact lowercase representation.",
      ),
    );
  }
  if (window.windowKey !== `window:${String(window.availabilityWindowId)}`) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_KEY",
        "/availabilityWindow/windowKey",
        "A window key must bind its own UUID.",
      ),
    );
  }
  const expectedLifecycle =
    root.operation === "remove_availability_window" ? "REMOVED" : "ACTIVE";
  if (window.lifecycle !== expectedLifecycle) {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_APPLIED_LIFECYCLE",
        "/availabilityWindow/lifecycle",
        "The applied window lifecycle must match the applied operation.",
      ),
    );
  }
  if (root.operation === "create_availability_window" && window.aggregateVersion !== "1") {
    violations.push(
      semanticViolation(
        "AVAILABILITY_WINDOW_VERSION",
        "/availabilityWindow/aggregateVersion",
        "A created window is applied at version one.",
      ),
    );
  }
  violations.push(...rangeViolations(window, "/availabilityWindow"));
  return violations;
}

export function availabilityWindowControlSemanticViolations(
  value: unknown,
): readonly ContractViolation[] {
  const root = asJsonObject(value, "availability window control response");
  const contract = asJsonObject(root.contract, "availability window contract");
  const name = asString(contract.name);
  if (name === "AvailabilityWindowSourceV1") return sourceSemanticViolations(root);
  if (name === "AvailabilityWindowPreviewV1") return previewSemanticViolations(root);
  if (name === "AvailabilityWindowApplyResultV1") return applySemanticViolations(root);
  return [
    semanticViolation(
      "AVAILABILITY_WINDOW_CONTRACT",
      "/contract/name",
      "Unsupported availability window contract.",
    ),
  ];
}

export function validateAvailabilityWindowControlV1(value: unknown): ValidationResult {
  const structural = validateSchema("availability-window-control-v1", value);
  return structural.valid
    ? validationResult(availabilityWindowControlSemanticViolations(value))
    : structural;
}

export class AvailabilityWindowContractError extends TypeError {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    super("Availability window response failed its contract.");
    this.name = "AvailabilityWindowContractError";
    this.violations = violations.map(({ code, path, message }) => ({ code, path, message }));
  }
}

function decodeNamed<T>(value: unknown, expectedName: string): T {
  const validation = validateAvailabilityWindowControlV1(value);
  if (!validation.valid) throw new AvailabilityWindowContractError(validation.violations);
  const root = asJsonObject(value, expectedName);
  const contract = asJsonObject(root.contract, `${expectedName} contract`);
  if (contract.name !== expectedName) {
    throw new AvailabilityWindowContractError([
      semanticViolation(
        "AVAILABILITY_WINDOW_CONTRACT",
        "/contract/name",
        `Expected ${expectedName}.`,
      ),
    ]);
  }
  return value as T;
}

export function decodeAvailabilityWindowSourceV1(value: unknown): AvailabilityWindowSourceV1 {
  return decodeNamed<AvailabilityWindowSourceV1>(value, "AvailabilityWindowSourceV1");
}

export function decodeAvailabilityWindowPreviewV1(value: unknown): AvailabilityWindowPreviewV1 {
  return decodeNamed<AvailabilityWindowPreviewV1>(value, "AvailabilityWindowPreviewV1");
}

export function decodeAvailabilityWindowApplyResultV1(
  value: unknown,
): AvailabilityWindowApplyResultV1 {
  return decodeNamed<AvailabilityWindowApplyResultV1>(value, "AvailabilityWindowApplyResultV1");
}
