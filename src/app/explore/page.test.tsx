import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../ui/explore/explore-workspace", () => ({
  ExploreWorkspace: ({ projection }: { projection: { nodes: unknown[] } }) => (
    <div data-testid="projection-consumer" data-node-count={projection.nodes.length} />
  ),
}));

import ExploreLayout from "./layout";
import ExplorePage, { metadata } from "./page";

describe("Explore route", () => {
  it("passes the validated representative projection through the server route", () => {
    render(<ExplorePage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("See the roots");
    expect(screen.getByTestId("projection-consumer")).toHaveAttribute("data-node-count", "25");
    expect(screen.getByText(/not production database state/)).toBeInTheDocument();
    expect(metadata.title).toContain("Explore competency map");
  });

  it("keeps the route layout transparent around its content", () => {
    render(
      <ExploreLayout>
        <span>Route child</span>
      </ExploreLayout>,
    );
    expect(screen.getByText("Route child")).toBeInTheDocument();
  });
});
