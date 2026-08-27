import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  verifySession: vi.fn(),
  loadOverlay: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  AuthenticatedSessionRequiredError: class AuthenticatedSessionRequiredError extends Error {},
  CompetencyOverlayInputError: class CompetencyOverlayInputError extends Error {},
}));

vi.mock("../../../../shared/supabase/server", () => ({
  createPandoServerComponentClient: mocks.createClient,
}));
vi.mock("../../../../shared/supabase/session", () => ({
  verifyPandoSession: mocks.verifySession,
  AuthenticatedSessionRequiredError: classes.AuthenticatedSessionRequiredError,
}));
vi.mock("../../../../ui/explore/server/database-competency-overlay", () => ({
  loadCurrentCompetencyOverlayV1: mocks.loadOverlay,
  CompetencyOverlayInputError: classes.CompetencyOverlayInputError,
}));

import { GET } from "./route";

const client = { requestScoped: true };

function request(query: string): Request {
  return new Request(`https://pando.test/api/explore/competency-overlay?${query}`);
}

describe("competency-overlay GET route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "owner-subject" });
    mocks.loadOverlay.mockResolvedValue({
      contract: { name: "CompetencyOverlayDetailV1", version: "1.0.0" },
      readinessGoalKey: "goal:personal-main",
      competencyRef: "competency:python-testing",
      overlayVersion: "7",
      note: null,
      customActivities: [],
    });
  });

  it("uses the verified request session and exact goal/competency selectors with private no-store caching", async () => {
    const response = await GET(
      request("goal=goal%3Apersonal-main&competency=competency%3Apython-testing"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ overlayVersion: "7" });
    expect(mocks.verifySession).toHaveBeenCalledWith(client);
    expect(mocks.loadOverlay).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:personal-main",
      competencyRef: "competency:python-testing",
    });
    const selector = mocks.loadOverlay.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(selector).not.toHaveProperty("workspaceId");
    expect(selector).not.toHaveProperty("profileVersionKey");
  });

  it.each([
    "goal=goal%3Aone&goal=goal%3Atwo&competency=competency%3Apython-testing",
    "goal=goal%3Apersonal-main&competency=competency%3Aone&competency=competency%3Atwo",
    "goal=goal%3Apersonal-main",
  ])(
    "rejects ambiguous or missing GET selectors before touching the session: %s",
    async (query) => {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(response.json()).resolves.toEqual({
        message: "The overlay selector is invalid.",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.loadOverlay).not.toHaveBeenCalled();
    },
  );

  it("returns 401 only for the typed authentication failure and otherwise hides backend details", async () => {
    mocks.verifySession.mockRejectedValueOnce(new classes.AuthenticatedSessionRequiredError());
    const unauthenticated = await GET(
      request("goal=goal%3Apersonal-main&competency=competency%3Apython-testing"),
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(unauthenticated.json()).resolves.toEqual({ message: "Sign in to continue." });

    mocks.loadOverlay.mockRejectedValueOnce(new Error("private note: rain-forest-42"));
    const unavailable = await GET(
      request("goal=goal%3Apersonal-main&competency=competency%3Apython-testing"),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(unavailable.json()).resolves.toEqual({
      message: "The competency overlay is temporarily unavailable.",
    });

    mocks.loadOverlay.mockRejectedValueOnce(new classes.CompetencyOverlayInputError());
    const invalid = await GET(
      request("goal=goal%3Apersonal-main&competency=competency%3Apython-testing"),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(invalid.json()).resolves.toEqual({ message: "The overlay selector is invalid." });
  });
});
