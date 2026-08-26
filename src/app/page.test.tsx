import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import FoundationPage from "./page";

describe("FoundationPage", () => {
  it("states the technical scope without pretending product features exist", () => {
    render(<FoundationPage />);

    expect(
      screen.getByRole("heading", { name: "A working Phase 0 baseline for PANDO." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByText(/Invite-only target onboarding is now persisted/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to PANDO" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(screen.getByLabelText("Motion accessibility contract")).toHaveTextContent(
      "full · reduced · off",
    );
  });
});
