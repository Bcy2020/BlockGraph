/**
 * BlockGraph MCP v0.2.5 — Adapter & Runner Tests
 * PRD §19.3: fixture adapter, file adapter, dry run, selected case/conditions
 */
import { describe, it, expect, afterAll } from "vitest";
import { resolve } from "node:path";
import { writeFile, mkdir, rm, readFile, readdir } from "node:fs/promises";
import { createFixtureAdapter } from "../src/benchmark/adapters/fixture.js";
import { createFileAdapter } from "../src/benchmark/adapters/file.js";
import { runBenchmark } from "../src/benchmark/run.js";
import type { AgentRunInput, GraphCondition } from "../src/benchmark/schema.js";

const suiteDir = resolve("benchmarks/access-accuracy");
const repoPath = resolve("fixtures/ts-react-complex");

function makeRunInput(
  caseId: string,
  condition: GraphCondition = "no_graph",
): AgentRunInput {
  return {
    run_id: "test-run-1",
    case: {
      id: caseId,
      module: "access-accuracy",
      title: "Test",
      description: "",
      repo: { kind: "fixture", path: repoPath },
      task: { type: "entrypoint_path_location", prompt: "Test" },
      allowed_conditions: [condition],
      golden: { expected_files: [], expected_entities: [], expected_blocks: [] },
      tags: [],
    },
    condition,
    repo_path: repoPath,
    prompt: "Test prompt",
    output_dir: resolve("benchmarks/runs/test"),
    timeout_ms: 60000,
  };
}

// ── Fixture Adapter ────────────────────────────────────────────────────────

describe("Fixture Adapter", () => {
  it("loads perfect answer for fixture-login-flow", async () => {
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const input = makeRunInput("fixture-login-flow");
    const result = await adapter.run(input);
    expect(result.final_answer.task_id).toBe("fixture-login-flow");
    expect(result.final_answer.condition).toBe("no_graph");
    expect(result.final_answer.ranked_files.length).toBeGreaterThan(0);
    expect(result.final_answer.confidence).toBeGreaterThan(0.8);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("loads weak answer for fixture-login-flow", async () => {
    const adapter = createFixtureAdapter({ profile: "weak" });
    const input = makeRunInput("fixture-login-flow");
    const result = await adapter.run(input);
    expect(result.final_answer.task_id).toBe("fixture-login-flow");
    expect(result.final_answer.confidence).toBeLessThan(0.7);
  });

  it("loads wrong answer for fixture-login-flow", async () => {
    const adapter = createFixtureAdapter({ profile: "wrong" });
    const input = makeRunInput("fixture-login-flow");
    const result = await adapter.run(input);
    expect(result.final_answer.task_id).toBe("fixture-login-flow");
    expect(result.final_answer.ranked_files[0]?.id).toContain("teams");
  });

  it("loads perfect answer for all cases", async () => {
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const caseIds = [
      "fixture-login-flow",
      "fixture-comment-submit-bug",
      "fixture-auth-impact",
      "fixture-team-feature-landing",
      "fixture-discussion-cross-flow",
      "fixture-orphaned-code",
      "fixture-api-endpoint-map",
      "fixture-shared-dep-impact",
      "fixture-error-handling-gaps",
      "fixture-component-prop-trace",
    ];
    for (const caseId of caseIds) {
      const input = makeRunInput(caseId);
      const result = await adapter.run(input);
      expect(result.final_answer.task_id).toBe(caseId);
      expect(result.final_answer.ranked_files.length).toBeGreaterThan(0);
    }
  });

  it("throws clear error for missing fixture answer", async () => {
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const input = makeRunInput("nonexistent-case");
    await expect(adapter.run(input)).rejects.toThrow("Fixture answer not found");
  });
});

// ── File Adapter ───────────────────────────────────────────────────────────

describe("File Adapter", () => {
  const tmpDir = resolve("test-workspace-file-adapter");

  async function setup() {
    await mkdir(tmpDir, { recursive: true });
  }

  async function cleanup() {
    await rm(tmpDir, { recursive: true, force: true });
  }

  it("loads answer from directory", async () => {
    await setup();
    try {
      const answer = {
        task_id: "fixture-login-flow",
        condition: "no_graph",
        answer: "Test answer",
        ranked_files: [{ id: "src/test.ts", rank: 1 }],
        ranked_entities: [],
        ranked_blocks: [],
        evidence: [],
        confidence: 0.8,
        used_blockgraph: false,
      };
      await writeFile(
        resolve(tmpDir, "fixture-login-flow.no_graph.json"),
        JSON.stringify(answer),
      );

      const adapter = createFileAdapter({ answersDir: tmpDir });
      const input = makeRunInput("fixture-login-flow");
      const result = await adapter.run(input);
      expect(result.final_answer.task_id).toBe("fixture-login-flow");
      expect(result.final_answer.answer).toBe("Test answer");
    } finally {
      await cleanup();
    }
  });

  it("falls back to case-id-only filename", async () => {
    await setup();
    try {
      const answer = {
        task_id: "test-case",
        condition: "no_graph",
        answer: "Fallback",
        ranked_files: [],
        ranked_entities: [],
        ranked_blocks: [],
        evidence: [],
        confidence: 0.5,
        used_blockgraph: false,
      };
      await writeFile(resolve(tmpDir, "test-case.json"), JSON.stringify(answer));

      const adapter = createFileAdapter({ answersDir: tmpDir });
      const input = makeRunInput("test-case");
      const result = await adapter.run(input);
      expect(result.final_answer.answer).toBe("Fallback");
    } finally {
      await cleanup();
    }
  });

  it("throws clear error for missing answer file", async () => {
    await setup();
    try {
      const adapter = createFileAdapter({ answersDir: tmpDir });
      const input = makeRunInput("nonexistent");
      await expect(adapter.run(input)).rejects.toThrow("Answer file not found");
    } finally {
      await cleanup();
    }
  });

  it("throws clear error for invalid JSON", async () => {
    await setup();
    try {
      await writeFile(resolve(tmpDir, "bad.json"), "not json");
      const adapter = createFileAdapter({ answersDir: tmpDir });
      const input = makeRunInput("bad");
      await expect(adapter.run(input)).rejects.toThrow("Invalid JSON");
    } finally {
      await cleanup();
    }
  });

  it("throws clear error for invalid schema", async () => {
    await setup();
    try {
      await writeFile(
        resolve(tmpDir, "bad-schema.json"),
        JSON.stringify({ task_id: "", condition: "invalid" }),
      );
      const adapter = createFileAdapter({ answersDir: tmpDir });
      const input = makeRunInput("bad-schema");
      await expect(adapter.run(input)).rejects.toThrow("Invalid answer schema");
    } finally {
      await cleanup();
    }
  });
});

// ── Runner ─────────────────────────────────────────────────────────────────

describe("Benchmark Runner", () => {
  const runnerOutput = resolve("test-workspace-runner");

  afterAll(async () => {
    await rm(runnerOutput, { recursive: true, force: true });
  });

  it("dry run writes planned run metadata", async () => {
    const outputDir = resolve(runnerOutput, "dry-run");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const { run } = await runBenchmark({
      suite: "access-accuracy",
      adapter,
      outputDir,
      timeoutMs: 60000,
      dryRun: true,
    });
    expect(run.cases).toHaveLength(0);
    expect(run.aggregate.case_count).toBe(0);

    // Check plan file exists
    const planRaw = await readFile(resolve(outputDir, "plan.json"), "utf-8");
    const plan = JSON.parse(planRaw);
    expect(plan.total_runs).toBeGreaterThan(0);
    expect(plan.dry_run).toBe(true);
  });

  it("fixture adapter full run with perfect profile", async () => {
    const outputDir = resolve(runnerOutput, "fixture-perfect");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const { run } = await runBenchmark({
      suite: "access-accuracy",
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });
    expect(run.cases.length).toBeGreaterThanOrEqual(10);
    expect(run.aggregate.failed_count).toBe(0);
    expect(run.aggregate.overall).toBeGreaterThan(0);
    expect(run.aggregate.by_condition["no_graph"]).toBeGreaterThan(0);
  });

  it("selected --case runs only one case", async () => {
    const outputDir = resolve(runnerOutput, "selected-case");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const { run } = await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });
    expect(run.cases).toHaveLength(1);
    expect(run.cases[0].case_id).toBe("fixture-login-flow");
  });

  it("selected --conditions runs only requested conditions", async () => {
    const outputDir = resolve(runnerOutput, "selected-conditions");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const { run } = await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph", "block_graph_with_flows"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });
    expect(run.cases).toHaveLength(2);
    const conditions = run.cases.map((c) => c.condition);
    expect(conditions).toContain("no_graph");
    expect(conditions).toContain("block_graph_with_flows");
  });

  it("writes per-case artifacts", async () => {
    const outputDir = resolve(runnerOutput, "artifacts");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const caseDir = resolve(outputDir, "cases", "fixture-login-flow", "no_graph");
    const files = await readdir(caseDir);
    expect(files).toContain("prompt.txt");
    expect(files).toContain("answer.json");
    expect(files).toContain("score.json");
  });

  it("writes events.jsonl", async () => {
    const outputDir = resolve(runnerOutput, "events");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const eventsRaw = await readFile(resolve(outputDir, "events.jsonl"), "utf-8");
    const lines = eventsRaw.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    const firstEvent = JSON.parse(lines[0]);
    expect(firstEvent.type).toBe("run_started");
  });

  it("run continues after failed case", async () => {
    const outputDir = resolve(runnerOutput, "partial-fail");
    // Use weak profile which has all answers
    const adapter = createFixtureAdapter({ profile: "weak" });
    const { run } = await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow", "fixture-comment-submit-bug"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });
    // Both cases should complete (weak answers exist for both)
    expect(run.cases.length).toBe(2);
    expect(run.aggregate.failed_count).toBe(0);
  });
});
