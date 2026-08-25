import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { initialMotionMode, motionModes } from "./motion";

describe("initialMotionMode", () => {
  it("uses the system preference when the user has not saved a choice", () => {
    expect(initialMotionMode(null, true)).toBe("reduced");
    expect(initialMotionMode(null, false)).toBe("full");
  });

  it("never overrides an explicit user preference", () => {
    fc.assert(
      fc.property(fc.constantFrom(...motionModes), fc.boolean(), (savedMode, systemPreference) => {
        expect(initialMotionMode(savedMode, systemPreference)).toBe(savedMode);
      }),
    );
  });
});
