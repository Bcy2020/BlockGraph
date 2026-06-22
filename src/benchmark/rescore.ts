/**
 * BlockGraph MCP v0.2.7 — Rescore and Artifact Consistency
 * Reproducible rescoring of benchmark runs with artifact consistency checks.
 * PRD FR1: rescore path and consistency validation.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { evaluateAccessAccuracy } from "./evaluators/accessAccuracy.js";
import type { GraphIndex } from "./idResolver.js";
import { writeReports } from "./report.js";
import { loadCases } from "./cases.js";
import { BenchmarkRunSchema } from "./schema.js";
import type {
  BenchmarkRun,
  BenchmarkCaseRun,
  BenchmarkCase,
  CaseScore,
  AgentFinalAnswer,
  BenchmarkAggregateScore,
} from "./schema.js";

// ── Run Loading with Validation ──────────────────────────────────────────

async function loadAndValidateRun(runDir: string): Promise<BenchmarkRun> {
  const runJsonPath = resolve(runDir, "run.json");
  if (!existsSync(runJsonPath)) {
    throw new Error(`run.json not found at ${runJsonPath}`);
  }
  const raw = await readFile(runJsonPath, "utf-8");
  const parsed = JSON.parse(raw);
  const result = BenchmarkRunSchema.safeParse(parsed);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid run.json in ${runDir}: ${issues}`);
}

// ── Consistency Check ─────────────────────────────────────────────────────

export interface ConsistencyMismatch {
  case_id: string;
  condition: string;
  field: string;
  run_value: unknown;
  score_value: unknown;
}

/**
 * Check consistency between run.json case scores and per-case score.json files.
 * Returns list of mismatches (empty if consistent).
 */
export async function checkArtifactConsistency(
  runDir: string,
): Promise<ConsistencyMismatch[]> {
  const run = await loadAndValidateRun(runDir);
  const mismatches: ConsistencyMismatch[] = [];

  for (const caseRun of run.cases) {
    if (caseRun.error || !caseRun.score) continue;

    const scorePath = resolve(
      runDir,
      "cases",
      caseRun.case_id,
      caseRun.condition,
      "score.json",
    );

    if (!existsSync(scorePath)) {
      mismatches.push({
        case_id: caseRun.case_id,
        condition: caseRun.condition,
        field: "score.json",
        run_value: caseRun.score,
        score_value: null,
      });
      continue;
    }

    const scoreJson: CaseScore = JSON.parse(await readFile(scorePath, "utf-8"));

    // Compare key fields
    const fieldsToCompare: (keyof CaseScore)[] = [
      "overall_score",
      "accuracy_score",
      "evidence_score",
    ];

    for (const field of fieldsToCompare) {
      if (caseRun.score[field] !== scoreJson[field]) {
        mismatches.push({
          case_id: caseRun.case_id,
          condition: caseRun.condition,
          field,
          run_value: caseRun.score[field],
          score_value: scoreJson[field],
        });
      }
    }
  }

  return mismatches;
}

// ── Rescore ───────────────────────────────────────────────────────────────

export interface RescoreOptions {
  runDir: string;
  suite?: string;
  failOnMismatch?: boolean;
}

export interface RescoreResult {
  run: BenchmarkRun;
  mismatchesBefore: ConsistencyMismatch[];
  mismatchesAfter: ConsistencyMismatch[];
  rescored: number;
  failed: number;
}

/**
 * Rescore a benchmark run:
 * 1. Read run.json
 * 2. For each successful case, read answer.json
 * 3. Recompute score.json using current evaluator
 * 4. Update run.json case scores
 * 5. Recompute aggregates
 * 6. Regenerate report.md
 * 7. Verify consistency
 */
export async function rescoreRun(options: RescoreOptions): Promise<RescoreResult> {
  const { runDir, suite = "access-accuracy", failOnMismatch = true } = options;

  const run = await loadAndValidateRun(runDir);

  // Check consistency before rescoring
  const mismatchesBefore = await checkArtifactConsistency(runDir);

  // Load cases for golden answers
  const suiteDir = resolve("benchmarks", suite);
  const loadResult = await loadCases(suiteDir);
  if (loadResult.errors.length > 0) {
    throw new Error(
      `Failed to load cases:\n${loadResult.errors.map((e) => `${e.file}: ${e.message}`).join("\n")}`,
    );
  }

  const casesById = new Map(loadResult.cases.map((c) => [c.id, c]));

  let rescored = 0;
  let failed = 0;

  // Rescore each case
  for (const caseRun of run.cases) {
    if (caseRun.error) {
      failed++;
      continue;
    }

    const caseDir = resolve(runDir, "cases", caseRun.case_id, caseRun.condition);
    const answerPath = resolve(caseDir, "answer.json");
    const repairedPath = resolve(caseDir, "answer.repaired.json");

    let useRepaired = false;
    let targetPath = answerPath;

    if (!existsSync(answerPath)) {
      if (existsSync(repairedPath)) {
        targetPath = repairedPath;
        useRepaired = true;
      } else {
        caseRun.error = "answer.json not found";
        failed++;
        continue;
      }
    }

    const caseDef = casesById.get(caseRun.case_id);
    const result = await rescoreSingleCase(
      targetPath,
      caseDef,
      caseRun,
      caseDir,
      useRepaired,
    );

    if (result.score) {
      caseRun.score = result.score;
      rescored++;
    } else {
      caseRun.error = result.error ?? "rescore failed: could not compute score";
      caseRun.score = null;
      failed++;
    }
  }

  // Recompute aggregates
  run.aggregate = computeAggregate(run.cases);

  // Write updated run.json
  await writeFile(resolve(runDir, "run.json"), JSON.stringify(run, null, 2));

  // Regenerate report.md
  await writeReports(run, runDir);

  // Check consistency after rescoring
  const mismatchesAfter = await checkArtifactConsistency(runDir);

  if (failOnMismatch && mismatchesAfter.length > 0) {
    throw new Error(
      `Artifact consistency check failed after rescoring:\n${mismatchesAfter
        .map(
          (m) =>
            `  ${m.case_id}/${m.condition}: ${m.field} run=${m.run_value} score=${m.score_value}`,
        )
        .join("\n")}`,
    );
  }

  return { run, mismatchesBefore, mismatchesAfter, rescored, failed };
}

async function rescoreSingleCase(
  answerPath: string,
  caseDef: BenchmarkCase | undefined,
  caseRun: BenchmarkCaseRun,
  caseDir: string,
  isRepaired: boolean,
): Promise<{ score: CaseScore | null; error?: string }> {
  if (!caseDef) return { score: null, error: `case "${caseRun.case_id}" not found in suite` };

  try {
    const answer: AgentFinalAnswer = JSON.parse(
      await readFile(answerPath, "utf-8"),
    );

    // Load graph index if available (same as run.ts)
    let graphIndex: GraphIndex | undefined;
    const graphIndexPath = resolve(caseDir, "graph-context", "graph-index.json");
    if (existsSync(graphIndexPath)) {
      try {
        graphIndex = JSON.parse(await readFile(graphIndexPath, "utf-8"));
      } catch {
        // Graph index is optional
      }
    }

    const score = evaluateAccessAccuracy({
      case_: caseDef,
      condition: caseRun.condition,
      answer,
      repo_path: resolve(caseDef.repo.path ?? "."),
      graphIndex,
    });

    if (isRepaired) {
      score.warnings = score.warnings ?? [];
      score.warnings.push("Answer from repaired artifact (answer.repaired.json)");
    }

    await writeFile(
      resolve(caseDir, "score.json"),
      JSON.stringify(score, null, 2),
    );

    return { score };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { score: null, error: `rescore failed: ${msg}` };
  }
}

// ── Aggregate (same as run.ts) ────────────────────────────────────────────

function computeAggregate(caseRuns: BenchmarkCaseRun[]): BenchmarkAggregateScore {
  const byCondition = new Map<string, number[]>();
  let totalScore = 0;
  let scoredCount = 0;
  let failedCount = 0;

  for (const cr of caseRuns) {
    if (cr.error) {
      failedCount++;
      continue;
    }
    if (cr.score) {
      totalScore += cr.score.overall_score;
      scoredCount++;
      const existing = byCondition.get(cr.condition) ?? [];
      existing.push(cr.score.overall_score);
      byCondition.set(cr.condition, existing);
    }
  }

  const by_condition: Record<string, number> = {};
  for (const [cond, scores] of byCondition) {
    by_condition[cond] =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10000) / 10000
        : 0;
  }

  return {
    overall: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 10000) / 10000 : 0,
    by_condition: by_condition as BenchmarkAggregateScore["by_condition"],
    case_count: caseRuns.length,
    failed_count: failedCount,
  };
}
