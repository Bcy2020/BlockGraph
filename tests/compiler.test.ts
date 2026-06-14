/**
 * BlockGraph MCP v0.1 — Phase 4 Compiler Tests
 * PRD §13.1: Test compile, promote, graph compile, and snapshot paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { openStore, closeStore, deleteStore } from "../src/graph/store.js";
import {
  createBlock,
  createCodeEntity,
  createCodeEdge,
  attachCodeEntity,
  createPort,
  createConnector,
  createFlow,
  appendFlowStep,
  createUnknownBoundary,
  getBlock,
} from "../src/graph/draft.js";
import {
  compileDraftBlock,
  promoteDraftBlock,
  compileDraftGraph,
  commitSnapshot,
} from "../src/graph/compiler.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTestDb(): Database.Database {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-compiler-test-"));
  const db = openStore(tmpDir);
  (db as any).__tmpDir = tmpDir;
  return db;
}

/** Helper to delete with FK checks disabled, then re-enable. */
function deleteWithFkOff(db: Database.Database, sql: string, ...params: unknown[]) {
  db.pragma("foreign_keys = OFF");
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function cleanupDb(db: Database.Database) {
  const tmpDir = (db as any).__tmpDir;
  closeStore(db);
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function seedCodeEntity(db: Database.Database, overrides?: Partial<{ name: string; file_path: string }>) {
  return createCodeEntity(db, {
    type: "function",
    name: overrides?.name ?? "testFunc",
    file_path: overrides?.file_path ?? "src/test.ts",
    start_line: 1,
    end_line: 5,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Phase 4 — Compiler", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    cleanupDb(db);
  });

  // ── §9.13 compile_draft_block ─────────────────────────────────────────

  describe("compileDraftBlock", () => {
    it("rejects non-existent block", () => {
      const result = compileDraftBlock(db, "nonexistent");
      expect(result.can_promote).toBe(false);
      expect(result.errors[0].code).toBe("BLOCK_NOT_FOUND");
    });

    it("rejects block with empty name", () => {
      const block = createBlock(db, { name: "" });
      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.some((e) => e.code === "EMPTY_NAME")).toBe(true);
    });

    it("rejects block with empty purpose", () => {
      const block = createBlock(db, { name: "Block", purpose: "" });
      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.some((e) => e.code === "EMPTY_PURPOSE")).toBe(true);
    });

    it("allows root block with no code entity mapping", () => {
      const block = createBlock(db, { name: "Root", purpose: "root block" });
      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("rejects non-root block with no code entity mapping", () => {
      const parent = createBlock(db, { name: "Parent", purpose: "parent" });
      const child = createBlock(db, { name: "Child", purpose: "child", parent_id: parent.id });
      const result = compileDraftBlock(db, child.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.some((e) => e.code === "NO_CODE_MAPPING")).toBe(true);
    });

    it("rejects mapping with missing code entity", () => {
      const block = createBlock(db, { name: "Block", purpose: "test" });
      const entity = seedCodeEntity(db);
      // Create mapping, then delete the entity to simulate missing reference
      const mapping = attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 5 }],
      });
      deleteWithFkOff(db, `DELETE FROM code_entities WHERE id = ?`, entity.id);

      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_CODE_ENTITY")).toBe(true);
    });

    it("rejects invalid evidence (empty file_path)", () => {
      const block = createBlock(db, { name: "Block", purpose: "test" });
      const entity = seedCodeEntity(db);
      attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "", start_line: 1, end_line: 5 }],
      });

      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_EVIDENCE")).toBe(true);
    });

    it("rejects invalid evidence (end_line < start_line)", () => {
      const block = createBlock(db, { name: "Block", purpose: "test" });
      const entity = seedCodeEntity(db);
      attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 10, end_line: 5 }],
      });

      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.some((e) => e.code === "INVALID_EVIDENCE")).toBe(true);
    });

    it("warns on low confidence", () => {
      const block = createBlock(db, { name: "Block", purpose: "test", confidence: 0.3 });
      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(true);
      expect(result.warnings.some((w) => w.code === "LOW_CONFIDENCE")).toBe(true);
    });

    it("valid block passes compile", () => {
      const block = createBlock(db, { name: "Block", purpose: "test" });
      const entity = seedCodeEntity(db);
      attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 5 }],
      });

      const result = compileDraftBlock(db, block.id);
      expect(result.can_promote).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  // ── §9.14 promote_draft_block ─────────────────────────────────────────

  describe("promoteDraftBlock", () => {
    it("fails if compile has errors", () => {
      const parent = createBlock(db, { name: "Parent", purpose: "parent" });
      const child = createBlock(db, { name: "Child", purpose: "child", parent_id: parent.id });

      const result = promoteDraftBlock(db, child.id);
      expect(result.can_promote).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // Block should still be draft
      const block = getBlock(db, child.id);
      expect(block!.status).toBe("draft");
    });

    it("promotes valid block to accepted", () => {
      const block = createBlock(db, { name: "Block", purpose: "test" });
      const entity = seedCodeEntity(db);
      attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 5 }],
      });

      const result = promoteDraftBlock(db, block.id);
      expect(result.can_promote).toBe(true);

      const promoted = getBlock(db, block.id);
      expect(promoted!.status).toBe("accepted");
    });
  });

  // ── §9.15 compile_draft_graph ─────────────────────────────────────────

  describe("compileDraftGraph", () => {
    it("empty graph compiles with warnings (no flows)", () => {
      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(true);
      expect(result.warnings.some((w) => w.code === "NO_FLOWS")).toBe(true);
    });

    it("rejects non-root block without mapping", () => {
      const parent = createBlock(db, { name: "Parent", purpose: "root" });
      createBlock(db, { name: "Child", purpose: "child", parent_id: parent.id });

      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(false);
      expect(result.errors.some((e) => e.code === "NO_CODE_MAPPING")).toBe(true);
    });

    it("rejects connector with missing port", () => {
      const blockA = createBlock(db, { name: "A", purpose: "a" });
      const portA = createPort(db, { block_id: blockA.id, name: "out", direction: "out" });
      const blockB = createBlock(db, { name: "B", purpose: "b" });
      const portB = createPort(db, { block_id: blockB.id, name: "in", direction: "in" });

      // Create connector, then delete one port
      const connector = createConnector(db, {
        source_port_id: portA.id,
        target_port_id: portB.id,
      });
      deleteWithFkOff(db, `DELETE FROM ports WHERE id = ?`, portB.id);

      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_PORT")).toBe(true);
    });

    it("rejects flow step with missing code entity", () => {
      const epEntity = seedCodeEntity(db, { name: "ep" });
      const stepEntity = seedCodeEntity(db, { name: "stepFunc" });
      const flow = createFlow(db, { name: "Flow", entrypoint_entity_id: epEntity.id });
      const block = createBlock(db, { name: "Block", purpose: "test" });

      // Create flow step, then delete the code entity
      const step = appendFlowStep(db, {
        flow_id: flow.id,
        block_id: block.id,
        code_entity_id: stepEntity.id,
        trigger: "click",
      });
      deleteWithFkOff(db, `DELETE FROM code_entities WHERE id = ?`, stepEntity.id);

      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_CODE_ENTITY")).toBe(true);
    });

    it("rejects flow with missing entrypoint entity", () => {
      const epEntity = seedCodeEntity(db, { name: "ep" });
      // Create flow, then delete the entrypoint entity
      const flow = createFlow(db, { name: "Flow", entrypoint_entity_id: epEntity.id });
      deleteWithFkOff(db, `DELETE FROM code_entities WHERE id = ?`, epEntity.id);

      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(false);
      expect(result.errors.some((e) => e.code === "MISSING_CODE_ENTITY")).toBe(true);
    });

    it("warns about unpromoted drafts", () => {
      createBlock(db, { name: "Draft", purpose: "test" });
      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(true);
      expect(result.warnings.some((w) => w.code === "UNPROMOTED_DRAFTS")).toBe(true);
    });

    it("valid graph with flow compiles", () => {
      const entity = seedCodeEntity(db);
      const epEntity = seedCodeEntity(db, { name: "ep" });
      const block = createBlock(db, { name: "Block", purpose: "test" });
      attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 5 }],
      });
      createFlow(db, { name: "Flow", entrypoint_entity_id: epEntity.id });

      const result = compileDraftGraph(db);
      expect(result.can_commit).toBe(true);
      expect(result.errors.length).toBe(0);
    });
  });

  // ── §9.16 commit_snapshot ─────────────────────────────────────────────

  describe("commitSnapshot", () => {
    it("fails if git_sha is empty", () => {
      const result = commitSnapshot(db, "");
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe("INVALID_INPUT");
    });

    it("fails if graph has compile errors", () => {
      const parent = createBlock(db, { name: "Parent", purpose: "root" });
      createBlock(db, { name: "Child", purpose: "child", parent_id: parent.id });

      const result = commitSnapshot(db, "abc123");
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("creates snapshot for valid graph", () => {
      const entity = seedCodeEntity(db);
      const epEntity = seedCodeEntity(db, { name: "ep" });
      const block = createBlock(db, { name: "Block", purpose: "test" });
      attachCodeEntity(db, {
        block_id: block.id,
        code_entity_id: entity.id,
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 5 }],
      });
      createFlow(db, { name: "Flow", entrypoint_entity_id: epEntity.id });

      const result = commitSnapshot(db, "abc123def456");
      expect(result.ok).toBe(true);
      expect(result.snapshot_id).toBeTruthy();
    });
  });
});
