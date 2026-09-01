import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import agentChangeSetSchema from "../../../schemas/agent-control/v1/change-set.schema.json";
import agentControlContextSchema from "../../../schemas/agent-control/v1/control-context.schema.json";
import exploreSourceSchema from "../../../schemas/explore-source/v1/explore-source.schema.json";
import exploreStructuralProjectionSchema from "../../../schemas/explore-structural-projection/v1/explore-structural-projection.schema.json";
import exploreTargetContextSchema from "../../../schemas/explore-target-context/v1/explore-target-context.schema.json";
import evidenceEventSchema from "../../../schemas/events/v1/evidence-event.schema.json";
import masteryEventSchema from "../../../schemas/events/v1/mastery-event.schema.json";
import planningEventSchema from "../../../schemas/events/v1/planning-event.schema.json";
import readinessEventSchema from "../../../schemas/events/v1/readiness-event.schema.json";
import reviewEventSchema from "../../../schemas/events/v1/review-event.schema.json";
import graphProjectionSchema from "../../../schemas/graph-projection/v1/graph-projection.schema.json";
import planSnapshotSchema from "../../../schemas/planning/v1/plan-snapshot.schema.json";
import growthPlanControlSchema from "../../../schemas/planning/v1/growth-plan-control.schema.json";
import growthPlanCapacityControlSchema from "../../../schemas/planning/v1/growth-plan-capacity-control.schema.json";
import growthPlanInitializationControlSchema from "../../../schemas/planning/v1/growth-plan-initialization-control.schema.json";
import learningTrackActivityAdmissionControlSchema from "../../../schemas/planning/v1/learning-track-activity-admission-control.schema.json";
import learningTrackCreationControlSchema from "../../../schemas/planning/v1/learning-track-creation-control.schema.json";
import learningTrackLifecycleControlSchema from "../../../schemas/planning/v1/learning-track-lifecycle-control.schema.json";
import learningTrackPriorityMinimumControlSchema from "../../../schemas/planning/v1/learning-track-priority-minimum-control.schema.json";
import planningInputSchema from "../../../schemas/planning/v1/planning-input.schema.json";
import todayWorkspaceSchema from "../../../schemas/planning/v1/today-workspace.schema.json";
import preparationCommonSchema from "../../../schemas/preparation-pack/v1/common.schema.json";
import preparationContextSchema from "../../../schemas/preparation-pack/v1/preparation-context.schema.json";
import preparationManifestSchema from "../../../schemas/preparation-pack/v1/manifest.schema.json";
import preparationPlanSchema from "../../../schemas/preparation-pack/v1/preparation-plan.schema.json";
import targetProfileSchema from "../../../schemas/preparation-pack/v1/target-profile.schema.json";
import targetSelectionSourceSchema from "../../../schemas/target-selection/v1/target-selection-source.schema.json";
import planningReadinessInputSchema from "../../../schemas/target-readiness/v1/planning-readiness-input.schema.json";
import targetReadinessSchema from "../../../schemas/target-readiness/v1/target-readiness.schema.json";

import { type ContractViolation, type ValidationResult, validationResult } from "./result";

export const schemaNames = [
  "agent-control-context",
  "agent-change-set",
  "explore-source",
  "explore-structural-projection",
  "explore-target-context",
  "evidence-event-v1",
  "mastery-event-v1",
  "planning-event-v1",
  "readiness-event-v1",
  "review-event-v1",
  "planning-input-v1",
  "growth-plan-control-v1",
  "growth-plan-capacity-control-v1",
  "growth-plan-initialization-control-v1",
  "learning-track-creation-control-v1",
  "learning-track-activity-admission-control-v1",
  "learning-track-lifecycle-control-v1",
  "learning-track-priority-minimum-control-v1",
  "plan-snapshot-v1",
  "today-workspace-v1",
  "preparation-context",
  "preparation-manifest",
  "preparation-plan",
  "target-profile",
  "target-selection-source",
  "target-readiness-v1",
  "planning-readiness-input-v1",
  "graph-projection",
] as const;

export type SchemaName = (typeof schemaNames)[number];

type JsonSchema = Record<string, unknown> & { readonly $id: string };

const schemasByName: Readonly<Record<SchemaName, JsonSchema>> = {
  "agent-control-context": agentControlContextSchema,
  "agent-change-set": agentChangeSetSchema,
  "explore-source": exploreSourceSchema,
  "explore-structural-projection": exploreStructuralProjectionSchema,
  "explore-target-context": exploreTargetContextSchema,
  "evidence-event-v1": evidenceEventSchema,
  "mastery-event-v1": masteryEventSchema,
  "planning-event-v1": planningEventSchema,
  "readiness-event-v1": readinessEventSchema,
  "review-event-v1": reviewEventSchema,
  "planning-input-v1": planningInputSchema,
  "growth-plan-control-v1": growthPlanControlSchema,
  "growth-plan-capacity-control-v1": growthPlanCapacityControlSchema,
  "growth-plan-initialization-control-v1": growthPlanInitializationControlSchema,
  "learning-track-creation-control-v1": learningTrackCreationControlSchema,
  "learning-track-activity-admission-control-v1": learningTrackActivityAdmissionControlSchema,
  "learning-track-lifecycle-control-v1": learningTrackLifecycleControlSchema,
  "learning-track-priority-minimum-control-v1": learningTrackPriorityMinimumControlSchema,
  "plan-snapshot-v1": planSnapshotSchema,
  "today-workspace-v1": todayWorkspaceSchema,
  "preparation-context": preparationContextSchema,
  "preparation-manifest": preparationManifestSchema,
  "preparation-plan": preparationPlanSchema,
  "target-profile": targetProfileSchema,
  "target-selection-source": targetSelectionSourceSchema,
  "target-readiness-v1": targetReadinessSchema,
  "planning-readiness-input-v1": planningReadinessInputSchema,
  "graph-projection": graphProjectionSchema,
};

function createRegistry(): Readonly<Record<SchemaName, ValidateFunction>> {
  const ajv = new Ajv2020({
    allErrors: true,
    coerceTypes: false,
    strict: true,
    useDefaults: false,
    removeAdditional: false,
    validateFormats: true,
  });
  addFormats(ajv, { mode: "full" });

  ajv.addSchema(preparationCommonSchema);
  for (const schema of Object.values(schemasByName)) {
    ajv.addSchema(schema);
  }

  return Object.fromEntries(
    schemaNames.map((name) => {
      const validate = ajv.getSchema(schemasByName[name].$id);
      if (validate === undefined) {
        throw new Error(`Schema was not registered: ${name}`);
      }
      return [name, validate];
    }),
  ) as unknown as Readonly<Record<SchemaName, ValidateFunction>>;
}

const registry = createRegistry();

function fieldFromPath(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? "";
}

function structuralCode(error: ErrorObject): string {
  const path = error.instancePath;
  const field = fieldFromPath(path);

  if (error.keyword === "format") {
    return error.params.format === "date-time" ? "SCHEMA_DATE_TIME_FORMAT" : "SCHEMA_DATE_FORMAT";
  }
  if (error.keyword === "maxItems") {
    return path === "/files" ? "SCHEMA_PACK_VARIANT_FILES" : "SCHEMA_MAX_ITEMS";
  }
  if (error.keyword === "minItems" && path === "/files") {
    return "SCHEMA_PACK_VARIANT_FILES";
  }
  if (error.keyword === "additionalProperties") {
    if (path.includes("subject_ref")) return "SCHEMA_REFERENCE_SHAPE";
    return "SCHEMA_UNKNOWN_FIELD";
  }
  if (error.keyword === "pattern") {
    if (path.endsWith("/checksum/digest")) return "SCHEMA_CHECKSUM_DIGEST";
    if (path.endsWith("/fingerprint/digest")) {
      return "SCHEMA_FINGERPRINT_DIGEST";
    }
    return "SCHEMA_ID_PATTERN";
  }
  if (error.keyword === "const") {
    if (field === "schema_version") return "SCHEMA_VERSION_UNSUPPORTED";
    if (path.endsWith("/checksum/algorithm")) {
      return "SCHEMA_CHECKSUM_ALGORITHM";
    }
    if (path.endsWith("/fingerprint/canonicalization")) {
      return "SCHEMA_FINGERPRINT_CANONICALIZATION";
    }
    if (field === "path") return "SCHEMA_DESCRIPTOR_PATH";
    if (field === "scope") return "SCHEMA_PERSONAL_SCOPE";
    if (field === "lifecycle") return "SCHEMA_PERSONAL_LIFECYCLE";
  }
  if (error.keyword === "required") {
    const missing = String(error.params.missingProperty);
    if (missing === "confidence" || missing === "source_refs") {
      return "SCHEMA_REQUIRED_PROVENANCE";
    }
    if (missing === "sources" || missing === "target_profile_ref" || missing === "deadline") {
      return "SCHEMA_VARIANT_REQUIRED_FIELD";
    }
  }
  if (error.keyword === "not") return "SCHEMA_VARIANT_FIELD_FORBIDDEN";
  if (error.keyword === "oneOf") {
    if (path.includes("subject_ref")) return "SCHEMA_REFERENCE_SHAPE";
    if (path.includes("dimensions")) return "SCHEMA_DIMENSION_STATE";
    if (path === "/files") return "SCHEMA_PACK_VARIANT_FILES";
  }
  return `SCHEMA_${error.keyword.toUpperCase()}`;
}

function toViolation(error: ErrorObject): ContractViolation {
  return {
    code: structuralCode(error),
    path: error.instancePath || "/",
    message: error.message ?? "JSON Schema validation failed",
  };
}

export function validateSchema(schemaName: SchemaName, value: unknown): ValidationResult {
  const validate = registry[schemaName];
  return validate(value)
    ? validationResult([])
    : validationResult((validate.errors ?? []).map(toViolation));
}

export function schemaId(schemaName: SchemaName): string {
  return schemasByName[schemaName].$id;
}
