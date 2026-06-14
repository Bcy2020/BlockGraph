/**
 * BlockGraph MCP v0.2 — Quality Gate Tests
 * Tests coverage report, missing module detection, shared dependency detection,
 * connector audit, flow sufficiency, and quality gate report.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { openStore, closeStore } from "../src/graph/store.js";
import {
  createCodeEntity,
  createCodeEdge,
  createBlock as dbCreateBlock,
  attachCodeEntity as dbAttachCodeEntity,
  createPort as dbCreatePort,
  createConnector as dbCreateConnector,
  createFlow as dbCreateFlow,
  appendFlowStep as dbAppendFlowStep,
  createUnknownBoundary,
} from "../src/graph/draft.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleCoverageReport,
  handleDetectMissingModules,
  handleDetectSharedDependencies,
  handleConnectorAudit,
  handleFlowSufficiencyCheck,
  handleQualityGateReport,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-qg-test-"));
}

function makeCtx(): ToolContext {
  return { db: null, repoPath: null };
}

function makeInitializedCtx(): ToolContext {
  const ctx = makeCtx();
  const tmpDir = makeTempDir();
  handleBeginInitialization(ctx, { repo_path: tmpDir });
  return ctx;
}

// ── Coverage Report Tests ──────────────────────────────────────────────────

describe("Coverage Report", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports unmapped entities", () => {
    // Create entities without mappings
    createCodeEntity(ctx.db!, { type: "function", name: "func1", file_path: "src/a.ts", start_line: 1, end_line: 5 });
    createCodeEntity(ctx.db!, { type: "function", name: "func2", file_path: "src/b.ts", start_line: 1, end_line: 5 });

    const result = handleCoverageReport(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.total_entities).toBe(2);
    expect(result.data!.mapped_entities).toBe(0);
    expect(result.data!.unmapped_entities).toHaveLength(2);
    expect(result.data!.entity_coverage).toBe(0);
  });

  it("reports mapped entities", () => {
    const entity = createCodeEntity(ctx.db!, { type: "function", name: "func1", file_path: "src/a.ts", start_line: 1, end_line: 5 });
    const block = dbCreateBlock(ctx.db!, { name: "Block A" });
    dbAttachCodeEntity(ctx.db!, { block_id: block.id, code_entity_id: entity.id, role: "owns" });

    const result = handleCoverageReport(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.total_entities).toBe(1);
    expect(result.data!.mapped_entities).toBe(1);
    expect(result.data!.unmapped_entities).toHaveLength(0);
    expect(result.data!.entity_coverage).toBe(1);
  });

  it("reports unmapped directories", () => {
    createCodeEntity(ctx.db!, { type: "function", name: "func1", file_path: "src/features/auth/login.ts", start_line: 1, end_line: 5 });
    createCodeEntity(ctx.db!, { type: "function", name: "func2", file_path: "src/features/users/list.ts", start_line: 1, end_line: 5 });

    const result = handleCoverageReport(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.unmapped_directories.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Missing Module Detection Tests ─────────────────────────────────────────

describe("Missing Module Detection", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects unmodeled feature directories", () => {
    // Create entities in feature directories
    createCodeEntity(ctx.db!, { type: "function", name: "login", file_path: "src/features/auth/login.ts", start_line: 1, end_line: 10 });
    createCodeEntity(ctx.db!, { type: "component", name: "UserList", file_path: "src/features/users/UserList.tsx", start_line: 1, end_line: 20 });

    const result = handleDetectMissingModules(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.missing_modules.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.missing_modules.some(m => m.includes("auth"))).toBe(true);
  });

  it("does not report modeled directories", () => {
    const entity = createCodeEntity(ctx.db!, { type: "function", name: "login", file_path: "src/features/auth/login.ts", start_line: 1, end_line: 10 });
    const block = dbCreateBlock(ctx.db!, { name: "Auth" });
    dbAttachCodeEntity(ctx.db!, { block_id: block.id, code_entity_id: entity.id, role: "owns" });

    const result = handleDetectMissingModules(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.missing_modules).toHaveLength(0);
  });
});

// ── Shared Dependency Detection Tests ──────────────────────────────────────

describe("Shared Dependency Detection", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects shared utils", () => {
    createCodeEntity(ctx.db!, { type: "function", name: "helper", file_path: "src/utils/helpers.ts", start_line: 1, end_line: 5 });

    const result = handleDetectSharedDependencies(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.data!.candidates.some(c => c.name.includes("utils"))).toBe(true);
  });

  it("detects shared types", () => {
    createCodeEntity(ctx.db!, { type: "function", name: "types", file_path: "src/types/api.ts", start_line: 1, end_line: 5 });

    const result = handleDetectSharedDependencies(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.candidates.some(c => c.name.includes("types"))).toBe(true);
  });
});

// ── Connector Audit Tests ──────────────────────────────────────────────────

describe("Connector Audit", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds unexplained cross-block edges", () => {
    // Create two blocks with entities
    const block1 = dbCreateBlock(ctx.db!, { name: "Block A" });
    const block2 = dbCreateBlock(ctx.db!, { name: "Block B" });
    const entity1 = createCodeEntity(ctx.db!, { type: "function", name: "funcA", file_path: "src/a.ts", start_line: 1, end_line: 5 });
    const entity2 = createCodeEntity(ctx.db!, { type: "function", name: "funcB", file_path: "src/b.ts", start_line: 1, end_line: 5 });
    dbAttachCodeEntity(ctx.db!, { block_id: block1.id, code_entity_id: entity1.id, role: "owns" });
    dbAttachCodeEntity(ctx.db!, { block_id: block2.id, code_entity_id: entity2.id, role: "owns" });

    // Create cross-block edge
    createCodeEdge(ctx.db!, { type: "calls", source_entity_id: entity1.id, target_entity_id: entity2.id });

    const result = handleConnectorAudit(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.unexplained_edges.length).toBeGreaterThanOrEqual(1);
  });

  it("does not report edges with connectors", () => {
    const block1 = dbCreateBlock(ctx.db!, { name: "Block A" });
    const block2 = dbCreateBlock(ctx.db!, { name: "Block B" });
    const entity1 = createCodeEntity(ctx.db!, { type: "function", name: "funcA", file_path: "src/a.ts", start_line: 1, end_line: 5 });
    const entity2 = createCodeEntity(ctx.db!, { type: "function", name: "funcB", file_path: "src/b.ts", start_line: 1, end_line: 5 });
    dbAttachCodeEntity(ctx.db!, { block_id: block1.id, code_entity_id: entity1.id, role: "owns" });
    dbAttachCodeEntity(ctx.db!, { block_id: block2.id, code_entity_id: entity2.id, role: "owns" });

    // Create ports and connector
    const port1 = dbCreatePort(ctx.db!, { block_id: block1.id, name: "out", direction: "out" });
    const port2 = dbCreatePort(ctx.db!, { block_id: block2.id, name: "in", direction: "in" });
    dbCreateConnector(ctx.db!, { source_port_id: port1.id, target_port_id: port2.id, protocol: "function_call" });

    // Create cross-block edge
    createCodeEdge(ctx.db!, { type: "calls", source_entity_id: entity1.id, target_entity_id: entity2.id });

    const result = handleConnectorAudit(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.unexplained_edges).toHaveLength(0);
  });

  it("does not report edges with unknown boundaries", () => {
    const block1 = dbCreateBlock(ctx.db!, { name: "Block A" });
    const block2 = dbCreateBlock(ctx.db!, { name: "Block B" });
    const entity1 = createCodeEntity(ctx.db!, { type: "function", name: "funcA", file_path: "src/a.ts", start_line: 1, end_line: 5 });
    const entity2 = createCodeEntity(ctx.db!, { type: "function", name: "funcB", file_path: "src/b.ts", start_line: 1, end_line: 5 });
    dbAttachCodeEntity(ctx.db!, { block_id: block1.id, code_entity_id: entity1.id, role: "owns" });
    dbAttachCodeEntity(ctx.db!, { block_id: block2.id, code_entity_id: entity2.id, role: "owns" });

    // Create unknown boundary
    createUnknownBoundary(ctx.db!, { related_entity_ids: [entity2.id], reason: "External dependency" });

    // Create cross-block edge
    createCodeEdge(ctx.db!, { type: "calls", source_entity_id: entity1.id, target_entity_id: entity2.id });

    const result = handleConnectorAudit(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.unexplained_edges).toHaveLength(0);
  });

  it("flags weak connectors without evidence", () => {
    const block1 = dbCreateBlock(ctx.db!, { name: "Block A" });
    const block2 = dbCreateBlock(ctx.db!, { name: "Block B" });
    const port1 = dbCreatePort(ctx.db!, { block_id: block1.id, name: "out", direction: "out" });
    const port2 = dbCreatePort(ctx.db!, { block_id: block2.id, name: "in", direction: "in" });
    dbCreateConnector(ctx.db!, { source_port_id: port1.id, target_port_id: port2.id, protocol: "function_call" });

    const result = handleConnectorAudit(ctx, {} as any);
    expect(result.ok).toBe(true);
    expect(result.data!.weak_connectors.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Flow Sufficiency Tests ─────────────────────────────────────────────────

describe("Flow Sufficiency Check", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fails for complex repo with no flows", () => {
    const result = handleFlowSufficiencyCheck(ctx, { complexity: "complex" });
    expect(result.ok).toBe(true);
    expect(result.data!.sufficient).toBe(false);
    expect(result.data!.required_flows).toBe(5);
  });

  it("passes for small repo with one flow", () => {
    const entity = createCodeEntity(ctx.db!, { type: "function", name: "entry", file_path: "src/entry.ts", start_line: 1, end_line: 5 });
    const block = dbCreateBlock(ctx.db!, { name: "Block" });
    dbCreateFlow(ctx.db!, { name: "Main Flow", entrypoint_entity_id: entity.id });

    const result = handleFlowSufficiencyCheck(ctx, { complexity: "small" });
    expect(result.ok).toBe(true);
    expect(result.data!.sufficient).toBe(true);
  });

  it("recommends missing flow types", () => {
    const result = handleFlowSufficiencyCheck(ctx, { complexity: "medium" });
    expect(result.ok).toBe(true);
    expect(result.data!.missing_flow_recommendations.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Quality Gate Report Tests ──────────────────────────────────────────────

describe("Quality Gate Report", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns not ready for empty repo", () => {
    const result = handleQualityGateReport(ctx, { complexity: "medium" });
    expect(result.ok).toBe(true);
    expect(result.data!.ready_for_maintenance).toBe(false);
  });

  it("returns not ready for low coverage", () => {
    // Create unmapped entities
    createCodeEntity(ctx.db!, { type: "function", name: "func1", file_path: "src/a.ts", start_line: 1, end_line: 5 });
    createCodeEntity(ctx.db!, { type: "function", name: "func2", file_path: "src/b.ts", start_line: 1, end_line: 5 });

    const result = handleQualityGateReport(ctx, { complexity: "medium" });
    expect(result.ok).toBe(true);
    expect(result.data!.ready_for_maintenance).toBe(false);
    expect(result.data!.errors.some(e => e.code === "LOW_COVERAGE")).toBe(true);
  });

  it("includes all quality checks", () => {
    const result = handleQualityGateReport(ctx, { complexity: "medium" });
    expect(result.ok).toBe(true);
    expect(result.data!.entity_coverage).toBeDefined();
    expect(result.data!.missing_feature_modules).toBeDefined();
    expect(result.data!.shared_dependency_candidates).toBeDefined();
    expect(result.data!.unexplained_cross_block_edges).toBeDefined();
    expect(result.data!.weak_connectors).toBeDefined();
    expect(result.data!.flow_count).toBeDefined();
  });
});
