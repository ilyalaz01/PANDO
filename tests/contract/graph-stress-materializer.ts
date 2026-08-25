import type { JsonObject } from "../../src/shared/contracts/json";
import { computeGraphStructuralFingerprint } from "../../src/shared/contracts/graph-projection";

const constants = {
  workspaceId: "workspace:stress-primary",
  overlayRevision: "overlay:stress-v1",
  catalogVersionId: "catalog:stress-v1",
  roadmapTemplateVersionId: "roadmap:stress-v1",
  targetProfileVersionId: "target:stress-v1",
  projectionId: "projection:graph-stress-500-v1",
  semanticRevision: "revision:graph-stress-v1",
  inputWatermark: "watermark:stress-2026-08-25",
  generatedAt: "2026-08-25T12:00:00Z",
  policyVersion: "mastery-readiness-v0.1",
  readinessEngineVersion: "readiness-engine-v0.1",
} as const;

function ordinal(value: number): string {
  return String(value).padStart(4, "0");
}

function domainNodeId(value: number): string {
  return `node:domain:stress-${ordinal(value)}`;
}

function competencyNodeId(value: number): string {
  return `node:competency:stress-${ordinal(value)}`;
}

function overlayOrigin(): JsonObject {
  return {
    kind: "WORKSPACE_OVERLAY",
    workspaceId: constants.workspaceId,
    overlayRevision: constants.overlayRevision,
    acceptance: "ACCEPTED",
  };
}

function canonicalOrigin(): JsonObject {
  return { kind: "CANONICAL", sourceVersionId: constants.catalogVersionId };
}

function directMember(nodeOrdinal: number, dimension: string, requiredLevel: string): JsonObject {
  return {
    memberType: "NODE",
    nodeId: competencyNodeId(nodeOrdinal),
    dimension,
    requiredLevel,
  };
}

function ruleMember(ruleOrdinal: number): JsonObject {
  return { memberType: "RULE", ruleId: `rule:stress:${ordinal(ruleOrdinal)}` };
}

function baseRule(ruleOrdinal: number, ruleType: string, title: string): JsonObject {
  return {
    ruleId: `rule:stress:${ordinal(ruleOrdinal)}`,
    ruleType,
    title,
    criticality: "MANDATORY",
    explanation: `Deterministic stress rule ${ordinal(ruleOrdinal)} of type ${ruleType}.`,
    accessibilityLabel: `Stress rule ${ordinal(ruleOrdinal)}, ${ruleType}.`,
  };
}

function materializeRules(): JsonObject[] {
  const rules: JsonObject[] = [
    { ...baseRule(1, "ALL", "Stress root"), members: [2, 3, 4, 5].map(ruleMember) },
    {
      ...baseRule(2, "ANY", "Stress floor alternatives"),
      members: [6, 7, 8, 9, 10].map(ruleMember),
    },
    {
      ...baseRule(3, "K_OF_N", "Stress breadth groups"),
      requiredCount: 3,
      members: [11, 12, 13, 14, 15].map(ruleMember),
    },
    {
      ...baseRule(4, "WEIGHTED_THRESHOLD", "Stress weighted groups"),
      threshold: 0.8,
      members: [16, 17, 18, 19, 20].map((value) => ({
        member: ruleMember(value),
        weight: 0.2,
      })),
    },
    { ...baseRule(5, "ALL", "Stress final groups"), members: [21, 22, 23, 24, 25].map(ruleMember) },
  ];
  for (let value = 6; value <= 10; value += 1) {
    rules.push({
      ...baseRule(value, "MANDATORY_FLOOR", `Stress floor ${ordinal(value)}`),
      member: directMember(value - 5, "APPLICATION", "VERIFIED"),
    });
  }
  for (let value = 11; value <= 15; value += 1) {
    const first = 6 + (value - 11) * 3;
    rules.push({
      ...baseRule(value, "ANY", `Stress alternatives ${ordinal(value)}`),
      members: [first, first + 1, first + 2].map((item) =>
        directMember(item, "KNOWLEDGE", "COMPLETED"),
      ),
    });
  }
  for (let value = 16; value <= 20; value += 1) {
    const first = 21 + (value - 16) * 3;
    rules.push({
      ...baseRule(value, "K_OF_N", `Stress two of three ${ordinal(value)}`),
      requiredCount: 2,
      members: [first, first + 1, first + 2].map((item) =>
        directMember(item, "APPLICATION", "COMPLETED"),
      ),
    });
  }
  for (let value = 21; value <= 24; value += 1) {
    const first = 36 + (value - 21) * 5;
    rules.push({
      ...baseRule(value, "WEIGHTED_THRESHOLD", `Stress weighted leaves ${ordinal(value)}`),
      threshold: 0.75,
      members: Array.from({ length: 5 }, (_, index) => ({
        member: directMember(first + index, "RECALL", "VERIFIED"),
        weight: 0.2,
      })),
    });
  }
  rules.push({
    ...baseRule(25, "MANDATORY_FLOOR", "Stress known stale floor"),
    member: directMember(56, "APPLICATION", "VERIFIED"),
  });
  return rules.sort((left, right) => String(left.ruleId).localeCompare(String(right.ruleId)));
}

function directRuleMap(rules: JsonObject[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const rule of rules) {
    const members =
      rule.member === undefined ? (rule.members as JsonObject[]) : [rule.member as JsonObject];
    for (const item of members) {
      const member = (item.member as JsonObject | undefined) ?? item;
      if (member.memberType !== "NODE") continue;
      const nodeId = String(member.nodeId);
      result.set(nodeId, [...(result.get(nodeId) ?? []), String(rule.ruleId)].sort());
    }
  }
  return result;
}

function stateBucket(globalOrdinal: number): JsonObject {
  if (globalOrdinal <= 50) {
    return {
      availability: "UNKNOWN",
      lastMeaningfulEvidenceAt: null,
      summaryText: "Unknown because no qualifying evidence is available.",
      code: "state.unknown",
      competencyAchievement: "NOT_STARTED",
    };
  }
  if (globalOrdinal <= 125) {
    return {
      availability: "KNOWN",
      condition: "STALE",
      confidence: "LOW",
      lastMeaningfulEvidenceAt: "2026-01-01T00:00:00Z",
      summaryText: "Known STALE estimate with LOW confidence.",
      code: "state.stale",
      competencyAchievement: "COMPLETED",
    };
  }
  if (globalOrdinal <= 250) {
    return {
      availability: "KNOWN",
      condition: "WEAK",
      confidence: "LOW",
      lastMeaningfulEvidenceAt: "2026-08-01T00:00:00Z",
      summaryText: "Known WEAK estimate with LOW confidence.",
      code: "state.weak",
      competencyAchievement: "COMPLETED",
    };
  }
  return {
    availability: "KNOWN",
    condition: "STRONG",
    confidence: "MEDIUM",
    lastMeaningfulEvidenceAt: "2026-08-20T00:00:00Z",
    summaryText: "Known STRONG estimate with MEDIUM confidence.",
    code: "state.strong",
    competencyAchievement: "VERIFIED",
  };
}

function semanticState(globalOrdinal: number, competency: boolean): JsonObject {
  const bucket = stateBucket(globalOrdinal);
  const estimate =
    bucket.availability === "UNKNOWN"
      ? { availability: "UNKNOWN", lastMeaningfulEvidenceAt: null }
      : {
          availability: "KNOWN",
          condition: bucket.condition!,
          confidence: bucket.confidence!,
          lastMeaningfulEvidenceAt: bucket.lastMeaningfulEvidenceAt!,
        };
  return {
    achievementLevel: competency ? bucket.competencyAchievement! : null,
    estimate,
    policyVersion: constants.policyVersion,
    summaryText: bucket.summaryText!,
  };
}

function requirementState(
  nodeId: string,
  globalOrdinal: number,
  directRules: Map<string, string[]>,
): JsonObject {
  const ruleIds = directRules.get(nodeId) ?? [];
  if (ruleIds.length === 0) return { kind: "NOT_REQUIRED" };
  const floor = ruleIds.some((id) =>
    [
      "rule:stress:0006",
      "rule:stress:0007",
      "rule:stress:0008",
      "rule:stress:0009",
      "rule:stress:0010",
      "rule:stress:0025",
    ].includes(id),
  );
  const bucket = stateBucket(globalOrdinal);
  if (bucket.availability === "UNKNOWN") {
    return {
      kind: "REQUIRED_UNKNOWN",
      ruleIds,
      attainment: { lower: 0, upper: 1 },
      floorStatus: floor ? "UNKNOWN" : "NOT_APPLICABLE",
    };
  }
  const attainment =
    bucket.competencyAchievement === "VERIFIED"
      ? 1
      : bucket.condition === "STALE"
        ? 0.5333333333
        : 0.67;
  return {
    kind: "REQUIRED_KNOWN",
    ruleIds,
    attainment: { lower: attainment, upper: attainment },
    floorStatus: floor ? "BELOW" : "NOT_APPLICABLE",
  };
}

function keyboardOrders(): Map<string, number> {
  const result = new Map<string, number>();
  let order = 1;
  for (let domain = 1; domain <= 10; domain += 1) {
    result.set(domainNodeId(domain), order++);
    for (let competency = domain; competency <= 490; competency += 10) {
      result.set(competencyNodeId(competency), order++);
    }
  }
  return result;
}

function materializeNodes(
  directRules: Map<string, string[]>,
  visibleNodeIds: Set<string>,
): JsonObject[] {
  const keyboard = keyboardOrders();
  const nodes: JsonObject[] = [];
  for (let value = 1; value <= 10; value += 1) {
    const id = domainNodeId(value);
    const bucket = stateBucket(value);
    nodes.push({
      nodeId: id,
      nodeType: "DOMAIN",
      entityRef: {
        entityType: "DOMAIN",
        entityId: `domain:stress-${ordinal(value)}`,
        entityVersionId: constants.catalogVersionId,
      },
      origin: canonicalOrigin(),
      domainNodeId: null,
      title: `Stress domain ${ordinal(value)}`,
      shortLabel: `Domain ${ordinal(value)}`,
      state: semanticState(value, false),
      requirementState: { kind: "NOT_REQUIRED" },
      explanations: [
        {
          code: bucket.code!,
          message: bucket.summaryText!,
          relatedNodeIds: [id],
          relatedRuleIds: [],
        },
      ],
      visibilityHint: {
        defaultVisible: visibleNodeIds.has(id),
        availableAtDetailLevels: ["DOMAIN", "GROUP", "COMPETENCY"],
        reasonCodes: ["STRUCTURAL_CONTEXT"],
      },
      accessibility: {
        label: `Stress domain ${ordinal(value)}, domain summary`,
        description: `Deterministic stress domain ${ordinal(value)}.`,
        statusText: bucket.summaryText!,
        keyboardOrder: keyboard.get(id)!,
        outlineItemId: `outline:${id}`,
      },
      inspectorRef: `inspector:${id}`,
    });
  }
  for (let value = 1; value <= 490; value += 1) {
    const id = competencyNodeId(value);
    const globalOrdinal = 10 + value;
    const domain = ((value - 1) % 10) + 1;
    const bucket = stateBucket(globalOrdinal);
    const ruleIds = directRules.get(id) ?? [];
    const personal = value >= 466;
    nodes.push({
      nodeId: id,
      nodeType: "COMPETENCY",
      entityRef: {
        entityType: "COMPETENCY",
        entityId: `competency:stress-${ordinal(value)}`,
        entityVersionId: personal ? constants.overlayRevision : constants.catalogVersionId,
      },
      origin: personal ? overlayOrigin() : canonicalOrigin(),
      domainNodeId: domainNodeId(domain),
      title: `Stress competency ${ordinal(value)}`,
      shortLabel: `Competency ${ordinal(value)}`,
      state: semanticState(globalOrdinal, true),
      requirementState: requirementState(id, globalOrdinal, directRules),
      explanations: [
        {
          code: bucket.code!,
          message: bucket.summaryText!,
          relatedNodeIds: [id],
          relatedRuleIds: ruleIds,
        },
      ],
      visibilityHint: {
        defaultVisible: visibleNodeIds.has(id),
        availableAtDetailLevels: ["COMPETENCY", "SELECTED_ACTIVITY"],
        reasonCodes: [
          personal
            ? "PERSONAL_OVERLAY"
            : ruleIds.length > 0
              ? "REQUIRED_BY_TARGET"
              : "STRUCTURAL_CONTEXT",
        ],
      },
      accessibility: {
        label: `Stress competency ${ordinal(value)}, competency`,
        description: `Deterministic competency ${ordinal(value)} in stress domain ${ordinal(domain)}.`,
        statusText: bucket.summaryText!,
        keyboardOrder: keyboard.get(id)!,
        outlineItemId: `outline:${id}`,
      },
      inspectorRef: `inspector:${id}`,
    });
  }
  return nodes.sort((left, right) => String(left.nodeId).localeCompare(String(right.nodeId)));
}

function edge(
  edgeId: string,
  edgeType: string,
  sourceNodeId: string,
  targetNodeId: string,
  origin: JsonObject,
  blocking: boolean,
  rationale: string,
  accessibilityLabel: string,
  reasonCode: string,
): JsonObject {
  return {
    edgeId,
    edgeType,
    sourceNodeId,
    targetNodeId,
    origin,
    blocking,
    rationale,
    accessibilityLabel,
    visibilityHint: { defaultVisible: false, reasonCode },
  };
}

function materializeEdges(): JsonObject[] {
  const edges: JsonObject[] = [];
  for (let source = 1; source <= 490; source += 1) {
    const domain = ((source - 1) % 10) + 1;
    edges.push(
      edge(
        `edge:part-of:stress-${ordinal(source)}`,
        "PART_OF",
        competencyNodeId(source),
        domainNodeId(domain),
        source >= 466 ? overlayOrigin() : canonicalOrigin(),
        false,
        `Stress competency ${ordinal(source)} belongs to stress domain ${ordinal(domain)} for navigation.`,
        `Stress competency ${ordinal(source)} is part of stress domain ${ordinal(domain)}.`,
        "NAVIGATION_ONLY",
      ),
    );
  }
  for (let source = 1; source <= 489; source += 1) {
    edges.push(
      edge(
        `edge:prerequisite:offset-0001:source-${ordinal(source)}`,
        "PREREQUISITE_OF",
        competencyNodeId(source),
        competencyNodeId(source + 1),
        source >= 465 ? overlayOrigin() : canonicalOrigin(),
        true,
        `Offset one prerequisite from ${ordinal(source)} to ${ordinal(source + 1)}.`,
        `Stress competency ${ordinal(source)} is a prerequisite of stress competency ${ordinal(source + 1)}.`,
        "ACTIVE_PREREQUISITE",
      ),
    );
  }
  for (let source = 1; source <= 231; source += 1) {
    edges.push(
      edge(
        `edge:prerequisite:offset-0010:source-${ordinal(source)}`,
        "PREREQUISITE_OF",
        competencyNodeId(source),
        competencyNodeId(source + 10),
        canonicalOrigin(),
        true,
        `Offset ten prerequisite from ${ordinal(source)} to ${ordinal(source + 10)}.`,
        `Stress competency ${ordinal(source)} is a prerequisite of stress competency ${ordinal(source + 10)}.`,
        "ACTIVE_PREREQUISITE",
      ),
    );
  }
  for (let source = 1; source <= 50; source += 1) {
    edges.push(
      edge(
        `edge:related:source-${ordinal(source)}`,
        "RELATED_TO",
        competencyNodeId(source),
        competencyNodeId(source + 100),
        canonicalOrigin(),
        false,
        `Deterministic non-blocking related context from ${ordinal(source)} to ${ordinal(source + 100)}.`,
        `Stress competency ${ordinal(source)} is related to stress competency ${ordinal(source + 100)}.`,
        "SEMANTIC_CONTEXT",
      ),
    );
  }
  for (let source = 466; source <= 490; source += 1) {
    edges.push(
      edge(
        `edge:user-added:source-${ordinal(source)}`,
        "USER_ADDED",
        competencyNodeId(source),
        competencyNodeId(source - 465),
        overlayOrigin(),
        false,
        `Accepted personal non-blocking context from ${ordinal(source)} to ${ordinal(source - 465)}.`,
        `Personal stress competency ${ordinal(source)} is related to stress competency ${ordinal(source - 465)}.`,
        "PERSONAL_CONTEXT",
      ),
    );
  }
  return edges.sort((left, right) => String(left.edgeId).localeCompare(String(right.edgeId)));
}

function materializeOutline(): JsonObject {
  const items: JsonObject[] = [];
  for (let domain = 1; domain <= 10; domain += 1) {
    const id = domainNodeId(domain);
    const children = Array.from(
      { length: 49 },
      (_, index) => `outline:${competencyNodeId(domain + index * 10)}`,
    ).sort();
    items.push({
      outlineItemId: `outline:${id}`,
      nodeId: id,
      parentItemId: null,
      depth: 0,
      sortKey: `${ordinal(domain * 100)}:stress-${ordinal(domain)}`,
      childItemIds: children,
      accessibilityLabel: `Stress domain ${ordinal(domain)}, domain summary`,
    });
  }
  for (let competency = 1; competency <= 490; competency += 1) {
    const domain = ((competency - 1) % 10) + 1;
    const id = competencyNodeId(competency);
    items.push({
      outlineItemId: `outline:${id}`,
      nodeId: id,
      parentItemId: `outline:${domainNodeId(domain)}`,
      depth: 1,
      sortKey: `${ordinal(1000 + competency)}:stress-${ordinal(competency)}`,
      childItemIds: [],
      accessibilityLabel: `Stress competency ${ordinal(competency)}, competency`,
    });
  }
  items.sort((left, right) =>
    String(left.outlineItemId).localeCompare(String(right.outlineItemId)),
  );
  return {
    projectionId: constants.projectionId,
    rootItemIds: Array.from(
      { length: 10 },
      (_, index) => `outline:${domainNodeId(index + 1)}`,
    ).sort(),
    items,
  };
}

export function materializeGraphStressProjection(): JsonObject {
  const rules = materializeRules();
  const directRules = directRuleMap(rules);
  const visibleNodeIds = new Set([
    ...Array.from({ length: 10 }, (_, index) => domainNodeId(index + 1)),
    ...Array.from({ length: 140 }, (_, index) => competencyNodeId(index + 1)),
  ]);
  const nodes = materializeNodes(directRules, visibleNodeIds);
  const edges = materializeEdges();
  const visibleEdgeIds = edges
    .filter(
      (item) =>
        visibleNodeIds.has(String(item.sourceNodeId)) &&
        visibleNodeIds.has(String(item.targetNodeId)),
    )
    .slice(0, 299)
    .map((item) => String(item.edgeId));
  const visibleEdges = new Set(visibleEdgeIds);
  for (const item of edges) {
    (item.visibilityHint as JsonObject).defaultVisible = visibleEdges.has(String(item.edgeId));
  }
  const positions = nodes.map((node) => {
    const id = String(node.nodeId);
    const domainMatch = /^node:domain:stress-(\d{4})$/.exec(id);
    const globalOrdinal =
      domainMatch === null
        ? 10 + Number(/^node:competency:stress-(\d{4})$/.exec(id)![1])
        : Number(domainMatch[1]);
    const canonical = {
      x: ((globalOrdinal - 1) % 10) * 340,
      y: Math.floor((globalOrdinal - 1) / 10) * 180,
    };
    const personal = id >= competencyNodeId(466) && id <= competencyNodeId(490);
    return {
      nodeId: id,
      canonical,
      effective: personal ? { x: canonical.x + 40, y: canonical.y + 24 } : { ...canonical },
      source: personal ? "WORKSPACE_OVERRIDE" : "CANONICAL_LAYOUT",
      overrideRevision: personal ? constants.overlayRevision : null,
      ...(personal ? { overrideWorkspaceId: constants.workspaceId } : {}),
    } as JsonObject;
  });
  const unknownNodeIds = nodes
    .filter((node) => {
      const state = node.state as JsonObject;
      return (state.estimate as JsonObject).availability === "UNKNOWN";
    })
    .map((node) => String(node.nodeId));
  const staleNodeIds = nodes
    .filter((node) => {
      const state = node.state as JsonObject;
      return (state.estimate as JsonObject).condition === "STALE";
    })
    .map((node) => String(node.nodeId));

  const projection: JsonObject = {
    contract: { name: "GraphProjectionV1", version: "1.0.0" },
    projectionId: constants.projectionId,
    workspaceScope: {
      workspaceId: constants.workspaceId,
      overlayRevision: constants.overlayRevision,
      acceptedPersonalContentOnly: true,
    },
    selectedVersions: {
      catalogVersionId: constants.catalogVersionId,
      roadmapTemplateVersionId: constants.roadmapTemplateVersionId,
      targetProfileVersionId: constants.targetProfileVersionId,
      masteryPolicyVersion: constants.policyVersion,
      readinessPolicyVersion: constants.policyVersion,
    },
    projectionState: {
      semanticRevision: constants.semanticRevision,
      inputWatermark: constants.inputWatermark,
      generatedAt: constants.generatedAt,
      calculationState: "CURRENT",
      staleReason: null,
      explanation: "Deterministic 500-node stress projection generated without randomness.",
    },
    layout: {
      layoutVersion: "graph-layout-v1",
      algorithmVersion: "dagre-layered-v1",
      structuralFingerprint: "0".repeat(64),
      coordinateSystem: "TOP_LEFT",
      fixedNodeSize: { width: 240, height: 104 },
      spacing: { rank: 88, node: 40 },
      positions,
    },
    nodes,
    edges,
    requirements: {
      targetProfileVersionId: constants.targetProfileVersionId,
      rootRuleId: "rule:stress:0001",
      rules,
    },
    readiness: {
      targetProfileVersionId: constants.targetProfileVersionId,
      engineVersion: constants.readinessEngineVersion,
      policyVersion: constants.policyVersion,
      calculatedAt: constants.generatedAt,
      inputWatermark: constants.inputWatermark,
      status: "NOT_READY",
      estimate: { lower: 0.1523809524, upper: 0.8666666667 },
      coverage: 0.2857142857,
      confidence: "LOW",
      mandatoryBlockerRuleIds: ["rule:stress:0025"],
      unknownNodeIds,
      staleNodeIds,
      domainBreakdown: Array.from({ length: 10 }, (_, index) => ({
        domainNodeId: domainNodeId(index + 1),
        estimate: { lower: 0.15, upper: 0.87 },
        coverage: 0.29,
        confidence: "LOW",
      })),
      explanations: [
        {
          code: "mandatory-floor-below",
          message: "Stress competency 0056 is known stale and below its verified mandatory floor.",
          relatedNodeIds: [competencyNodeId(56)],
          relatedRuleIds: ["rule:stress:0025"],
        },
        {
          code: "unknown-coverage",
          message:
            "Forty required competencies remain unknown and are represented as intervals, not zero.",
          relatedNodeIds: [competencyNodeId(1)],
          relatedRuleIds: ["rule:stress:0002"],
        },
      ],
      displayLabel: "Readiness 15 to 87 out of 100, confidence Low, status Not ready.",
    },
    visibilityHints: {
      completeTargetGraph: true,
      defaultVisibleNodeIds: [...visibleNodeIds].sort(),
      defaultVisibleEdgeIds: visibleEdgeIds,
      totalNodeCount: 500,
      totalEdgeCount: 1285,
      maximumRenderedNodes: 150,
      maximumRenderedEdges: 300,
    },
    outline: materializeOutline(),
  };
  (projection.layout as JsonObject).structuralFingerprint =
    computeGraphStructuralFingerprint(projection);
  return projection;
}
