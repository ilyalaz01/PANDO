import readinessFixture from "../../../../tests/contract/fixtures/target-readiness/v1/target-readiness.valid.json";
import { describe, expect, it } from "vitest";

import type { ExploreStructuralProjectionView } from "../types";

import { composeTargetReadinessView } from "./compose-target-readiness-view";

const structural = {
  selectedVersions: {
    catalogVersionKey: "catalog:python-v1",
    targetProfileVersionKey: "target:python-verification-v1",
  },
  workspaceScope: { overlayRevision: "4" },
  nodes: [
    {
      nodeId: "node:domain:python",
      nodeType: "DOMAIN",
      entityRef: { entityId: "domain:python" },
      title: "Python",
      domainNodeId: null,
    },
    {
      nodeId: "node:competency:python-typing",
      nodeType: "COMPETENCY",
      entityRef: { entityId: "competency:python-typing" },
      title: "Python typing",
      domainNodeId: "node:domain:python",
    },
  ],
} as unknown as ExploreStructuralProjectionView;

describe("Explore target-readiness composition", () => {
  it("derives domain counts from every persisted input and maps blockers to structural titles", () => {
    const withEvidence = structuredClone(readinessFixture) as unknown as Record<string, unknown> & {
      inputs: Array<Record<string, unknown>>;
    };
    withEvidence.inputs[0]!.supportingEvidenceIds = ["50000000-0000-4000-8000-000000000001"];
    const view = composeTargetReadinessView(withEvidence, structural);

    expect(view.snapshot?.domains).toEqual([
      {
        domainNodeId: "node:domain:python",
        title: "Python",
        catalogVersionKey: "catalog:python-v1",
        overlayRevision: "4",
        requiredCount: 1,
        knownCount: 0,
        unknownCount: 1,
        staleCount: 0,
        mandatoryFloorBlockerCount: 1,
      },
    ]);
    expect(view.snapshot?.blockers).toEqual([
      { code: "MANDATORY_FLOOR_UNKNOWN", title: "Python typing" },
    ]);
    expect(view.snapshot?.gaps[0]?.outlineNodeId).toBe("node:competency:python-typing");
    expect(view.snapshot?.gaps[0]?.evidenceRefs).toEqual(["50000000-0000-4000-8000-000000000001"]);
  });

  it("fails closed when profile, input, or gap identities cannot be structurally joined", () => {
    const wrongProfile = structuredClone(readinessFixture);
    wrongProfile.profile.profileVersionKey = "target:other-v1";
    expect(() => composeTargetReadinessView(wrongProfile, structural)).toThrow(/profile/u);

    const missingInput = structuredClone(readinessFixture);
    missingInput.inputs = [];
    expect(() => composeTargetReadinessView(missingInput, structural)).toThrow(/persisted input/u);

    const missingCompetency = structuredClone(readinessFixture);
    missingCompetency.inputs[0]!.competencyRef = "competency:missing";
    missingCompetency.gaps[0]!.competencyRef = "competency:missing";
    expect(() => composeTargetReadinessView(missingCompetency, structural)).toThrow(/structural/u);
  });
});
