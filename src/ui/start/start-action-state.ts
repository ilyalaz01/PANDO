export interface StartActionState {
  readonly message: string;
  readonly status: "idle" | "invalid_selection" | "unavailable";
}

export const initialStartActionState: StartActionState = { message: "", status: "idle" };
