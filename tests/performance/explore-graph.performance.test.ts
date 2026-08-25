// @vitest-environment node

import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";

import fixture from "../fixtures/graph/v1/valid/graph-projection-v1.representative.json";
import { describe, expect, it } from "vitest";

import { composeExploreProjection } from "../../src/ui/explore/server/compose-graph-projection";

const fingerprint = "650e5b39cea63a3b6746aca6ce3234e20756eb3b7422b5df8d26be18e7f29394";

function percentile95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

describe("representative Explore budgets", () => {
  it("keeps GraphProjectionV1 under the compressed payload budget", () => {
    const projection = composeExploreProjection(fixture);
    const compressedBytes = gzipSync(JSON.stringify(projection), { level: 9 }).byteLength;
    console.info("[explore-budget] gzip-bytes=" + compressedBytes + " limit=153600");
    expect(compressedBytes).toBeLessThanOrEqual(150 * 1024);
  });

  it("keeps deterministic Dagre materialization p95 within 250ms", () => {
    for (let index = 0; index < 5; index += 1) composeExploreProjection(fixture);
    const samples = Array.from({ length: 50 }, () => {
      const startedAt = performance.now();
      composeExploreProjection(fixture);
      return performance.now() - startedAt;
    });

    const p95 = percentile95(samples);
    console.info("[explore-budget] compose-layout-p95-ms=" + p95.toFixed(3) + " limit=250");
    expect(p95).toBeLessThanOrEqual(250);
  });

  it("retains the approved stable structural fingerprint across reload materializations", () => {
    const first = composeExploreProjection(fixture);
    const second = composeExploreProjection(fixture);
    expect(first.layout.structuralFingerprint).toBe(fingerprint);
    expect(second.layout.structuralFingerprint).toBe(first.layout.structuralFingerprint);
    expect(second.layout.positions).toEqual(first.layout.positions);
  });
});

export { percentile95 };
