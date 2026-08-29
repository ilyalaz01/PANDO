import { describe, expect, it } from "vitest";
import { parseInstant, sameInstant, toCanonicalInstant, utcDateKey } from "./utc-instant";

describe("UTC instant primitives", () => {
  it("canonicalizes explicit offsets and extracts the UTC date", () => {
    const epoch = parseInstant("2024-03-10T09:30:00+02:00", "instant");

    expect(toCanonicalInstant(epoch)).toBe("2024-03-10T07:30:00.000Z");
    expect(utcDateKey(epoch)).toBe("2024-03-10");
  });

  it("accepts PostgreSQL microsecond precision and canonicalizes to JavaScript milliseconds", () => {
    const epoch = parseInstant("2026-08-27T13:45:10.123456+00:00", "database instant");

    expect(toCanonicalInstant(epoch)).toBe("2026-08-27T13:45:10.123Z");
  });

  it("compares equivalent offset forms without hiding sub-millisecond drift", () => {
    expect(
      sameInstant("2026-08-27T13:45:10.123456+00:00", "2026-08-27T15:45:10.123456+02:00"),
    ).toBe(true);
    expect(sameInstant("2026-08-27T13:45:10.123456Z", "2026-08-27T13:45:10.123457Z")).toBe(false);
    expect(sameInstant("not-an-instant", "2026-08-27T13:45:10Z")).toBe(false);
  });

  it("rejects local timestamps and impossible calendar instants", () => {
    expect(() => parseInstant("2024-03-10T09:30:00", "instant")).toThrow(/explicit offset/u);
    expect(() => parseInstant("2024-99-99T09:30:00Z", "instant")).toThrow(/calendar instant/u);
    expect(() => parseInstant("2024-02-30T09:30:00Z", "instant")).toThrow(/calendar instant/u);
    expect(() => parseInstant("2023-02-29T09:30:00Z", "instant")).toThrow(/calendar instant/u);
    expect(toCanonicalInstant(parseInstant("2024-02-29T09:30:00Z", "instant"))).toBe(
      "2024-02-29T09:30:00.000Z",
    );
  });
});
