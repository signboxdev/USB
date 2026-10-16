import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");

const catalogPath = path.join(repoRoot, "data", "catalog.json");
const schemaPath = path.join(repoRoot, "data", "catalog.schema.json");

export function readCatalog() {
  let catalog;
  let schema;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read data/catalog.json: ${error.message}`);
  }
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read data/catalog.schema.json: ${error.message}`);
  }
  return { catalog, schema };
}

function compile(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function pointerToPath(pointer) {
  if (!pointer) return "catalog";
  const parts = pointer
    .split("/")
    .filter(Boolean)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  return parts.reduce((acc, part) => {
    if (/^\d+$/.test(part)) return `${acc}[${part}]`;
    return acc ? `${acc}.${part}` : part;
  }, "");
}

function formatAjvError(error) {
  const where = pointerToPath(error.instancePath);
  let extra = "";
  if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
    extra = `: ${error.params.additionalProperty}`;
  } else if (error.keyword === "enum" && Array.isArray(error.params?.allowedValues)) {
    extra = ` (${error.params.allowedValues.join(" | ")})`;
  } else if (error.keyword === "const") {
    extra = ` (${JSON.stringify(error.params?.allowedValue)})`;
  }
  return `${where} ${error.message}${extra}`;
}

function duplicateIdErrors(catalog) {
  if (!catalog || !Array.isArray(catalog.entries)) return [];
  const seen = new Map();
  const errors = [];
  catalog.entries.forEach((entry, index) => {
    if (!entry || typeof entry.id !== "string") return;
    if (seen.has(entry.id)) {
      errors.push(
        `entries[${index}].id duplicate of entries[${seen.get(entry.id)}].id ("${entry.id}")`,
      );
    } else {
      seen.set(entry.id, index);
    }
  });
  return errors;
}

export function validateCatalog(catalog, schema) {
  let validate;
  try {
    validate = compile(schema);
  } catch (error) {
    return [`catalog.schema.json ${error.message}`];
  }
  const schemaErrors = validate(catalog) ? [] : (validate.errors || []).map(formatAjvError);
  return [...schemaErrors, ...duplicateIdErrors(catalog)];
}

export function assertValidCatalog() {
  let catalog;
  let schema;
  try {
    ({ catalog, schema } = readCatalog());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const errors = validateCatalog(catalog, schema);
  if (errors.length > 0) {
    const noun = errors.length === 1 ? "problem" : "problems";
    console.error(`data/catalog.json has ${errors.length} ${noun}:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  return catalog;
}
