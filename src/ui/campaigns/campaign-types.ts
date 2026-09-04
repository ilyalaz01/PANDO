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
import type { TargetSelectionReadinessGoalV1 } from "../start/server/target-selection-source-v1";

export type CampaignPreviewV1 =
  | InterviewCampaignCreationPreviewV1
  | InterviewCampaignDeadlineChangePreviewV1
  | InterviewCampaignRetargetPreviewV1
  | InterviewCampaignLifecyclePreviewV1;

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
};
