export type ExploreNodeType = "DOMAIN" | "GROUP" | "COMPETENCY" | "ACTIVITY";
export type ExploreProjectionCalculationState =
  "CURRENT" | "STALE" | "REBUILDING" | "ERROR" | "NOT_MATERIALIZED";
export type ExploreReadinessStatus =
  "NOT_APPLICABLE" | "NOT_READY" | "INSUFFICIENT_EVIDENCE" | "DEVELOPING" | "READY";

export interface ExplorePoint {
  x: number;
  y: number;
}

export interface ExploreLayoutPosition {
  nodeId: string;
  canonical: ExplorePoint;
  effective: ExplorePoint;
  source: "CANONICAL_LAYOUT" | "WORKSPACE_OVERRIDE";
  overrideRevision: string | null;
  overrideWorkspaceId?: string;
}

export interface ExploreSemanticNodeState {
  kind: "SEMANTIC";
  achievementLevel: "NOT_STARTED" | "COMPLETED" | "VERIFIED" | "MASTERED" | null;
  summaryText: string;
}

export interface ExploreUnavailableNodeState {
  kind: "UNAVAILABLE";
  summaryText: string;
}

export interface ExploreActivityNodeState {
  kind: "ACTIVITY";
  lifecycleStatus: "AVAILABLE" | "IN_PROGRESS" | "COMPLETED" | "UNAVAILABLE";
  evidenceExpectation: "NONE" | "POSSIBLE" | "EXPECTED";
  summaryText: string;
}

export interface ExploreEntityRef {
  entityType: ExploreNodeType;
  entityId: string;
  entityVersionId: string | null;
}

interface ExploreNodeBase {
  nodeId: string;
  entityRef: ExploreEntityRef;
  inspectorRef: string;
  domainNodeId: string | null;
  title: string;
  shortLabel: string;
  requirementState: {
    kind: "NOT_REQUIRED" | "REQUIRED_UNEVALUATED" | "REQUIRED_UNKNOWN" | "REQUIRED_KNOWN";
    floorStatus?: "NOT_APPLICABLE" | "UNKNOWN" | "BELOW" | "MET";
  };
  explanations: Array<{ code: string; message: string }>;
  accessibility: {
    label: string;
    description: string;
    statusText: string;
    keyboardOrder: number;
    outlineItemId: string;
  };
}

export type ExploreNode =
  | (ExploreNodeBase & {
      nodeType: "DOMAIN" | "GROUP" | "COMPETENCY";
      state: ExploreSemanticNodeState | ExploreUnavailableNodeState;
    })
  | (ExploreNodeBase & {
      nodeType: "ACTIVITY";
      state: ExploreActivityNodeState | ExploreUnavailableNodeState;
    });

export interface ExploreEdge {
  edgeId: string;
  edgeType:
    | "PREREQUISITE_OF"
    | "RELATED_TO"
    | "PART_OF"
    | "ACTIVITY_EVIDENCES"
    | "TARGET_REQUIRES"
    | "RESOURCE_SUPPORTS"
    | "USER_ADDED";
  sourceNodeId: string;
  targetNodeId: string;
  blocking: boolean;
  accessibilityLabel: string;
}

export interface ExploreOutlineItem {
  outlineItemId: string;
  nodeId: string;
  parentItemId: string | null;
  depth: number;
  childItemIds: string[];
  accessibilityLabel: string;
}

/**
 * Minimal client view mapped from a runtime-validated GraphProjectionV1 document.
 * It omits server-only ownership and requirement bodies that this slice does not render.
 */
export interface ExploreGraphProjectionView {
  contract: { name: "GraphProjectionV1"; version: "1.0.0" };
  projectionId: string;
  workspaceScope: { overlayRevision: string };
  projectionState: {
    calculationState: ExploreProjectionCalculationState;
    staleReason: string | null;
    explanation: string;
  };
  layout: {
    layoutVersion: string;
    algorithmVersion: string;
    structuralFingerprint: string;
    coordinateSystem: "TOP_LEFT";
    fixedNodeSize: { width: number; height: number };
    spacing: { rank: number; node: number };
    positions: ExploreLayoutPosition[];
  };
  nodes: ExploreNode[];
  edges: ExploreEdge[];
  readiness: {
    targetProfileVersionId: string | null;
    status: ExploreReadinessStatus;
    estimate: { lower: number; upper: number };
    coverage: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    mandatoryBlockerRuleIds: string[];
    unknownNodeIds: string[];
    staleNodeIds: string[];
    explanations: Array<{ code: string; message: string }>;
    displayLabel: string;
  };
  visibilityHints: {
    defaultVisibleNodeIds: string[];
    defaultVisibleEdgeIds: string[];
    totalNodeCount: number;
    totalEdgeCount: number;
    maximumRenderedNodes: number;
    maximumRenderedEdges: number;
  };
  outline: { rootItemIds: string[]; items: ExploreOutlineItem[] };
}

export interface ExploreStructuralProjectionView extends Omit<
  ExploreGraphProjectionView,
  "contract" | "projectionState" | "readiness"
> {
  contract: { name: "ExploreStructuralProjectionV1"; version: "1.0.0" };
  projectionState: {
    calculationState: "NOT_MATERIALIZED";
    staleReason: null;
    explanation: string;
  };
  readiness: null;
  selectedVersions: {
    catalogVersionKey: string;
    targetProfileVersionKey: string;
  };
}

export type ExploreWorkspaceProjectionView =
  ExploreGraphProjectionView | ExploreStructuralProjectionView;

export type ExploreTargetReadinessState =
  "NOT_MATERIALIZED" | "REBUILDING" | "CURRENT" | "STALE" | "ERROR";

export interface ExploreReadinessGapView {
  gapKey: string;
  title: string;
  gapCode:
    | "FAILED_MANDATORY_FLOOR"
    | "UNKNOWN_MANDATORY_FLOOR"
    | "UNKNOWN_REQUIREMENT"
    | "KNOWN_SHORTFALL";
  competencyRef: string;
  dimension: string;
  requiredLevel: string;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  outlineNodeId: string;
  evidenceRefs: string[];
  evidenceRefCount: number;
}

export interface ExploreReadinessDomainCountsView {
  domainNodeId: string;
  title: string;
  catalogVersionKey: string;
  overlayRevision: string;
  requiredCount: number;
  knownCount: number;
  unknownCount: number;
  staleCount: number;
  mandatoryFloorBlockerCount: number;
}

export interface ExploreTargetReadinessView {
  state: ExploreTargetReadinessState;
  message: string;
  profileVersionKey: string;
  calculatedAt: string | null;
  snapshot: {
    status: "NOT_READY" | "INSUFFICIENT_EVIDENCE" | "DEVELOPING" | "READY";
    lower: number;
    upper: number;
    coverage: number;
    confidence: "LOW" | "MEDIUM" | "HIGH";
    blockers: Array<{ code: string; title: string }>;
    gaps: ExploreReadinessGapView[];
    domains: ExploreReadinessDomainCountsView[];
  } | null;
}
