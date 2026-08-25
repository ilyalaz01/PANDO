import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FoundationPage from "./page";

describe("FoundationPage", () => {
  it("states the technical scope without pretending product features exist", () => {
    render(<FoundationPage />);

    expect(
      screen.getByRole("heading", { name: "A calm, testable foundation for PANDO." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(
      screen.getByText(/Product features are intentionally not implemented/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Motion accessibility contract")).toHaveTextContent(
      "full · reduced · off",
    );
  });
});
