/**
 * BlockGraph MCP v0.2.6 — Paired Comparison Tests
 * PRD FR8: paired comparison reporting.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { compareRuns, type CompareResult } from "../src/benchmark/compare.js";
import type { BenchmarkRun, CaseScore } from "../src/benchmark/schema.js";

const BASELINE_DIR = resolve("test-workspace", "compare-baseline");
const CANDIDATE_DIR = resolve("test-workspace", "compare-candidate");
const OUTPUT_DIR = resolve("test-workspace", "compare-output");

function makeScore(overrides?: Partial<CaseScore>): CaseScore {
  return {
    case_id: "test-case",
    condition: "no_graph",
    accuracy: {
      file_precision: 0.8, file_recall: 0.7, file_f1: 0.75,
      entity_precision: 0.6, entity_recall: 0.5, entity_f1: 0.55,
      block_precision: 0.9, block_recall: 0.8, block_f1: 0.85,
      top1_file_hit: 1, top3_file_hit: 1, top5_file_hit: 1,
      top1_entity_hit: 1, top3_entity_hit: 1,
      flow_order_score: 1,
      must_not_include_penalty: 0,
      unsupported_evidence_penalty: 0,
    },
    efficiency: {
      reported_tool_calls: null, reported_read_calls: null,
      reported_grep_calls: null, reported_mcp_calls: null,
      unique_files_read: null, search_waste_ratio: null, duration_ms: null,
    },
    evidence: {
      evidence_file_exists_rate: 1, evidence_line_valid_rate: 1,
      evidence_entity_valid_rate: 1, unsupported_claim_count: 0,
    },
    accuracy_score: 0.8, efficiency_score: null, evidence_score: 1,
    overall_score: 0.84,
    warnings: [],
    resolution: {
      resolved_blocks: 2, unresolved_blocks: 0,
      resolved_entities: 3, unresolved_entities: 1,
      resolution_methods: { exact: 4, scanner_id: 1 },
    },
    ...overrides,
  };
}

function makeRun(overall: number, cases: Array<{ case_id: string; score: number | null; condition?: string }>): BenchmarkRun {
  return {
    id: `run-${overall}`,
    created_at: "2026-06-19T00:00:00Z",
    benchmark_version: "0.2.6",
    adapter: "fixture",
    cases: cases.map((c) => ({
      case_id: c.case_id,
      condition: (c.condition ?? "no_graph") as any,
      adapter: "fixture",
      final_answer: null,
      score: c.score !== null ? makeScore({ case_id: c.case_id, overall_score: c.score, condition: (c.condition ?? "no_graph") as any }) : null,
      duration_ms: 1000,
      error: c.score === null ? "failed" : undefined,
    })),
    aggregate: {
      overall,
      by_condition: { no_graph: overall, code_facts_only: 0, block_graph: 0, block_graph_with_flows: 0, stale_or_incomplete_graph: 0, block_graph_mcp: 0 },
      case_count: cases.length,
      failed_count: cases.filter((c) => c.score === null).length,
    },
  };
}

describe("Paired Comparison", () => {
  beforeEach(async () => {
    await mkdir(BASELINE_DIR, { recursive: true });
    await mkdir(CANDIDATE_DIR, { recursive: true });
    await mkdir(OUTPUT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(resolve("test-workspace", "compare-baseline"), { recursive: true, force: true });
    await rm(resolve("test-workspace", "compare-candidate"), { recursive: true, force: true });
    await rm(resolve("test-workspace", "compare-output"), { recursive: true, force: true });
  });

  it("computes overall delta and win/loss counts", async () => {
    const baseline = makeRun(0.7, [
      { case_id: "case-a", score: 0.8 },
      { case_id: "case-b", score: 0.6 },
    ]);
    const candidate = makeRun(0.85, [
      { case_id: "case-a", score: 0.9 },  // win
      { case_id: "case-b", score: 0.8 },  // win
    ]);

    await writeFile(resolve(BASELINE_DIR, "run.json"), JSON.stringify(baseline, null, 2));
    await writeFile(resolve(CANDIDATE_DIR, "run.json"), JSON.stringify(candidate, null, 2));

    const result = await compareRuns({
      baselineDir: BASELINE_DIR,
      candidateDir: CANDIDATE_DIR,
    });

    expect(result.overall_delta).toBe(0.15);
    expect(result.win_count).toBe(2);
    expect(result.loss_count).toBe(0);
    expect(result.tie_count).toBe(0);
  });

  it("detects losses and generates failure reasons", async () => {
    const baseline = makeRun(0.9, [
      { case_id: "case-a", score: 0.95 },
    ]);
    const candidate = makeRun(0.5, [
      { case_id: "case-a", score: 0.5 },  // loss
    ]);

    await writeFile(resolve(BASELINE_DIR, "run.json"), JSON.stringify(baseline, null, 2));
    await writeFile(resolve(CANDIDATE_DIR, "run.json"), JSON.stringify(candidate, null, 2));

    const result = await compareRuns({
      baselineDir: BASELINE_DIR,
      candidateDir: CANDIDATE_DIR,
    });

    expect(result.loss_count).toBe(1);
    expect(result.top_failure_reasons.length).toBeGreaterThan(0);
  });

  it("computes sub-deltas for file/entity/block/evidence", async () => {
    const baseline = makeRun(0.8, [
      { case_id: "case-a", score: 0.8 },
    ]);
    const candidate = makeRun(0.8, [
      { case_id: "case-a", score: 0.8 },
    ]);

    await writeFile(resolve(BASELINE_DIR, "run.json"), JSON.stringify(baseline, null, 2));
    await writeFile(resolve(CANDIDATE_DIR, "run.json"), JSON.stringify(candidate, null, 2));

    const result = await compareRuns({
      baselineDir: BASELINE_DIR,
      candidateDir: CANDIDATE_DIR,
    });

    expect(result.avg_file_f1_delta).toBe(0);
    expect(result.avg_entity_f1_delta).toBe(0);
    expect(result.avg_block_f1_delta).toBe(0);
    expect(result.avg_evidence_delta).toBe(0);
  });

  it("reports unresolved ID deltas", async () => {
    const baseline = makeRun(0.8, [
      { case_id: "case-a", score: 0.8 },
    ]);
    const candidate = makeRun(0.8, [
      { case_id: "case-a", score: 0.8 },
    ]);

    await writeFile(resolve(BASELINE_DIR, "run.json"), JSON.stringify(baseline, null, 2));
    await writeFile(resolve(CANDIDATE_DIR, "run.json"), JSON.stringify(candidate, null, 2));

    const result = await compareRuns({
      baselineDir: BASELINE_DIR,
      candidateDir: CANDIDATE_DIR,
    });

    expect(result.cases[0].baseline_unresolved_ids).toBe(1);
    expect(result.cases[0].candidate_unresolved_ids).toBe(1);
  });

  it("writes compare.json and compare.md when outputDir provided", async () => {
    const baseline = makeRun(0.8, [{ case_id: "case-a", score: 0.8 }]);
    const candidate = makeRun(0.9, [{ case_id: "case-a", score: 0.9 }]);

    await writeFile(resolve(BASELINE_DIR, "run.json"), JSON.stringify(baseline, null, 2));
    await writeFile(resolve(CANDIDATE_DIR, "run.json"), JSON.stringify(candidate, null, 2));

    await compareRuns({
      baselineDir: BASELINE_DIR,
      candidateDir: CANDIDATE_DIR,
      outputDir: OUTPUT_DIR,
    });

    expect(existsSync(resolve(OUTPUT_DIR, "compare.json"))).toBe(true);
    expect(existsSync(resolve(OUTPUT_DIR, "compare.md"))).toBe(true);

    const report = await readFile(resolve(OUTPUT_DIR, "compare.md"), "utf-8");
    expect(report).toContain("Paired Benchmark Comparison");
    expect(report).toContain("Win/Loss Summary");
  });

  it("handles missing cases gracefully", async () => {
    const baseline = makeRun(0.8, [{ case_id: "case-a", score: 0.8 }]);
    const candidate = makeRun(0.9, [
      { case_id: "case-a", score: 0.9 },
      { case_id: "case-b", score: 0.85 },
    ]);

    await writeFile(resolve(BASELINE_DIR, "run.json"), JSON.stringify(baseline, null, 2));
    await writeFile(resolve(CANDIDATE_DIR, "run.json"), JSON.stringify(candidate, null, 2));

    const result = await compareRuns({
      baselineDir: BASELINE_DIR,
      candidateDir: CANDIDATE_DIR,
    });

    expect(result.cases).toHaveLength(2);
    expect(result.error_count).toBe(1); // case-b missing from baseline
  });
});
