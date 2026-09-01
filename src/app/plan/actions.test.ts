import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  createClient: vi.fn(),
  preview: vi.fn(),
  revalidate: vi.fn(),
  verifySession: vi.fn(),
}));
const classes = vi.hoisted(() => ({
  PlanConflictError: class PlanConflictError extends Error {},
  PlanInputError: class PlanInputError extends Error {},
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../../shared/supabase/server", () => ({
  createPandoServerActionClient: mocks.createClient,
}));
vi.mock("../../shared/supabase/session", () => ({ verifyPandoSession: mocks.verifySession }));
vi.mock("../../ui/plan/server/database-plan", () => ({
  applyGrowthPlanLifecycleV1: mocks.apply,
  previewGrowthPlanLifecycleV1: mocks.preview,
  PlanConflictError: classes.PlanConflictError,
  PlanInputError: classes.PlanInputError,
}));

import { initialPlanActionState } from "../../ui/plan/plan-action-state";
import { applyGrowthPlanLifecycleAction, previewGrowthPlanLifecycleAction } from "./actions";

const client = { requestScoped: true };
const requestId = "10000000-0000-4000-8000-000000000001";
const digest = "a".repeat(64);
const preview = {
  contract: { name: "GrowthPlanLifecyclePreviewV1", version: "1.0.0" },
  operation: "pause_growth_plan",
  reason: "Interview was cancelled.",
  expectedGrowthPlanVersion: "4",
  before: {
    growthPlanId: "30000000-0000-4000-8000-000000000020",
    title: "Backend interview readiness",
    lifecycle: "ACTIVE",
    weeklyCapacityMinutes: 600,
    aggregateVersion: "4",
  },
  after: {
    growthPlanId: "30000000-0000-4000-8000-000000000020",
    title: "Backend interview readiness",
    lifecycle: "PAUSED",
    weeklyCapacityMinutes: 600,
    aggregateVersion: "5",
  },
  retained: { learningTracks: true, planSnapshots: true, focusSessions: true, evidence: true },
  recalculationAfterApply: {
    projectionState: "PENDING",
    consumerName: "planning.plan_snapshot_v1",
  },
  previewDigest: digest,
} as const;

function form(): FormData {
  const data = new FormData();
  data.set("operation", "pause_growth_plan");
  data.set("expectedGrowthPlanVersion", "4");
  data.set("reason", "Interview was cancelled.");
  data.set("previewDigest", digest);
  data.set("requestId", requestId);
  data.set("workspaceId", "attacker-selected-workspace");
  data.set("growthPlanId", "attacker-selected-plan");
  return data;
}

describe("Plan Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "owner" });
    mocks.preview.mockResolvedValue(preview);
    mocks.apply.mockResolvedValue({ projectionState: "PENDING" });
  });

  it("returns a pure preview without accepting browser authority fields", async () => {
    await expect(
      previewGrowthPlanLifecycleAction(initialPlanActionState, form()),
    ).resolves.toMatchObject({ status: "previewed", preview });
    expect(mocks.preview).toHaveBeenCalledWith(client, {
      operation: "pause_growth_plan",
      expectedGrowthPlanVersion: "4",
      reason: "Interview was cancelled.",
    });
    expect(mocks.preview.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    expect(mocks.preview.mock.calls[0]?.[1]).not.toHaveProperty("growthPlanId");
  });

  it("applies only the confirmed digest and revalidates Plan plus Today", async () => {
    await expect(
      applyGrowthPlanLifecycleAction(initialPlanActionState, form()),
    ).resolves.toMatchObject({ status: "applied", preview: null });
    expect(mocks.apply).toHaveBeenCalledWith(client, {
      operation: "pause_growth_plan",
      expectedGrowthPlanVersion: "4",
      reason: "Interview was cancelled.",
      previewDigest: digest,
      idempotencyKey: `growth-plan-lifecycle:v1:${requestId}`,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/plan");
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");
  });

  it("rejects malformed fields before creating a database client", async () => {
    const malformed = form();
    malformed.set("operation", "archive_growth_plan");
    await expect(
      previewGrowthPlanLifecycleAction(initialPlanActionState, malformed),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("collapses stale versions and private failures into safe messages", async () => {
    mocks.apply.mockRejectedValueOnce(new classes.PlanConflictError("private row version"));
    await expect(
      applyGrowthPlanLifecycleAction(initialPlanActionState, form()),
    ).resolves.toMatchObject({ status: "conflict" });

    mocks.verifySession.mockRejectedValueOnce(new Error("private token"));
    const unavailable = await previewGrowthPlanLifecycleAction(initialPlanActionState, form());
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.message).not.toMatch(/token/iu);
  });
});
