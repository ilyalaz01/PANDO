"use client";

import { Background, Controls, ReactFlow, type NodeTypes } from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import styles from "./explore.module.css";
import { CompetencyOverlayInspector } from "./competency-overlay-inspector";
import { TargetReadinessPanel } from "./target-readiness-panel";
import { ExploreMapNode, nodeTypeLabel, type ExploreNodeInteraction } from "./explore-map-node";
import { buildReactFlowElements } from "./react-flow-adapter";
import type {
  ExploreOutlineItem,
  ExploreProjectionCalculationState,
  ExploreTargetReadinessView,
  ExploreWorkspaceProjectionView,
} from "./types";

const nodeTypes: NodeTypes = { explore: ExploreMapNode };
const EXPLORE_INTERACTIVE_DATA_ATTRIBUTE = "data-explore-interactive";

type ExploreView = "map" | "outline";

const projectionStateLabels: Record<ExploreProjectionCalculationState, string> = {
  CURRENT: "Current",
  STALE: "Stale",
  REBUILDING: "Rebuilding",
  ERROR: "Error",
  NOT_MATERIALIZED: "Not materialized",
};

function nextNodeId(
  orderedNodeIds: readonly string[],
  currentNodeId: string,
  key: string,
): string | undefined {
  if (orderedNodeIds.length === 0) return undefined;
  const index = orderedNodeIds.indexOf(currentNodeId);
  if (index < 0) return orderedNodeIds[0];
  if (key === "Home") return orderedNodeIds[0];
  if (key === "End") return orderedNodeIds.at(-1);
  if (key === "ArrowRight" || key === "ArrowDown") {
    return orderedNodeIds[(index + 1) % orderedNodeIds.length];
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return orderedNodeIds[(index - 1 + orderedNodeIds.length) % orderedNodeIds.length];
  }
  return undefined;
}

function chooseViewFocus(
  orderedNodeIds: readonly string[],
  selectedNodeId: string,
  previousFocusedNodeId: string,
): string {
  if (orderedNodeIds.includes(selectedNodeId)) return selectedNodeId;
  if (orderedNodeIds.includes(previousFocusedNodeId)) return previousFocusedNodeId;
  return orderedNodeIds[0] ?? "";
}

function percentage(value: number): string {
  return Math.round(value * 100) + "%";
}

function sortByKeyboardOrder(
  nodes: ExploreWorkspaceProjectionView["nodes"],
): ExploreWorkspaceProjectionView["nodes"] {
  return [...nodes].sort(
    (a, b) =>
      a.accessibility.keyboardOrder - b.accessibility.keyboardOrder ||
      a.nodeId.localeCompare(b.nodeId),
  );
}

interface OutlineBranchProps {
  item: ExploreOutlineItem;
  itemById: ReadonlyMap<string, ExploreOutlineItem>;
  nodeById: ReadonlyMap<string, ExploreWorkspaceProjectionView["nodes"][number]>;
  interaction: ExploreNodeInteraction;
}

function OutlineBranch({ item, itemById, nodeById, interaction }: OutlineBranchProps) {
  const node = nodeById.get(item.nodeId);
  if (!node) return null;
  const selected = interaction.selectedNodeId === node.nodeId;

  return (
    <li className={styles.outlineItem}>
      <button
        type="button"
        className={styles.outlineButton}
        aria-label={item.accessibilityLabel + ". " + node.accessibility.statusText}
        aria-pressed={selected}
        data-explore-focus-order={node.accessibility.keyboardOrder}
        data-explore-node-id={node.nodeId}
        data-explore-view="outline"
        tabIndex={interaction.focusedNodeId === node.nodeId ? 0 : -1}
        onClick={() => interaction.onSelectNode(node.nodeId)}
        onFocus={() => interaction.onFocusNode(node.nodeId)}
        onKeyDown={(event) => interaction.onKeyDown(event, node.nodeId)}
      >
        <span>
          <strong>{node.shortLabel}</strong>
          <small>
            {nodeTypeLabel(node.nodeType)} · {node.state.summaryText}
          </small>
        </span>
        <span aria-hidden="true">{selected ? "Selected" : "Open"}</span>
      </button>
      {item.childItemIds.length > 0 ? (
        <ul className={styles.outlineChildren}>
          {item.childItemIds.map((childId) => {
            const child = itemById.get(childId);
            return child ? (
              <OutlineBranch
                key={childId}
                item={child}
                itemById={itemById}
                nodeById={nodeById}
                interaction={interaction}
              />
            ) : null;
          })}
        </ul>
      ) : null}
    </li>
  );
}

export interface ExploreWorkspaceProps {
  readonly projection: ExploreWorkspaceProjectionView;
  readonly readinessGoalKey: string;
  readonly initialSelectedNodeId?: string;
  readonly targetReadiness?: ExploreTargetReadinessView | null;
}

export function ExploreWorkspace({
  projection,
  readinessGoalKey,
  initialSelectedNodeId: requestedInitialSelectedNodeId,
  targetReadiness,
}: ExploreWorkspaceProps) {
  const orderedNodes = useMemo(() => sortByKeyboardOrder(projection.nodes), [projection.nodes]);
  const orderedNodeIds = useMemo(() => orderedNodes.map((node) => node.nodeId), [orderedNodes]);
  const nodeById = useMemo(
    () => new Map(projection.nodes.map((node) => [node.nodeId, node])),
    [projection.nodes],
  );
  const visibleNodeIdSet = useMemo(
    () => new Set(projection.visibilityHints.defaultVisibleNodeIds),
    [projection.visibilityHints.defaultVisibleNodeIds],
  );
  const mapOrderedNodeIds = useMemo(
    () =>
      orderedNodes.filter((node) => visibleNodeIdSet.has(node.nodeId)).map((node) => node.nodeId),
    [orderedNodes, visibleNodeIdSet],
  );

  const initialSelectedNodeId =
    requestedInitialSelectedNodeId !== undefined &&
    orderedNodeIds.includes(requestedInitialSelectedNodeId)
      ? requestedInitialSelectedNodeId
      : (orderedNodeIds[0] ?? "");
  const [view, setView] = useState<ExploreView>("map");
  const [selectedNodeId, setSelectedNodeId] = useState(initialSelectedNodeId);
  const [previousProjection, setPreviousProjection] = useState(projection);
  const [previousRequestedSelection, setPreviousRequestedSelection] = useState(
    requestedInitialSelectedNodeId,
  );
  const [mapFocusedNodeId, setMapFocusedNodeId] = useState(() =>
    chooseViewFocus(mapOrderedNodeIds, initialSelectedNodeId, ""),
  );
  const [outlineFocusedNodeId, setOutlineFocusedNodeId] = useState(initialSelectedNodeId);
  const [dirtyInspectorRef, setDirtyInspectorRef] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    nodeId: string;
    view: ExploreView;
    switchToOutline?: boolean;
  } | null>(null);
  const restoreFocusRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    workspaceRef.current?.setAttribute(EXPLORE_INTERACTIVE_DATA_ATTRIBUTE, "true");
  }, []);

  const outlineById = useMemo(
    () => new Map(projection.outline.items.map((item) => [item.outlineItemId, item])),
    [projection.outline.items],
  );
  const baseElements = useMemo(() => buildReactFlowElements(projection), [projection]);

  if (
    projection !== previousProjection ||
    requestedInitialSelectedNodeId !== previousRequestedSelection
  ) {
    const requestedSelection =
      requestedInitialSelectedNodeId !== undefined && nodeById.has(requestedInitialSelectedNodeId)
        ? requestedInitialSelectedNodeId
        : undefined;
    const normalizedSelection =
      requestedInitialSelectedNodeId !== previousRequestedSelection &&
      requestedSelection !== undefined
        ? requestedSelection
        : nodeById.has(selectedNodeId)
          ? selectedNodeId
          : (orderedNodeIds[0] ?? "");
    setPreviousProjection(projection);
    setPreviousRequestedSelection(requestedInitialSelectedNodeId);
    setSelectedNodeId(normalizedSelection);
    setMapFocusedNodeId((previous) =>
      chooseViewFocus(mapOrderedNodeIds, normalizedSelection, previous),
    );
    setOutlineFocusedNodeId((previous) =>
      chooseViewFocus(orderedNodeIds, normalizedSelection, previous),
    );
  }

  const commitSelection = useCallback((nodeId: string, sourceView: ExploreView) => {
    if (sourceView === "map") setMapFocusedNodeId(nodeId);
    else setOutlineFocusedNodeId(nodeId);
    setSelectedNodeId(nodeId);
  }, []);
  const requestSelection = useCallback(
    (nodeId: string, sourceView: ExploreView) => {
      if (dirtyInspectorRef !== null && nodeId !== selectedNodeId) {
        setPendingSelection({ nodeId, view: sourceView });
        return;
      }
      commitSelection(nodeId, sourceView);
    },
    [commitSelection, dirtyInspectorRef, selectedNodeId],
  );
  const selectMapNode = useCallback(
    (nodeId: string) => requestSelection(nodeId, "map"),
    [requestSelection],
  );
  const selectOutlineNode = useCallback(
    (nodeId: string) => requestSelection(nodeId, "outline"),
    [requestSelection],
  );
  const inspectReadinessGap = useCallback(
    (nodeId: string) => {
      if (dirtyInspectorRef !== null && nodeId !== selectedNodeId) {
        setPendingSelection({ nodeId, view: "outline", switchToOutline: true });
        return;
      }
      restoreFocusRef.current = true;
      setOutlineFocusedNodeId(nodeId);
      setSelectedNodeId(nodeId);
      setView("outline");
    },
    [dirtyInspectorRef, selectedNodeId],
  );
  const handleDirtyChange = useCallback((inspectorRef: string, dirty: boolean) => {
    setDirtyInspectorRef((current) => {
      if (dirty) return inspectorRef;
      return current === inspectorRef ? null : current;
    });
  }, []);

  const handleMapKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, nodeId: string) => {
      const destination = nextNodeId(mapOrderedNodeIds, nodeId, event.key);
      if (!destination) return;
      event.preventDefault();
      setMapFocusedNodeId(destination);
    },
    [mapOrderedNodeIds],
  );
  const handleOutlineKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, nodeId: string) => {
      const destination = nextNodeId(orderedNodeIds, nodeId, event.key);
      if (!destination) return;
      event.preventDefault();
      setOutlineFocusedNodeId(destination);
    },
    [orderedNodeIds],
  );

  const mapInteraction = useMemo<ExploreNodeInteraction>(
    () => ({
      focusedNodeId: mapFocusedNodeId,
      selectedNodeId,
      onFocusNode: setMapFocusedNodeId,
      onKeyDown: handleMapKeyDown,
      onSelectNode: selectMapNode,
    }),
    [handleMapKeyDown, mapFocusedNodeId, selectMapNode, selectedNodeId],
  );
  const outlineInteraction = useMemo<ExploreNodeInteraction>(
    () => ({
      focusedNodeId: outlineFocusedNodeId,
      selectedNodeId,
      onFocusNode: setOutlineFocusedNodeId,
      onKeyDown: handleOutlineKeyDown,
      onSelectNode: selectOutlineNode,
    }),
    [handleOutlineKeyDown, outlineFocusedNodeId, selectOutlineNode, selectedNodeId],
  );
  const flowNodes = useMemo(
    () =>
      baseElements.nodes.map((node) => ({
        ...node,
        data: { ...node.data, interaction: mapInteraction },
      })),
    [baseElements.nodes, mapInteraction],
  );

  const activeFocusedNodeId = view === "map" ? mapFocusedNodeId : outlineFocusedNodeId;
  useEffect(() => {
    const focusWasInsideView = document.activeElement?.matches("[data-explore-view]");
    if (!restoreFocusRef.current && !focusWasInsideView) return;
    const order = nodeById.get(activeFocusedNodeId)?.accessibility.keyboardOrder;
    if (order === undefined) return;
    const selector = '[data-explore-view="' + view + '"][data-explore-focus-order="' + order + '"]';
    document.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: view === "map" });
    restoreFocusRef.current = false;
  }, [activeFocusedNodeId, nodeById, view]);

  const selectedNode = nodeById.get(selectedNodeId) ?? orderedNodes[0];
  if (!selectedNode) return null;

  const selectedRelationships = projection.edges.filter(
    (edge) =>
      edge.sourceNodeId === selectedNode.nodeId || edge.targetNodeId === selectedNode.nodeId,
  );
  const selectedHiddenFromMap = !visibleNodeIdSet.has(selectedNode.nodeId);
  const calculationState = projection.projectionState.calculationState;
  const readinessNotApplicable = projection.readiness?.status === "NOT_APPLICABLE";
  const showCurrentMetrics =
    calculationState === "CURRENT" && projection.readiness !== null && !readinessNotApplicable;
  const showStaleMetrics =
    calculationState === "STALE" && projection.readiness !== null && !readinessNotApplicable;

  const changeView = (nextView: ExploreView) => {
    if (nextView === view) return;
    restoreFocusRef.current = true;
    if (nextView === "map") {
      setMapFocusedNodeId((previous) =>
        chooseViewFocus(mapOrderedNodeIds, selectedNodeId, previous),
      );
    } else {
      setOutlineFocusedNodeId((previous) =>
        chooseViewFocus(orderedNodeIds, selectedNodeId, previous),
      );
    }
    setView(nextView);
  };

  return (
    <div ref={workspaceRef} className={styles.workspace} data-explore-interactive="false">
      {targetReadiness !== undefined ? (
        <TargetReadinessPanel readiness={targetReadiness} onInspectGap={inspectReadinessGap} />
      ) : (
        <section className={styles.readiness} aria-labelledby="readiness-title">
          <div>
            <p className={styles.eyebrow}>
              Projection state · {projectionStateLabels[calculationState]}
            </p>
            <h2 id="readiness-title">
              {calculationState === "NOT_MATERIALIZED"
                ? "Mastery and readiness are not calculated yet"
                : readinessNotApplicable
                  ? "Choose a target to calculate readiness"
                  : projection.readiness?.status.replaceAll("_", " ")}
            </h2>
            {showCurrentMetrics || showStaleMetrics ? (
              <p>{projection.readiness?.displayLabel}</p>
            ) : null}
            <p className={styles.projectionExplanation}>{projection.projectionState.explanation}</p>
          </div>
          {showCurrentMetrics || showStaleMetrics ? (
            <dl
              className={styles.readinessMetrics}
              aria-label={showStaleMetrics ? "Last calculated readiness" : "Current readiness"}
            >
              <div>
                <dt>{showStaleMetrics ? "Last interval" : "Interval"}</dt>
                <dd>
                  {percentage(projection.readiness?.estimate.lower ?? 0)}–
                  {percentage(projection.readiness?.estimate.upper ?? 0)}
                </dd>
              </div>
              <div>
                <dt>{showStaleMetrics ? "Last coverage" : "Coverage"}</dt>
                <dd>{percentage(projection.readiness?.coverage ?? 0)}</dd>
              </div>
              <div>
                <dt>{showStaleMetrics ? "Last confidence" : "Confidence"}</dt>
                <dd>{projection.readiness?.confidence}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.projectionNotice}>
              {calculationState === "NOT_MATERIALIZED"
                ? "The live target structure is available. Evidence-derived states will appear after the calculation boundary is materialized."
                : readinessNotApplicable
                  ? "Start by choosing a target. Readiness is not calculated without one."
                  : calculationState === "REBUILDING"
                    ? "Readiness is being rebuilt. No result is presented as current."
                    : "Readiness could not be calculated. No result is presented as current."}
            </p>
          )}
        </section>
      )}

      <div className={styles.viewBar} aria-label="Explore view">
        <div className={styles.viewSwitch}>
          <button type="button" aria-pressed={view === "map"} onClick={() => changeView("map")}>
            Map
          </button>
          <button
            type="button"
            aria-pressed={view === "outline"}
            onClick={() => changeView("outline")}
          >
            Outline
          </button>
        </div>
        <p>
          {projection.visibilityHints.totalNodeCount} nodes ·{" "}
          {projection.visibilityHints.totalEdgeCount} relationships
        </p>
      </div>

      <div className={styles.exploreGrid}>
        <section
          className={styles.graphPanel}
          aria-label={view === "map" ? "Competency map" : "Competency outline"}
        >
          {view === "map" ? (
            <>
              <div className={styles.mapCanvas} data-testid="explore-map">
                <ReactFlow
                  nodes={flowNodes}
                  edges={baseElements.edges}
                  onNodeClick={() => undefined}
                  nodeTypes={nodeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  nodesFocusable={false}
                  edgesFocusable={false}
                  elementsSelectable={false}
                  disableKeyboardA11y
                  fitView
                  fitViewOptions={{ padding: 0.08, duration: 0 }}
                  minZoom={0.12}
                  maxZoom={1.8}
                  onlyRenderVisibleElements={false}
                  ariaLabelConfig={{
                    "node.a11yDescription.default":
                      "Use arrow keys on a competency to move through the projection.",
                    "controls.ariaLabel": "Map controls",
                    "controls.zoomIn.ariaLabel": "Zoom in map",
                    "controls.zoomOut.ariaLabel": "Zoom out map",
                    "controls.fitView.ariaLabel": "Fit competency map",
                  }}
                >
                  <Background gap={24} size={1} color="var(--color-graph-grid)" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
              <div className={styles.mapMobileFallback} data-testid="mobile-map-fallback">
                <p className={styles.eyebrow}>Compact map</p>
                <h3>{selectedNode.shortLabel}</h3>
                <p>{selectedNode.accessibility.description}</p>
                <button type="button" onClick={() => changeView("outline")}>
                  Use accessible outline
                </button>
              </div>
            </>
          ) : (
            <ul className={styles.outlineRoot} data-testid="explore-outline">
              {projection.outline.rootItemIds.map((rootId) => {
                const item = outlineById.get(rootId);
                return item ? (
                  <OutlineBranch
                    key={rootId}
                    item={item}
                    itemById={outlineById}
                    nodeById={nodeById}
                    interaction={outlineInteraction}
                  />
                ) : null;
              })}
            </ul>
          )}
        </section>

        <aside className={styles.inspector} aria-labelledby="inspector-title">
          <p className={styles.eyebrow}>{nodeTypeLabel(selectedNode.nodeType)}</p>
          <h2 id="inspector-title">{selectedNode.title}</h2>
          <p>{selectedNode.accessibility.description}</p>
          {view === "map" && selectedHiddenFromMap ? (
            <p className={styles.notice}>
              This selection remains available in the Outline but is outside the server-projected
              default Map visibility.
            </p>
          ) : null}
          <dl>
            <div>
              <dt>State</dt>
              <dd>{selectedNode.state.summaryText}</dd>
            </div>
            <div>
              <dt>Requirement</dt>
              <dd>{selectedNode.requirementState.kind.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Floor</dt>
              <dd>
                {(selectedNode.requirementState.floorStatus ?? "NOT_APPLICABLE").replaceAll(
                  "_",
                  " ",
                )}
              </dd>
            </div>
          </dl>
          {selectedRelationships.length > 0 ? (
            <div>
              <h3>Relationships and prerequisites</h3>
              <ul>
                {selectedRelationships.map((edge) => (
                  <li key={edge.edgeId}>
                    {edge.accessibilityLabel}
                    {edge.blocking ? (
                      <>
                        {" "}
                        <strong className={styles.relationshipStatus}>Blocking</strong>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {selectedNode.explanations.length > 0 ? (
            <div>
              <h3>Why this state?</h3>
              <ul>
                {selectedNode.explanations.map((explanation) => (
                  <li key={explanation.code}>{explanation.message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {projection.readiness?.unknownNodeIds.includes(selectedNode.nodeId) ? (
            <p className={styles.notice}>
              Evidence is unknown; the server projection does not treat unknown as zero.
            </p>
          ) : null}
          {projection.readiness?.staleNodeIds.includes(selectedNode.nodeId) ? (
            <p className={styles.notice}>This estimate is marked stale by the server projection.</p>
          ) : null}
          {selectedNode.nodeType === "ACTIVITY" &&
          selectedNode.entityRef.entityType === "ACTIVITY" &&
          selectedNode.entityRef.entityId.startsWith("activity:custom-") ? (
            <Link
              className={styles.focusLink}
              href={`/focus?${new URLSearchParams({
                goal: readinessGoalKey,
                activity: selectedNode.entityRef.entityId,
              }).toString()}`}
              prefetch={false}
            >
              Start focus session
            </Link>
          ) : null}
          {pendingSelection !== null ? (
            <section
              className={styles.draftWarning}
              aria-labelledby="draft-warning-title"
              role="alert"
            >
              <h3 id="draft-warning-title">Unsaved changes</h3>
              <p>Keep editing this competency, or discard the draft before opening another node.</p>
              <div>
                <button type="button" onClick={() => setPendingSelection(null)}>
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const selection = pendingSelection;
                    setPendingSelection(null);
                    setDirtyInspectorRef(null);
                    if (selection.switchToOutline) {
                      restoreFocusRef.current = true;
                      setOutlineFocusedNodeId(selection.nodeId);
                      setSelectedNodeId(selection.nodeId);
                      setView("outline");
                    } else {
                      commitSelection(selection.nodeId, selection.view);
                    }
                  }}
                >
                  Discard draft and open selection
                </button>
              </div>
            </section>
          ) : null}
          {selectedNode.nodeType === "COMPETENCY" &&
          selectedNode.entityRef.entityType === "COMPETENCY" ? (
            <CompetencyOverlayInspector
              key={selectedNode.inspectorRef}
              readinessGoalKey={readinessGoalKey}
              competencyRef={selectedNode.entityRef.entityId}
              inspectorRef={selectedNode.inspectorRef}
              initialOverlayVersion={projection.workspaceScope.overlayRevision}
              onDirtyChange={handleDirtyChange}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

export { chooseViewFocus, nextNodeId };
