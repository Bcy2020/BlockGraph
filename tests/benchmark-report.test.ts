/**
 * BlockGraph MCP v0.2.5 — Graph Condition & Report Tests
 * PRD §19.4, §19.5: graph condition tests, report tests
 */
import { describe, it, expect, afterAll } from "vitest";
import { resolve } from "node:path";
import { rm, readFile, readdir } from "node:fs/promises";
import { prepareGraphCondition } from "../src/benchmark/graphConditions.js";
import { writeReports } from "../src/benchmark/report.js";
import { runBenchmark } from "../src/benchmark/run.js";
import { createFixtureAdapter } from "../src/benchmark/adapters/fixture.js";
import type { GraphCondition, BenchmarkRun } from "../src/benchmark/schema.js";

const repoPath = resolve("fixtures/ts-react-complex");
const tmpOutput = resolve("test-workspace-graph-conditions");

async function cleanup() {
  await rm(tmpOutput, { recursive: true, force: true });
}

describe("Graph Condition Preparation", () => {
  afterAll(cleanup);

  it("no_graph produces no context files", async () => {
    const outputDir = resolve(tmpOutput, "no_graph");
    const result = await prepareGraphCondition(repoPath, outputDir, "no_graph");
    expect(result.context.condition).toBe("no_graph");
    expect(result.context.code_facts_path).toBeUndefined();
    expect(result.context.blocks_path).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("code_facts_only exports scanned entities", async () => {
    const outputDir = resolve(tmpOutput, "code_facts_only");
    const result = await prepareGraphCondition(repoPath, outputDir, "code_facts_only");
    expect(result.context.code_facts_path).toBeDefined();

    const raw = await readFile(result.context.code_facts_path!, "utf-8");
    const data = JSON.parse(raw);
    expect(data.entities.length).toBeGreaterThan(0);
    expect(data.edges.length).toBeGreaterThan(0);
  });

  it("block_graph exports blocks and connectors", async () => {
    const outputDir = resolve(tmpOutput, "block_graph");
    const result = await prepareGraphCondition(repoPath, outputDir, "block_graph");
    expect(result.context.blocks_path).toBeDefined();
    expect(result.context.connectors_path).toBeDefined();

    const blocksRaw = await readFile(result.context.blocks_path!, "utf-8");
    const blocks = JSON.parse(blocksRaw);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b: { name: string }) => b.name === "Auth")).toBe(true);
    expect(blocks.some((b: { name: string }) => b.name === "Shared API Client")).toBe(true);
  });

  it("block_graph_with_flows exports flows", async () => {
    const outputDir = resolve(tmpOutput, "block_graph_with_flows");
    const result = await prepareGraphCondition(repoPath, outputDir, "block_graph_with_flows");
    expect(result.context.flows_path).toBeDefined();

    const flowsRaw = await readFile(result.context.flows_path!, "utf-8");
    const flows = JSON.parse(flowsRaw);
    expect(flows.length).toBeGreaterThan(0);
    expect(flows.some((f: { name: string }) => f.name === "Login Flow")).toBe(true);
  });

  it("stale_or_incomplete_graph records omissions", async () => {
    const outputDir = resolve(tmpOutput, "stale");
    const result = await prepareGraphCondition(repoPath, outputDir, "stale_or_incomplete_graph");
    expect(result.context.stale_warning_path).toBeDefined();
    expect(result.context.omissions).toBeDefined();
    expect(result.context.omissions!.features).toContain("teams");
    expect(result.warnings.length).toBeGreaterThan(0);

    const warningRaw = await readFile(result.context.stale_warning_path!, "utf-8");
    const warning = JSON.parse(warningRaw);
    expect(warning.warning).toContain("incomplete");
    expect(warning.omissions.features).toContain("teams");
  });

  it("stale condition omits teams from blocks", async () => {
    const outputDir = resolve(tmpOutput, "stale_blocks");
    const result = await prepareGraphCondition(repoPath, outputDir, "stale_or_incomplete_graph");
    const blocksRaw = await readFile(result.context.blocks_path!, "utf-8");
    const blocks = JSON.parse(blocksRaw);
    expect(blocks.some((b: { name: string }) => b.name === "Teams")).toBe(false);
    expect(blocks.some((b: { name: string }) => b.name === "Auth")).toBe(true);
  });
});

// ── Report Tests ───────────────────────────────────────────────────────────

describe("Report Generator", () => {
  const reportOutput = resolve("test-workspace-reports");

  afterAll(async () => {
    await rm(reportOutput, { recursive: true, force: true });
  });

  it("run.json includes aggregate and per-case metrics", async () => {
    const outputDir = resolve(reportOutput, "json-test");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    const { run } = await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const runJsonRaw = await readFile(resolve(outputDir, "run.json"), "utf-8");
    const runJson = JSON.parse(runJsonRaw);
    expect(runJson.id).toBe(run.id);
    expect(runJson.cases).toHaveLength(1);
    expect(runJson.aggregate.overall).toBeGreaterThan(0);
  });

  it("report.md contains condition comparison table", async () => {
    const outputDir = resolve(reportOutput, "md-test");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const report = await readFile(resolve(outputDir, "report.md"), "utf-8");
    expect(report).toContain("# BlockGraph Benchmark Report");
    expect(report).toContain("Score by Condition");
    expect(report).toContain("| no_graph |");
    expect(report).toContain("Per-Case Results");
    expect(report).toContain("fixture-login-flow");
  });

  it("report.md includes per-case rows", async () => {
    const outputDir = resolve(reportOutput, "per-case");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow", "fixture-comment-submit-bug"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const report = await readFile(resolve(outputDir, "report.md"), "utf-8");
    expect(report).toContain("fixture-login-flow");
    expect(report).toContain("fixture-comment-submit-bug");
  });

  it("report.md includes top-k hit rates", async () => {
    const outputDir = resolve(reportOutput, "topk");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const report = await readFile(resolve(outputDir, "report.md"), "utf-8");
    expect(report).toContain("Top-K Hit Rates");
    expect(report).toContain("Top-1 File Hit");
  });

  it("report.md includes evidence validity", async () => {
    const outputDir = resolve(reportOutput, "evidence");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const report = await readFile(resolve(outputDir, "report.md"), "utf-8");
    expect(report).toContain("Evidence Validity");
    expect(report).toContain("File Exists Rate");
  });

  it("report.md lists artifacts", async () => {
    const outputDir = resolve(reportOutput, "artifacts");
    const adapter = createFixtureAdapter({ profile: "perfect" });
    await runBenchmark({
      suite: "access-accuracy",
      caseIds: ["fixture-login-flow"],
      conditions: ["no_graph"],
      adapter,
      outputDir,
      timeoutMs: 60000,
    });

    const report = await readFile(resolve(outputDir, "report.md"), "utf-8");
    expect(report).toContain("Artifacts");
    expect(report).toContain("run.json");
    expect(report).toContain("events.jsonl");
  });
});
