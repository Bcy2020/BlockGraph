/**
 * BlockGraph MCP v0.1 — Phase 2 Tool Handler Tests
 * Tests all tool handlers directly (no MCP client needed) per PRD Phase 2 validation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { closeStore } from "../src/graph/store.js";
import {
  createCodeEntity,
  createBlock as dbCreateBlock,
  createFlow as dbCreateFlow,
} from "../src/graph/draft.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleScanRepo,
  handleCreateBlock,
  handleAttachCodeEntity,
  handleCreatePort,
  handleConnectPorts,
  handleCreateFlow,
  handleAppendFlowStep,
  handleMarkUnknownBoundary,
  handleQueryBlock,
  handleQuerySymbolsByBlock,
  handleSuggestBlockCandidates,
  handleListCodeEntities,
  handleListCodeEdges,
  handleCompileDraftBlock,
  handlePromoteDraftBlock,
  handleCompileDraftGraph,
  handleCommitSnapshot,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-auth");

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-test-"));
}

function makeCtx(): ToolContext {
  return { db: null, repoPath: null };
}

function makeInitializedCtx(customTmpDir?: string): ToolContext {
  const ctx = makeCtx();
  const tmpDir = customTmpDir ?? makeTempDir();
  handleBeginInitialization(ctx, { repo_path: tmpDir });
  return ctx;
}

/** Insert a code entity directly into the DB for test setup. */
function seedCodeEntity(db: Database.Database, overrides?: Partial<{ type: string; name: string; file_path: string }>) {
  return createCodeEntity(db, {
    type: (overrides?.type as any) ?? "function",
    name: overrides?.name ?? "testFunc",
    file_path: overrides?.file_path ?? "src/test.ts",
    start_line: 1,
    end_line: 5,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Phase 2 — MCP Tool Handlers", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    // Cleanup temp dirs
    for (const dir of tempDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tempDirs = [];
  });

  // ── §9.1 begin_initialization ─────────────────────────────────────────

  describe("begin_initialization", () => {
    it("success: creates session for valid repo path", () => {
      const ctx = makeCtx();
      const tmpDir = makeTempDir();
      tempDirs.push(tmpDir);

      const result = handleBeginInitialization(ctx, { repo_path: tmpDir });
      expect(result.ok).toBe(true);
      expect(result.data!.repo_path).toBe(path.resolve(tmpDir));
      expect(result.data!.session_id).toBeTruthy();
      expect(ctx.db).not.toBeNull();
      expect(ctx.repoPath).toBe(path.resolve(tmpDir));
    });

    it("failure: empty repo_path", () => {
      const ctx = makeCtx();
      const result = handleBeginInitialization(ctx, { repo_path: "" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: non-existent path", () => {
      const ctx = makeCtx();
      const result = handleBeginInitialization(ctx, { repo_path: "/nonexistent/path/xyz" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("PATH_NOT_FOUND");
    });

    it("failure: path is file not directory", () => {
      const tmpDir = makeTempDir();
      tempDirs.push(tmpDir);
      const tmpFile = path.join(tmpDir, "file.txt");
      fs.writeFileSync(tmpFile, "test");

      const ctx = makeCtx();
      const result = handleBeginInitialization(ctx, { repo_path: tmpFile });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NOT_DIRECTORY");
    });

    it("success: re-initialization closes old session", () => {
      const ctx = makeCtx();
      const tmpDir1 = makeTempDir();
      const tmpDir2 = makeTempDir();
      tempDirs.push(tmpDir1, tmpDir2);

      handleBeginInitialization(ctx, { repo_path: tmpDir1 });
      const firstDb = ctx.db;

      handleBeginInitialization(ctx, { repo_path: tmpDir2 });
      expect(ctx.db).not.toBe(firstDb);
    });
  });

  // ── §9.6 create_block ─────────────────────────────────────────────────

  describe("create_block", () => {
    it("success: create root block", () => {
      const ctx = makeInitializedCtx();

      const result = handleCreateBlock(ctx, { name: "Auth Feature" });
      expect(result.ok).toBe(true);
      expect(result.data!.block_id).toBeTruthy();
      expect(result.data!.status).toBe("draft");
    });

    it("success: create child block with valid parent", () => {
      const ctx = makeInitializedCtx();
      const parent = handleCreateBlock(ctx, { name: "Root" });

      const result = handleCreateBlock(ctx, { name: "Child", parent_id: parent.data!.block_id });
      expect(result.ok).toBe(true);
      expect(result.data!.status).toBe("draft");
    });

    it("failure: parent_id references non-existent block", () => {
      const ctx = makeInitializedCtx();
      const result = handleCreateBlock(ctx, { name: "Child", parent_id: "nonexistent-id" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("PARENT_NOT_FOUND");
    });

    it("failure: empty name", () => {
      const ctx = makeInitializedCtx();
      const result = handleCreateBlock(ctx, { name: "" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleCreateBlock(ctx, { name: "Block" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.7 attach_code_entity ───────────────────────────────────────────

  describe("attach_code_entity", () => {
    it("success: attach with evidence", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
        role: "owns",
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 5, note: "test" }],
      });
      expect(result.ok).toBe(true);
      expect(result.data!.mapping_id).toBeTruthy();
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);

      const result = handleAttachCodeEntity(ctx, {
        block_id: "nonexistent",
        code_entity_id: entity.id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "BLOCK_NOT_FOUND")).toBe(true);
    });

    it("failure: code entity not found", () => {
      const ctx = makeInitializedCtx();
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: "nonexistent",
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "ENTITY_NOT_FOUND")).toBe(true);
    });

    it("failure: invalid evidence — empty file_path", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "", start_line: 1, end_line: 5 }],
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "INVALID_EVIDENCE")).toBe(true);
    });

    it("failure: invalid evidence — end_line < start_line", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 10, end_line: 5 }],
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "INVALID_EVIDENCE")).toBe(true);
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleAttachCodeEntity(ctx, {
        block_id: "b",
        code_entity_id: "e",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.8 create_port ──────────────────────────────────────────────────

  describe("create_port", () => {
    it("success: create in port", () => {
      const ctx = makeInitializedCtx();
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleCreatePort(ctx, {
        block_id: block.data!.block_id,
        name: "loginRequest",
        direction: "in",
        contract: "accepts credentials",
      });
      expect(result.ok).toBe(true);
      expect(result.data!.port_id).toBeTruthy();
    });

    it("success: create out port", () => {
      const ctx = makeInitializedCtx();
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleCreatePort(ctx, {
        block_id: block.data!.block_id,
        name: "httpRequest",
        direction: "out",
      });
      expect(result.ok).toBe(true);
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const result = handleCreatePort(ctx, {
        block_id: "nonexistent",
        name: "port",
        direction: "in",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("BLOCK_NOT_FOUND");
    });

    it("failure: invalid direction", () => {
      const ctx = makeInitializedCtx();
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleCreatePort(ctx, {
        block_id: block.data!.block_id,
        name: "port",
        direction: "sideways" as any,
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleCreatePort(ctx, {
        block_id: "b",
        name: "p",
        direction: "in",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.9 connect_ports ────────────────────────────────────────────────

  describe("connect_ports", () => {
    it("success: connect out -> in with evidence", () => {
      const ctx = makeInitializedCtx();
      const blockA = handleCreateBlock(ctx, { name: "A" });
      const blockB = handleCreateBlock(ctx, { name: "B" });
      const srcPort = handleCreatePort(ctx, {
        block_id: blockA.data!.block_id,
        name: "out",
        direction: "out",
      });
      const tgtPort = handleCreatePort(ctx, {
        block_id: blockB.data!.block_id,
        name: "in",
        direction: "in",
      });

      const result = handleConnectPorts(ctx, {
        source_port_id: srcPort.data!.port_id,
        target_port_id: tgtPort.data!.port_id,
        protocol: "function_call",
        evidence: [{ file_path: "src/a.ts", start_line: 1, end_line: 3 }],
      });
      expect(result.ok).toBe(true);
      expect(result.data!.connector_id).toBeTruthy();
    });

    it("failure: source port not found", () => {
      const ctx = makeInitializedCtx();
      const blockB = handleCreateBlock(ctx, { name: "B" });
      const tgtPort = handleCreatePort(ctx, {
        block_id: blockB.data!.block_id,
        name: "in",
        direction: "in",
      });

      const result = handleConnectPorts(ctx, {
        source_port_id: "nonexistent",
        target_port_id: tgtPort.data!.port_id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "PORT_NOT_FOUND")).toBe(true);
    });

    it("failure: target port not found", () => {
      const ctx = makeInitializedCtx();
      const blockA = handleCreateBlock(ctx, { name: "A" });
      const srcPort = handleCreatePort(ctx, {
        block_id: blockA.data!.block_id,
        name: "out",
        direction: "out",
      });

      const result = handleConnectPorts(ctx, {
        source_port_id: srcPort.data!.port_id,
        target_port_id: "nonexistent",
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "PORT_NOT_FOUND")).toBe(true);
    });

    it("failure: source port has wrong direction (in instead of out)", () => {
      const ctx = makeInitializedCtx();
      const blockA = handleCreateBlock(ctx, { name: "A" });
      const blockB = handleCreateBlock(ctx, { name: "B" });
      const srcPort = handleCreatePort(ctx, {
        block_id: blockA.data!.block_id,
        name: "in",
        direction: "in",
      });
      const tgtPort = handleCreatePort(ctx, {
        block_id: blockB.data!.block_id,
        name: "in",
        direction: "in",
      });

      const result = handleConnectPorts(ctx, {
        source_port_id: srcPort.data!.port_id,
        target_port_id: tgtPort.data!.port_id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "INVALID_PORT_DIRECTION")).toBe(true);
    });

    it("failure: target port has wrong direction (out instead of in)", () => {
      const ctx = makeInitializedCtx();
      const blockA = handleCreateBlock(ctx, { name: "A" });
      const blockB = handleCreateBlock(ctx, { name: "B" });
      const srcPort = handleCreatePort(ctx, {
        block_id: blockA.data!.block_id,
        name: "out",
        direction: "out",
      });
      const tgtPort = handleCreatePort(ctx, {
        block_id: blockB.data!.block_id,
        name: "out",
        direction: "out",
      });

      const result = handleConnectPorts(ctx, {
        source_port_id: srcPort.data!.port_id,
        target_port_id: tgtPort.data!.port_id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "INVALID_PORT_DIRECTION")).toBe(true);
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleConnectPorts(ctx, {
        source_port_id: "s",
        target_port_id: "t",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.10 create_flow ─────────────────────────────────────────────────

  describe("create_flow", () => {
    it("success: create with valid entrypoint", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!, { type: "event_handler", name: "onSubmit" });

      const result = handleCreateFlow(ctx, {
        name: "Submit Login",
        entrypoint_entity_id: entity.id,
      });
      expect(result.ok).toBe(true);
      expect(result.data!.flow_id).toBeTruthy();
      expect(result.data!.status).toBe("draft");
    });

    it("failure: entrypoint entity not found", () => {
      const ctx = makeInitializedCtx();
      const result = handleCreateFlow(ctx, {
        name: "Flow",
        entrypoint_entity_id: "nonexistent",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("ENTITY_NOT_FOUND");
    });

    it("failure: empty name", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);

      const result = handleCreateFlow(ctx, {
        name: "",
        entrypoint_entity_id: entity.id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleCreateFlow(ctx, {
        name: "Flow",
        entrypoint_entity_id: "e",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.11 append_flow_step ────────────────────────────────────────────

  describe("append_flow_step", () => {
    it("success: append step with auto-computed order", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const block = handleCreateBlock(ctx, { name: "Block" });
      const epEntity = seedCodeEntity(ctx.db!, { type: "component", name: "App" });
      const flow = handleCreateFlow(ctx, { name: "Flow", entrypoint_entity_id: epEntity.id });

      const step1 = handleAppendFlowStep(ctx, {
        flow_id: flow.data!.flow_id,
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
        trigger: "click",
      });
      expect(step1.ok).toBe(true);
      expect(step1.data!.order).toBe(1);

      const step2 = handleAppendFlowStep(ctx, {
        flow_id: flow.data!.flow_id,
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
        trigger: "submit",
      });
      expect(step2.ok).toBe(true);
      expect(step2.data!.order).toBe(2);
    });

    it("failure: flow not found", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const block = handleCreateBlock(ctx, { name: "Block" });

      const result = handleAppendFlowStep(ctx, {
        flow_id: "nonexistent",
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "FLOW_NOT_FOUND")).toBe(true);
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const epEntity = seedCodeEntity(ctx.db!, { type: "component", name: "App" });
      const flow = handleCreateFlow(ctx, { name: "Flow", entrypoint_entity_id: epEntity.id });

      const result = handleAppendFlowStep(ctx, {
        flow_id: flow.data!.flow_id,
        block_id: "nonexistent",
        code_entity_id: entity.id,
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "BLOCK_NOT_FOUND")).toBe(true);
    });

    it("failure: code entity not found", () => {
      const ctx = makeInitializedCtx();
      const block = handleCreateBlock(ctx, { name: "Block" });
      const epEntity = seedCodeEntity(ctx.db!, { type: "component", name: "App" });
      const flow = handleCreateFlow(ctx, { name: "Flow", entrypoint_entity_id: epEntity.id });

      const result = handleAppendFlowStep(ctx, {
        flow_id: flow.data!.flow_id,
        block_id: block.data!.block_id,
        code_entity_id: "nonexistent",
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "ENTITY_NOT_FOUND")).toBe(true);
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleAppendFlowStep(ctx, {
        flow_id: "f",
        block_id: "b",
        code_entity_id: "e",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.12 mark_unknown_boundary ───────────────────────────────────────

  describe("mark_unknown_boundary", () => {
    it("success: mark with entities and reason", () => {
      const ctx = makeInitializedCtx();
      const entity1 = seedCodeEntity(ctx.db!, { name: "e1" });
      const entity2 = seedCodeEntity(ctx.db!, { name: "e2" });

      const result = handleMarkUnknownBoundary(ctx, {
        related_entity_ids: [entity1.id, entity2.id],
        reason: "Cannot determine interaction pattern",
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 10 }],
      });
      expect(result.ok).toBe(true);
      expect(result.data!.boundary_id).toBeTruthy();
    });

    it("failure: empty related_entity_ids", () => {
      const ctx = makeInitializedCtx();
      const result = handleMarkUnknownBoundary(ctx, {
        related_entity_ids: [],
        reason: "test",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: empty reason", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);

      const result = handleMarkUnknownBoundary(ctx, {
        related_entity_ids: [entity.id],
        reason: "",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: related entity not found", () => {
      const ctx = makeInitializedCtx();
      const result = handleMarkUnknownBoundary(ctx, {
        related_entity_ids: ["nonexistent"],
        reason: "test",
      });
      expect(result.ok).toBe(false);
      expect(result.errors!.some((e) => e.code === "ENTITY_NOT_FOUND")).toBe(true);
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleMarkUnknownBoundary(ctx, {
        related_entity_ids: ["e"],
        reason: "r",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.17 query_block ─────────────────────────────────────────────────

  describe("query_block", () => {
    it("success: query with full data", () => {
      const ctx = makeInitializedCtx();
      const entity = seedCodeEntity(ctx.db!);
      const block = handleCreateBlock(ctx, { name: "Block" });
      handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
      });
      const inPort = handleCreatePort(ctx, {
        block_id: block.data!.block_id,
        name: "in",
        direction: "in",
      });
      const outPort = handleCreatePort(ctx, {
        block_id: block.data!.block_id,
        name: "out",
        direction: "out",
      });
      handleConnectPorts(ctx, {
        source_port_id: outPort.data!.port_id,
        target_port_id: inPort.data!.port_id,
      });
      const epEntity = seedCodeEntity(ctx.db!, { type: "component", name: "App" });
      const flow = handleCreateFlow(ctx, { name: "Flow", entrypoint_entity_id: epEntity.id });
      handleAppendFlowStep(ctx, {
        flow_id: flow.data!.flow_id,
        block_id: block.data!.block_id,
        code_entity_id: entity.id,
      });

      const result = handleQueryBlock(ctx, { block_id: block.data!.block_id });
      expect(result.ok).toBe(true);
      expect(result.data!.block.name).toBe("Block");
      expect(result.data!.ports.length).toBe(2);
      expect(result.data!.mappings.length).toBe(1);
      expect(result.data!.connectors.length).toBe(1);
      expect(result.data!.flow_steps.length).toBe(1);
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const result = handleQueryBlock(ctx, { block_id: "nonexistent" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("BLOCK_NOT_FOUND");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleQueryBlock(ctx, { block_id: "b" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── §9.18 query_symbols_by_block ──────────────────────────────────────

  describe("query_symbols_by_block", () => {
    it("success: query with mappings", () => {
      const ctx = makeInitializedCtx();
      const entity1 = seedCodeEntity(ctx.db!, { name: "func1" });
      const entity2 = seedCodeEntity(ctx.db!, { name: "func2" });
      const block = handleCreateBlock(ctx, { name: "Block" });
      handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entity1.id,
      });
      handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entity2.id,
        role: "uses",
      });

      const result = handleQuerySymbolsByBlock(ctx, { block_id: block.data!.block_id });
      expect(result.ok).toBe(true);
      expect(result.data!.entities.length).toBe(2);
      const names = result.data!.entities.map((e) => e.name).sort();
      expect(names).toEqual(["func1", "func2"]);
    });

    it("success: block with no mappings returns empty", () => {
      const ctx = makeInitializedCtx();
      const block = handleCreateBlock(ctx, { name: "Empty" });

      const result = handleQuerySymbolsByBlock(ctx, { block_id: block.data!.block_id });
      expect(result.ok).toBe(true);
      expect(result.data!.entities.length).toBe(0);
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const result = handleQuerySymbolsByBlock(ctx, { block_id: "nonexistent" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("BLOCK_NOT_FOUND");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleQuerySymbolsByBlock(ctx, { block_id: "b" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── suggest_block_candidates ────────────────────────────────────────────

  describe("handleSuggestBlockCandidates", () => {
    const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-auth");

    function makeScannedCtx(): ToolContext {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-suggest-test-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx: ToolContext = { db: null, repoPath: null };
      handleBeginInitialization(ctx, { repo_path: fixtureCopy });
      handleScanRepo(ctx, { repo_path: fixtureCopy });
      return ctx;
    }

    it("success: directory strategy groups by top-level dir", () => {
      const ctx = makeScannedCtx();
      const result = handleSuggestBlockCandidates(ctx, { strategy: "directory" });
      expect(result.ok).toBe(true);
      expect(result.data!.candidates.length).toBeGreaterThan(0);
      const names = result.data!.candidates.map((c) => c.name);
      expect(names).toContain("src");
    });

    it("success: component strategy groups by React component", () => {
      const ctx = makeScannedCtx();
      const result = handleSuggestBlockCandidates(ctx, { strategy: "component" });
      expect(result.ok).toBe(true);
      expect(result.data!.candidates.length).toBeGreaterThan(0);
      const names = result.data!.candidates.map((c) => c.name);
      expect(names).toContain("LoginForm");
    });

    it("success: route strategy groups by routes/ directory", () => {
      const ctx = makeScannedCtx();
      const result = handleSuggestBlockCandidates(ctx, { strategy: "route" });
      expect(result.ok).toBe(true);
      expect(result.data!.candidates.length).toBeGreaterThan(0);
      const names = result.data!.candidates.map((c) => c.name);
      expect(names.some((n) => n.includes("routes"))).toBe(true);
    });

    it("success: mixed strategy combines all heuristics", () => {
      const ctx = makeScannedCtx();
      const result = handleSuggestBlockCandidates(ctx, { strategy: "mixed" });
      expect(result.ok).toBe(true);
      // mixed should have more candidates than any single strategy
      const dirResult = handleSuggestBlockCandidates(ctx, { strategy: "directory" });
      expect(result.data!.candidates.length).toBeGreaterThanOrEqual(dirResult.data!.candidates.length);
    });

    it("success: default strategy is mixed", () => {
      const ctx = makeScannedCtx();
      const result = handleSuggestBlockCandidates(ctx, {});
      expect(result.ok).toBe(true);
      const mixedResult = handleSuggestBlockCandidates(ctx, { strategy: "mixed" });
      expect(result.data!.candidates.length).toBe(mixedResult.data!.candidates.length);
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleSuggestBlockCandidates(ctx, {});
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── list_code_entities ─────────────────────────────────────────────────

  describe("handleListCodeEntities", () => {
    it("success: returns entities after scan", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-list-ent-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx = makeInitializedCtx(tmpDir);
      handleScanRepo(ctx, { repo_path: fixtureCopy });

      const result = handleListCodeEntities(ctx, {});
      expect(result.ok).toBe(true);
      expect(result.data!.entities.length).toBeGreaterThan(0);
    });

    it("success: filter by type", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-list-ent-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx = makeInitializedCtx(tmpDir);
      handleScanRepo(ctx, { repo_path: fixtureCopy });

      const result = handleListCodeEntities(ctx, { filter: { type: "component" } });
      expect(result.ok).toBe(true);
      for (const e of result.data!.entities) {
        expect(e.type).toBe("component");
      }
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleListCodeEntities(ctx, {});
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── list_code_edges ────────────────────────────────────────────────────

  describe("handleListCodeEdges", () => {
    it("success: returns edges after scan", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-list-edge-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx = makeInitializedCtx(tmpDir);
      handleScanRepo(ctx, { repo_path: fixtureCopy });

      const result = handleListCodeEdges(ctx, {});
      expect(result.ok).toBe(true);
      expect(result.data!.edges.length).toBeGreaterThan(0);
    });

    it("success: filter by type", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-list-edge-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx = makeInitializedCtx(tmpDir);
      handleScanRepo(ctx, { repo_path: fixtureCopy });

      const result = handleListCodeEdges(ctx, { filter: { type: "imports" } });
      expect(result.ok).toBe(true);
      for (const e of result.data!.edges) {
        expect(e.type).toBe("imports");
      }
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleListCodeEdges(ctx, {});
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── compile_draft_block ────────────────────────────────────────────────

  describe("handleCompileDraftBlock", () => {
    it("success: compiles a valid block", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-compile-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx = makeInitializedCtx(tmpDir);
      handleScanRepo(ctx, { repo_path: fixtureCopy });
      const block = handleCreateBlock(ctx, { name: "Test", purpose: "Test block" });
      const entities = handleListCodeEntities(ctx, {});
      handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entities.data!.entities[0].id,
        role: "owns",
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 10 }],
      });

      const result = handleCompileDraftBlock(ctx, { block_id: block.data!.block_id });
      expect(result.ok).toBe(true);
      expect(result.data!.can_promote).toBe(true);
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const result = handleCompileDraftBlock(ctx, { block_id: "nonexistent" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("BLOCK_NOT_FOUND");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleCompileDraftBlock(ctx, { block_id: "b" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── promote_draft_block ────────────────────────────────────────────────

  describe("handlePromoteDraftBlock", () => {
    it("success: promotes a valid block", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-promote-"));
      const fixtureCopy = path.join(tmpDir, "repo");
      fs.cpSync(FIXTURE_PATH, fixtureCopy, {
        recursive: true,
        filter: (src) => !src.includes(".blockgraph"),
      });
      const ctx = makeInitializedCtx(tmpDir);
      handleScanRepo(ctx, { repo_path: fixtureCopy });
      const block = handleCreateBlock(ctx, { name: "Test", purpose: "Test block" });
      const entities = handleListCodeEntities(ctx, {});
      handleAttachCodeEntity(ctx, {
        block_id: block.data!.block_id,
        code_entity_id: entities.data!.entities[0].id,
        role: "owns",
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 10 }],
      });

      const result = handlePromoteDraftBlock(ctx, { block_id: block.data!.block_id });
      expect(result.ok).toBe(true);
      expect(result.data!.status).toBe("accepted");
    });

    it("failure: block not found", () => {
      const ctx = makeInitializedCtx();
      const result = handlePromoteDraftBlock(ctx, { block_id: "nonexistent" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("BLOCK_NOT_FOUND");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handlePromoteDraftBlock(ctx, { block_id: "b" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── compile_draft_graph ────────────────────────────────────────────────

  describe("handleCompileDraftGraph", () => {
    it("success: compiles empty graph", () => {
      const ctx = makeInitializedCtx();
      const result = handleCompileDraftGraph(ctx, {});
      expect(result.ok).toBe(true);
      expect(result.data!.can_commit).toBe(true);
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleCompileDraftGraph(ctx, {});
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  // ── commit_snapshot ────────────────────────────────────────────────────

  describe("handleCommitSnapshot", () => {
    it("success: commits snapshot on clean graph", () => {
      const ctx = makeInitializedCtx();
      const result = handleCommitSnapshot(ctx, { git_sha: "abc123" });
      expect(result.ok).toBe(true);
      expect(result.data!.snapshot_id).toBeTruthy();
    });

    it("failure: empty git_sha", () => {
      const ctx = makeInitializedCtx();
      const result = handleCommitSnapshot(ctx, { git_sha: "" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("failure: no session", () => {
      const ctx = makeCtx();
      const result = handleCommitSnapshot(ctx, { git_sha: "abc" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });
});
