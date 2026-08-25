import "server-only";

import representativeFixture from "../../../../tests/fixtures/graph/v1/valid/graph-projection-v1.representative.json";
import { composeExploreProjection } from "./compose-graph-projection";

/**
 * Phase 0 demo input only. This fixture is not a production database read, live workspace state,
 * or an authoritative NVIDIA target. Replace this adapter with bounded-context read models later.
 */
export function getRepresentativeExploreProjection() {
  return composeExploreProjection(representativeFixture);
}
