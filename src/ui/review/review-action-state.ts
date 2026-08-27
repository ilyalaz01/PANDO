export type ReviewActionState = Readonly<{
  status: "idle" | "updated" | "invalid" | "conflict" | "unavailable";
  message: string;
}>;
export const initialReviewActionState: ReviewActionState = { status: "idle", message: "" };
