export interface SignInActionState {
  readonly message: string;
  readonly status: "idle" | "invalid_credentials" | "unavailable";
}

export const initialSignInActionState: SignInActionState = {
  message: "",
  status: "idle",
};
