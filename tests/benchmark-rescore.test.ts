/**
 * BlockGraph MCP v0.2.6 — Rescore and Artifact Consistency Tests
 * PRD FR1: reproducible rescoring, artifact consistency, output-file mode.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { checkArtifactConsistency, rescoreRun } from "../src/benchmark/rescore.js";
import { evaluateAccessAccuracy } from "../src/benchmark/evaluators/accessAccuracy.js";
import type { BenchmarkRun, CaseScore, AgentFinalAnswer } from "../src/benchmark/schema.js";

const TEST_RUN_DIR = resolve("test-workspace", "rescore-test");

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeRunJson(overrides?: Partial<BenchmarkRun>): BenchmarkRun {
  return {
    id: "run-test-001",
    created_at: "2026-06-18T15:08:41Z",
    benchmark_version: "0.2.6",
    adapter: "fixture",
    cases: [
      {
        case_id: "fixture-login-flow",
        condition: "no_graph",
        adapter: "fixture",
        final_answer: null,
        score: {
          case_id: "fixture-login-flow",
          condition: "no_graph",
          accuracy: {
            file_precision: 1, file_recall: 1, file_f1: 1,
            entity_precision: 1, entity_recall: 1, entity_f1: 1,
            block_precision: 1, block_recall: 1, block_f1: 1,
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
          accuracy_score: 1, efficiency_score: null, evidence_score: 1,
          overall_score: 1,
          warnings: [],
        },
        duration_ms: 1000,
      },
    ],
    aggregate: {
      overall: 1,
      by_condition: { no_graph: 1, code_facts_only: 0, block_graph: 0, block_graph_with_flows: 0, stale_or_incomplete_graph: 0, block_graph_mcp: 0 } as any,
      case_count: 1,
      failed_count: 0,
    },
    ...overrides,
  };
}

function makeAnswerJson(): AgentFinalAnswer {
  return {
    task_id: "fixture-login-flow",
    condition: "no_graph",
    answer: "Login form located in LoginForm.tsx",
    ranked_files: [{ id: "src/features/auth/LoginForm.tsx", rank: 1 }],
    ranked_entities: [{ id: "src/features/auth/LoginForm.tsx#LoginForm", rank: 1 }],
    ranked_blocks: [{ id: "Auth", rank: 1 }],
    evidence: [{ file_path: "src/features/auth/LoginForm.tsx", start_line: 1, end_line: 50 }],
    confidence: 0.9,
    used_blockgraph: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Artifact Consistency Check", () => {
  beforeEach(async () => {
    await mkdir(resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph"), { recursive: true });
  });

  afterEach(async () => {
    await rm(resolve("test-workspace", "rescore-test"), { recursive: true, force: true });
  });

  it("returns empty mismatches when run.json and score.json agree", async () => {
    const run = makeRunJson();
    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));
    await writeFile(
      resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "score.json"),
      JSON.stringify(run.cases[0].score, null, 2),
    );

    const mismatches = await checkArtifactConsistency(TEST_RUN_DIR);
    expect(mismatches).toHaveLength(0);
  });

  it("detects stale score.json with different overall_score", async () => {
    const run = makeRunJson();
    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));

    // Write a stale score.json with different overall_score
    const staleScore = { ...run.cases[0].score!, overall_score: 0.5 };
    await writeFile(
      resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "score.json"),
      JSON.stringify(staleScore, null, 2),
    );

    const mismatches = await checkArtifactConsistency(TEST_RUN_DIR);
    expect(mismatches.length).toBeGreaterThanOrEqual(1);
    expect(mismatches.some((m) => m.field === "overall_score")).toBe(true);
  });

  it("detects missing score.json", async () => {
    const run = makeRunJson();
    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));
    // Don't write score.json

    const mismatches = await checkArtifactConsistency(TEST_RUN_DIR);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].field).toBe("score.json");
    expect(mismatches[0].score_value).toBeNull();
  });

  it("throws when run.json not found", async () => {
    await expect(checkArtifactConsistency(TEST_RUN_DIR)).rejects.toThrow("run.json not found");
  });

  it("skips failed cases in consistency check", async () => {
    const run = makeRunJson({
      cases: [{
        case_id: "fixture-login-flow",
        condition: "no_graph",
        adapter: "fixture",
        final_answer: null,
        score: null,
        duration_ms: 0,
        error: "agent failed",
      }],
    });
    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));

    const mismatches = await checkArtifactConsistency(TEST_RUN_DIR);
    expect(mismatches).toHaveLength(0);
  });
});

describe("Rescore", () => {
  beforeEach(async () => {
    await mkdir(resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph"), { recursive: true });
  });

  afterEach(async () => {
    await rm(resolve("test-workspace", "rescore-test"), { recursive: true, force: true });
  });

  it("rescore recomputes score.json, run.json, and report.md consistently", async () => {
    const run = makeRunJson();
    const answer = makeAnswerJson();

    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));
    await writeFile(
      resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "answer.json"),
      JSON.stringify(answer, null, 2),
    );
    // Write intentionally stale score.json
    const staleScore = { ...run.cases[0].score!, overall_score: 0.1234 };
    await writeFile(
      resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "score.json"),
      JSON.stringify(staleScore, null, 2),
    );

    const result = await rescoreRun({
      runDir: TEST_RUN_DIR,
      suite: "access-accuracy",
      failOnMismatch: false,
    });

    expect(result.rescored).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.mismatchesBefore.length).toBeGreaterThanOrEqual(1); // stale
    expect(result.mismatchesAfter).toHaveLength(0); // consistent after rescore

    // Verify run.json was updated
    const updatedRun: BenchmarkRun = JSON.parse(await readFile(resolve(TEST_RUN_DIR, "run.json"), "utf-8"));
    expect(updatedRun.cases[0].score!.overall_score).not.toBe(0.1234);

    // Verify score.json matches run.json
    const updatedScore: CaseScore = JSON.parse(
      await readFile(resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "score.json"), "utf-8"),
    );
    expect(updatedScore.overall_score).toBe(updatedRun.cases[0].score!.overall_score);

    // Verify report.md was generated
    expect(existsSync(resolve(TEST_RUN_DIR, "report.md"))).toBe(true);
  });

  it("rescore handles missing answer.json by marking failed", async () => {
    const run = makeRunJson();
    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));
    // Don't write answer.json

    const result = await rescoreRun({
      runDir: TEST_RUN_DIR,
      suite: "access-accuracy",
      failOnMismatch: false,
    });

    expect(result.rescored).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.run.cases[0].error).toContain("answer.json not found");
  });

  it("rescore uses answer.repaired.json when answer.json is missing", async () => {
    const run = makeRunJson();
    const answer = makeAnswerJson();

    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));
    // Write repaired answer instead of answer.json
    await writeFile(
      resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "answer.repaired.json"),
      JSON.stringify(answer, null, 2),
    );

    const result = await rescoreRun({
      runDir: TEST_RUN_DIR,
      suite: "access-accuracy",
      failOnMismatch: false,
    });

    expect(result.rescored).toBe(1);
    // Check that the repaired warning was added
    expect(result.run.cases[0].score!.warnings.some((w) => w.includes("repaired"))).toBe(true);
  });

  it("rescore recomputes aggregates correctly", async () => {
    // Create a run with 2 cases
    const run = makeRunJson({
      cases: [
        {
          case_id: "fixture-login-flow",
          condition: "no_graph",
          adapter: "fixture",
          final_answer: null,
          score: {
            case_id: "fixture-login-flow",
            condition: "no_graph",
            accuracy: {
              file_precision: 1, file_recall: 1, file_f1: 1,
              entity_precision: 1, entity_recall: 1, entity_f1: 1,
              block_precision: 1, block_recall: 1, block_f1: 1,
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
            accuracy_score: 1, efficiency_score: null, evidence_score: 1,
            overall_score: 1,
            warnings: [],
          },
          duration_ms: 1000,
        },
        {
          case_id: "fixture-comment-submit-bug",
          condition: "no_graph",
          adapter: "fixture",
          final_answer: null,
          score: null,
          duration_ms: 500,
          error: "failed",
        },
      ],
      aggregate: {
        overall: 1,
        by_condition: { no_graph: 1, code_facts_only: 0, block_graph: 0, block_graph_with_flows: 0, stale_or_incomplete_graph: 0, block_graph_mcp: 0 } as any,
        case_count: 2,
        failed_count: 0,
      },
    });

    await mkdir(resolve(TEST_RUN_DIR, "cases", "fixture-comment-submit-bug", "no_graph"), { recursive: true });
    await writeFile(resolve(TEST_RUN_DIR, "run.json"), JSON.stringify(run, null, 2));
    await writeFile(
      resolve(TEST_RUN_DIR, "cases", "fixture-login-flow", "no_graph", "answer.json"),
      JSON.stringify(makeAnswerJson(), null, 2),
    );

    const result = await rescoreRun({
      runDir: TEST_RUN_DIR,
      suite: "access-accuracy",
      failOnMismatch: false,
    });

    expect(result.run.aggregate.case_count).toBe(2);
    expect(result.run.aggregate.failed_count).toBe(1); // second case failed
  });
});
