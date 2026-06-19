/**
 * BlockGraph MCP v0.2.5 — Benchmark Runner
 * Orchestrates benchmark case execution, scoring, and reporting.
 * PRD §16: runner implementation.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadCases, type CaseLoadResult } from "./cases.js";
import { prepareGraphCondition } from "./graphConditions.js";
import { buildPrompt } from "./prompt.js";
import { evaluateAccessAccuracy } from "./evaluators/accessAccuracy.js";
import { EventLogger } from "./events.js";
import { writeReports } from "./report.js";
import type {
  BenchmarkCase,
  BenchmarkCaseRun,
  BenchmarkRun,
  BenchmarkAggregateScore,
  GraphCondition,
  AgentAdapter,
  AgentFinalAnswer,
  CaseScore,
} from "./schema.js";

export interface RunBenchmarkOptions {
  suite: string;
  caseIds?: string[];
  conditions?: GraphCondition[];
  adapter: AgentAdapter;
  outputDir: string;
  timeoutMs: number;
  model?: string;
  dryRun?: boolean;
}

export interface RunBenchmarkResult {
  run: BenchmarkRun;
  outputDir: string;
}

/**
 * Run a benchmark suite end-to-end.
 */
export async function runBenchmark(
  options: RunBenchmarkOptions,
): Promise<RunBenchmarkResult> {
  const {
    suite,
    caseIds,
    conditions,
    adapter,
    outputDir,
    timeoutMs,
    model,
    dryRun = false,
  } = options;

  const runId = `run-${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const suiteDir = resolve("benchmarks", suite);

  // Load cases
  const loadResult: CaseLoadResult = await loadCases(suiteDir);
  if (loadResult.errors.length > 0) {
    throw new Error(
      `Failed to load cases:\n${loadResult.errors.map((e) => `${e.file}: ${e.message}`).join("\n")}`,
    );
  }

  let cases = loadResult.cases;
  if (caseIds && caseIds.length > 0) {
    cases = cases.filter((c) => caseIds.includes(c.id));
  }

  // Filter conditions
  const allConditions: GraphCondition[] = conditions ?? [
    "no_graph",
    "code_facts_only",
    "block_graph",
    "block_graph_with_flows",
    "stale_or_incomplete_graph",
    "block_graph_mcp",
  ];

  // Create output directory
  await mkdir(outputDir, { recursive: true });

  // Initialize event logger
  const events = new EventLogger(outputDir, runId);
  await events.init();
  events.log("run_started", { data: { suite, adapter: adapter.name, model, dryRun } });
  await events.flush();

  // Dry run: write planned metadata and return
  if (dryRun) {
    const plan = {
      run_id: runId,
      created_at: createdAt,
      adapter: adapter.name,
      model,
      dry_run: true,
      cases: cases.map((c) => ({
        case_id: c.id,
        conditions: c.allowed_conditions.filter((cond) => allConditions.includes(cond)),
      })),
      total_runs: cases.reduce(
        (sum, c) =>
          sum +
          c.allowed_conditions.filter((cond) => allConditions.includes(cond)).length,
        0,
      ),
    };
    await writeFile(resolve(outputDir, "plan.json"), JSON.stringify(plan, null, 2));
    events.log("run_finished", { data: { dry_run: true } });
    await events.flush();

    const run: BenchmarkRun = {
      id: runId,
      created_at: createdAt,
      benchmark_version: "0.2.5",
      adapter: adapter.name,
      model,
      cases: [],
      aggregate: { overall: 0, by_condition: {} as BenchmarkAggregateScore["by_condition"], case_count: 0, failed_count: 0 },
    };
    return { run, outputDir };
  }

  // Execute cases
  const caseRuns: BenchmarkCaseRun[] = [];
  let failedCount = 0;

  for (const case_ of cases) {
    const applicableConditions = case_.allowed_conditions.filter((c) =>
      allConditions.includes(c),
    );

    for (const condition of applicableConditions) {
      const caseRun = await executeCase({
        case_,
        condition,
        adapter,
        runId,
        repoPath: resolve(case_.repo.path ?? "."),
        outputDir,
        timeoutMs,
        model,
        events,
      });
      caseRuns.push(caseRun);
      if (caseRun.error) failedCount++;
    }
  }

  // Compute aggregate
  const aggregate = computeAggregate(caseRuns);

  // Build run record
  const run: BenchmarkRun = {
    id: runId,
    created_at: createdAt,
    benchmark_version: "0.2.5",
    adapter: adapter.name,
    model,
    cases: caseRuns,
    aggregate,
  };

  events.log("run_finished", { data: { case_count: caseRuns.length, failed_count: failedCount } });
  await events.flush();

  // Write reports
  await writeReports(run, outputDir);

  return { run, outputDir };
}

// ── Case Execution ─────────────────────────────────────────────────────────

interface ExecuteCaseOptions {
  case_: BenchmarkCase;
  condition: GraphCondition;
  adapter: AgentAdapter;
  runId: string;
  repoPath: string;
  outputDir: string;
  timeoutMs: number;
  model?: string;
  events: EventLogger;
}

async function executeCase(
  options: ExecuteCaseOptions,
): Promise<BenchmarkCaseRun> {
  const {
    case_,
    condition,
    adapter,
    runId,
    repoPath,
    outputDir,
    timeoutMs,
    model,
    events,
  } = options;

  const caseDir = resolve(outputDir, "cases", case_.id, condition);
  await mkdir(caseDir, { recursive: true });

  events.log("case_started", { case_id: case_.id, condition });
  await events.flush();

  const startTime = Date.now();
  let finalAnswer: AgentFinalAnswer | null = null;
  let score: CaseScore | null = null;
  let error: string | undefined;

  try {
    // Prepare graph condition
    const { context, warnings } = await prepareGraphCondition(
      repoPath,
      caseDir,
      condition,
    );
    events.log("graph_condition_prepared", {
      case_id: case_.id,
      condition,
      data: { warnings },
    });

    // Build prompt
    const prompt = buildPrompt({ case_, condition, repoPath, context });
    await writeFile(resolve(caseDir, "prompt.txt"), prompt, "utf-8");

    // Run adapter
    events.log("agent_started", { case_id: case_.id, condition });
    await events.flush();

    const result = await adapter.run({
      run_id: runId,
      case: case_,
      condition,
      repo_path: repoPath,
      graph_context: context,
      prompt,
      output_dir: caseDir,
      timeout_ms: timeoutMs,
    });

    finalAnswer = result.final_answer;
    await writeFile(
      resolve(caseDir, "answer.json"),
      JSON.stringify(finalAnswer, null, 2),
    );

    events.log("agent_finished", {
      case_id: case_.id,
      condition,
      data: { duration_ms: result.duration_ms },
    });

    // Score
    score = evaluateAccessAccuracy({
      case_,
      condition,
      answer: finalAnswer,
      repo_path: repoPath,
    });
    await writeFile(resolve(caseDir, "score.json"), JSON.stringify(score, null, 2));

    events.log("score_computed", {
      case_id: case_.id,
      condition,
      data: { overall_score: score.overall_score },
    });
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
    events.log("agent_failed", { case_id: case_.id, condition, data: { error } });
  }

  const duration_ms = Date.now() - startTime;
  events.log("case_finished", { case_id: case_.id, condition, data: { duration_ms, error } });
  await events.flush();

  return {
    case_id: case_.id,
    condition,
    adapter: adapter.name,
    model,
    final_answer: finalAnswer,
    score,
    duration_ms,
    error,
  };
}

// ── Aggregate Scoring ──────────────────────────────────────────────────────

function computeAggregate(caseRuns: BenchmarkCaseRun[]): BenchmarkAggregateScore {
  const byCondition = new Map<GraphCondition, number[]>();
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
