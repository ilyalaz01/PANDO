import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  applyCapacity: vi.fn(),
  applyTrack: vi.fn(),
  applyTrackSettings: vi.fn(),
  applyInitialization: vi.fn(),
  createClient: vi.fn(),
  preview: vi.fn(),
  previewCapacity: vi.fn(),
  previewTrack: vi.fn(),
  previewTrackSettings: vi.fn(),
  previewInitialization: vi.fn(),
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
  applyGrowthPlanCapacityV1: mocks.applyCapacity,
  applyGrowthPlanLifecycleV1: mocks.apply,
  applyLearningTrackLifecycleV1: mocks.applyTrack,
  applyLearningTrackPriorityMinimumV1: mocks.applyTrackSettings,
  applyGrowthPlanInitializationV1: mocks.applyInitialization,
  previewGrowthPlanCapacityV1: mocks.previewCapacity,
  previewGrowthPlanLifecycleV1: mocks.preview,
  previewLearningTrackLifecycleV1: mocks.previewTrack,
  previewLearningTrackPriorityMinimumV1: mocks.previewTrackSettings,
  previewGrowthPlanInitializationV1: mocks.previewInitialization,
  PlanConflictError: classes.PlanConflictError,
  PlanInputError: classes.PlanInputError,
}));

import { initialPlanActionState } from "../../ui/plan/plan-action-state";
import {
  applyGrowthPlanCapacityAction,
  applyGrowthPlanLifecycleAction,
  applyLearningTrackLifecycleAction,
  applyLearningTrackPriorityMinimumAction,
  applyGrowthPlanInitializationAction,
  previewGrowthPlanCapacityAction,
  previewGrowthPlanLifecycleAction,
  previewLearningTrackLifecycleAction,
  previewLearningTrackPriorityMinimumAction,
  previewGrowthPlanInitializationAction,
} from "./actions";

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

const capacityPreview = {
  contract: { name: "GrowthPlanCapacityPreviewV1", version: "1.0.0" },
  operation: "set_default_capacity",
  reason: "I have more time this term.",
  expectedGrowthPlanVersion: "4",
  before: preview.before,
  after: { ...preview.before, weeklyCapacityMinutes: 720, aggregateVersion: "5" },
  constraint: {
    activeTrackCount: 2,
    activeProtectedMinimumMinutes: 180,
    flexibleMinutesBefore: 420,
    flexibleMinutesAfter: 540,
    activeTrackFingerprint: "b".repeat(64),
  },
  canApply: true,
  blockingReasons: [],
  retained: preview.retained,
  recalculationAfterApply: preview.recalculationAfterApply,
  previewDigest: "c".repeat(64),
} as const;

const trackPreview = {
  contract: { name: "LearningTrackLifecyclePreviewV1", version: "1.0.0" },
  operation: "pause_track",
  reason: "Pause the Track while priorities change.",
  expectedGrowthPlanVersion: "4",
  expectedLearningTrackVersion: "7",
  growthPlan: {
    growthPlanId: preview.before.growthPlanId,
    lifecycle: preview.before.lifecycle,
    weeklyCapacityMinutes: preview.before.weeklyCapacityMinutes,
    aggregateVersion: preview.before.aggregateVersion,
  },
  before: {
    learningTrackId: "30000000-0000-4000-8000-000000000021",
    trackKey: "track:algorithms",
    title: "Algorithms",
    lifecycle: "ACTIVE",
    priority: 90,
    protectedMinimumMinutes: 120,
    aggregateVersion: "7",
  },
  after: {
    learningTrackId: "30000000-0000-4000-8000-000000000021",
    trackKey: "track:algorithms",
    title: "Algorithms",
    lifecycle: "PAUSED",
    priority: 90,
    protectedMinimumMinutes: 120,
    aggregateVersion: "8",
  },
  constraint: {
    activeTrackCountBefore: 2,
    activeTrackCountAfter: 1,
    activeProtectedMinimumMinutesBefore: 180,
    activeProtectedMinimumMinutesAfter: 60,
    flexibleMinutesBefore: 420,
    flexibleMinutesAfter: 540,
    activeTrackFingerprintBefore: "d".repeat(64),
    activeTrackFingerprintAfter: "e".repeat(64),
  },
  canApply: true,
  blockingReasons: [],
  warnings: [],
  retained: {
    learningTrackActivities: true,
    planSnapshots: true,
    focusSessions: true,
    evidence: true,
  },
  recalculationAfterApply: preview.recalculationAfterApply,
  previewDigest: "d".repeat(64),
} as const;

const trackSettingsPreview = {
  contract: { name: "LearningTrackPriorityMinimumPreviewV1", version: "1.0.0" },
  operation: "set_track_priority_minimum",
  reason: "Increase systems practice.",
  expectedGrowthPlanVersion: "4",
  expectedLearningTrackVersion: "7",
  growthPlan: trackPreview.growthPlan,
  before: trackPreview.before,
  after: {
    ...trackPreview.before,
    priority: 80,
    protectedMinimumMinutes: 180,
    aggregateVersion: "8",
  },
  constraint: {
    activeTrackCountBefore: 2,
    activeTrackCountAfter: 2,
    activeProtectedMinimumMinutesBefore: 180,
    activeProtectedMinimumMinutesAfter: 240,
    flexibleMinutesBefore: 420,
    flexibleMinutesAfter: 360,
    activeTrackFingerprintBefore: "e".repeat(64),
    activeTrackFingerprintAfter: "f".repeat(64),
    activeTrackCountIfTargetActiveAfter: 2,
    minimumCapacityIfTargetActiveAfter: 240,
    targetActiveStateFitsCapacity: true,
    currentTrackPositionBefore: 1,
    currentTrackPositionAfter: 1,
    currentTrackOrderFingerprintBefore: "g".repeat(64),
    currentTrackOrderFingerprintAfter: "h".repeat(64),
  },
  canApply: true,
  blockingReasons: [],
  warnings: [],
  retained: trackPreview.retained,
  recalculationAfterApply: trackPreview.recalculationAfterApply,
  previewDigest: "a".repeat(64),
} as const;

const initializationPreview = {
  contract: { name: "GrowthPlanInitializationPreviewV1", version: "1.0.0" },
  digestVersion: "growth-plan-initialization-preview-digest/1.0.0",
  identityVersion: "planning-create-identity/1.0.0",
  operation: "initialize_growth_plan",
  commandType: "planning.initialize_growth_plan_v2",
  idempotencyKey: requestId,
  reason: "Set up a first plan.",
  expectedReadinessGoalVersion: "1",
  source: {
    readinessGoalId: "30000000-0000-8000-8000-000000000021",
    readinessGoalKey: "goal:backend-interview-readiness",
    readinessGoalTitle: "Backend interview readiness",
    readinessGoalLifecycle: "ACTIVE",
    readinessGoalVersion: "1",
    profileVersionId: "30000000-0000-8000-8000-000000000022",
    profileVersionKey: "target:backend-interview-v1",
    sourceKind: "TARGET_PROFILE_REQUIREMENT_COLLECTION",
    sourceRef: "30000000-0000-8000-8000-000000000022",
    roadmapVersionId: null,
    sourceOwnerRevision: "readiness-goal:1",
  },
  before: { lifetimePlanCount: 0, currentPlanCount: 0, snapshotSentinelCount: 0 },
  after: {
    lifetimePlanCount: 1,
    currentPlanCount: 1,
    currentPlanLimit: 1,
    snapshotSentinelCount: 1,
    growthPlan: {
      growthPlanId: "30000000-0000-8000-8000-000000000023",
      title: "Backend interview readiness",
      lifecycle: "ACTIVE",
      weeklyCapacityMinutes: 600,
      aggregateVersion: "1",
    },
    learningTrack: {
      learningTrackId: "30000000-0000-8000-8000-000000000024",
      trackKey: "track:backend-interview-readiness",
      title: "Backend interview readiness",
      lifecycle: "ACTIVE",
      priority: 50,
      protectedMinimumMinutes: 0,
      defaultSessionMinutes: 30,
      aggregateVersion: "1",
    },
  },
  canApply: true,
  blockingReasons: [],
  warnings: [{ code: "INITIAL_TRACK_HAS_NO_ACTIVITIES" }],
  retained: {
    readinessGoal: true,
    competencyOverlay: true,
    activitiesAndEvidence: true,
    mastery: true,
    reviews: true,
    history: true,
  },
  recalculationAfterApply: {
    projectionState: "PENDING",
    eventChangeKind: "INITIALIZED",
    consumerName: "planning.plan_snapshot_v1",
  },
  previewDigest: "b".repeat(64),
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

function capacityForm(): FormData {
  const data = new FormData();
  data.set("proposedWeeklyCapacityMinutes", "720");
  data.set("expectedGrowthPlanVersion", "4");
  data.set("reason", "I have more time this term.");
  data.set("previewDigest", capacityPreview.previewDigest);
  data.set("requestId", requestId);
  data.set("workspaceId", "attacker-selected-workspace");
  data.set("growthPlanId", "attacker-selected-plan");
  data.set("learningTrackIds", "attacker-selected-track");
  return data;
}

function trackForm(): FormData {
  const data = new FormData();
  data.set("trackKey", "track:algorithms");
  data.set("operation", "pause_track");
  data.set("expectedGrowthPlanVersion", "4");
  data.set("expectedLearningTrackVersion", "7");
  data.set("reason", "Pause the Track while priorities change.");
  data.set("previewDigest", trackPreview.previewDigest);
  data.set("requestId", requestId);
  data.set("workspaceId", "attacker-selected-workspace");
  data.set("growthPlanId", "attacker-selected-plan");
  data.set("learningTrackId", "attacker-selected-track");
  return data;
}

function trackSettingsForm(): FormData {
  const data = new FormData();
  data.set("trackKey", "track:algorithms");
  data.set("priority", "80");
  data.set("protectedMinimumMinutes", "180");
  data.set("expectedGrowthPlanVersion", "4");
  data.set("expectedLearningTrackVersion", "7");
  data.set("reason", "Increase systems practice.");
  data.set("previewDigest", trackSettingsPreview.previewDigest);
  data.set("requestId", requestId);
  data.set("workspaceId", "attacker-selected-workspace");
  data.set("growthPlanId", "attacker-selected-plan");
  data.set("learningTrackId", "attacker-selected-track");
  data.set("capacity", "99999");
  return data;
}

function initializationForm(): FormData {
  const data = new FormData();
  data.set("readinessGoalKey", "goal:backend-interview-readiness");
  data.set("expectedReadinessGoalVersion", "1");
  data.set("weeklyCapacityMinutes", "600");
  data.set("defaultSessionMinutes", "30");
  data.set("trackPriority", "50");
  data.set("reason", "Set up a first plan.");
  data.set("requestId", requestId);
  data.set("previewDigest", initializationPreview.previewDigest);
  data.set("workspaceId", "attacker-selected-workspace");
  data.set("readinessGoalId", "attacker-selected-goal");
  data.set("capacityFingerprint", "attacker-selected-capacity");
  return data;
}

describe("Plan Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(client);
    mocks.verifySession.mockResolvedValue({ client, subject: "owner" });
    mocks.preview.mockResolvedValue(preview);
    mocks.previewCapacity.mockResolvedValue(capacityPreview);
    mocks.apply.mockResolvedValue({ projectionState: "PENDING" });
    mocks.applyCapacity.mockResolvedValue({ projectionState: "PENDING" });
    mocks.previewTrack.mockResolvedValue(trackPreview);
    mocks.applyTrack.mockResolvedValue({ projectionState: "PENDING" });
    mocks.previewTrackSettings.mockResolvedValue(trackSettingsPreview);
    mocks.applyTrackSettings.mockResolvedValue({ projectionState: "PENDING" });
    mocks.previewInitialization.mockResolvedValue(initializationPreview);
    mocks.applyInitialization.mockResolvedValue({ projectionState: "PENDING" });
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

  it("previews and applies a first Plan through its bounded setup fields", async () => {
    await expect(
      previewGrowthPlanInitializationAction(initialPlanActionState, initializationForm()),
    ).resolves.toMatchObject({ status: "previewed", preview: initializationPreview });
    expect(mocks.previewInitialization).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:backend-interview-readiness",
      expectedReadinessGoalVersion: "1",
      weeklyCapacityMinutes: 600,
      defaultSessionMinutes: 30,
      trackPriority: 50,
      reason: "Set up a first plan.",
      idempotencyKey: requestId,
    });
    expect(mocks.previewInitialization.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    expect(mocks.previewInitialization.mock.calls[0]?.[1]).not.toHaveProperty("readinessGoalId");

    await expect(
      applyGrowthPlanInitializationAction(initialPlanActionState, initializationForm()),
    ).resolves.toMatchObject({ status: "applied", preview: null });
    expect(mocks.applyInitialization).toHaveBeenCalledWith(client, {
      readinessGoalKey: "goal:backend-interview-readiness",
      expectedReadinessGoalVersion: "1",
      weeklyCapacityMinutes: 600,
      defaultSessionMinutes: 30,
      trackPriority: 50,
      reason: "Set up a first plan.",
      idempotencyKey: requestId,
      previewDigest: initializationPreview.previewDigest,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/plan");
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");
  });

  it("rejects invalid first-Plan values before creating a client", async () => {
    const malformed = initializationForm();
    malformed.set("defaultSessionMinutes", "0");
    await expect(
      previewGrowthPlanInitializationAction(initialPlanActionState, malformed),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("counts first-Plan reasons by Unicode characters rather than UTF-16 units", async () => {
    const boundary = initializationForm();
    boundary.set("reason", "😀".repeat(500));
    await expect(
      previewGrowthPlanInitializationAction(initialPlanActionState, boundary),
    ).resolves.toMatchObject({ status: "previewed" });

    mocks.previewInitialization.mockClear();
    const tooLong = initializationForm();
    tooLong.set("reason", "😀".repeat(501));
    await expect(
      previewGrowthPlanInitializationAction(initialPlanActionState, tooLong),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(mocks.previewInitialization).not.toHaveBeenCalled();
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

  it("previews capacity without accepting browser-selected owner or constraint fields", async () => {
    await expect(
      previewGrowthPlanCapacityAction(initialPlanActionState, capacityForm()),
    ).resolves.toMatchObject({ status: "previewed", preview: capacityPreview });
    expect(mocks.previewCapacity).toHaveBeenCalledWith(client, {
      proposedWeeklyCapacityMinutes: 720,
      expectedGrowthPlanVersion: "4",
      reason: "I have more time this term.",
    });
    expect(mocks.previewCapacity.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    expect(mocks.previewCapacity.mock.calls[0]?.[1]).not.toHaveProperty("growthPlanId");
    expect(mocks.previewCapacity.mock.calls[0]?.[1]).not.toHaveProperty("learningTrackIds");
  });

  it("applies the exact capacity preview and rejects non-integer browser input", async () => {
    await expect(
      applyGrowthPlanCapacityAction(initialPlanActionState, capacityForm()),
    ).resolves.toMatchObject({ status: "applied", preview: null });
    expect(mocks.applyCapacity).toHaveBeenCalledWith(client, {
      proposedWeeklyCapacityMinutes: 720,
      expectedGrowthPlanVersion: "4",
      reason: "I have more time this term.",
      previewDigest: capacityPreview.previewDigest,
      idempotencyKey: `growth-plan-capacity:v1:${requestId}`,
    });
    const malformed = capacityForm();
    malformed.set("proposedWeeklyCapacityMinutes", "719.5");
    await expect(
      previewGrowthPlanCapacityAction(initialPlanActionState, malformed),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(mocks.previewCapacity).not.toHaveBeenCalled();
  });

  it("previews a Track through its opaque key without accepting browser authority", async () => {
    await expect(
      previewLearningTrackLifecycleAction(initialPlanActionState, trackForm()),
    ).resolves.toMatchObject({ status: "previewed", preview: trackPreview });
    expect(mocks.previewTrack).toHaveBeenCalledWith(client, {
      trackKey: "track:algorithms",
      operation: "pause_track",
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "7",
      reason: "Pause the Track while priorities change.",
    });
    expect(mocks.previewTrack.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    expect(mocks.previewTrack.mock.calls[0]?.[1]).not.toHaveProperty("growthPlanId");
    expect(mocks.previewTrack.mock.calls[0]?.[1]).not.toHaveProperty("learningTrackId");
  });

  it("applies only the exact Track preview and rejects an injected UUID selector", async () => {
    await expect(
      applyLearningTrackLifecycleAction(initialPlanActionState, trackForm()),
    ).resolves.toMatchObject({ status: "applied", preview: null });
    expect(mocks.applyTrack).toHaveBeenCalledWith(client, {
      trackKey: "track:algorithms",
      operation: "pause_track",
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "7",
      reason: "Pause the Track while priorities change.",
      previewDigest: trackPreview.previewDigest,
      idempotencyKey: `learning-track-lifecycle:v1:${requestId}`,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/plan");
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");

    mocks.previewTrack.mockClear();
    const malformed = trackForm();
    malformed.set("trackKey", "30000000-0000-4000-8000-000000000021");
    await expect(
      previewLearningTrackLifecycleAction(initialPlanActionState, malformed),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(mocks.previewTrack).not.toHaveBeenCalled();
  });

  it("uses only bounded Track setting inputs and revalidates Plan plus Today", async () => {
    await expect(
      previewLearningTrackPriorityMinimumAction(initialPlanActionState, trackSettingsForm()),
    ).resolves.toMatchObject({ status: "previewed", preview: trackSettingsPreview });
    expect(mocks.previewTrackSettings).toHaveBeenCalledWith(client, {
      trackKey: "track:algorithms",
      priority: 80,
      protectedMinimumMinutes: 180,
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "7",
      reason: "Increase systems practice.",
    });
    expect(mocks.previewTrackSettings.mock.calls[0]?.[1]).not.toHaveProperty("workspaceId");
    expect(mocks.previewTrackSettings.mock.calls[0]?.[1]).not.toHaveProperty("capacity");

    await expect(
      applyLearningTrackPriorityMinimumAction(initialPlanActionState, trackSettingsForm()),
    ).resolves.toMatchObject({ status: "applied", preview: null });
    expect(mocks.applyTrackSettings).toHaveBeenCalledWith(client, {
      trackKey: "track:algorithms",
      priority: 80,
      protectedMinimumMinutes: 180,
      expectedGrowthPlanVersion: "4",
      expectedLearningTrackVersion: "7",
      reason: "Increase systems practice.",
      previewDigest: trackSettingsPreview.previewDigest,
      idempotencyKey: `learning-track-priority-minimum:v1:${requestId}`,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/plan");
    expect(mocks.revalidate).toHaveBeenCalledWith("/today");
  });

  it("rejects malformed Track setting values before creating a client", async () => {
    const malformed = trackSettingsForm();
    malformed.set("priority", "101");
    await expect(
      previewLearningTrackPriorityMinimumAction(initialPlanActionState, malformed),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
