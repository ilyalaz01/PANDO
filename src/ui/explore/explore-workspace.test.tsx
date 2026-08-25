import fixture from "../../../tests/fixtures/graph/v1/valid/graph-projection-v1.representative.json";
import typedVariantsFixture from "../../../tests/fixtures/graph/v1/valid/graph-projection-v1.typed-variants.json";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ExploreGraphProjectionView } from "./types";

interface MockFlowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface MockFlowProps {
  nodes: MockFlowNode[];
  nodeTypes: Record<string, ComponentType<Record<string, unknown>>>;
}

vi.mock("@xyflow/react", () => ({
  Background: () => <span data-testid="mock-background" />,
  Controls: () => <span data-testid="mock-controls" />,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  ReactFlow: ({ nodes, nodeTypes }: MockFlowProps) => (
    <div data-testid="mock-react-flow">
      {nodes.map((node) => {
        const Renderer = nodeTypes[node.type];
        return Renderer ? (
          <Renderer
            key={node.id}
            id={node.id}
            type={node.type}
            data={node.data}
            selected={false}
            dragging={false}
            isConnectable={false}
            zIndex={0}
            xPos={0}
            yPos={0}
          />
        ) : null;
      })}
    </div>
  ),
}));

import { chooseViewFocus, ExploreWorkspace, nextNodeId } from "./explore-workspace";
import { composeExploreProjection } from "./server/compose-graph-projection";

const projection = composeExploreProjection(fixture);

function withoutNode(
  source: ExploreGraphProjectionView,
  removedNodeId: string,
): ExploreGraphProjectionView {
  const next = structuredClone(source);
  const removedOutlineIds = new Set(
    next.outline.items
      .filter((item) => item.nodeId === removedNodeId)
      .map((item) => item.outlineItemId),
  );
  next.nodes = next.nodes.filter((node) => node.nodeId !== removedNodeId);
  next.edges = next.edges.filter(
    (edge) => edge.sourceNodeId !== removedNodeId && edge.targetNodeId !== removedNodeId,
  );
  next.layout.positions = next.layout.positions.filter(
    (position) => position.nodeId !== removedNodeId,
  );
  next.visibilityHints.defaultVisibleNodeIds = next.visibilityHints.defaultVisibleNodeIds.filter(
    (nodeId) => nodeId !== removedNodeId,
  );
  const remainingEdgeIds = new Set(next.edges.map((edge) => edge.edgeId));
  next.visibilityHints.defaultVisibleEdgeIds = next.visibilityHints.defaultVisibleEdgeIds.filter(
    (edgeId) => remainingEdgeIds.has(edgeId),
  );
  next.visibilityHints.totalNodeCount = next.nodes.length;
  next.visibilityHints.totalEdgeCount = next.edges.length;
  next.outline.items = next.outline.items
    .filter((item) => !removedOutlineIds.has(item.outlineItemId))
    .map((item) => ({
      ...item,
      childItemIds: item.childItemIds.filter(
        (outlineItemId) => !removedOutlineIds.has(outlineItemId),
      ),
    }));
  next.outline.rootItemIds = next.outline.rootItemIds.filter(
    (outlineItemId) => !removedOutlineIds.has(outlineItemId),
  );
  return next;
}

describe("Explore roving keyboard order", () => {
  const ids = ["a", "b", "c"] as const;

  it.each([
    ["a", "ArrowRight", "b"],
    ["a", "ArrowDown", "b"],
    ["a", "ArrowLeft", "c"],
    ["a", "ArrowUp", "c"],
    ["b", "Home", "a"],
    ["b", "End", "c"],
    ["missing", "ArrowRight", "a"],
  ])("moves from %s with %s to %s", (current, key, expected) => {
    expect(nextNodeId(ids, current, key)).toBe(expected);
  });

  it("leaves unrelated keys to the browser and handles an empty projection", () => {
    expect(nextNodeId(ids, "a", "Enter")).toBeUndefined();
    expect(nextNodeId([], "a", "Home")).toBeUndefined();
  });

  it("normalizes focus as selected, then last valid, then first visible", () => {
    expect(chooseViewFocus(ids, "b", "c")).toBe("b");
    expect(chooseViewFocus(ids, "hidden", "c")).toBe("c");
    expect(chooseViewFocus(ids, "hidden", "also-hidden")).toBe("a");
    expect(chooseViewFocus([], "hidden", "also-hidden")).toBe("");
  });
});

describe("ExploreWorkspace", () => {
  it("shares selection while keeping deterministic per-view focus", () => {
    render(<ExploreWorkspace projection={projection} />);
    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /competency|domain summary/i })).toHaveLength(25);

    const graphTraversal = screen.getByRole("button", { name: /Graph traversal, competency/ });
    fireEvent.click(graphTraversal);
    expect(graphTraversal).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Graph traversal" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "algorithms complexity analysis is a prerequisite of algorithms graph traversal.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("algorithms hash tables is a prerequisite of algorithms graph traversal."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    const outlineTraversal = screen.getByRole("button", { name: /Graph traversal, competency/ });
    expect(outlineTraversal).toHaveAttribute("aria-pressed", "true");
    expect(outlineTraversal).toHaveFocus();

    fireEvent.keyDown(outlineTraversal, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Hash tables, competency/ })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /HTTP basics, competency/ }));
    expect(screen.getByText(/Evidence is unknown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /TCP and IP, competency/ }));
    expect(screen.getByText(/estimate is marked stale/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use accessible outline" }));
    expect(screen.getByTestId("explore-outline")).toBeInTheDocument();
  });

  it("keeps a hidden Outline selection without expanding Map visibility", async () => {
    const hiddenNodeId = "node:competency:algorithms-graph-traversal";
    const limited = structuredClone(projection);
    const visibleInKeyboardOrder = [...limited.nodes]
      .filter((node) => node.nodeId !== hiddenNodeId)
      .sort((a, b) => a.accessibility.keyboardOrder - b.accessibility.keyboardOrder)
      .slice(0, 3);
    const visibleIds = visibleInKeyboardOrder.map((node) => node.nodeId);
    limited.visibilityHints.defaultVisibleNodeIds = [...visibleIds].reverse();
    const visibleIdSet = new Set(visibleIds);
    limited.visibilityHints.defaultVisibleEdgeIds = limited.edges
      .filter((edge) => visibleIdSet.has(edge.sourceNodeId) && visibleIdSet.has(edge.targetNodeId))
      .map((edge) => edge.edgeId);

    const { container, rerender } = render(<ExploreWorkspace projection={limited} />);
    expect(container.querySelectorAll('[data-explore-view="map"]')).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    fireEvent.click(screen.getByRole("button", { name: /Graph traversal, competency/ }));
    fireEvent.click(screen.getByRole("button", { name: "Map" }));

    expect(screen.getByRole("heading", { level: 2, name: "Graph traversal" })).toBeInTheDocument();
    expect(screen.getByText(/outside the server-projected default Map visibility/)).toBeVisible();
    const mapButtons = container.querySelectorAll<HTMLButtonElement>('[data-explore-view="map"]');
    expect(mapButtons).toHaveLength(3);
    expect(container.querySelectorAll('[data-explore-view="map"][tabindex="0"]')).toHaveLength(1);

    const firstVisible = container.querySelector<HTMLButtonElement>(
      '[data-explore-node-id="' + visibleIds[0] + '"]',
    );
    const secondVisible = container.querySelector<HTMLButtonElement>(
      '[data-explore-node-id="' + visibleIds[1] + '"]',
    );
    expect(firstVisible).toHaveFocus();
    fireEvent.keyDown(firstVisible!, { key: "ArrowDown" });
    expect(secondVisible).toHaveFocus();

    rerender(<ExploreWorkspace projection={withoutNode(limited, hiddenNodeId)} />);
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { level: 2, name: "Graph traversal" }),
      ).not.toBeInTheDocument();
    });
    expect(container.querySelectorAll('[data-explore-view="map"][tabindex="0"]')).toHaveLength(1);
  });

  it("maps every validated node variant to truthful labels and tagged state", () => {
    const typedProjection = composeExploreProjection(typedVariantsFixture);
    expect(typedProjection.contract).toEqual({
      name: "GraphProjectionV1",
      version: "1.0.0",
    });
    expect(typedProjection.nodes.find((node) => node.nodeType === "ACTIVITY")?.state.kind).toBe(
      "ACTIVITY",
    );
    expect(typedProjection.nodes.find((node) => node.nodeType === "GROUP")?.state.kind).toBe(
      "SEMANTIC",
    );

    render(<ExploreWorkspace projection={typedProjection} />);
    expect(
      screen.getByRole("button", { name: /Networking fundamentals, group/i }),
    ).toBeInTheDocument();
    const activity = screen.getByRole("button", {
      name: /TCP troubleshooting exercise, selected activity/i,
    });
    fireEvent.click(activity);
    const inspector = screen.getByRole("complementary", {
      name: "TCP troubleshooting exercise",
    });
    expect(within(inspector).getByText("Activity")).toBeInTheDocument();
  });

  it.each([
    ["CURRENT", "Current readiness", "Interval"],
    ["STALE", "Last calculated readiness", "Last interval"],
    ["REBUILDING", null, "Readiness is being rebuilt"],
    ["ERROR", null, "Readiness could not be calculated"],
  ] as const)(
    "renders the %s projection state without presenting unavailable results as current",
    (calculationState, metricsLabel, expectedText) => {
      const stateProjection = structuredClone(projection);
      stateProjection.projectionState.calculationState = calculationState;
      stateProjection.projectionState.staleReason =
        calculationState === "STALE" ? "SOURCE_CHANGED" : null;
      stateProjection.projectionState.explanation =
        "Projection calculation state is " + calculationState + ".";

      render(<ExploreWorkspace projection={stateProjection} />);
      expect(
        screen.getByText(
          "Projection state · " + calculationState[0] + calculationState.slice(1).toLowerCase(),
        ),
      ).toBeInTheDocument();
      if (metricsLabel) {
        expect(screen.getByLabelText(metricsLabel)).toBeInTheDocument();
        expect(screen.getByText(expectedText, { exact: true })).toBeInTheDocument();
      } else {
        expect(screen.queryByLabelText(/readiness/i)).not.toBeInTheDocument();
        expect(screen.getByText(new RegExp(expectedText))).toBeInTheDocument();
        expect(screen.queryByText(projection.readiness.displayLabel)).not.toBeInTheDocument();
      }
    },
  );

  it("renders NOT_APPLICABLE as onboarding and hides the zero sentinel", () => {
    const onboarding = structuredClone(projection);
    onboarding.readiness.targetProfileVersionId = null;
    onboarding.readiness.status = "NOT_APPLICABLE";
    onboarding.readiness.estimate = { lower: 0, upper: 0 };
    onboarding.readiness.coverage = 0;
    onboarding.readiness.confidence = "LOW";
    onboarding.readiness.displayLabel = "Readiness is not applicable until a target is selected.";

    render(<ExploreWorkspace projection={onboarding} />);
    expect(
      screen.getByRole("heading", {
        name: "Choose a target to calculate readiness",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Start by choosing a target/)).toBeInTheDocument();
    expect(screen.queryByText("0%–0%")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(onboarding.readiness.displayLabel)).not.toBeInTheDocument();
  });

  it("fails safely when a caller supplies an empty projection view", () => {
    const empty = structuredClone(projection) as ExploreGraphProjectionView;
    empty.nodes = [];
    empty.layout.positions = [];
    empty.visibilityHints.defaultVisibleNodeIds = [];
    const { container } = render(<ExploreWorkspace projection={empty} />);
    expect(container).toBeEmptyDOMElement();
  });
});
