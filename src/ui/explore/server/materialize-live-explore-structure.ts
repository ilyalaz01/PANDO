import "server-only";

import {
  computeExploreStructuralFingerprint,
  type ExploreStructuralProjectionV1,
  validateExploreStructuralProjection,
} from "../../../shared/contracts/explore-structural-projection";
import { sha256 } from "../../../shared/contracts/json";

import { computeDagrePositions, dagreLayoutAdapterVersion } from "./dagre-layout";
import {
  type ExploreSourceEdgeV1,
  type ExploreSourceNodeV1,
  type ExploreSourceV1,
  validateExploreSourceV1,
} from "./explore-source-v1";
import {
  type ExploreTargetContextV1,
  type ExploreTargetRequirementMemberV1,
  type ExploreTargetRequirementRuleV1,
  validateExploreTargetContextV1,
} from "./explore-target-context-v1";

const FIXED_NODE_SIZE = { width: 240, height: 104 } as const;
const SPACING = { rank: 88, node: 40 } as const;
const LAYOUT_VERSION = "graph-layout-v1" as const;

const asciiCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const nodeId = (nodeRef: string): string => `node:${nodeRef}`;
const outlineItemId = (id: string): string => `outline:${id}`;

export interface MaterializeLiveExploreStructureInput {
  readonly source: ExploreSourceV1;
  readonly targetContext: ExploreTargetContextV1;
  readonly selectedActivityKey?: string | null;
}

export class LiveExploreStructureMaterializationError extends Error {
  constructor(readonly violationCodes: readonly string[]) {
    super("Live Explore structure could not be materialized from the authorized inputs.");
    this.name = "LiveExploreStructureMaterializationError";
  }
}

function fail(...violationCodes: readonly string[]): never {
  const codes = [...new Set(violationCodes)].sort(asciiCompare);
  throw new LiveExploreStructureMaterializationError(codes);
}

function assertValidInputs(source: ExploreSourceV1, target: ExploreTargetContextV1): void {
  const sourceValidation = validateExploreSourceV1(source);
  const targetValidation = validateExploreTargetContextV1(target);
  const codes = [
    ...sourceValidation.violations.map(({ code }) => `SOURCE_${code}`),
    ...targetValidation.violations.map(({ code }) => `TARGET_${code}`),
  ];
  if (codes.length > 0) fail(...codes);
}

function assertCorrelated(
  source: ExploreSourceV1,
  target: ExploreTargetContextV1,
  selectedActivityKey: string | null,
): void {
  const correlations = [
    [source.workspaceId, target.workspaceId, "WORKSPACE_MISMATCH"],
    [source.readinessGoalId, target.readinessGoal.readinessGoalId, "GOAL_ID_MISMATCH"],
    [source.readinessGoalKey, target.readinessGoal.readinessGoalKey, "GOAL_KEY_MISMATCH"],
    [
      source.targetProfileVersionId,
      target.targetProfile.profileVersionId,
      "TARGET_PROFILE_ID_MISMATCH",
    ],
    [
      source.targetProfileVersionKey,
      target.targetProfile.profileVersionKey,
      "TARGET_PROFILE_KEY_MISMATCH",
    ],
    [source.catalogVersionKey, target.targetProfile.catalogVersionKey, "CATALOG_VERSION_MISMATCH"],
    [source.roadmapVersionKey, target.targetProfile.roadmapVersionKey, "ROADMAP_VERSION_MISMATCH"],
    [source.overlayVersion, target.overlayVersion, "OVERLAY_VERSION_MISMATCH"],
  ] as const;
  const violations: string[] = correlations
    .filter(([left, right]) => left !== right)
    .map(([, , code]) => code);

  const activityRefs = source.nodes
    .filter(({ nodeType }) => nodeType === "ACTIVITY")
    .map(({ nodeRef }) => nodeRef);
  if (
    (selectedActivityKey === null && activityRefs.length !== 0) ||
    (selectedActivityKey !== null &&
      (activityRefs.length !== 1 || activityRefs[0] !== selectedActivityKey))
  ) {
    violations.push("SELECTED_ACTIVITY_MISMATCH");
  }
  if (violations.length > 0) fail(...violations);
}

function assertNodeMatches(
  sourceNode: ExploreSourceNodeV1 | undefined,
  expected: {
    readonly nodeRef: string;
    readonly nodeType: "COMPETENCY" | "DOMAIN";
    readonly title: string;
    readonly domainRef: string | null;
    readonly origin: "CANONICAL" | "WORKSPACE_OVERLAY";
  },
  source: ExploreSourceV1,
): asserts sourceNode is ExploreSourceNodeV1 {
  if (sourceNode === undefined) fail("TARGET_NODE_MISSING_FROM_SOURCE");
  if (
    sourceNode.nodeRef !== expected.nodeRef ||
    sourceNode.nodeType !== expected.nodeType ||
    sourceNode.title !== expected.title ||
    sourceNode.domainRef !== expected.domainRef ||
    sourceNode.origin !== expected.origin
  ) {
    fail("TARGET_NODE_SOURCE_MISMATCH");
  }
  if (
    (sourceNode.origin === "CANONICAL" &&
      sourceNode.sourceVersionKey !== source.catalogVersionKey) ||
    (sourceNode.origin === "WORKSPACE_OVERLAY" && sourceNode.workspaceId !== source.workspaceId)
  ) {
    fail("TARGET_NODE_ORIGIN_MISMATCH");
  }
}

function collectBoundedNodes(
  source: ExploreSourceV1,
  target: ExploreTargetContextV1,
  selectedActivityKey: string | null,
): ExploreSourceNodeV1[] {
  const sourceByRef = new Map(source.nodes.map((node) => [node.nodeRef, node]));
  const bounded: ExploreSourceNodeV1[] = [];

  for (const expected of target.scope.canonicalNodes) {
    const item = sourceByRef.get(expected.nodeRef);
    assertNodeMatches(item, { ...expected, origin: "CANONICAL" }, source);
    bounded.push(item);
  }
  for (const expected of target.scope.requiredOverlayNodes) {
    const item = sourceByRef.get(expected.nodeRef);
    assertNodeMatches(item, { ...expected, origin: "WORKSPACE_OVERLAY" }, source);
    bounded.push(item);
  }
  if (selectedActivityKey !== null) {
    const activity = sourceByRef.get(selectedActivityKey);
    if (activity?.nodeType !== "ACTIVITY") fail("SELECTED_ACTIVITY_MISSING");
    bounded.push(activity);
  }

  const boundedRefs = new Set(bounded.map(({ nodeRef }) => nodeRef));
  const selectedActivity =
    selectedActivityKey === null ? undefined : sourceByRef.get(selectedActivityKey);
  if (
    selectedActivity?.nodeType === "ACTIVITY" &&
    !boundedRefs.has(selectedActivity.targetCompetencyRef ?? "")
  ) {
    fail("SELECTED_ACTIVITY_OUTSIDE_TARGET");
  }
  return bounded.sort((left, right) => asciiCompare(left.nodeRef, right.nodeRef));
}

function edgeOrigin(edge: ExploreSourceEdgeV1, source: ExploreSourceV1) {
  return edge.origin === "CANONICAL"
    ? ({ kind: "CANONICAL", sourceVersionId: source.catalogVersionKey } as const)
    : ({
        kind: "WORKSPACE_OVERLAY",
        workspaceId: source.workspaceId,
        overlayRevision: source.overlayVersion,
        acceptance: "ACCEPTED",
      } as const);
}

function edgeText(edge: ExploreSourceEdgeV1): {
  readonly rationale: string;
  readonly accessibilityLabel: string;
  readonly reasonCode:
    "ACTIVE_PREREQUISITE" | "NAVIGATION_ONLY" | "PERSONAL_CONTEXT" | "SEMANTIC_CONTEXT";
} {
  switch (edge.edgeType) {
    case "PREREQUISITE_OF":
      return {
        rationale: "Prerequisite relationship in the selected target structure.",
        accessibilityLabel: "Prerequisite relationship.",
        reasonCode: "ACTIVE_PREREQUISITE",
      };
    case "PART_OF":
      return {
        rationale: "Domain membership in the selected target structure.",
        accessibilityLabel: "Domain membership relationship.",
        reasonCode: "NAVIGATION_ONLY",
      };
    case "ACTIVITY_EVIDENCES":
      return {
        rationale: "The selected activity can produce evidence for this competency.",
        accessibilityLabel: "Selected activity evidence relationship.",
        reasonCode: "SEMANTIC_CONTEXT",
      };
    case "RELATED_TO":
      return {
        rationale: "Related accepted content in the selected target structure.",
        accessibilityLabel: "Related content relationship.",
        reasonCode: edge.origin === "WORKSPACE_OVERLAY" ? "PERSONAL_CONTEXT" : "SEMANTIC_CONTEXT",
      };
    case "USER_ADDED":
      return {
        rationale: "Accepted personal relationship in the selected target structure.",
        accessibilityLabel: "Accepted personal relationship.",
        reasonCode: "PERSONAL_CONTEXT",
      };
  }
}

function collectBoundedEdges(
  source: ExploreSourceV1,
  target: ExploreTargetContextV1,
  boundedNodes: readonly ExploreSourceNodeV1[],
) {
  const boundedRefs = new Set(boundedNodes.map(({ nodeRef }) => nodeRef));
  const targetPrerequisites = new Map(
    target.scope.canonicalEdges.map((edge) => [edge.edgeKey, edge]),
  );
  const sourceByKey = new Map(source.edges.map((edge) => [edge.edgeKey, edge]));

  for (const expected of target.scope.canonicalEdges) {
    const actual = sourceByKey.get(expected.edgeKey);
    if (
      actual === undefined ||
      actual.edgeType !== expected.edgeType ||
      actual.sourceRef !== expected.sourceRef ||
      actual.targetRef !== expected.targetRef ||
      actual.blocking !== expected.blocking ||
      actual.origin !== "CANONICAL"
    ) {
      fail("TARGET_EDGE_SOURCE_MISMATCH");
    }
  }

  const relevant = source.edges.filter((edge) => {
    if (!boundedRefs.has(edge.sourceRef) || !boundedRefs.has(edge.targetRef)) return false;
    if (edge.edgeType !== "PREREQUISITE_OF" || edge.origin === "WORKSPACE_OVERLAY") return true;
    if (!targetPrerequisites.has(edge.edgeKey)) fail("CANONICAL_PREREQUISITE_SET_MISMATCH");
    return true;
  });

  return relevant
    .map((edge) => {
      const targetEdge = targetPrerequisites.get(edge.edgeKey);
      const text = edgeText(edge);
      return {
        edgeId: edge.edgeKey,
        edgeType: edge.edgeType,
        sourceNodeId: nodeId(edge.sourceRef),
        targetNodeId: nodeId(edge.targetRef),
        origin: edgeOrigin(edge, source),
        blocking: edge.blocking,
        rationale: targetEdge?.rationale ?? text.rationale,
        accessibilityLabel: targetEdge?.rationale ?? text.accessibilityLabel,
        visibilityHint: { defaultVisible: false, reasonCode: text.reasonCode },
      };
    })
    .sort((left, right) => asciiCompare(left.edgeId, right.edgeId));
}

function requirementMember(member: ExploreTargetRequirementMemberV1) {
  return member.memberType === "NODE"
    ? {
        memberType: "NODE" as const,
        nodeId: nodeId(member.nodeRef),
        dimension: member.dimension,
        requiredLevel: member.requiredLevel,
      }
    : { memberType: "RULE" as const, ruleId: member.ruleKey };
}

function requirementMemberId(member: ReturnType<typeof requirementMember>): string {
  return member.memberType === "NODE" ? member.nodeId : member.ruleId;
}

function materializeRequirementRule(rule: ExploreTargetRequirementRuleV1) {
  const base = {
    ruleId: rule.ruleKey,
    ruleType: rule.ruleType,
    title: rule.title,
    criticality: rule.criticality,
    explanation: rule.explanation,
    accessibilityLabel: rule.accessibilityLabel,
  };
  const members = rule.members
    .map(requirementMember)
    .sort((left, right) => asciiCompare(requirementMemberId(left), requirementMemberId(right)));
  switch (rule.ruleType) {
    case "ALL":
    case "ANY":
      return { ...base, ruleType: rule.ruleType, members };
    case "K_OF_N":
      return { ...base, ruleType: rule.ruleType, requiredCount: rule.requiredCount!, members };
    case "WEIGHTED_THRESHOLD": {
      const weightedMembers = rule.members
        .map((member) => ({ member: requirementMember(member), weight: member.weight! }))
        .sort((left, right) =>
          asciiCompare(requirementMemberId(left.member), requirementMemberId(right.member)),
        );
      return {
        ...base,
        ruleType: rule.ruleType,
        threshold: rule.threshold!,
        members: weightedMembers,
      };
    }
    case "MANDATORY_FLOOR":
      return { ...base, ruleType: rule.ruleType, member: members[0]! };
  }
}

function directRequirementRules(target: ExploreTargetContextV1): ReadonlyMap<string, string[]> {
  const byNode = new Map<string, string[]>();
  for (const rule of target.requirementRules) {
    for (const member of rule.members) {
      if (member.memberType !== "NODE") continue;
      const ids = byNode.get(member.nodeRef) ?? [];
      if (!ids.includes(rule.ruleKey)) ids.push(rule.ruleKey);
      byNode.set(member.nodeRef, ids.sort(asciiCompare));
    }
  }
  return byNode;
}

function makeOutline(nodes: readonly ExploreSourceNodeV1[], projectionId: string) {
  const byRef = new Map(nodes.map((node) => [node.nodeRef, node]));
  const parentRef = (node: ExploreSourceNodeV1): string | null =>
    node.nodeType === "DOMAIN"
      ? null
      : node.nodeType === "ACTIVITY"
        ? node.targetCompetencyRef!
        : node.domainRef;
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    const parent = parentRef(node);
    if (parent === null) continue;
    if (!byRef.has(parent)) fail("OUTLINE_PARENT_MISSING");
    children.set(parent, [...(children.get(parent) ?? []), node.nodeRef].sort(asciiCompare));
  }
  const roots = nodes
    .filter((node) => parentRef(node) === null)
    .map(({ nodeRef }) => nodeRef)
    .sort(asciiCompare);
  const keyboardOrder = new Map<string, number>();
  const visit = (ref: string): void => {
    keyboardOrder.set(ref, keyboardOrder.size + 1);
    for (const child of children.get(ref) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  if (keyboardOrder.size !== nodes.length) fail("OUTLINE_NOT_CONNECTED");

  const siblingIndex = new Map<string, number>();
  for (const refs of [roots, ...children.values()]) {
    refs.forEach((ref, index) => siblingIndex.set(ref, index + 1));
  }
  const depthOf = (node: ExploreSourceNodeV1): number =>
    node.nodeType === "DOMAIN" ? 0 : node.nodeType === "ACTIVITY" ? 2 : 1;
  const items = nodes
    .map((node) => {
      const id = nodeId(node.nodeRef);
      const parent = parentRef(node);
      const slug = node.nodeRef.slice(node.nodeRef.lastIndexOf(":") + 1);
      return {
        outlineItemId: outlineItemId(id),
        nodeId: id,
        parentItemId: parent === null ? null : outlineItemId(nodeId(parent)),
        depth: depthOf(node),
        sortKey: `${String(siblingIndex.get(node.nodeRef)!).padStart(4, "0")}:${slug}`,
        childItemIds: (children.get(node.nodeRef) ?? []).map((ref) => outlineItemId(nodeId(ref))),
        accessibilityLabel: `${node.title}, ${node.nodeType.toLowerCase()}`,
      };
    })
    .sort((left, right) => asciiCompare(left.outlineItemId, right.outlineItemId));
  return {
    outline: {
      projectionId,
      rootItemIds: roots.map((ref) => outlineItemId(nodeId(ref))),
      items,
    },
    keyboardOrder,
  };
}

function canonicalPositions(
  nodes: readonly { readonly nodeId: string }[],
  edges: readonly {
    readonly edgeId: string;
    readonly edgeType: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
  }[],
) {
  const seedPositions = nodes.map(({ nodeId: id }) => ({
    nodeId: id,
    canonical: { x: 0, y: 0 },
    effective: { x: 0, y: 0 },
    source: "CANONICAL_LAYOUT" as const,
    overrideRevision: null,
  }));
  return computeDagrePositions({
    layout: {
      algorithmVersion: dagreLayoutAdapterVersion,
      fixedNodeSize: FIXED_NODE_SIZE,
      spacing: SPACING,
      positions: seedPositions,
    },
    nodes,
    edges,
  });
}

function positionOverrides(
  source: ExploreSourceV1,
  boundedNodes: readonly ExploreSourceNodeV1[],
  positions: ReturnType<typeof canonicalPositions>,
) {
  const boundedRefs = new Set(boundedNodes.map(({ nodeRef }) => nodeRef));
  const overrides = new Map(
    source.positions
      .filter(({ nodeRef }) => boundedRefs.has(nodeRef))
      .map((position) => [nodeId(position.nodeRef), position]),
  );
  return positions.map((position) => {
    const override = overrides.get(position.nodeId);
    return override === undefined
      ? position
      : {
          ...position,
          effective: { x: override.x, y: override.y },
          source: "WORKSPACE_OVERRIDE" as const,
          overrideRevision: source.overlayVersion,
          overrideWorkspaceId: source.workspaceId,
        };
  });
}

/**
 * Correlates authorized owner DTOs into a pure structural Explore response. This function performs
 * no I/O and intentionally cannot materialize Mastery, readiness, Unknown, or fabricated zeroes.
 */
export function materializeLiveExploreStructure(
  input: MaterializeLiveExploreStructureInput,
): ExploreStructuralProjectionV1 {
  const selectedActivityKey = input.selectedActivityKey ?? null;
  assertValidInputs(input.source, input.targetContext);
  assertCorrelated(input.source, input.targetContext, selectedActivityKey);

  const boundedNodes = collectBoundedNodes(input.source, input.targetContext, selectedActivityKey);
  const boundedEdges = collectBoundedEdges(input.source, input.targetContext, boundedNodes);
  const projectionId = `projection:structural:${sha256(
    JSON.stringify([
      input.source.workspaceId,
      input.source.readinessGoalId,
      input.source.targetProfileVersionId,
      input.source.catalogVersionKey,
      input.source.roadmapVersionKey,
    ]),
  )}`;
  const { outline, keyboardOrder } = makeOutline(boundedNodes, projectionId);
  const requiredByNode = directRequirementRules(input.targetContext);
  const requiredRefs = new Set([
    ...input.targetContext.scope.requiredCanonicalNodeRefs,
    ...input.targetContext.scope.requiredOverlayNodeRefs,
  ]);
  const prerequisiteRefs = new Set(input.targetContext.scope.prerequisiteClosureNodeRefs);
  const roadmapRefs = new Set(input.targetContext.scope.roadmapNodeRefs);

  const visibilityPriority = (node: ExploreSourceNodeV1): number =>
    node.nodeType === "ACTIVITY"
      ? 0
      : requiredRefs.has(node.nodeRef)
        ? 1
        : prerequisiteRefs.has(node.nodeRef)
          ? 2
          : roadmapRefs.has(node.nodeRef)
            ? 3
            : 4;
  const defaultVisibleRefs = new Set(
    [...boundedNodes]
      .sort(
        (left, right) =>
          visibilityPriority(left) - visibilityPriority(right) ||
          asciiCompare(left.nodeRef, right.nodeRef),
      )
      .slice(0, 150)
      .map(({ nodeRef }) => nodeRef),
  );

  const nodes = boundedNodes
    .map((node) => {
      const id = nodeId(node.nodeRef);
      const ruleIds = requiredByNode.get(node.nodeRef);
      const reasonCodes = [
        ...(node.nodeType === "ACTIVITY" ? (["SELECTED_CONTEXT"] as const) : []),
        ...(requiredRefs.has(node.nodeRef) ? (["REQUIRED_BY_TARGET"] as const) : []),
        ...(node.origin === "WORKSPACE_OVERLAY" ? (["PERSONAL_OVERLAY"] as const) : []),
        ...(!requiredRefs.has(node.nodeRef) && node.nodeType !== "ACTIVITY"
          ? (["STRUCTURAL_CONTEXT"] as const)
          : []),
      ];
      const origin =
        node.origin === "CANONICAL"
          ? ({ kind: "CANONICAL", sourceVersionId: input.source.catalogVersionKey } as const)
          : ({
              kind: "WORKSPACE_OVERLAY",
              workspaceId: input.source.workspaceId,
              overlayRevision: input.source.overlayVersion,
              acceptance: "ACCEPTED",
            } as const);
      const description =
        input.targetContext.scope.canonicalNodes.find(({ nodeRef }) => nodeRef === node.nodeRef)
          ?.description ?? `${node.title} is accepted personal content in this target.`;
      return {
        nodeId: id,
        nodeType: node.nodeType,
        entityRef: {
          entityType: node.nodeType,
          entityId: node.nodeRef,
          entityVersionId: node.origin === "CANONICAL" ? input.source.catalogVersionKey : null,
        },
        origin,
        domainNodeId: node.domainRef === null ? null : nodeId(node.domainRef),
        title: node.title,
        shortLabel: node.title,
        requirementState:
          ruleIds === undefined
            ? ({ kind: "NOT_REQUIRED" } as const)
            : ({ kind: "REQUIRED_UNEVALUATED", ruleIds } as const),
        visibilityHint: {
          defaultVisible: defaultVisibleRefs.has(node.nodeRef),
          availableAtDetailLevels:
            node.nodeType === "DOMAIN"
              ? (["DOMAIN", "COMPETENCY", "SELECTED_ACTIVITY"] as const)
              : node.nodeType === "ACTIVITY"
                ? (["SELECTED_ACTIVITY"] as const)
                : (["COMPETENCY", "SELECTED_ACTIVITY"] as const),
          reasonCodes: [...new Set(reasonCodes)].sort(asciiCompare),
        },
        accessibility: {
          label: `${node.title}, ${node.nodeType.toLowerCase()}`,
          description,
          statusText: "Calculation not materialized.",
          keyboardOrder: keyboardOrder.get(node.nodeRef)!,
          outlineItemId: outlineItemId(id),
        },
        inspectorRef: `inspector:${id}`,
      };
    })
    .sort((left, right) => asciiCompare(left.nodeId, right.nodeId));

  const visibleNodeIds = new Set(
    nodes.filter(({ visibilityHint }) => visibilityHint.defaultVisible).map(({ nodeId }) => nodeId),
  );
  const defaultVisibleEdgeIds = boundedEdges
    .filter(
      ({ sourceNodeId, targetNodeId }) =>
        visibleNodeIds.has(sourceNodeId) && visibleNodeIds.has(targetNodeId),
    )
    .slice(0, 300)
    .map(({ edgeId }) => edgeId);
  const visibleEdgeIds = new Set(defaultVisibleEdgeIds);
  const edges = boundedEdges.map((edge) => ({
    ...edge,
    visibilityHint: {
      ...edge.visibilityHint,
      defaultVisible: visibleEdgeIds.has(edge.edgeId),
    },
  }));
  const positions = positionOverrides(input.source, boundedNodes, canonicalPositions(nodes, edges));

  const document = {
    contract: { name: "ExploreStructuralProjectionV1", version: "1.0.0" },
    projectionId,
    workspaceScope: {
      workspaceId: input.source.workspaceId,
      overlayRevision: input.source.overlayVersion,
      acceptedPersonalContentOnly: true,
    },
    selectedVersions: {
      catalogVersionKey: input.source.catalogVersionKey,
      roadmapVersionKey: input.source.roadmapVersionKey,
      targetProfileVersionKey: input.source.targetProfileVersionKey,
    },
    calculationAvailability: "NOT_MATERIALIZED",
    layout: {
      layoutVersion: LAYOUT_VERSION,
      algorithmVersion: dagreLayoutAdapterVersion,
      structuralFingerprint: "0".repeat(64),
      coordinateSystem: "TOP_LEFT",
      fixedNodeSize: FIXED_NODE_SIZE,
      spacing: SPACING,
      positions,
    },
    nodes,
    edges,
    requirements: {
      targetProfileVersionKey: input.source.targetProfileVersionKey,
      rootRuleId: input.targetContext.targetProfile.rootRuleKey,
      rules: input.targetContext.requirementRules.map(materializeRequirementRule),
    },
    visibilityHints: {
      completeTargetGraph: true,
      defaultVisibleNodeIds: [...visibleNodeIds].sort(asciiCompare),
      defaultVisibleEdgeIds,
      totalNodeCount: nodes.length,
      totalEdgeCount: edges.length,
      maximumRenderedNodes: 150,
      maximumRenderedEdges: 300,
    },
    outline,
  };
  document.layout.structuralFingerprint = computeExploreStructuralFingerprint(document);
  const validation = validateExploreStructuralProjection(document);
  if (!validation.valid) {
    fail(...validation.violations.map(({ code }) => `OUTPUT_${code}`));
  }
  return document as ExploreStructuralProjectionV1;
}
