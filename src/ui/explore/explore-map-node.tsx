"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { KeyboardEvent } from "react";

import styles from "./explore.module.css";
import type { ExploreFlowNode } from "./react-flow-adapter";
import type { ExploreNodeType } from "./types";

export interface ExploreNodeInteraction {
  focusedNodeId: string;
  selectedNodeId: string;
  onFocusNode: (nodeId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const nodeTypeLabels: Record<ExploreNodeType, string> = {
  DOMAIN: "Domain",
  GROUP: "Group",
  COMPETENCY: "Competency",
  ACTIVITY: "Activity",
};

export function nodeTypeLabel(nodeType: ExploreNodeType): string {
  return nodeTypeLabels[nodeType];
}

export function ExploreMapNode({ data }: NodeProps<ExploreFlowNode>) {
  const interaction = data.interaction as ExploreNodeInteraction;
  const node = data.projectionNode;
  const selected = node.nodeId === interaction.selectedNodeId;
  const isDomain = node.nodeType === "DOMAIN";

  return (
    <div className={isDomain ? styles.mapNodeDomain : styles.mapNode}>
      <Handle className={styles.handle} type="target" position={Position.Left} />
      <button
        type="button"
        className={styles.mapNodeButton}
        aria-label={node.accessibility.label + ". " + node.accessibility.statusText}
        aria-pressed={selected}
        data-explore-focus-order={node.accessibility.keyboardOrder}
        data-explore-node-id={node.nodeId}
        data-explore-view="map"
        data-position-x={data.positionX}
        data-position-y={data.positionY}
        tabIndex={node.nodeId === interaction.focusedNodeId ? 0 : -1}
        onClick={() => interaction.onSelectNode(node.nodeId)}
        onFocus={() => interaction.onFocusNode(node.nodeId)}
        onKeyDown={(event) => interaction.onKeyDown(event, node.nodeId)}
        onPointerDown={() => interaction.onSelectNode(node.nodeId)}
      >
        <span className={styles.nodeType}>{nodeTypeLabel(node.nodeType)}</span>
        <strong>{node.shortLabel}</strong>
        <span className={styles.nodeStatus}>{node.state.summaryText}</span>
      </button>
      <Handle className={styles.handle} type="source" position={Position.Right} />
    </div>
  );
}
