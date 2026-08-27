export type OverlayActionState =
  | { readonly status: "idle"; readonly message: "" }
  | { readonly status: "saved"; readonly message: string; readonly overlayVersion: string }
  | {
      readonly status: "added";
      readonly message: string;
      readonly overlayVersion: string;
      readonly activityKey: string;
    }
  | { readonly status: "conflict"; readonly message: string }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

export const initialOverlayActionState: OverlayActionState = { status: "idle", message: "" };
