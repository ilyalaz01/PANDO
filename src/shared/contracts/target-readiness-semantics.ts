type JsonRecord = Record<string, unknown>;

const GAP_ORDER: Readonly<Record<string, number>> = {
  FAILED_MANDATORY_FLOOR: 0,
  UNKNOWN_MANDATORY_FLOOR: 1,
  UNKNOWN_REQUIREMENT: 2,
  KNOWN_SHORTFALL: 3,
};

function object(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function leafIdentity(value: JsonRecord): string {
  return `${String(value.competencyRef)}\u001f${String(value.dimension)}\u001f${String(value.requiredLevel)}`;
}

function intervalViolation(value: JsonRecord | null, code: string): string[] {
  if (value === null) return [];
  return typeof value.lower === "number" &&
    typeof value.upper === "number" &&
    value.lower > value.upper
    ? [code]
    : [];
}

/** Semantic checks that JSON Schema cannot express and every TargetReadinessV1 consumer needs. */
export function targetReadinessSemanticViolations(value: unknown): string[] {
  const root = object(value);
  if (root === null) return [];
  const snapshot = object(root.snapshot);
  const violations = intervalViolation(snapshot, "TARGET_READINESS_INTERVAL_ORDER");
  for (const blocker of array(snapshot?.blockers)) {
    violations.push(...intervalViolation(object(blocker), "TARGET_READINESS_INTERVAL_ORDER"));
  }
  for (const rule of array(snapshot?.ruleEvaluations)) {
    violations.push(...intervalViolation(object(rule), "TARGET_READINESS_INTERVAL_ORDER"));
  }

  if (snapshot !== null) {
    const asOf = Date.parse(String(root.asOf));
    const calculatedAsOf = Date.parse(String(snapshot.calculatedAsOf));
    const validUntil = root.validUntil === null ? null : Date.parse(String(root.validUntil));
    if (calculatedAsOf > asOf || (validUntil !== null && validUntil < calculatedAsOf)) {
      violations.push("TARGET_READINESS_CLOCK_ORDER");
    }
    if (root.projectionState === "CURRENT" && validUntil !== null && asOf > validUntil) {
      violations.push("TARGET_READINESS_CURRENT_EXPIRED");
    }
    if (root.projectionState === "STALE" && (validUntil === null || asOf <= validUntil)) {
      violations.push("TARGET_READINESS_STALE_NOT_EXPIRED");
    }
  }

  const inputs = array(root.inputs).flatMap((item) => {
    const parsed = object(item);
    return parsed === null ? [] : [parsed];
  });
  const inputByIdentity = new Map<string, JsonRecord>();
  for (const input of inputs) {
    const identity = leafIdentity(input);
    if (inputByIdentity.has(identity)) violations.push("TARGET_READINESS_INPUT_DUPLICATE");
    inputByIdentity.set(identity, input);
    const support = new Set(array(input.supportingEvidenceIds).map(String));
    if (array(input.contradictingEvidenceIds).some((id) => support.has(String(id)))) {
      violations.push("TARGET_READINESS_EVIDENCE_OVERLAP");
    }
  }

  let previousGapOrder = -1;
  let previousGapIdentity = "";
  for (const gapValue of array(root.gaps)) {
    const gap = object(gapValue);
    if (gap === null) continue;
    const identity = leafIdentity(gap);
    const order = GAP_ORDER[String(gap.gapCode)] ?? Number.MAX_SAFE_INTEGER;
    if (
      order < previousGapOrder ||
      (order === previousGapOrder && identity <= previousGapIdentity)
    ) {
      violations.push("TARGET_READINESS_GAP_ORDER");
    }
    previousGapOrder = order;
    previousGapIdentity = identity;
    const input = inputByIdentity.get(identity);
    if (
      input === undefined ||
      input.freshness !== gap.freshness ||
      input.confidence !== gap.confidence ||
      JSON.stringify(input.owningRuleKeys) !== JSON.stringify(gap.owningRuleKeys)
    ) {
      violations.push("TARGET_READINESS_GAP_INPUT_MISMATCH");
    }
    const unknownGap = ["UNKNOWN_MANDATORY_FLOOR", "UNKNOWN_REQUIREMENT"].includes(
      String(gap.gapCode),
    );
    if (input !== undefined && unknownGap !== (input.value === "UNKNOWN")) {
      violations.push("TARGET_READINESS_GAP_VALUE_MISMATCH");
    }
  }
  return [...new Set(violations)].sort();
}

/** Semantic checks for the future Planning adapter's minimized readiness boundary. */
export function planningReadinessSemanticViolations(value: unknown): string[] {
  const root = object(value);
  const snapshot = object(root?.snapshot);
  const violations = intervalViolation(snapshot, "PLANNING_READINESS_INTERVAL_ORDER");
  if (snapshot !== null && snapshot.validUntil !== null) {
    if (Date.parse(String(snapshot.validUntil)) < Date.parse(String(snapshot.calculatedAsOf))) {
      violations.push("PLANNING_READINESS_CLOCK_ORDER");
    }
  }
  return violations;
}
