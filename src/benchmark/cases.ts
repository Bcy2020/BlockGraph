/**
 * BlockGraph MCP v0.2.5 — Benchmark Case Loader
 * Loads and validates benchmark case JSON files from disk.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BenchmarkCaseSchema, type BenchmarkCase } from "./schema.js";

export interface CaseLoadResult {
  cases: BenchmarkCase[];
  errors: CaseLoadError[];
}

export interface CaseLoadError {
  file: string;
  message: string;
}

/**
 * Load all benchmark cases from `benchmarks/<suite>/cases/*.json`.
 * Validates each file against BenchmarkCaseSchema.
 * Rejects duplicate case IDs.
 */
export async function loadCases(
  suiteDir: string,
): Promise<CaseLoadResult> {
  const casesDir = resolve(suiteDir, "cases");
  const errors: CaseLoadError[] = [];
  const cases: BenchmarkCase[] = [];
  const seenIds = new Set<string>();

  let entries: string[];
  try {
    const dirEntries = await readdir(casesDir);
    entries = dirEntries.filter((f) => f.endsWith(".json"));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ file: casesDir, message: `Cannot read cases directory: ${msg}` });
    return { cases, errors };
  }

  for (const filename of entries.sort()) {
    const filepath = join(casesDir, filename);
    let raw: string;
    try {
      raw = await readFile(filepath, "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ file: filename, message: `Cannot read file: ${msg}` });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ file: filename, message: "Invalid JSON" });
      continue;
    }

    const result = BenchmarkCaseSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      errors.push({ file: filename, message: `Schema validation failed: ${issues}` });
      continue;
    }

    const case_ = result.data;
    if (seenIds.has(case_.id)) {
      errors.push({ file: filename, message: `Duplicate case ID: ${case_.id}` });
      continue;
    }
    seenIds.add(case_.id);
    cases.push(case_);
  }

  return { cases, errors };
}

/**
 * Load a single case by ID from a suite directory.
 */
export async function loadCase(
  suiteDir: string,
  caseId: string,
): Promise<{ case_: BenchmarkCase | null; error: CaseLoadError | null }> {
  const filepath = resolve(suiteDir, "cases", `${caseId}.json`);
  let raw: string;
  try {
    raw = await readFile(filepath, "utf-8");
  } catch {
    return { case_: null, error: { file: `${caseId}.json`, message: "File not found" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { case_: null, error: { file: `${caseId}.json`, message: "Invalid JSON" } };
  }

  const result = BenchmarkCaseSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { case_: null, error: { file: `${caseId}.json`, message: `Schema validation failed: ${issues}` } };
  }

  return { case_: result.data, error: null };
}
