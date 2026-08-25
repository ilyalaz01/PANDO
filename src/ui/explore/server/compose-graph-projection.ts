import "server-only";

import { validateGraphProjection } from "../../../shared/contracts/graph-projection";
import { asJsonObject } from "../../../shared/contracts/json";

import type { ExploreGraphProjectionView } from "../types";
import { computeDagrePositions } from "./dagre-layout";
import { toExploreProjectionView } from "./projection-view";

export class ExploreProjectionError extends Error {
  constructor(
    message: string,
    readonly violationCodes: readonly string[],
  ) {
    super(message);
    this.name = "ExploreProjectionError";
  }
}

function assertProjection(value: unknown, stage: string): void {
  const result = validateGraphProjection(value);
  if (!result.valid) {
    throw new ExploreProjectionError(
      "GraphProjectionV1 failed " + stage + " validation",
      result.violations.map((violation) => violation.code),
    );
  }
}

/** Pure, read-only server projection materialization. It never owns or mutates domain facts. */
export function composeExploreProjection(source: unknown): ExploreGraphProjectionView {
  const document: unknown = structuredClone(source);
  assertProjection(document, "source");

  const sourceView = toExploreProjectionView(document);
  const documentObject = asJsonObject(document, "GraphProjectionV1");
  const layout = asJsonObject(documentObject.layout, "layout");
  const materialized = {
    ...documentObject,
    layout: {
      ...layout,
      positions: computeDagrePositions(sourceView),
    },
  };

  assertProjection(materialized, "materialized");
  return toExploreProjectionView(materialized);
}
