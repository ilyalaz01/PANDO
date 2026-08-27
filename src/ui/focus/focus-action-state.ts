export type FocusActionState =
  | { readonly status: "idle"; readonly message: "" }
  | { readonly status: "updated"; readonly message: string }
  | { readonly status: "conflict" | "invalid" | "unavailable"; readonly message: string };

export const initialFocusActionState: FocusActionState = { status: "idle", message: "" };
