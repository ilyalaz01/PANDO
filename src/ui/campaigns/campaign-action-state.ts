import type { CampaignPreviewV1 } from "./campaign-types";

export type CampaignActionState = Readonly<{
  status: "idle" | "previewed" | "applied" | "invalid" | "conflict" | "unavailable";
  message: string;
  preview: CampaignPreviewV1 | null;
}>;

export const initialCampaignActionState: CampaignActionState = {
  status: "idle",
  message: "",
  preview: null,
};
