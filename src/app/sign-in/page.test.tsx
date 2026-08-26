import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignInPage from "./page";

describe("SignInPage", () => {
  it("renders an invite-only accessible credential form without self-service signup", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Return to your roots." })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByRole("link", { name: /sign up|register|create account/iu })).toBeNull();
  });

  it("shows a safe configuration status without exposing underlying errors", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ status: "unavailable" }) }));

    expect(
      screen.getByText(/Authentication is not configured or cannot be reached\./u),
    ).toBeVisible();
  });
});
