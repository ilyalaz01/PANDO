import "server-only";

import type {
  ExploreReadinessDomainCountsView,
  ExploreReadinessGapView,
  ExploreStructuralProjectionView,
  ExploreTargetReadinessView,
} from "../types";

type JsonRecord = Record<string, unknown>;
const records = (value: unknown): JsonRecord[] =>
  Array.isArray(value)
    ? value.filter((item): item is JsonRecord => typeof item === "object" && item !== null)
    : [];
const items = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function gapKey(gap: JsonRecord): string {
  return [text(gap.competencyRef), text(gap.dimension), text(gap.requiredLevel)].join(":");
}

/** Joins structural identity only; Targets remains the authority for readiness facts. */
export function composeTargetReadinessView(
  readiness: JsonRecord,
  structural: ExploreStructuralProjectionView,
): ExploreTargetReadinessView {
  const profile = readiness.profile as JsonRecord;
  if (text(profile.profileVersionKey) !== structural.selectedVersions.targetProfileVersionKey) {
    throw new TypeError("Readiness profile does not match the selected structural profile.");
  }
  const state = text(readiness.projectionState) as ExploreTargetReadinessView["state"];
  const snapshot = readiness.snapshot as JsonRecord | null;
  const nodeByCompetency = new Map(
    structural.nodes
      .filter((node) => node.nodeType === "COMPETENCY")
      .map((node) => [node.entityRef.entityId, node]),
  );
  const inputs = records(readiness.inputs);
  const inputByKey = new Map(inputs.map((input) => [gapKey(input), input]));
  for (const input of inputs) {
    if (!nodeByCompetency.has(text(input.competencyRef))) {
      throw new TypeError("A readiness input is absent from the selected structural profile.");
    }
  }
  const rawGaps = records(readiness.gaps);
  const gaps: ExploreReadinessGapView[] = rawGaps.map((gap) => {
    const node = nodeByCompetency.get(text(gap.competencyRef));
    if (node === undefined) {
      throw new TypeError("A readiness gap is absent from the selected structural profile.");
    }
    const input = inputByKey.get(gapKey(gap));
    if (input === undefined) {
      throw new TypeError("A readiness gap has no corresponding persisted input.");
    }
    const refs = [
      ...new Set(
        [...items(input.supportingEvidenceIds), ...items(input.contradictingEvidenceIds)]
          .map((ref) => text(ref))
          .filter(Boolean),
      ),
    ].sort();
    return {
      gapKey: gapKey(gap),
      title: node.title,
      gapCode: text(gap.gapCode) as ExploreReadinessGapView["gapCode"],
      competencyRef: text(gap.competencyRef),
      dimension: text(gap.dimension),
      requiredLevel: text(gap.requiredLevel),
      freshness: text(gap.freshness) as ExploreReadinessGapView["freshness"],
      outlineNodeId: node.nodeId,
      evidenceRefs: refs.slice(0, 3),
      evidenceRefCount: refs.length,
    };
  });
  const domains = structural.nodes
    .filter((node) => node.nodeType === "DOMAIN")
    .map((domain): ExploreReadinessDomainCountsView => {
      const relatedInputs = inputs.filter(
        (input) => nodeByCompetency.get(text(input.competencyRef))?.domainNodeId === domain.nodeId,
      );
      const relatedGaps = gaps.filter(
        (gap) => nodeByCompetency.get(gap.competencyRef)?.domainNodeId === domain.nodeId,
      );
      return {
        domainNodeId: domain.nodeId,
        title: domain.title,
        catalogVersionKey: structural.selectedVersions.catalogVersionKey,
        overlayRevision: structural.workspaceScope.overlayRevision,
        requiredCount: relatedInputs.length,
        knownCount: relatedInputs.filter((input) => input.value === "KNOWN").length,
        unknownCount: relatedInputs.filter((input) => input.value === "UNKNOWN").length,
        staleCount: relatedInputs.filter((input) => input.freshness === "STALE").length,
        mandatoryFloorBlockerCount: relatedGaps.filter((gap) =>
          ["FAILED_MANDATORY_FLOOR", "UNKNOWN_MANDATORY_FLOOR"].includes(gap.gapCode),
        ).length,
      };
    })
    .filter(({ requiredCount }) => requiredCount > 0);
  const firstGapTitleByRule = new Map<string, string>();
  rawGaps.forEach((gap, index) => {
    for (const ruleKey of items(gap.owningRuleKeys).map(text)) {
      if (!firstGapTitleByRule.has(ruleKey)) {
        firstGapTitleByRule.set(ruleKey, gaps[index]?.title ?? ruleKey);
      }
    }
  });
  const blockers =
    snapshot === null
      ? []
      : records(snapshot.blockers).map((blocker) => ({
          code: text(blocker.code),
          title:
            firstGapTitleByRule.get(text(blocker.ruleId)) ??
            (text(blocker.code) === "AGGREGATE_BELOW_THRESHOLD"
              ? "Aggregate readiness threshold"
              : text(blocker.ruleId)),
        }));
  return {
    state,
    message:
      state === "CURRENT"
        ? "Current evidence-derived readiness."
        : `Readiness is ${state.toLowerCase().replaceAll("_", " ")}.`,
    profileVersionKey: text(profile.profileVersionKey),
    calculatedAt: snapshot === null ? null : text(snapshot.calculatedAsOf),
    snapshot:
      snapshot === null
        ? null
        : {
            status: text(snapshot.status) as
              "NOT_READY" | "INSUFFICIENT_EVIDENCE" | "DEVELOPING" | "READY",
            lower: snapshot.lower as number,
            upper: snapshot.upper as number,
            coverage: snapshot.coverage as number,
            confidence: text(snapshot.confidence) as "LOW" | "MEDIUM" | "HIGH",
            blockers,
            gaps,
            domains,
          },
  };
}
