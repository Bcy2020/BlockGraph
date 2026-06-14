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
  WorkPackage,
  WorkPackageStatus,
  WorkPackageType,
  ModuleProposal,
  ModuleProposalStatus,
  ProposalEntity,
  ProposalPort,
  ProposalDependency,
  ProposalFlow,
  ProposalGap,
  ProposalUnknownBoundary,
  ProposalReview,
  ProposalReviewStatus,
  ReviewFinding,
  MergedProposalMapping,
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

// ── v0.2: WorkPackage ─────────────────────────────────────────────────────

/** Legal status transitions for work packages. */
const WP_TRANSITIONS: Record<WorkPackageStatus, WorkPackageStatus[]> = {
  planned: ["assigned", "rejected", "deferred", "merged"],
  assigned: ["proposed", "rejected", "deferred", "merged"],
  proposed: ["reviewing", "rejected", "deferred", "merged"],
  reviewing: ["needs_revision", "approved", "rejected", "merged"],
  needs_revision: ["proposed", "rejected", "deferred", "merged"],
  approved: ["merged", "rejected"],
  merged: [],
  rejected: [],
  deferred: ["planned"],
};

export function createWorkPackage(
  db: Database.Database,
  input: {
    id: string;
    name: string;
    type?: WorkPackageType;
    scope_paths?: string[];
    included_entity_ids?: string[];
    excluded_entity_ids?: string[];
    allowed_external_refs?: string[];
    forbidden_ownership?: string[];
    dependencies_on_packages?: string[];
    owner_agent?: string;
    open_questions?: string[];
    notes?: string;
  },
): WorkPackage {
  const type = input.type ?? "unknown";
  const scope_paths = input.scope_paths ?? [];
  const included_entity_ids = input.included_entity_ids ?? [];
  const excluded_entity_ids = input.excluded_entity_ids ?? [];
  const allowed_external_refs = input.allowed_external_refs ?? [];
  const forbidden_ownership = input.forbidden_ownership ?? [];
  const dependencies_on_packages = input.dependencies_on_packages ?? [];
  const open_questions = input.open_questions ?? [];

  db.prepare(
    `INSERT INTO work_packages (id, name, type, status, scope_paths, included_entity_ids, excluded_entity_ids, allowed_external_refs, forbidden_ownership, dependencies_on_packages, owner_agent, open_questions, notes)
     VALUES (?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    type,
    JSON.stringify(scope_paths),
    JSON.stringify(included_entity_ids),
    JSON.stringify(excluded_entity_ids),
    JSON.stringify(allowed_external_refs),
    JSON.stringify(forbidden_ownership),
    JSON.stringify(dependencies_on_packages),
    input.owner_agent ?? null,
    JSON.stringify(open_questions),
    input.notes ?? null,
  );

  return {
    id: input.id,
    name: input.name,
    type,
    status: "planned",
    scope_paths,
    included_entity_ids,
    excluded_entity_ids,
    allowed_external_refs,
    forbidden_ownership,
    dependencies_on_packages,
    owner_agent: input.owner_agent,
    open_questions,
    notes: input.notes,
  };
}

export function getWorkPackage(
  db: Database.Database,
  id: string,
): WorkPackage | null {
  const row = db.prepare(`SELECT * FROM work_packages WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as WorkPackageType,
    status: row.status as WorkPackageStatus,
    scope_paths: parseJson(row.scope_paths as string),
    included_entity_ids: parseJson(row.included_entity_ids as string),
    excluded_entity_ids: parseJson(row.excluded_entity_ids as string),
    allowed_external_refs: parseJson(row.allowed_external_refs as string),
    forbidden_ownership: parseJson(row.forbidden_ownership as string),
    dependencies_on_packages: parseJson(row.dependencies_on_packages as string),
    owner_agent: row.owner_agent as string | undefined,
    open_questions: parseJson(row.open_questions as string),
    notes: row.notes as string | undefined,
  };
}

export function listWorkPackages(
  db: Database.Database,
  filter?: { status?: WorkPackageStatus; type?: WorkPackageType },
): WorkPackage[] {
  let sql = `SELECT * FROM work_packages WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  if (filter?.type) {
    sql += ` AND type = ?`;
    params.push(filter.type);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    type: row.type as WorkPackageType,
    status: row.status as WorkPackageStatus,
    scope_paths: parseJson(row.scope_paths as string),
    included_entity_ids: parseJson(row.included_entity_ids as string),
    excluded_entity_ids: parseJson(row.excluded_entity_ids as string),
    allowed_external_refs: parseJson(row.allowed_external_refs as string),
    forbidden_ownership: parseJson(row.forbidden_ownership as string),
    dependencies_on_packages: parseJson(row.dependencies_on_packages as string),
    owner_agent: row.owner_agent as string | undefined,
    open_questions: parseJson(row.open_questions as string),
    notes: row.notes as string | undefined,
  }));
}

export function updateWorkPackageStatus(
  db: Database.Database,
  id: string,
  status: WorkPackageStatus,
): { ok: boolean; error?: string } {
  const pkg = getWorkPackage(db, id);
  if (!pkg) return { ok: false, error: `Work package not found: ${id}` };

  const allowed = WP_TRANSITIONS[pkg.status] ?? [];
  if (!allowed.includes(status)) {
    return { ok: false, error: `Illegal status transition: ${pkg.status} -> ${status}` };
  }

  db.prepare(`UPDATE work_packages SET status = ? WHERE id = ?`).run(status, id);
  return { ok: true };
}

export function deleteWorkPackage(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM work_packages WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── v0.2: ModuleProposal ──────────────────────────────────────────────────

/** Proposal status transitions. */
const PROPOSAL_TRANSITIONS: Record<ModuleProposalStatus, ModuleProposalStatus[]> = {
  draft: ["submitted", "rejected"],
  submitted: ["reviewing", "rejected", "needs_revision"],
  reviewing: ["needs_revision", "approved", "rejected"],
  needs_revision: ["submitted", "rejected"],
  approved: ["merged", "rejected"],
  merged: [],
  rejected: [],
};

/** Check if an entity's file_path matches any of the package's scope_paths. */
export function isEntityInScope(
  db: Database.Database,
  entityId: string,
  pkg: WorkPackage,
): boolean {
  const entity = getCodeEntity(db, entityId);
  if (!entity) return false;
  if (pkg.scope_paths.length === 0) return true; // no scope = no restriction
  return pkg.scope_paths.some((scope) => {
    const prefix = scope.replace(/\*\*\/?$/, "").replace(/\*$/, "");
    return entity.file_path.startsWith(prefix);
  });
}

/** Check if an entity is in the package's forbidden_ownership paths. */
export function isEntityForbidden(
  db: Database.Database,
  entityId: string,
  pkg: WorkPackage,
): boolean {
  const entity = getCodeEntity(db, entityId);
  if (!entity) return false;
  return pkg.forbidden_ownership.some((fp) => {
    const prefix = fp.replace(/\*\*\/?$/, "").replace(/\*$/, "");
    return entity.file_path.startsWith(prefix);
  });
}

/** Check if an entity is in the package's allowed_external_refs or included_entity_ids. */
export function isEntityAllowedExternal(
  db: Database.Database,
  entityId: string,
  pkg: WorkPackage,
): boolean {
  const entity = getCodeEntity(db, entityId);
  if (!entity) return false;
  if (pkg.included_entity_ids.includes(entityId)) return true;
  if (pkg.allowed_external_refs.length === 0) return true; // no restrictions
  return pkg.allowed_external_refs.some((ref) => {
    const prefix = ref.replace(/\*\*\/?$/, "").replace(/\*$/, "");
    return entity.file_path.startsWith(prefix) || entityId === ref;
  });
}

export function createModuleProposal(
  db: Database.Database,
  input: {
    id: string;
    work_package_id: string;
    module_name: string;
    module_type?: WorkPackageType;
    purpose?: string;
    confidence?: number;
  },
): ModuleProposal {
  const module_type = input.module_type ?? "unknown";
  const purpose = input.purpose ?? "";
  const confidence = input.confidence ?? 1.0;

  db.prepare(
    `INSERT INTO module_proposals (id, work_package_id, module_name, module_type, purpose, confidence, status)
     VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
  ).run(input.id, input.work_package_id, input.module_name, module_type, purpose, confidence);

  return {
    id: input.id,
    work_package_id: input.work_package_id,
    module_name: input.module_name,
    module_type,
    purpose,
    owned_code_entities: [],
    used_code_entities: [],
    entrypoints: [],
    ports: [],
    internal_flows: [],
    outgoing_dependencies: [],
    incoming_dependencies: [],
    unknown_boundaries: [],
    coverage_gaps: [],
    confidence,
    status: "draft",
  };
}

export function getModuleProposal(
  db: Database.Database,
  id: string,
): ModuleProposal | null {
  const row = db.prepare(`SELECT * FROM module_proposals WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    work_package_id: row.work_package_id as string,
    module_name: row.module_name as string,
    module_type: row.module_type as WorkPackageType,
    purpose: row.purpose as string,
    owned_code_entities: parseJson(row.owned_code_entities as string),
    used_code_entities: parseJson(row.used_code_entities as string),
    entrypoints: parseJson(row.entrypoints as string),
    ports: parseJson(row.ports as string),
    internal_flows: parseJson(row.internal_flows as string),
    outgoing_dependencies: parseJson(row.outgoing_dependencies as string),
    incoming_dependencies: parseJson(row.incoming_dependencies as string),
    unknown_boundaries: parseJson(row.unknown_boundaries as string),
    coverage_gaps: parseJson(row.coverage_gaps as string),
    confidence: row.confidence as number,
    status: row.status as ModuleProposalStatus,
  };
}

export function listModuleProposals(
  db: Database.Database,
  filter?: { work_package_id?: string; status?: ModuleProposalStatus },
): ModuleProposal[] {
  let sql = `SELECT * FROM module_proposals WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.work_package_id) {
    sql += ` AND work_package_id = ?`;
    params.push(filter.work_package_id);
  }
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    work_package_id: row.work_package_id as string,
    module_name: row.module_name as string,
    module_type: row.module_type as WorkPackageType,
    purpose: row.purpose as string,
    owned_code_entities: parseJson(row.owned_code_entities as string),
    used_code_entities: parseJson(row.used_code_entities as string),
    entrypoints: parseJson(row.entrypoints as string),
    ports: parseJson(row.ports as string),
    internal_flows: parseJson(row.internal_flows as string),
    outgoing_dependencies: parseJson(row.outgoing_dependencies as string),
    incoming_dependencies: parseJson(row.incoming_dependencies as string),
    unknown_boundaries: parseJson(row.unknown_boundaries as string),
    coverage_gaps: parseJson(row.coverage_gaps as string),
    confidence: row.confidence as number,
    status: row.status as ModuleProposalStatus,
  }));
}

export function updateModuleProposal(
  db: Database.Database,
  id: string,
  updates: {
    owned_code_entities?: ProposalEntity[];
    used_code_entities?: ProposalEntity[];
    entrypoints?: ProposalEntity[];
    ports?: ProposalPort[];
    internal_flows?: ProposalFlow[];
    outgoing_dependencies?: ProposalDependency[];
    incoming_dependencies?: ProposalDependency[];
    unknown_boundaries?: ProposalUnknownBoundary[];
    coverage_gaps?: ProposalGap[];
    confidence?: number;
    status?: ModuleProposalStatus;
    purpose?: string;
  },
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.owned_code_entities !== undefined) {
    sets.push(`owned_code_entities = ?`);
    params.push(JSON.stringify(updates.owned_code_entities));
  }
  if (updates.used_code_entities !== undefined) {
    sets.push(`used_code_entities = ?`);
    params.push(JSON.stringify(updates.used_code_entities));
  }
  if (updates.entrypoints !== undefined) {
    sets.push(`entrypoints = ?`);
    params.push(JSON.stringify(updates.entrypoints));
  }
  if (updates.ports !== undefined) {
    sets.push(`ports = ?`);
    params.push(JSON.stringify(updates.ports));
  }
  if (updates.internal_flows !== undefined) {
    sets.push(`internal_flows = ?`);
    params.push(JSON.stringify(updates.internal_flows));
  }
  if (updates.outgoing_dependencies !== undefined) {
    sets.push(`outgoing_dependencies = ?`);
    params.push(JSON.stringify(updates.outgoing_dependencies));
  }
  if (updates.incoming_dependencies !== undefined) {
    sets.push(`incoming_dependencies = ?`);
    params.push(JSON.stringify(updates.incoming_dependencies));
  }
  if (updates.unknown_boundaries !== undefined) {
    sets.push(`unknown_boundaries = ?`);
    params.push(JSON.stringify(updates.unknown_boundaries));
  }
  if (updates.coverage_gaps !== undefined) {
    sets.push(`coverage_gaps = ?`);
    params.push(JSON.stringify(updates.coverage_gaps));
  }
  if (updates.confidence !== undefined) {
    sets.push(`confidence = ?`);
    params.push(updates.confidence);
  }
  if (updates.status !== undefined) {
    sets.push(`status = ?`);
    params.push(updates.status);
  }
  if (updates.purpose !== undefined) {
    sets.push(`purpose = ?`);
    params.push(updates.purpose);
  }

  if (sets.length === 0) return false;

  params.push(id);
  const result = db.prepare(`UPDATE module_proposals SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return result.changes > 0;
}

export function deleteModuleProposal(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM module_proposals WHERE id = ?`).run(id);
  return result.changes > 0;
}

/**
 * Update proposal status with legal transition enforcement.
 * Separate from updateModuleProposal to enforce transition rules.
 */
export function updateModuleProposalStatus(
  db: Database.Database,
  id: string,
  status: ModuleProposalStatus,
): { ok: boolean; error?: string } {
  const proposal = getModuleProposal(db, id);
  if (!proposal) return { ok: false, error: `Module proposal not found: ${id}` };

  const allowed = PROPOSAL_TRANSITIONS[proposal.status] ?? [];
  if (!allowed.includes(status)) {
    return { ok: false, error: `Illegal proposal status transition: ${proposal.status} -> ${status}` };
  }

  db.prepare(`UPDATE module_proposals SET status = ? WHERE id = ?`).run(status, id);
  return { ok: true };
}

/**
 * Append an owned/used/entrypoint entity to a proposal.
 * Returns the updated entity list.
 */
export function appendProposalEntity(
  db: Database.Database,
  proposalId: string,
  entityType: "owned" | "used" | "entrypoint",
  entity: ProposalEntity,
): { ok: boolean; error?: string } {
  const proposal = getModuleProposal(db, proposalId);
  if (!proposal) return { ok: false, error: `Proposal not found: ${proposalId}` };

  const field = entityType === "owned"
    ? "owned_code_entities"
    : entityType === "used"
      ? "used_code_entities"
      : "entrypoints";

  const list = [...proposal[field], entity];
  db.prepare(`UPDATE module_proposals SET ${field} = ? WHERE id = ?`).run(JSON.stringify(list), proposalId);
  return { ok: true };
}

/**
 * Append a port to a proposal.
 */
export function appendProposalPort(
  db: Database.Database,
  proposalId: string,
  port: ProposalPort,
): { ok: boolean; error?: string } {
  const proposal = getModuleProposal(db, proposalId);
  if (!proposal) return { ok: false, error: `Proposal not found: ${proposalId}` };

  const list = [...proposal.ports, port];
  db.prepare(`UPDATE module_proposals SET ports = ? WHERE id = ?`).run(JSON.stringify(list), proposalId);
  return { ok: true };
}

/**
 * Append a dependency to a proposal.
 */
export function appendProposalDependency(
  db: Database.Database,
  proposalId: string,
  direction: "incoming" | "outgoing",
  dependency: ProposalDependency,
): { ok: boolean; error?: string } {
  const proposal = getModuleProposal(db, proposalId);
  if (!proposal) return { ok: false, error: `Proposal not found: ${proposalId}` };

  const field = direction === "outgoing" ? "outgoing_dependencies" : "incoming_dependencies";
  const list = [...proposal[field], dependency];
  db.prepare(`UPDATE module_proposals SET ${field} = ? WHERE id = ?`).run(JSON.stringify(list), proposalId);
  return { ok: true };
}

/**
 * Append a flow to a proposal.
 */
export function appendProposalFlow(
  db: Database.Database,
  proposalId: string,
  flow: ProposalFlow,
): { ok: boolean; error?: string } {
  const proposal = getModuleProposal(db, proposalId);
  if (!proposal) return { ok: false, error: `Proposal not found: ${proposalId}` };

  const list = [...proposal.internal_flows, flow];
  db.prepare(`UPDATE module_proposals SET internal_flows = ? WHERE id = ?`).run(JSON.stringify(list), proposalId);
  return { ok: true };
}

/**
 * Append a gap to a proposal.
 */
export function appendProposalGap(
  db: Database.Database,
  proposalId: string,
  gap: ProposalGap,
): { ok: boolean; error?: string } {
  const proposal = getModuleProposal(db, proposalId);
  if (!proposal) return { ok: false, error: `Proposal not found: ${proposalId}` };

  const list = [...proposal.coverage_gaps, gap];
  db.prepare(`UPDATE module_proposals SET coverage_gaps = ? WHERE id = ?`).run(JSON.stringify(list), proposalId);
  return { ok: true };
}

// ── v0.2: ProposalReview ──────────────────────────────────────────────────

export function createProposalReview(
  db: Database.Database,
  input: {
    id: string;
    proposal_id: string;
    reviewer_agent?: string;
    status?: ProposalReviewStatus;
    findings?: ReviewFinding[];
    coverage_notes?: string;
    evidence_notes?: string;
    recommended_fixes?: string[];
  },
): ProposalReview {
  const status = input.status ?? "needs_revision";
  const findings = input.findings ?? [];
  const coverage_notes = input.coverage_notes ?? "";
  const evidence_notes = input.evidence_notes ?? "";
  const recommended_fixes = input.recommended_fixes ?? [];

  db.prepare(
    `INSERT INTO proposal_reviews (id, proposal_id, reviewer_agent, status, findings, coverage_notes, evidence_notes, recommended_fixes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.proposal_id,
    input.reviewer_agent ?? null,
    status,
    JSON.stringify(findings),
    coverage_notes,
    evidence_notes,
    JSON.stringify(recommended_fixes),
  );

  return {
    id: input.id,
    proposal_id: input.proposal_id,
    reviewer_agent: input.reviewer_agent,
    status,
    findings,
    coverage_notes,
    evidence_notes,
    recommended_fixes,
  };
}

export function getProposalReview(
  db: Database.Database,
  id: string,
): ProposalReview | null {
  const row = db.prepare(`SELECT * FROM proposal_reviews WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    proposal_id: row.proposal_id as string,
    reviewer_agent: row.reviewer_agent as string | undefined,
    status: row.status as ProposalReviewStatus,
    findings: parseJson(row.findings as string),
    coverage_notes: row.coverage_notes as string,
    evidence_notes: row.evidence_notes as string,
    recommended_fixes: parseJson(row.recommended_fixes as string),
  };
}

export function listProposalReviews(
  db: Database.Database,
  filter?: { proposal_id?: string; status?: ProposalReviewStatus },
): ProposalReview[] {
  let sql = `SELECT * FROM proposal_reviews WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.proposal_id) {
    sql += ` AND proposal_id = ?`;
    params.push(filter.proposal_id);
  }
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    proposal_id: row.proposal_id as string,
    reviewer_agent: row.reviewer_agent as string | undefined,
    status: row.status as ProposalReviewStatus,
    findings: parseJson(row.findings as string),
    coverage_notes: row.coverage_notes as string,
    evidence_notes: row.evidence_notes as string,
    recommended_fixes: parseJson(row.recommended_fixes as string),
  }));
}

export function updateProposalReview(
  db: Database.Database,
  id: string,
  updates: {
    status?: ProposalReviewStatus;
    findings?: ReviewFinding[];
  },
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push(`status = ?`);
    params.push(updates.status);
  }
  if (updates.findings !== undefined) {
    sets.push(`findings = ?`);
    params.push(JSON.stringify(updates.findings));
  }

  if (sets.length === 0) return false;

  params.push(id);
  const result = db.prepare(`UPDATE proposal_reviews SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return result.changes > 0;
}

export function deleteProposalReview(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM proposal_reviews WHERE id = ?`).run(id);
  return result.changes > 0;
}

// ── v0.2: MergedProposalMapping ───────────────────────────────────────────

export function createMergedProposalMapping(
  db: Database.Database,
  input: {
    proposal_id: string;
    work_package_id: string;
    block_id: string;
  },
): MergedProposalMapping {
  const id = genId();
  const merged_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO merged_proposal_mappings (id, proposal_id, work_package_id, block_id, merged_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.proposal_id, input.work_package_id, input.block_id, merged_at);
  return { id, proposal_id: input.proposal_id, work_package_id: input.work_package_id, block_id: input.block_id, merged_at };
}

export function listMergedProposalMappings(
  db: Database.Database,
  filter?: { work_package_id?: string; proposal_id?: string },
): MergedProposalMapping[] {
  let sql = `SELECT * FROM merged_proposal_mappings WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.work_package_id) {
    sql += ` AND work_package_id = ?`;
    params.push(filter.work_package_id);
  }
  if (filter?.proposal_id) {
    sql += ` AND proposal_id = ?`;
    params.push(filter.proposal_id);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    proposal_id: row.proposal_id as string,
    work_package_id: row.work_package_id as string,
    block_id: row.block_id as string,
    merged_at: row.merged_at as string,
  }));
}
