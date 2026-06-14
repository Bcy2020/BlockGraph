/**
 * BlockGraph MCP v0.1 — Graph CRUD Unit Tests
 * Tests all CRUD service functions against an in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  createCodeEntity,
  getCodeEntity,
  listCodeEntities,
  deleteCodeEntity,
  createCodeEdge,
  getCodeEdge,
  listCodeEdges,
  deleteCodeEdge,
  createBlock,
  getBlock,
  listBlocks,
  updateBlockStatus,
  deleteBlock,
  attachCodeEntity,
  getBlockCodeMapping,
  listBlockCodeMappings,
  deleteBlockCodeMapping,
  createPort,
  getPort,
  listPorts,
  deletePort,
  createConnector,
  getConnector,
  listConnectors,
  deleteConnector,
  createFlow,
  getFlow,
  listFlows,
  updateFlowStatus,
  deleteFlow,
  appendFlowStep,
  getFlowStep,
  listFlowSteps,
  deleteFlowStep,
  createUnknownBoundary,
  getUnknownBoundary,
  listUnknownBoundaries,
  deleteUnknownBoundary,
  createSnapshot,
  getSnapshot,
  listSnapshots,
} from "../src/graph/draft.js";

// Use in-memory SQLite for tests (no initTables needed — we create tables inline)
function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS code_edges (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (source_entity_id) REFERENCES code_entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES code_entities(id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      confidence REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (parent_id) REFERENCES blocks(id)
    );
    CREATE TABLE IF NOT EXISTS block_code_mappings (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      code_entity_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owns',
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (block_id) REFERENCES blocks(id),
      FOREIGN KEY (code_entity_id) REFERENCES code_entities(id)
    );
    CREATE TABLE IF NOT EXISTS ports (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      name TEXT NOT NULL,
      direction TEXT NOT NULL,
      contract TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (block_id) REFERENCES blocks(id)
    );
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      source_port_id TEXT NOT NULL,
      target_port_id TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'unknown',
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (source_port_id) REFERENCES ports(id),
      FOREIGN KEY (target_port_id) REFERENCES ports(id)
    );
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entrypoint_entity_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      FOREIGN KEY (entrypoint_entity_id) REFERENCES code_entities(id)
    );
    CREATE TABLE IF NOT EXISTS flow_steps (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      block_id TEXT NOT NULL,
      code_entity_id TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (flow_id) REFERENCES flows(id),
      FOREIGN KEY (block_id) REFERENCES blocks(id),
      FOREIGN KEY (code_entity_id) REFERENCES code_entities(id)
    );
    CREATE TABLE IF NOT EXISTS unknown_boundaries (
      id TEXT PRIMARY KEY,
      related_entity_ids TEXT NOT NULL DEFAULT '[]',
      reason TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft'
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      git_sha TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_graph_version TEXT NOT NULL
    );
  `);
  return db;
}

describe("CodeEntity CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create and retrieve a code entity", () => {
    const entity = createCodeEntity(db, {
      type: "component",
      name: "LoginForm",
      file_path: "src/LoginForm.tsx",
      start_line: 1,
      end_line: 50,
    });
    expect(entity.id).toBeDefined();
    expect(entity.type).toBe("component");
    expect(entity.name).toBe("LoginForm");

    const retrieved = getCodeEntity(db, entity.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("LoginForm");
    expect(retrieved!.file_path).toBe("src/LoginForm.tsx");
  });

  it("should list code entities with filter", () => {
    createCodeEntity(db, { type: "component", name: "A", file_path: "a.tsx", start_line: 1, end_line: 10 });
    createCodeEntity(db, { type: "function", name: "B", file_path: "b.ts", start_line: 1, end_line: 5 });
    createCodeEntity(db, { type: "component", name: "C", file_path: "c.tsx", start_line: 1, end_line: 20 });

    const all = listCodeEntities(db);
    expect(all).toHaveLength(3);

    const components = listCodeEntities(db, { type: "component" });
    expect(components).toHaveLength(2);

    const byFile = listCodeEntities(db, { file_path: "b.ts" });
    expect(byFile).toHaveLength(1);
    expect(byFile[0].name).toBe("B");

    const byName = listCodeEntities(db, { name_contains: "Log" });
    expect(byName).toHaveLength(0);
  });

  it("should return null for non-existent code entity", () => {
    expect(getCodeEntity(db, "nonexistent")).toBeNull();
  });

  it("should delete a code entity", () => {
    const entity = createCodeEntity(db, { type: "function", name: "fn", file_path: "f.ts", start_line: 1, end_line: 3 });
    expect(deleteCodeEntity(db, entity.id)).toBe(true);
    expect(getCodeEntity(db, entity.id)).toBeNull();
  });
});

describe("CodeEdge CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create and retrieve a code edge", () => {
    const src = createCodeEntity(db, { type: "file", name: "a.ts", file_path: "a.ts", start_line: 1, end_line: 1 });
    const tgt = createCodeEntity(db, { type: "file", name: "b.ts", file_path: "b.ts", start_line: 1, end_line: 1 });

    const edge = createCodeEdge(db, {
      type: "imports",
      source_entity_id: src.id,
      target_entity_id: tgt.id,
      confidence: 0.9,
    });

    expect(edge.id).toBeDefined();
    expect(edge.type).toBe("imports");
    expect(edge.confidence).toBe(0.9);

    const retrieved = getCodeEdge(db, edge.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.source_entity_id).toBe(src.id);
    expect(retrieved!.target_entity_id).toBe(tgt.id);
  });

  it("should create edge with null target", () => {
    const src = createCodeEntity(db, { type: "file", name: "a.ts", file_path: "a.ts", start_line: 1, end_line: 1 });
    const edge = createCodeEdge(db, {
      type: "calls",
      source_entity_id: src.id,
      target_entity_id: null,
    });
    expect(edge.target_entity_id).toBeNull();
  });

  it("should list edges with filter", () => {
    const a = createCodeEntity(db, { type: "file", name: "a.ts", file_path: "a.ts", start_line: 1, end_line: 1 });
    const b = createCodeEntity(db, { type: "file", name: "b.ts", file_path: "b.ts", start_line: 1, end_line: 1 });
    createCodeEdge(db, { type: "imports", source_entity_id: a.id, target_entity_id: b.id });
    createCodeEdge(db, { type: "calls", source_entity_id: a.id, target_entity_id: b.id });

    const imports = listCodeEdges(db, { type: "imports" });
    expect(imports).toHaveLength(1);
  });
});

describe("Block CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create a draft block", () => {
    const block = createBlock(db, { name: "Auth Feature", purpose: "Handles authentication" });
    expect(block.id).toBeDefined();
    expect(block.status).toBe("draft");
    expect(block.name).toBe("Auth Feature");
    expect(block.parent_id).toBeNull();
  });

  it("should create a child block", () => {
    const parent = createBlock(db, { name: "Auth Feature" });
    const child = createBlock(db, { name: "Auth UI", parent_id: parent.id });
    expect(child.parent_id).toBe(parent.id);

    const retrieved = getBlock(db, child.id);
    expect(retrieved!.parent_id).toBe(parent.id);
  });

  it("should list blocks with status filter", () => {
    createBlock(db, { name: "A" });
    createBlock(db, { name: "B" });

    const drafts = listBlocks(db, { status: "draft" });
    expect(drafts).toHaveLength(2);

    const accepted = listBlocks(db, { status: "accepted" });
    expect(accepted).toHaveLength(0);
  });

  it("should list root blocks (parent_id null)", () => {
    const parent = createBlock(db, { name: "Root" });
    createBlock(db, { name: "Child", parent_id: parent.id });

    const roots = listBlocks(db, { parent_id: null });
    expect(roots).toHaveLength(1);
    expect(roots[0].name).toBe("Root");
  });

  it("should update block status", () => {
    const block = createBlock(db, { name: "A" });
    expect(updateBlockStatus(db, block.id, "accepted")).toBe(true);
    const updated = getBlock(db, block.id);
    expect(updated!.status).toBe("accepted");
  });

  it("should delete a block", () => {
    const block = createBlock(db, { name: "A" });
    expect(deleteBlock(db, block.id)).toBe(true);
    expect(getBlock(db, block.id)).toBeNull();
  });
});

describe("BlockCodeMapping CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should attach a code entity to a block", () => {
    const block = createBlock(db, { name: "Auth" });
    const entity = createCodeEntity(db, { type: "component", name: "LoginForm", file_path: "src/LoginForm.tsx", start_line: 1, end_line: 50 });

    const mapping = attachCodeEntity(db, {
      block_id: block.id,
      code_entity_id: entity.id,
      role: "owns",
      evidence: [{ file_path: "src/LoginForm.tsx", start_line: 1, end_line: 50 }],
    });

    expect(mapping.id).toBeDefined();
    expect(mapping.block_id).toBe(block.id);
    expect(mapping.code_entity_id).toBe(entity.id);
    expect(mapping.role).toBe("owns");
    expect(mapping.evidence).toHaveLength(1);
  });

  it("should list mappings by block", () => {
    const block = createBlock(db, { name: "Auth" });
    const e1 = createCodeEntity(db, { type: "component", name: "A", file_path: "a.tsx", start_line: 1, end_line: 10 });
    const e2 = createCodeEntity(db, { type: "function", name: "B", file_path: "b.ts", start_line: 1, end_line: 5 });

    attachCodeEntity(db, { block_id: block.id, code_entity_id: e1.id });
    attachCodeEntity(db, { block_id: block.id, code_entity_id: e2.id });

    const mappings = listBlockCodeMappings(db, { block_id: block.id });
    expect(mappings).toHaveLength(2);
  });

  it("should reject attaching a non-existent code entity (FK violation)", () => {
    const block = createBlock(db, { name: "Auth" });
    expect(() => {
      attachCodeEntity(db, { block_id: block.id, code_entity_id: "nonexistent" });
    }).toThrow();
  });

  it("should delete a mapping", () => {
    const block = createBlock(db, { name: "Auth" });
    const entity = createCodeEntity(db, { type: "function", name: "fn", file_path: "f.ts", start_line: 1, end_line: 3 });
    const mapping = attachCodeEntity(db, { block_id: block.id, code_entity_id: entity.id });
    expect(deleteBlockCodeMapping(db, mapping.id)).toBe(true);
    expect(getBlockCodeMapping(db, mapping.id)).toBeNull();
  });
});

describe("Port CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create a port", () => {
    const block = createBlock(db, { name: "Auth UI" });
    const port = createPort(db, {
      block_id: block.id,
      name: "submitCredentials",
      direction: "out",
      contract: "submits login form data",
    });

    expect(port.id).toBeDefined();
    expect(port.block_id).toBe(block.id);
    expect(port.direction).toBe("out");
  });

  it("should list ports by block", () => {
    const block = createBlock(db, { name: "Svc" });
    createPort(db, { block_id: block.id, name: "in1", direction: "in" });
    createPort(db, { block_id: block.id, name: "out1", direction: "out" });

    const inPorts = listPorts(db, { block_id: block.id, direction: "in" });
    expect(inPorts).toHaveLength(1);
    expect(inPorts[0].name).toBe("in1");
  });
});

describe("Connector CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create a connector between ports", () => {
    const b1 = createBlock(db, { name: "UI" });
    const b2 = createBlock(db, { name: "Svc" });
    const srcPort = createPort(db, { block_id: b1.id, name: "out", direction: "out" });
    const tgtPort = createPort(db, { block_id: b2.id, name: "in", direction: "in" });

    const conn = createConnector(db, {
      source_port_id: srcPort.id,
      target_port_id: tgtPort.id,
      protocol: "function_call",
      evidence: [{ file_path: "src/a.ts", start_line: 10, end_line: 15 }],
    });

    expect(conn.id).toBeDefined();
    expect(conn.source_port_id).toBe(srcPort.id);
    expect(conn.target_port_id).toBe(tgtPort.id);
    expect(conn.protocol).toBe("function_call");
  });

  it("should reject connector with non-existent port (FK violation)", () => {
    const b1 = createBlock(db, { name: "UI" });
    const srcPort = createPort(db, { block_id: b1.id, name: "out", direction: "out" });

    expect(() => {
      createConnector(db, { source_port_id: srcPort.id, target_port_id: "nonexistent" });
    }).toThrow();
  });
});

describe("Flow CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create a draft flow", () => {
    const entity = createCodeEntity(db, { type: "event_handler", name: "onSubmit", file_path: "src/LoginForm.tsx", start_line: 20, end_line: 30 });
    const flow = createFlow(db, { name: "Submit Login", entrypoint_entity_id: entity.id });

    expect(flow.id).toBeDefined();
    expect(flow.status).toBe("draft");
    expect(flow.entrypoint_entity_id).toBe(entity.id);
  });

  it("should update flow status", () => {
    const entity = createCodeEntity(db, { type: "route", name: "GET /api", file_path: "routes/api.ts", start_line: 1, end_line: 10 });
    const flow = createFlow(db, { name: "API Request", entrypoint_entity_id: entity.id });

    updateFlowStatus(db, flow.id, "accepted");
    const updated = getFlow(db, flow.id);
    expect(updated!.status).toBe("accepted");
  });

  it("should list flows", () => {
    const e = createCodeEntity(db, { type: "route", name: "r", file_path: "r.ts", start_line: 1, end_line: 1 });
    createFlow(db, { name: "F1", entrypoint_entity_id: e.id });
    createFlow(db, { name: "F2", entrypoint_entity_id: e.id });

    expect(listFlows(db)).toHaveLength(2);
    expect(listFlows(db, { status: "draft" })).toHaveLength(2);
  });
});

describe("FlowStep CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should append flow steps in order", () => {
    const block = createBlock(db, { name: "Auth" });
    const e1 = createCodeEntity(db, { type: "event_handler", name: "onSubmit", file_path: "a.tsx", start_line: 1, end_line: 10 });
    const e2 = createCodeEntity(db, { type: "function", name: "login", file_path: "auth.ts", start_line: 1, end_line: 10 });
    const flow = createFlow(db, { name: "Login Flow", entrypoint_entity_id: e1.id });

    const step1 = appendFlowStep(db, { flow_id: flow.id, block_id: block.id, code_entity_id: e1.id, trigger: "form submit" });
    const step2 = appendFlowStep(db, { flow_id: flow.id, block_id: block.id, code_entity_id: e2.id, trigger: "calls login" });

    expect(step1.order).toBe(1);
    expect(step2.order).toBe(2);

    const steps = listFlowSteps(db, { flow_id: flow.id });
    expect(steps).toHaveLength(2);
    expect(steps[0].order).toBe(1);
    expect(steps[1].order).toBe(2);
  });

  it("should reject flow step with non-existent flow (FK violation)", () => {
    const block = createBlock(db, { name: "Auth" });
    const entity = createCodeEntity(db, { type: "function", name: "fn", file_path: "f.ts", start_line: 1, end_line: 3 });

    expect(() => {
      appendFlowStep(db, { flow_id: "nonexistent", block_id: block.id, code_entity_id: entity.id });
    }).toThrow();
  });

  it("should reject flow step with non-existent block (FK violation)", () => {
    const entity = createCodeEntity(db, { type: "function", name: "fn", file_path: "f.ts", start_line: 1, end_line: 3 });
    const flow = createFlow(db, { name: "F", entrypoint_entity_id: entity.id });

    expect(() => {
      appendFlowStep(db, { flow_id: flow.id, block_id: "nonexistent", code_entity_id: entity.id });
    }).toThrow();
  });

  it("should reject flow step with non-existent code entity (FK violation)", () => {
    const block = createBlock(db, { name: "Auth" });
    const entity = createCodeEntity(db, { type: "route", name: "r", file_path: "r.ts", start_line: 1, end_line: 1 });
    const flow = createFlow(db, { name: "F", entrypoint_entity_id: entity.id });

    expect(() => {
      appendFlowStep(db, { flow_id: flow.id, block_id: block.id, code_entity_id: "nonexistent" });
    }).toThrow();
  });
});

describe("UnknownBoundary CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create an unknown boundary", () => {
    const e1 = createCodeEntity(db, { type: "function", name: "a", file_path: "a.ts", start_line: 1, end_line: 3 });
    const e2 = createCodeEntity(db, { type: "function", name: "b", file_path: "b.ts", start_line: 1, end_line: 3 });

    const ub = createUnknownBoundary(db, {
      related_entity_ids: [e1.id, e2.id],
      reason: "Cannot determine if a calls b directly",
      evidence: [{ file_path: "a.ts", start_line: 1, end_line: 3 }],
    });

    expect(ub.id).toBeDefined();
    expect(ub.status).toBe("draft");
    expect(ub.related_entity_ids).toHaveLength(2);
  });

  it("should list unknown boundaries", () => {
    createUnknownBoundary(db, { related_entity_ids: [], reason: "r1" });
    createUnknownBoundary(db, { related_entity_ids: [], reason: "r2" });

    expect(listUnknownBoundaries(db)).toHaveLength(2);
  });
});

describe("Snapshot CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should create a snapshot", () => {
    const snap = createSnapshot(db, { git_sha: "abc123" });
    expect(snap.id).toBeDefined();
    expect(snap.git_sha).toBe("abc123");
    expect(snap.created_at).toBeDefined();
  });

  it("should list snapshots", () => {
    createSnapshot(db, { git_sha: "aaa" });
    createSnapshot(db, { git_sha: "bbb" });

    const snaps = listSnapshots(db);
    expect(snaps).toHaveLength(2);
  });
});

describe("Edge cases", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("should return empty list when no entities exist", () => {
    expect(listCodeEntities(db)).toHaveLength(0);
    expect(listBlocks(db)).toHaveLength(0);
    expect(listFlows(db)).toHaveLength(0);
  });

  it("should return false when deleting non-existent entity", () => {
    expect(deleteBlock(db, "nonexistent")).toBe(false);
    expect(deleteCodeEntity(db, "nonexistent")).toBe(false);
  });

  it("should store and retrieve evidence array", () => {
    const block = createBlock(db, { name: "B" });
    const entity = createCodeEntity(db, { type: "function", name: "fn", file_path: "f.ts", start_line: 1, end_line: 5 });
    const mapping = attachCodeEntity(db, {
      block_id: block.id,
      code_entity_id: entity.id,
      role: "owns",
      evidence: [
        { file_path: "f.ts", start_line: 1, end_line: 5, note: "main function" },
        { file_path: "f.ts", start_line: 10, end_line: 15, note: "helper" },
      ],
    });

    const retrieved = getBlockCodeMapping(db, mapping.id);
    expect(retrieved!.evidence).toHaveLength(2);
    expect(retrieved!.evidence[0].note).toBe("main function");
  });

  it("should store metadata as JSON", () => {
    const entity = createCodeEntity(db, {
      type: "route",
      name: "GET /users",
      file_path: "routes/users.ts",
      start_line: 5,
      end_line: 20,
      metadata: { method: "GET", path: "/users" },
    });

    const retrieved = getCodeEntity(db, entity.id);
    expect(retrieved!.metadata).toEqual({ method: "GET", path: "/users" });
  });
});
