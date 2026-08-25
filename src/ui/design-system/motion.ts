export const motionModes = ["full", "reduced", "off"] as const;

export type MotionMode = (typeof motionModes)[number];

export function initialMotionMode(
  savedMode: MotionMode | null,
  prefersReducedMotion: boolean,
): MotionMode {
  if (savedMode !== null) {
    return savedMode;
  }

  return prefersReducedMotion ? "reduced" : "full";
}
