import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifySession: vi.fn(),
  loadTargetContext: vi.fn(),
  loadSource: vi.fn(),
  materialize: vi.fn(),
  toView: vi.fn(),
  renderWorkspace: vi.fn(),
}));

vi.mock("../../shared/supabase/server", () => ({
  createPandoServerComponentClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({
  AuthenticatedSessionRequiredError: class AuthenticatedSessionRequiredError extends Error {},
  verifyPandoSession: mocks.verifySession,
}));
vi.mock("../../ui/explore/server/database-current-explore-source", () => ({
  loadCurrentDatabaseExploreSourceV1: mocks.loadSource,
}));
vi.mock("../../ui/explore/server/database-explore-target-context", () => ({
  loadDatabaseExploreTargetContextV1: mocks.loadTargetContext,
}));
vi.mock("../../ui/explore/server/materialize-live-explore-structure", () => ({
  materializeLiveExploreStructure: mocks.materialize,
}));
vi.mock("../../ui/explore/server/structural-projection-view", () => ({
  toExploreStructuralProjectionView: mocks.toView,
}));
vi.mock("../../ui/explore/explore-workspace", () => ({
  ExploreWorkspace: (props: {
    projection: { nodes: unknown[] };
    readinessGoalKey: string;
    initialSelectedNodeId?: string;
    targetReadiness?: unknown;
  }) => {
    mocks.renderWorkspace(props);
    return <div data-testid="explore-workspace">{props.projection.nodes.length} live nodes</div>;
  },
}));

import ExploreLayout from "./layout";
import ExplorePage, { metadata } from "./page";

describe("live Explore page", () => {
  const client = { rpc: vi.fn() };
  const targetContext = { kind: "target-context" };
  const source = { kind: "source" };
  const structuralProjection = { kind: "structural-projection" };
  const view = {
    nodes: [
      {
        nodeId: "node:domain:core",
        entityRef: {
          entityType: "DOMAIN",
          entityId: "domain:core",
          entityVersionId: "catalog:seed-v1",
        },
      },
      {
        nodeId: "node:opaque:selected-activity",
        entityRef: {
          entityType: "ACTIVITY",
          entityId: "activity:beta-lab",
          entityVersionId: null,
        },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "authorized-user" });
    mocks.loadTargetContext.mockResolvedValue(targetContext);
    mocks.loadSource.mockResolvedValue(source);
    mocks.materialize.mockReturnValue(structuralProjection);
    mocks.toView.mockReturnValue(view);
  });

  it("loads one authorized target through zero-workspace server boundaries", async () => {
    render(
      await ExplorePage({
        searchParams: Promise.resolve({ goal: "goal:personal-main" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "See the roots beneath your next move." }),
    ).toBeVisible();
    expect(screen.getByTestId("explore-workspace")).toHaveTextContent("2 live nodes");
    expect(mocks.loadTargetContext).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
    });
    expect(mocks.loadSource).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
      selectedActivityKey: null,
    });
    expect(mocks.loadSource.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    expect(mocks.materialize).toHaveBeenCalledWith({
      source,
      targetContext,
      selectedActivityKey: null,
    });
    expect(mocks.renderWorkspace).toHaveBeenCalledWith({
      projection: view,
      readinessGoalKey: "goal:personal-main",
      targetReadiness: null,
    });
    expect(screen.queryByText(/Representative Phase 0 fixture/iu)).not.toBeInTheDocument();
  });

  it("selects the requested activity by its entity reference without parsing node IDs", async () => {
    render(
      await ExplorePage({
        searchParams: Promise.resolve({
          goal: "goal:personal-main",
          activity: "activity:beta-lab",
        }),
      }),
    );

    expect(mocks.loadSource).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
      selectedActivityKey: "activity:beta-lab",
    });
    expect(mocks.renderWorkspace).toHaveBeenCalledWith({
      projection: view,
      readinessGoalKey: "goal:personal-main",
      initialSelectedNodeId: "node:opaque:selected-activity",
      targetReadiness: null,
    });
  });

  it("fails closed when the requested activity entity is absent from the correlated view", async () => {
    mocks.toView.mockReturnValueOnce({ nodes: [view.nodes[0]] });

    render(
      await ExplorePage({
        searchParams: Promise.resolve({
          goal: "goal:personal-main",
          activity: "activity:beta-lab",
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Your saved goal was not changed." })).toBeVisible();
    expect(mocks.renderWorkspace).not.toHaveBeenCalled();
  });

  it("requires an explicit selected target before accessing either live source", async () => {
    render(await ExplorePage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "Give the map a goal to grow around." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Choose a target" })).toHaveAttribute("href", "/start");
    expect(mocks.loadTargetContext).not.toHaveBeenCalled();
    expect(mocks.loadSource).not.toHaveBeenCalled();
  });

  it("fails closed on ambiguous selectors without substituting a fixture", async () => {
    render(
      await ExplorePage({
        searchParams: Promise.resolve({
          goal: ["goal:personal-main", "goal:other"],
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Your saved goal was not changed." })).toBeVisible();
    expect(mocks.loadTargetContext).not.toHaveBeenCalled();
    expect(mocks.loadSource).not.toHaveBeenCalled();
    expect(screen.queryByTestId("explore-workspace")).not.toBeInTheDocument();
  });

  it("collapses owner or correlation failures into a safe unavailable state", async () => {
    mocks.loadTargetContext.mockRejectedValueOnce(new Error("private database detail"));

    render(
      await ExplorePage({
        searchParams: Promise.resolve({ goal: "goal:personal-main" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Your saved goal was not changed." })).toBeVisible();
    expect(screen.queryByText("private database detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("explore-workspace")).not.toBeInTheDocument();
  });

  it("keeps route metadata and layout stable", () => {
    expect(metadata.title).toMatch(/Explore competency map/iu);
    const child = <div>Explore child</div>;
    expect(ExploreLayout({ children: child })).toBe(child);
  });
});
