/**
 * BlockGraph MCP v0.1 — CRUD Service
 * Provides create/get/list/delete operations for all graph entities.
 * All edits target the draft graph; accepted graph is mutated only through promote (Phase 4).
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Block,
  BlockCodeMapping,
  BlockStatus,
  CodeEdge,
  CodeEdgeType,
  CodeEntity,
  CodeEntityType,
  Connector,
  Evidence,
  Flow,
  FlowStatus,
  FlowStep,
  Port,
  PortDirection,
  Snapshot,
  UnknownBoundary,
  UnknownBoundaryStatus,
} from "./schema.js";

// ── helpers ────────────────────────────────────────────────────────────────

function genId(): string {
  return randomUUID();
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

// ── CodeEntity ─────────────────────────────────────────────────────────────

export function createCodeEntity(
  db: Database.Database,
  input: {
    type: CodeEntityType;
    name: string;
    file_path: string;
    start_line: number;
    end_line: number;
    metadata?: Record<string, unknown>;
  },
  providedId?: string,
): CodeEntity {
  const id = providedId ?? genId();
  const metadata = input.metadata ?? {};
  db.prepare(
    `INSERT INTO code_entities (id, type, name, file_path, start_line, end_line, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.type, input.name, input.file_path, input.start_line, input.end_line, JSON.stringify(metadata));
  return { id, ...input, metadata };
}

export function getCodeEntity(
  db: Database.Database,
  id: string,
): CodeEntity | null {
  const row = db.prepare(`SELECT * FROM code_entities WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    type: row.type as CodeEntityType,
    name: row.name as string,
    file_path: row.file_path as string,
    start_line: row.start_line as number,
    end_line: row.end_line as number,
    metadata: parseJson(row.metadata as string),
  };
}

export function listCodeEntities(
  db: Database.Database,
  filter?: { type?: string; file_path?: string; name_contains?: string },
): CodeEntity[] {
  let sql = `SELECT * FROM code_entities WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.type) {
    sql += ` AND type = ?`;
    params.push(filter.type);
  }
  if (filter?.file_path) {
    sql += ` AND file_path = ?`;
    params.push(filter.file_path);
  }
  if (filter?.name_contains) {
    sql += ` AND name LIKE ?`;
    params.push(`%${filter.name_contains}%`);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    type: row.type as CodeEntityType,
    name: row.name as string,
    file_path: row.file_path as string,
    start_line: row.start_line as number,
    end_line: row.end_line as number,
    metadata: parseJson(row.metadata as string),
  }));
}

export function deleteCodeEntity(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM code_entities WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── CodeEdge ───────────────────────────────────────────────────────────────

export function createCodeEdge(
  db: Database.Database,
  input: {
    type: CodeEdgeType;
    source_entity_id: string;
    target_entity_id?: string | null;
    confidence?: number;
    evidence?: Evidence[];
  },
  providedId?: string,
): CodeEdge {
  const id = providedId ?? genId();
  const confidence = input.confidence ?? 1.0;
  const evidence = input.evidence ?? [];
  const target = input.target_entity_id ?? null;
  db.prepare(
    `INSERT INTO code_edges (id, type, source_entity_id, target_entity_id, confidence, evidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.type, input.source_entity_id, target, confidence, JSON.stringify(evidence));
  return { id, type: input.type, source_entity_id: input.source_entity_id, target_entity_id: target, confidence, evidence };
}

export function getCodeEdge(
  db: Database.Database,
  id: string,
): CodeEdge | null {
  const row = db.prepare(`SELECT * FROM code_edges WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    type: row.type as CodeEdgeType,
    source_entity_id: row.source_entity_id as string,
    target_entity_id: row.target_entity_id as string | null,
    confidence: row.confidence as number,
    evidence: parseJson(row.evidence as string),
  };
}

export function listCodeEdges(
  db: Database.Database,
  filter?: { type?: string; source_entity_id?: string; target_entity_id?: string },
): CodeEdge[] {
  let sql = `SELECT * FROM code_edges WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.type) {
    sql += ` AND type = ?`;
    params.push(filter.type);
  }
  if (filter?.source_entity_id) {
    sql += ` AND source_entity_id = ?`;
    params.push(filter.source_entity_id);
  }
  if (filter?.target_entity_id) {
    sql += ` AND target_entity_id = ?`;
    params.push(filter.target_entity_id);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    type: row.type as CodeEdgeType,
    source_entity_id: row.source_entity_id as string,
    target_entity_id: row.target_entity_id as string | null,
    confidence: row.confidence as number,
    evidence: parseJson(row.evidence as string),
  }));
}

export function deleteCodeEdge(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM code_edges WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── Block ──────────────────────────────────────────────────────────────────

export function createBlock(
  db: Database.Database,
  input: {
    parent_id?: string | null;
    name: string;
    purpose?: string;
    confidence?: number;
  },
): Block {
  const id = genId();
  const parent_id = input.parent_id ?? null;
  const purpose = input.purpose ?? "";
  const confidence = input.confidence ?? 1.0;
  db.prepare(
    `INSERT INTO blocks (id, parent_id, name, purpose, status, confidence)
     VALUES (?, ?, ?, ?, 'draft', ?)`,
  ).run(id, parent_id, input.name, purpose, confidence);
  return { id, parent_id, name: input.name, purpose, status: "draft", confidence };
}

export function getBlock(db: Database.Database, id: string): Block | null {
  const row = db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    parent_id: row.parent_id as string | null,
    name: row.name as string,
    purpose: row.purpose as string,
    status: row.status as BlockStatus,
    confidence: row.confidence as number,
  };
}

export function listBlocks(
  db: Database.Database,
  filter?: { status?: string; parent_id?: string | null },
): Block[] {
  let sql = `SELECT * FROM blocks WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  if (filter?.parent_id !== undefined) {
    if (filter.parent_id === null) {
      sql += ` AND parent_id IS NULL`;
    } else {
      sql += ` AND parent_id = ?`;
      params.push(filter.parent_id);
    }
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    parent_id: row.parent_id as string | null,
    name: row.name as string,
    purpose: row.purpose as string,
    status: row.status as BlockStatus,
    confidence: row.confidence as number,
  }));
}

export function updateBlockStatus(
  db: Database.Database,
  id: string,
  status: BlockStatus,
): boolean {
  const result = db.prepare(`UPDATE blocks SET status = ? WHERE id = ?`).run(status, id);
  return result.changes > 0;
}

export function deleteBlock(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM blocks WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── BlockCodeMapping ───────────────────────────────────────────────────────

export function attachCodeEntity(
  db: Database.Database,
  input: {
    block_id: string;
    code_entity_id: string;
    role?: string;
    evidence?: Evidence[];
  },
): BlockCodeMapping {
  const id = genId();
  const role = input.role ?? "owns";
  const evidence = input.evidence ?? [];
  db.prepare(
    `INSERT INTO block_code_mappings (id, block_id, code_entity_id, role, evidence)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.block_id, input.code_entity_id, role, JSON.stringify(evidence));
  return { id, block_id: input.block_id, code_entity_id: input.code_entity_id, role, evidence };
}

export function getBlockCodeMapping(
  db: Database.Database,
  id: string,
): BlockCodeMapping | null {
  const row = db.prepare(`SELECT * FROM block_code_mappings WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    block_id: row.block_id as string,
    code_entity_id: row.code_entity_id as string,
    role: row.role as string,
    evidence: parseJson(row.evidence as string),
  };
}

export function listBlockCodeMappings(
  db: Database.Database,
  filter?: { block_id?: string; code_entity_id?: string },
): BlockCodeMapping[] {
  let sql = `SELECT * FROM block_code_mappings WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.block_id) {
    sql += ` AND block_id = ?`;
    params.push(filter.block_id);
  }
  if (filter?.code_entity_id) {
    sql += ` AND code_entity_id = ?`;
    params.push(filter.code_entity_id);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    block_id: row.block_id as string,
    code_entity_id: row.code_entity_id as string,
    role: row.role as string,
    evidence: parseJson(row.evidence as string),
  }));
}

export function deleteBlockCodeMapping(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM block_code_mappings WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── Port ───────────────────────────────────────────────────────────────────

export function createPort(
  db: Database.Database,
  input: {
    block_id: string;
    name: string;
    direction: PortDirection;
    contract?: string;
  },
): Port {
  const id = genId();
  const contract = input.contract ?? "";
  db.prepare(
    `INSERT INTO ports (id, block_id, name, direction, contract)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.block_id, input.name, input.direction, contract);
  return { id, block_id: input.block_id, name: input.name, direction: input.direction, contract };
}

export function getPort(db: Database.Database, id: string): Port | null {
  const row = db.prepare(`SELECT * FROM ports WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    block_id: row.block_id as string,
    name: row.name as string,
    direction: row.direction as PortDirection,
    contract: row.contract as string,
  };
}

export function listPorts(
  db: Database.Database,
  filter?: { block_id?: string; direction?: string },
): Port[] {
  let sql = `SELECT * FROM ports WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.block_id) {
    sql += ` AND block_id = ?`;
    params.push(filter.block_id);
  }
  if (filter?.direction) {
    sql += ` AND direction = ?`;
    params.push(filter.direction);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    block_id: row.block_id as string,
    name: row.name as string,
    direction: row.direction as PortDirection,
    contract: row.contract as string,
  }));
}

export function deletePort(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM ports WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── Connector ──────────────────────────────────────────────────────────────

export function createConnector(
  db: Database.Database,
  input: {
    source_port_id: string;
    target_port_id: string;
    protocol?: string;
    evidence?: Evidence[];
  },
): Connector {
  const id = genId();
  const protocol = input.protocol ?? "unknown";
  const evidence = input.evidence ?? [];
  db.prepare(
    `INSERT INTO connectors (id, source_port_id, target_port_id, protocol, evidence)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.source_port_id, input.target_port_id, protocol, JSON.stringify(evidence));
  return { id, source_port_id: input.source_port_id, target_port_id: input.target_port_id, protocol, evidence };
}

export function getConnector(
  db: Database.Database,
  id: string,
): Connector | null {
  const row = db.prepare(`SELECT * FROM connectors WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    source_port_id: row.source_port_id as string,
    target_port_id: row.target_port_id as string,
    protocol: row.protocol as string,
    evidence: parseJson(row.evidence as string),
  };
}

export function listConnectors(
  db: Database.Database,
  filter?: { source_port_id?: string; target_port_id?: string },
): Connector[] {
  let sql = `SELECT * FROM connectors WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.source_port_id) {
    sql += ` AND source_port_id = ?`;
    params.push(filter.source_port_id);
  }
  if (filter?.target_port_id) {
    sql += ` AND target_port_id = ?`;
    params.push(filter.target_port_id);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    source_port_id: row.source_port_id as string,
    target_port_id: row.target_port_id as string,
    protocol: row.protocol as string,
    evidence: parseJson(row.evidence as string),
  }));
}

export function deleteConnector(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM connectors WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── Flow ───────────────────────────────────────────────────────────────────

export function createFlow(
  db: Database.Database,
  input: {
    name: string;
    entrypoint_entity_id: string;
  },
): Flow {
  const id = genId();
  db.prepare(
    `INSERT INTO flows (id, name, entrypoint_entity_id, status)
     VALUES (?, ?, ?, 'draft')`,
  ).run(id, input.name, input.entrypoint_entity_id);
  return { id, name: input.name, entrypoint_entity_id: input.entrypoint_entity_id, status: "draft" };
}

export function getFlow(db: Database.Database, id: string): Flow | null {
  const row = db.prepare(`SELECT * FROM flows WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    entrypoint_entity_id: row.entrypoint_entity_id as string,
    status: row.status as FlowStatus,
  };
}

export function listFlows(
  db: Database.Database,
  filter?: { status?: string },
): Flow[] {
  let sql = `SELECT * FROM flows WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    entrypoint_entity_id: row.entrypoint_entity_id as string,
    status: row.status as FlowStatus,
  }));
}

export function updateFlowStatus(
  db: Database.Database,
  id: string,
  status: FlowStatus,
): boolean {
  const result = db.prepare(`UPDATE flows SET status = ? WHERE id = ?`).run(status, id);
  return result.changes > 0;
}

export function deleteFlow(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM flows WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── FlowStep ───────────────────────────────────────────────────────────────

export function appendFlowStep(
  db: Database.Database,
  input: {
    flow_id: string;
    block_id: string;
    code_entity_id: string;
    trigger?: string;
    evidence?: Evidence[];
  },
): FlowStep {
  const id = genId();
  const trigger = input.trigger ?? "";
  const evidence = input.evidence ?? [];
  // Compute next order: max(order) + 1 for this flow
  const row = db.prepare(
    `SELECT COALESCE(MAX("order"), 0) AS max_order FROM flow_steps WHERE flow_id = ?`,
  ).get(input.flow_id) as { max_order: number };
  const order = row.max_order + 1;
  db.prepare(
    `INSERT INTO flow_steps (id, flow_id, "order", block_id, code_entity_id, trigger, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.flow_id, order, input.block_id, input.code_entity_id, trigger, JSON.stringify(evidence));
  return { id, flow_id: input.flow_id, order, block_id: input.block_id, code_entity_id: input.code_entity_id, trigger, evidence };
}

export function getFlowStep(
  db: Database.Database,
  id: string,
): FlowStep | null {
  const row = db.prepare(`SELECT * FROM flow_steps WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    flow_id: row.flow_id as string,
    order: row.order as number,
    block_id: row.block_id as string,
    code_entity_id: row.code_entity_id as string,
    trigger: row.trigger as string,
    evidence: parseJson(row.evidence as string),
  };
}

export function listFlowSteps(
  db: Database.Database,
  filter?: { flow_id?: string; block_id?: string },
): FlowStep[] {
  let sql = `SELECT * FROM flow_steps WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.flow_id) {
    sql += ` AND flow_id = ?`;
    params.push(filter.flow_id);
  }
  if (filter?.block_id) {
    sql += ` AND block_id = ?`;
    params.push(filter.block_id);
  }
  sql += ` ORDER BY "order" ASC`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    flow_id: row.flow_id as string,
    order: row.order as number,
    block_id: row.block_id as string,
    code_entity_id: row.code_entity_id as string,
    trigger: row.trigger as string,
    evidence: parseJson(row.evidence as string),
  }));
}

export function deleteFlowStep(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM flow_steps WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── UnknownBoundary ────────────────────────────────────────────────────────

export function createUnknownBoundary(
  db: Database.Database,
  input: {
    related_entity_ids: string[];
    reason: string;
    evidence?: Evidence[];
    status?: UnknownBoundaryStatus;
  },
): UnknownBoundary {
  const id = genId();
  const evidence = input.evidence ?? [];
  const status = input.status ?? "draft";
  db.prepare(
    `INSERT INTO unknown_boundaries (id, related_entity_ids, reason, evidence, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, JSON.stringify(input.related_entity_ids), input.reason, JSON.stringify(evidence), status);
  return { id, related_entity_ids: input.related_entity_ids, reason: input.reason, evidence, status };
}

export function getUnknownBoundary(
  db: Database.Database,
  id: string,
): UnknownBoundary | null {
  const row = db.prepare(`SELECT * FROM unknown_boundaries WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    related_entity_ids: parseJson(row.related_entity_ids as string),
    reason: row.reason as string,
    evidence: parseJson(row.evidence as string),
    status: row.status as UnknownBoundaryStatus,
  };
}

export function listUnknownBoundaries(
  db: Database.Database,
  filter?: { status?: string },
): UnknownBoundary[] {
  let sql = `SELECT * FROM unknown_boundaries WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    related_entity_ids: parseJson(row.related_entity_ids as string),
    reason: row.reason as string,
    evidence: parseJson(row.evidence as string),
    status: row.status as UnknownBoundaryStatus,
  }));
}

export function deleteUnknownBoundary(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM unknown_boundaries WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── Snapshot ───────────────────────────────────────────────────────────────

export function createSnapshot(
  db: Database.Database,
  input: {
    git_sha: string;
    accepted_graph_version?: string;
  },
): Snapshot {
  const id = genId();
  const created_at = new Date().toISOString();
  const accepted_graph_version = input.accepted_graph_version ?? "1";
  db.prepare(
    `INSERT INTO snapshots (id, git_sha, created_at, accepted_graph_version)
     VALUES (?, ?, ?, ?)`,
  ).run(id, input.git_sha, created_at, accepted_graph_version);
  return { id, git_sha: input.git_sha, created_at, accepted_graph_version };
}

export function getSnapshot(
  db: Database.Database,
  id: string,
): Snapshot | null {
  const row = db.prepare(`SELECT * FROM snapshots WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    git_sha: row.git_sha as string,
    created_at: row.created_at as string,
    accepted_graph_version: row.accepted_graph_version as string,
  };
}

export function listSnapshots(db: Database.Database): Snapshot[] {
  const rows = db.prepare(`SELECT * FROM snapshots ORDER BY created_at ASC`).all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    git_sha: row.git_sha as string,
    created_at: row.created_at as string,
    accepted_graph_version: row.accepted_graph_version as string,
  }));
}
