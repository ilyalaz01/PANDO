import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import agentChangeSetSchema from "../../../schemas/agent-control/v1/change-set.schema.json";
import agentControlContextSchema from "../../../schemas/agent-control/v1/control-context.schema.json";
import exploreSourceSchema from "../../../schemas/explore-source/v1/explore-source.schema.json";
import graphProjectionSchema from "../../../schemas/graph-projection/v1/graph-projection.schema.json";
import preparationCommonSchema from "../../../schemas/preparation-pack/v1/common.schema.json";
import preparationContextSchema from "../../../schemas/preparation-pack/v1/preparation-context.schema.json";
import preparationManifestSchema from "../../../schemas/preparation-pack/v1/manifest.schema.json";
import preparationPlanSchema from "../../../schemas/preparation-pack/v1/preparation-plan.schema.json";
import targetProfileSchema from "../../../schemas/preparation-pack/v1/target-profile.schema.json";

import { type ContractViolation, type ValidationResult, validationResult } from "./result";

export const schemaNames = [
  "agent-control-context",
  "agent-change-set",
  "explore-source",
  "preparation-context",
  "preparation-manifest",
  "preparation-plan",
  "target-profile",
  "graph-projection",
] as const;

export type SchemaName = (typeof schemaNames)[number];

type JsonSchema = Record<string, unknown> & { readonly $id: string };

const schemasByName: Readonly<Record<SchemaName, JsonSchema>> = {
  "agent-control-context": agentControlContextSchema,
  "agent-change-set": agentChangeSetSchema,
  "explore-source": exploreSourceSchema,
  "preparation-context": preparationContextSchema,
  "preparation-manifest": preparationManifestSchema,
  "preparation-plan": preparationPlanSchema,
  "target-profile": targetProfileSchema,
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
