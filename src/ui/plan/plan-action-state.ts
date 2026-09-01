import type { PlanPreviewV1 } from "./plan-types";

export type PlanActionState = Readonly<{
  status: "idle" | "previewed" | "applied" | "invalid" | "conflict" | "unavailable";
  message: string;
  preview: PlanPreviewV1 | null;
}>;

export const initialPlanActionState: PlanActionState = {
  status: "idle",
  message: "",
  preview: null,
};
