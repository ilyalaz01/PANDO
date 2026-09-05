import type {
  InterviewCampaignCreationApplyResultV1,
  InterviewCampaignCreationPreviewV1,
} from "../../shared/contracts/interview-campaign-creation-control";
import type {
  InterviewCampaignDeadlineChangeApplyResultV1,
  InterviewCampaignDeadlineChangePreviewV1,
} from "../../shared/contracts/interview-campaign-deadline-control";
import type {
  InterviewCampaignRetargetApplyResultV1,
  InterviewCampaignRetargetPreviewV1,
} from "../../shared/contracts/interview-campaign-retarget-control";
import type {
  InterviewCampaignLifecycleApplyResultV1,
  InterviewCampaignLifecycleOperationV1,
  InterviewCampaignLifecyclePreviewV1,
} from "../../shared/contracts/interview-campaign-lifecycle-control";
import type {
  InterviewCampaignSummaryV1,
  InterviewCampaignsV1,
} from "../../shared/contracts/interview-campaigns";
import type {
  CampaignAllocationOverrideChangeApplyResultV1,
  CampaignAllocationOverrideChangePreviewV1,
  CampaignAllocationOverrideOperationV1,
} from "../../shared/contracts/campaign-allocation-override-control";
import type {
  CampaignAllocationOverrideCapabilityV1,
  CampaignAllocationOverrideLifecycleV1,
  CampaignAllocationOverrideSummaryV1,
  CampaignAllocationOverridesV1,
} from "../../shared/contracts/campaign-allocation-overrides";
import type {
  CampaignLifecycleCoordinationApplyResultV1,
  CampaignLifecycleCoordinationOperationV1,
  CampaignLifecycleCoordinationPreviewV1,
} from "../../shared/contracts/campaign-lifecycle-coordination-control";
import type { TargetSelectionReadinessGoalV1 } from "../start/server/target-selection-source-v1";
import type { CurrentLearningTrackV1 } from "../plan/plan-types";

export type CampaignPreviewV1 =
  | InterviewCampaignCreationPreviewV1
  | InterviewCampaignDeadlineChangePreviewV1
  | InterviewCampaignRetargetPreviewV1
  | InterviewCampaignLifecyclePreviewV1
  | CampaignAllocationOverrideChangePreviewV1
  | CampaignLifecycleCoordinationPreviewV1;

/** A workspace's Learning Tracks a person may attach a start-time allocation override to. */
export type AvailableLearningTrackV1 = Pick<
  CurrentLearningTrackV1,
  "learningTrackId" | "trackKey" | "title" | "lifecycle" | "aggregateVersion"
>;

export type ActiveReadinessGoalV1 = Pick<
  TargetSelectionReadinessGoalV1,
  "readinessGoalKey" | "title" | "profileRoleTitle" | "aggregateVersion"
>;

export type {
  InterviewCampaignCreationApplyResultV1,
  InterviewCampaignCreationPreviewV1,
  InterviewCampaignDeadlineChangeApplyResultV1,
  InterviewCampaignDeadlineChangePreviewV1,
  InterviewCampaignRetargetApplyResultV1,
  InterviewCampaignRetargetPreviewV1,
  InterviewCampaignLifecycleApplyResultV1,
  InterviewCampaignLifecycleOperationV1,
  InterviewCampaignLifecyclePreviewV1,
  InterviewCampaignSummaryV1,
  InterviewCampaignsV1,
  CampaignAllocationOverrideChangeApplyResultV1,
  CampaignAllocationOverrideChangePreviewV1,
  CampaignAllocationOverrideOperationV1,
  CampaignAllocationOverrideCapabilityV1,
  CampaignAllocationOverrideLifecycleV1,
  CampaignAllocationOverrideSummaryV1,
  CampaignAllocationOverridesV1,
  CampaignLifecycleCoordinationApplyResultV1,
  CampaignLifecycleCoordinationOperationV1,
  CampaignLifecycleCoordinationPreviewV1,
};
