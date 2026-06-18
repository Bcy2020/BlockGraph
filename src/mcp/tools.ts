/**
 * BlockGraph MCP v0.1 — Phase 2 Tool Handlers
 * All handlers return structured ToolResponse per PRD §9.
 * Handlers are testable without an MCP client by passing a ToolContext directly.
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { openStore, closeStore } from "../graph/store.js";
import {
  attachCodeEntity as dbAttachCodeEntity,
  appendFlowStep as dbAppendFlowStep,
  createBlock as dbCreateBlock,
  createCodeEntity,
  createCodeEdge,
  createConnector,
  createFlow as dbCreateFlow,
  createPort as dbCreatePort,
  createUnknownBoundary,
  getBlock,
  getCodeEntity,
  getConnector,
  getFlow,
  getFlowStep,
  getPort,
  listBlockCodeMappings,
  listBlocks,
  listCodeEntities,
  listCodeEdges,
  listConnectors,
  listFlows,
  listFlowSteps,
  listPorts,
  listUnknownBoundaries,
  createWorkPackage as dbCreateWorkPackage,
  getWorkPackage,
  listWorkPackages,
  updateWorkPackageStatus,
  listModuleProposals,
  listProposalReviews,
  listMergedProposalMappings,
  createModuleProposal as dbCreateModuleProposal,
  getModuleProposal,
  updateModuleProposalStatus,
  appendProposalEntity,
  appendProposalPort,
  appendProposalDependency,
  appendProposalFlow,
  appendProposalGap,
  isEntityInScope,
  isEntityForbidden,
  isEntityAllowedExternal,
  createProposalReview as dbCreateProposalReview,
  getProposalReview,
  updateProposalReview,
  createMergedProposalMapping,
} from "../graph/draft.js";
import { scanRepo } from "../scanner/tsScanner.js";
import { compileDraftBlock, promoteDraftBlock, compileDraftGraph, commitSnapshot } from "../graph/compiler.js";
import type {
  CodeEntityType,
  ConflictCheckResult,
  Diagnostic,
  Evidence,
  FindingPriority,
  FindingResolution,
  ModuleProposalStatus,
  PortDirection,
  ProposalGapKind,
  ProposalProtocol,
  ProposalReviewStatus,
  QualityGateReport,
  RepoComplexity,
  ReviewFinding,
  SharedDependencyCandidate,
  ToolResponse,
  WeakConnector,
  WorkPackageStatus,
  WorkPackageType,
} from "../graph/schema.js";

// ── Context ────────────────────────────────────────────────────────────────

/**
 * Mutable context provided to every tool handler.
 * The MCP server owns the lifecycle; tests can create their own.
 */
export interface ToolContext {
  db: Database.Database | null;
  repoPath: string | null;
}

export function createToolContext(): ToolContext {
  return { db: null, repoPath: null };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function err(code: string, message: string, entity_id?: string, suggested_fix?: string): Diagnostic {
  return { code, message, severity: "error", ...(entity_id ? { entity_id } : {}), ...(suggested_fix ? { suggested_fix } : {}) };
}

function warn(code: string, message: string, entity_id?: string): Diagnostic {
  return { code, message, severity: "warning", ...(entity_id ? { entity_id } : {}) };
}

function ok<T>(data: T): ToolResponse<T> {
  return { ok: true, data };
}

function fail<T = never>(errors: Diagnostic[], warnings?: Diagnostic[]): ToolResponse<T> {
  return { ok: false, errors, ...(warnings && warnings.length ? { warnings } : {}) };
}

function requireDb(ctx: ToolContext): Database.Database | null {
  return ctx.db;
}

/** Shared NO_SESSION error with reconnect guidance. */
function noSessionError(): Diagnostic {
  return err(
    "NO_SESSION",
    "No active in-memory BlockGraph session. Existing graph data may still exist in the target repository's .blockgraph/blockgraph.db. Call begin_initialization({ repo_path }) or resume_initialization({ repo_path }) to reconnect.",
  );
}

/** Session summary counts for reconnect reporting. */
interface SessionSummary {
  code_entities: number;
  code_edges: number;
  blocks: number;
  work_packages: number;
  module_proposals: number;
  proposal_reviews: number;
  merged_proposals: number;
  flows: number;
  snapshots: number;
}

function getSessionSummary(db: Database.Database): SessionSummary {
  const count = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    return row.c;
  };
  return {
    code_entities: count("code_entities"),
    code_edges: count("code_edges"),
    blocks: count("blocks"),
    work_packages: count("work_packages"),
    module_proposals: count("module_proposals"),
    proposal_reviews: count("proposal_reviews"),
    merged_proposals: count("merged_proposal_mappings"),
    flows: count("flows"),
    snapshots: count("snapshots"),
  };
}

function validateEvidencePaths(evidence: Evidence[] | undefined): Diagnostic[] {
  if (!evidence || evidence.length === 0) return [];
  const errors: Diagnostic[] = [];
  for (const ev of evidence) {
    if (!ev.file_path || ev.file_path.trim() === "") {
      errors.push(err("INVALID_EVIDENCE", "Evidence file_path must be non-empty."));
    }
    if (typeof ev.start_line !== "number" || ev.start_line < 1) {
      errors.push(err("INVALID_EVIDENCE", "Evidence start_line must be a positive integer."));
    }
    if (typeof ev.end_line !== "number" || ev.end_line < ev.start_line) {
      errors.push(err("INVALID_EVIDENCE", "Evidence end_line must be >= start_line."));
    }
  }
  return errors;
}

// ── Tool Handlers ──────────────────────────────────────────────────────────

/**
 * §9.1 begin_initialization
 * Creates or reconnects an initialization session for the repository.
 * If .blockgraph/blockgraph.db exists with prior data, returns resumed: true.
 */
export function handleBeginInitialization(
  ctx: ToolContext,
  args: { repo_path: string },
): ToolResponse<{ session_id: string; repo_path: string; db_path: string; resumed: boolean; summary: SessionSummary }> {
  const errors: Diagnostic[] = [];

  if (!args.repo_path || args.repo_path.trim() === "") {
    errors.push(err("INVALID_INPUT", "repo_path is required."));
    return fail(errors);
  }

  const resolved = path.resolve(args.repo_path);
  if (!fs.existsSync(resolved)) {
    errors.push(err("PATH_NOT_FOUND", `repo_path does not exist: ${resolved}`));
    return fail(errors);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    errors.push(err("NOT_DIRECTORY", `repo_path is not a directory: ${resolved}`));
    return fail(errors);
  }

  // Close existing session if any
  if (ctx.db) {
    closeStore(ctx.db);
    ctx.db = null;
  }

  // Check if DB already exists before opening
  const dbPath = path.join(resolved, ".blockgraph", "blockgraph.db");
  const existed = fs.existsSync(dbPath);

  try {
    ctx.db = openStore(resolved);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return fail([err("DB_OPEN_FAILED", `Could not open database at ${dbPath}: ${message}. The file may be corrupted. Delete .blockgraph/blockgraph.db and re-initialize.`)]);
  }
  ctx.repoPath = resolved;

  // Check if there's prior graph data (any non-empty table)
  let resumed = false;
  if (existed) {
    const summary = getSessionSummary(ctx.db);
    const total = summary.code_entities + summary.blocks + summary.work_packages + summary.module_proposals;
    resumed = total > 0;
  }

  const sessionId = `session-${Date.now()}`;
  const summary = getSessionSummary(ctx.db);

  return ok({ session_id: sessionId, repo_path: resolved, db_path: dbPath, resumed, summary });
}

/**
 * resume_initialization
 * Explicit reconnect alias for begin_initialization.
 * Same behavior — opens existing DB or creates new one.
 */
export function handleResumeInitialization(
  ctx: ToolContext,
  args: { repo_path: string },
): ToolResponse<{ session_id: string; repo_path: string; db_path: string; resumed: boolean; summary: SessionSummary }> {
  return handleBeginInitialization(ctx, args);
}

/**
 * session_status
 * Returns whether there is an active in-memory session and, when active, the repo path, db path, and graph summary.
 */
export function handleSessionStatus(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<{ active: boolean; repo_path?: string; db_path?: string; summary?: SessionSummary }> {
  if (!ctx.db || !ctx.repoPath) {
    return ok({ active: false });
  }

  const dbPath = path.join(ctx.repoPath, ".blockgraph", "blockgraph.db");
  const summary = getSessionSummary(ctx.db);

  return ok({ active: true, repo_path: ctx.repoPath, db_path: dbPath, summary });
}

/**
 * list_module_proposals
 * Lists module proposals with optional filters.
 * Part of session recovery ergonomics — after reconnect, agents need to inspect proposal progress.
 */
export function handleListModuleProposals(
  ctx: ToolContext,
  args: { work_package_id?: string; status?: string },
): ToolResponse<{ proposals: ReturnType<typeof listModuleProposals> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const proposals = listModuleProposals(db, {
    work_package_id: args.work_package_id,
    status: args.status as ModuleProposalStatus | undefined,
  });
  return ok({ proposals });
}

/**
 * §9.6 create_block
 * Creates a draft block. If parent_id is provided, it must reference an existing block.
 */
export function handleCreateBlock(
  ctx: ToolContext,
  args: { parent_id?: string | null; name: string; purpose?: string },
): ToolResponse<{ block_id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.name || args.name.trim() === "") {
    errors.push(err("INVALID_INPUT", "Block name is required."));
  }

  if (args.parent_id) {
    const parent = getBlock(db, args.parent_id);
    if (!parent) {
      errors.push(err("PARENT_NOT_FOUND", `Parent block not found: ${args.parent_id}`, args.parent_id));
    }
  }

  if (errors.length > 0) return fail(errors);

  const block = dbCreateBlock(db, {
    parent_id: args.parent_id ?? null,
    name: args.name,
    purpose: args.purpose ?? "",
  });

  return ok({ block_id: block.id, status: block.status });
}

/**
 * §9.7 attach_code_entity
 * Attaches a code entity to a block with evidence.
 */
export function handleAttachCodeEntity(
  ctx: ToolContext,
  args: {
    block_id: string;
    code_entity_id: string;
    role?: string;
    evidence?: Evidence[];
  },
): ToolResponse<{ mapping_id: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.block_id) errors.push(err("INVALID_INPUT", "block_id is required."));
  if (!args.code_entity_id) errors.push(err("INVALID_INPUT", "code_entity_id is required."));

  if (args.block_id) {
    const block = getBlock(db, args.block_id);
    if (!block) errors.push(err("BLOCK_NOT_FOUND", `Block not found: ${args.block_id}`, args.block_id));
  }

  if (args.code_entity_id) {
    const entity = getCodeEntity(db, args.code_entity_id);
    if (!entity) errors.push(err("ENTITY_NOT_FOUND", `Code entity not found: ${args.code_entity_id}`, args.code_entity_id));
  }

  errors.push(...validateEvidencePaths(args.evidence));

  if (errors.length > 0) return fail(errors);

  const mapping = dbAttachCodeEntity(db, {
    block_id: args.block_id,
    code_entity_id: args.code_entity_id,
    role: args.role ?? "owns",
    evidence: args.evidence ?? [],
  });

  return ok({ mapping_id: mapping.id });
}

/**
 * §9.8 create_port
 * Creates a draft port for a block.
 */
export function handleCreatePort(
  ctx: ToolContext,
  args: {
    block_id: string;
    name: string;
    direction: string;
    contract?: string;
  },
): ToolResponse<{ port_id: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.block_id) errors.push(err("INVALID_INPUT", "block_id is required."));
  if (!args.name || args.name.trim() === "") errors.push(err("INVALID_INPUT", "Port name is required."));
  if (!args.direction || (args.direction !== "in" && args.direction !== "out")) {
    errors.push(err("INVALID_INPUT", 'direction must be "in" or "out".'));
  }

  if (args.block_id) {
    const block = getBlock(db, args.block_id);
    if (!block) errors.push(err("BLOCK_NOT_FOUND", `Block not found: ${args.block_id}`, args.block_id));
  }

  if (errors.length > 0) return fail(errors);

  const port = dbCreatePort(db, {
    block_id: args.block_id,
    name: args.name,
    direction: args.direction as PortDirection,
    contract: args.contract ?? "",
  });

  return ok({ port_id: port.id });
}

/**
 * §9.9 connect_ports
 * Creates a draft connector between two ports.
 */
export function handleConnectPorts(
  ctx: ToolContext,
  args: {
    source_port_id: string;
    target_port_id: string;
    protocol?: string;
    evidence?: Evidence[];
  },
): ToolResponse<{ connector_id: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.source_port_id) errors.push(err("INVALID_INPUT", "source_port_id is required."));
  if (!args.target_port_id) errors.push(err("INVALID_INPUT", "target_port_id is required."));

  let sourcePort = null;
  let targetPort = null;

  if (args.source_port_id) {
    sourcePort = getPort(db, args.source_port_id);
    if (!sourcePort) errors.push(err("PORT_NOT_FOUND", `Source port not found: ${args.source_port_id}`, args.source_port_id));
  }

  if (args.target_port_id) {
    targetPort = getPort(db, args.target_port_id);
    if (!targetPort) errors.push(err("PORT_NOT_FOUND", `Target port not found: ${args.target_port_id}`, args.target_port_id));
  }

  if (sourcePort && sourcePort.direction !== "out") {
    errors.push(err("INVALID_PORT_DIRECTION", "Source port must have direction 'out'.", args.source_port_id));
  }

  if (targetPort && targetPort.direction !== "in") {
    errors.push(err("INVALID_PORT_DIRECTION", "Target port must have direction 'in'.", args.target_port_id));
  }

  errors.push(...validateEvidencePaths(args.evidence));

  if (errors.length > 0) return fail(errors);

  const connector = createConnector(db, {
    source_port_id: args.source_port_id,
    target_port_id: args.target_port_id,
    protocol: args.protocol ?? "unknown",
    evidence: args.evidence ?? [],
  });

  return ok({ connector_id: connector.id });
}

/**
 * §9.10 create_flow
 * Creates a draft flow with an entrypoint entity.
 */
export function handleCreateFlow(
  ctx: ToolContext,
  args: {
    name: string;
    entrypoint_entity_id: string;
  },
): ToolResponse<{ flow_id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.name || args.name.trim() === "") errors.push(err("INVALID_INPUT", "Flow name is required."));
  if (!args.entrypoint_entity_id) errors.push(err("INVALID_INPUT", "entrypoint_entity_id is required."));

  if (args.entrypoint_entity_id) {
    const entity = getCodeEntity(db, args.entrypoint_entity_id);
    if (!entity) {
      errors.push(err("ENTITY_NOT_FOUND", `Entrypoint code entity not found: ${args.entrypoint_entity_id}`, args.entrypoint_entity_id));
    }
  }

  if (errors.length > 0) return fail(errors);

  const flow = dbCreateFlow(db, {
    name: args.name,
    entrypoint_entity_id: args.entrypoint_entity_id,
  });

  return ok({ flow_id: flow.id, status: flow.status });
}

/**
 * §9.11 append_flow_step
 * Appends a step to a draft flow. Auto-computes order.
 */
export function handleAppendFlowStep(
  ctx: ToolContext,
  args: {
    flow_id: string;
    block_id: string;
    code_entity_id: string;
    trigger?: string;
    evidence?: Evidence[];
  },
): ToolResponse<{ step_id: string; order: number }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.flow_id) errors.push(err("INVALID_INPUT", "flow_id is required."));
  if (!args.block_id) errors.push(err("INVALID_INPUT", "block_id is required."));
  if (!args.code_entity_id) errors.push(err("INVALID_INPUT", "code_entity_id is required."));

  if (args.flow_id) {
    const flow = getFlow(db, args.flow_id);
    if (!flow) errors.push(err("FLOW_NOT_FOUND", `Flow not found: ${args.flow_id}`, args.flow_id));
  }

  if (args.block_id) {
    const block = getBlock(db, args.block_id);
    if (!block) errors.push(err("BLOCK_NOT_FOUND", `Block not found: ${args.block_id}`, args.block_id));
  }

  if (args.code_entity_id) {
    const entity = getCodeEntity(db, args.code_entity_id);
    if (!entity) errors.push(err("ENTITY_NOT_FOUND", `Code entity not found: ${args.code_entity_id}`, args.code_entity_id));
  }

  errors.push(...validateEvidencePaths(args.evidence));

  if (errors.length > 0) return fail(errors);

  const step = dbAppendFlowStep(db, {
    flow_id: args.flow_id,
    block_id: args.block_id,
    code_entity_id: args.code_entity_id,
    trigger: args.trigger ?? "",
    evidence: args.evidence ?? [],
  });

  return ok({ step_id: step.id, order: step.order });
}

/**
 * §9.12 mark_unknown_boundary
 * Records an unresolved cross-module boundary.
 */
export function handleMarkUnknownBoundary(
  ctx: ToolContext,
  args: {
    related_entity_ids: string[];
    reason: string;
    evidence?: Evidence[];
  },
): ToolResponse<{ boundary_id: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.related_entity_ids || args.related_entity_ids.length === 0) {
    errors.push(err("INVALID_INPUT", "related_entity_ids must be a non-empty array."));
  }

  if (!args.reason || args.reason.trim() === "") {
    errors.push(err("INVALID_INPUT", "reason is required and must be non-empty."));
  }

  if (args.related_entity_ids) {
    for (const entityId of args.related_entity_ids) {
      const entity = getCodeEntity(db, entityId);
      if (!entity) {
        errors.push(err("ENTITY_NOT_FOUND", `Related code entity not found: ${entityId}`, entityId));
      }
    }
  }

  errors.push(...validateEvidencePaths(args.evidence));

  if (errors.length > 0) return fail(errors);

  const boundary = createUnknownBoundary(db, {
    related_entity_ids: args.related_entity_ids,
    reason: args.reason,
    evidence: args.evidence ?? [],
  });

  return ok({ boundary_id: boundary.id });
}

/**
 * §9.17 query_block
 * Returns block details, ports, mappings, connectors, and related flow steps.
 */
export function handleQueryBlock(
  ctx: ToolContext,
  args: { block_id: string },
): ToolResponse<{
  block: NonNullable<ReturnType<typeof getBlock>>;
  ports: ReturnType<typeof listPorts>;
  mappings: ReturnType<typeof listBlockCodeMappings>;
  connectors: ReturnType<typeof listConnectors>;
  flow_steps: ReturnType<typeof listFlowSteps>;
}> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  if (!args.block_id) return fail([err("INVALID_INPUT", "block_id is required.")]);

  const block = getBlock(db, args.block_id);
  if (!block) return fail([err("BLOCK_NOT_FOUND", `Block not found: ${args.block_id}`, args.block_id)]);

  const ports = listPorts(db, { block_id: args.block_id });
  const mappings = listBlockCodeMappings(db, { block_id: args.block_id });

  // Collect connectors that reference this block's ports
  const portIds = new Set(ports.map((p) => p.id));
  const allConnectors = listConnectors(db);
  const connectors = allConnectors.filter(
    (c) => portIds.has(c.source_port_id) || portIds.has(c.target_port_id),
  );

  const flow_steps = listFlowSteps(db, { block_id: args.block_id });

  return ok({ block, ports, mappings, connectors, flow_steps });
}

/**
 * §9.18 query_symbols_by_block
 * Returns all code entities mapped to the block.
 */
export function handleQuerySymbolsByBlock(
  ctx: ToolContext,
  args: { block_id: string },
): ToolResponse<{ entities: NonNullable<ReturnType<typeof getCodeEntity>>[] }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  if (!args.block_id) return fail([err("INVALID_INPUT", "block_id is required.")]);

  const block = getBlock(db, args.block_id);
  if (!block) return fail([err("BLOCK_NOT_FOUND", `Block not found: ${args.block_id}`, args.block_id)]);

  const mappings = listBlockCodeMappings(db, { block_id: args.block_id });
  const entities: NonNullable<ReturnType<typeof getCodeEntity>>[] = [];

  for (const mapping of mappings) {
    const entity = getCodeEntity(db, mapping.code_entity_id);
    if (entity) entities.push(entity);
  }

  return ok({ entities });
}

// ── Phase 3: Scanner Tools ─────────────────────────────────────────────────

/**
 * §9.2 scan_repo
 * Scans the repository and persists CodeEntity and CodeEdge records.
 */
export function handleScanRepo(
  ctx: ToolContext,
  args: { repo_path: string },
): ToolResponse<{ entity_count: number; edge_count: number; unsupported_file_count: number }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  if (!args.repo_path || args.repo_path.trim() === "") {
    return fail([err("INVALID_INPUT", "repo_path is required.")] as Diagnostic[]);
  }

  const resolved = path.resolve(args.repo_path);
  if (!fs.existsSync(resolved)) {
    return fail([err("PATH_NOT_FOUND", `repo_path does not exist: ${resolved}`)] as Diagnostic[]);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    return fail([err("NOT_DIRECTORY", `repo_path is not a directory: ${resolved}`)] as Diagnostic[]);
  }

  const result = scanRepo(resolved);

  // Persist entities (idempotent — skip if already exists)
  for (const entity of result.entities) {
    const existing = db.prepare("SELECT id FROM code_entities WHERE id = ?").get(entity.id) as { id: string } | undefined;
    if (existing) continue;
    createCodeEntity(db, {
      type: entity.type,
      name: entity.name,
      file_path: entity.file_path,
      start_line: entity.start_line,
      end_line: entity.end_line,
      metadata: entity.metadata,
    }, /* useProvidedId */ entity.id);
  }

  // Persist edges (idempotent — skip if already exists, skip if target doesn't exist)
  for (const edge of result.edges) {
    const existing = db.prepare("SELECT id FROM code_edges WHERE id = ?").get(edge.id) as { id: string } | undefined;
    if (existing) continue;
    // Skip edges referencing entities outside the scanned repo (e.g. node_modules)
    if (edge.target_entity_id) {
      const targetExists = db.prepare("SELECT id FROM code_entities WHERE id = ?").get(edge.target_entity_id) as { id: string } | undefined;
      if (!targetExists) continue;
    }
    createCodeEdge(db, {
      type: edge.type,
      source_entity_id: edge.source_entity_id,
      target_entity_id: edge.target_entity_id,
      confidence: edge.confidence,
      evidence: edge.evidence,
    }, /* useProvidedId */ edge.id);
  }

  return ok({
    entity_count: result.entities.length,
    edge_count: result.edges.length,
    unsupported_file_count: result.unsupportedFileCount,
  });
}

/**
 * §9.3 list_code_entities
 * Returns matching code entities.
 */
export function handleListCodeEntities(
  ctx: ToolContext,
  args: { filter?: { type?: string; file_path?: string; name_contains?: string } },
): ToolResponse<{ entities: ReturnType<typeof listCodeEntities> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const entities = listCodeEntities(db, args.filter);
  return ok({ entities });
}

/**
 * §9.4 list_code_edges
 * Returns matching code edges.
 */
export function handleListCodeEdges(
  ctx: ToolContext,
  args: { filter?: { type?: string; source_entity_id?: string; target_entity_id?: string } },
): ToolResponse<{ edges: ReturnType<typeof listCodeEdges> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const edges = listCodeEdges(db, args.filter);
  return ok({ edges });
}

// ── Phase 4: Compiler Tools ────────────────────────────────────────────────

/**
 * §9.13 compile_draft_block
 * Validates a single draft block and its associated entities.
 */
export function handleCompileDraftBlock(
  ctx: ToolContext,
  args: { block_id: string },
): ToolResponse<{ block_id: string; can_promote: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  if (!args.block_id) return fail([err("INVALID_INPUT", "block_id is required.")] as Diagnostic[]);

  const result = compileDraftBlock(db, args.block_id);
  return {
    ok: result.can_promote,
    data: { block_id: result.block_id, can_promote: result.can_promote },
    errors: result.errors.length > 0 ? result.errors : undefined,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };
}

/**
 * §9.14 promote_draft_block
 * Promotes a valid draft block to accepted status.
 */
export function handlePromoteDraftBlock(
  ctx: ToolContext,
  args: { block_id: string },
): ToolResponse<{ block_id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  if (!args.block_id) return fail([err("INVALID_INPUT", "block_id is required.")] as Diagnostic[]);

  const result = promoteDraftBlock(db, args.block_id);
  if (!result.can_promote) {
    return {
      ok: false,
      errors: result.errors,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  }

  return ok({ block_id: result.block_id, status: "accepted" });
}

/**
 * §9.15 compile_draft_graph
 * Validates the entire draft/accepted graph.
 */
export function handleCompileDraftGraph(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<{ can_commit: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const result = compileDraftGraph(db);
  return {
    ok: result.can_commit,
    data: { can_commit: result.can_commit },
    errors: result.errors.length > 0 ? result.errors : undefined,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };
}

/**
 * §9.16 commit_snapshot
 * Creates an immutable snapshot of the accepted graph.
 */
export function handleCommitSnapshot(
  ctx: ToolContext,
  args: { git_sha: string },
): ToolResponse<{ snapshot_id: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  if (!args.git_sha || args.git_sha.trim() === "") {
    return fail([err("INVALID_INPUT", "git_sha is required.")] as Diagnostic[]);
  }

  const result = commitSnapshot(db, args.git_sha);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  }

  return ok({ snapshot_id: result.snapshot_id! });
}

// ── suggest_block_candidates ────────────────────────────────────────────────

/**
 * §9.5 suggest_block_candidates
 * Suggest candidate blocks from the code graph using heuristics.
 */
export function handleSuggestBlockCandidates(
  ctx: ToolContext,
  args: { strategy?: string },
): ToolResponse<{ candidates: Array<{ name: string; reason: string; code_entity_ids: string[]; confidence: number }> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const strategy = args.strategy ?? "mixed";
  const entities = listCodeEntities(db);
  const candidates: Array<{ name: string; reason: string; code_entity_ids: string[]; confidence: number }> = [];

  if (strategy === "directory" || strategy === "mixed") {
    // Group by top-level source directory
    const dirMap = new Map<string, string[]>();
    for (const entity of entities) {
      if (entity.type === "file") continue;
      const parts = entity.file_path.split("/");
      const dir = parts.length > 1 ? parts[0] : "root";
      if (!dirMap.has(dir)) dirMap.set(dir, []);
      dirMap.get(dir)!.push(entity.id);
    }
    for (const [dir, ids] of dirMap) {
      if (ids.length >= 2) {
        candidates.push({
          name: dir,
          reason: `Grouped by top-level directory "${dir}"`,
          code_entity_ids: ids,
          confidence: 0.6,
        });
      }
    }
  }

  if (strategy === "component" || strategy === "mixed") {
    // Group React components with nearby entities in the same file
    const components = entities.filter((e) => e.type === "component");
    for (const comp of components) {
      const sameFile = entities.filter(
        (e) => e.file_path === comp.file_path && e.id !== comp.id && e.type !== "file",
      );
      candidates.push({
        name: comp.name,
        reason: `React component "${comp.name}" with ${sameFile.length} co-located entities`,
        code_entity_ids: [comp.id, ...sameFile.map((e) => e.id)],
        confidence: 0.7,
      });
    }
  }

  if (strategy === "route" || strategy === "mixed") {
    // Group by route files — entities in files under routes/ directories
    const routeFiles = new Map<string, string[]>();
    for (const entity of entities) {
      if (entity.type === "file") continue;
      const filePath = entity.file_path;
      if (filePath.includes("routes/") || filePath.includes("routes\\")) {
        const dir = filePath.split("/").slice(0, -1).join("/") || "routes";
        if (!routeFiles.has(dir)) routeFiles.set(dir, []);
        routeFiles.get(dir)!.push(entity.id);
      }
    }
    for (const [dir, ids] of routeFiles) {
      if (ids.length >= 1) {
        candidates.push({
          name: dir.replace(/\//g, "_"),
          reason: `Route group in "${dir}" with ${ids.length} entities`,
          code_entity_ids: ids,
          confidence: 0.75,
        });
      }
    }
  }

  return ok({ candidates });
}

// ── v0.2: Work Package Tools ──────────────────────────────────────────────

/**
 * §12.1 create_work_package
 * Creates a planned work package with isolation boundaries.
 */
export function handleCreateWorkPackage(
  ctx: ToolContext,
  args: {
    id: string;
    name: string;
    type?: string;
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
): ToolResponse<{ work_package_id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.id || args.id.trim() === "") {
    errors.push(err("INVALID_INPUT", "Work package id is required."));
  }
  if (!args.name || args.name.trim() === "") {
    errors.push(err("INVALID_INPUT", "Work package name is required."));
  }

  // Check for duplicate ID
  if (args.id) {
    const existing = getWorkPackage(db, args.id);
    if (existing) {
      errors.push(err("DUPLICATE_ID", `Work package already exists: ${args.id}`, args.id));
    }
  }

  // Validate entity IDs exist when provided
  if (args.included_entity_ids) {
    for (const entityId of args.included_entity_ids) {
      const entity = getCodeEntity(db, entityId);
      if (!entity) {
        errors.push(err("ENTITY_NOT_FOUND", `Included entity not found: ${entityId}`, entityId));
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  const pkg = dbCreateWorkPackage(db, {
    id: args.id,
    name: args.name,
    type: (args.type ?? "unknown") as WorkPackageType,
    scope_paths: args.scope_paths,
    included_entity_ids: args.included_entity_ids,
    excluded_entity_ids: args.excluded_entity_ids,
    allowed_external_refs: args.allowed_external_refs,
    forbidden_ownership: args.forbidden_ownership,
    dependencies_on_packages: args.dependencies_on_packages,
    owner_agent: args.owner_agent,
    open_questions: args.open_questions,
    notes: args.notes,
  });

  return ok({ work_package_id: pkg.id, status: pkg.status });
}

/**
 * §12.1 list_work_packages
 * Lists work packages by status or type.
 */
export function handleListWorkPackages(
  ctx: ToolContext,
  args: { status?: string; type?: string },
): ToolResponse<{ packages: ReturnType<typeof listWorkPackages> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const packages = listWorkPackages(db, {
    status: args.status as WorkPackageStatus | undefined,
    type: args.type as WorkPackageType | undefined,
  });
  return ok({ packages });
}

/**
 * §12.1 update_work_package_status
 * Updates package status with legal transition enforcement.
 */
export function handleUpdateWorkPackageStatus(
  ctx: ToolContext,
  args: { id: string; status: string },
): ToolResponse<{ id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.id) errors.push(err("INVALID_INPUT", "Work package id is required."));
  if (!args.status) errors.push(err("INVALID_INPUT", "Status is required."));

  if (errors.length > 0) return fail(errors);

  const result = updateWorkPackageStatus(db, args.id, args.status as WorkPackageStatus);
  if (!result.ok) {
    return fail([err("INVALID_TRANSITION", result.error!)]);
  }

  return ok({ id: args.id, status: args.status });
}

/**
 * §12.1 check_work_package_conflicts
 * Reports ownership conflicts, scope violations, and missing dependencies.
 */
export function handleCheckWorkPackageConflicts(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<ConflictCheckResult> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const packages = listWorkPackages(db);
  const proposals = listModuleProposals(db);
  const reviews = listProposalReviews(db);

  const result: ConflictCheckResult = {
    duplicate_ownership: [],
    scope_violations: [],
    missing_dependencies: [],
    undeclared_external_refs: [],
    unreviewed_proposals: [],
  };

  // Check duplicate ownership across proposals
  const ownershipMap = new Map<string, string[]>();
  for (const proposal of proposals) {
    if (proposal.status === "rejected") continue;
    const pkg = packages.find(p => p.id === proposal.work_package_id);
    if (!pkg) continue;
    for (const entity of proposal.owned_code_entities) {
      if (entity.role !== "owns") continue;
      if (!ownershipMap.has(entity.code_entity_id)) {
        ownershipMap.set(entity.code_entity_id, []);
      }
      ownershipMap.get(entity.code_entity_id)!.push(pkg.id);
    }
  }
  for (const [entityId, claimingPkgs] of ownershipMap) {
    if (claimingPkgs.length > 1) {
      result.duplicate_ownership.push({
        code_entity_id: entityId,
        claiming_packages: [...new Set(claimingPkgs)],
      });
    }
  }

  // Check scope violations
  for (const proposal of proposals) {
    if (proposal.status === "rejected") continue;
    const pkg = packages.find(p => p.id === proposal.work_package_id);
    if (!pkg) continue;
    for (const entity of proposal.owned_code_entities) {
      if (entity.role !== "owns") continue;
      const codeEntity = getCodeEntity(db, entity.code_entity_id);
      if (!codeEntity) continue;
      // Check if entity file_path is within any scope_path
      const inScope = pkg.scope_paths.some(scope => {
        // Simple glob-like match: check if file_path starts with scope prefix
        const prefix = scope.replace(/\*\*\/?$/, "").replace(/\*$/, "");
        return codeEntity.file_path.startsWith(prefix);
      });
      // Check if entity is in forbidden_ownership
      const forbidden = pkg.forbidden_ownership.some(fp => {
        const prefix = fp.replace(/\*\*\/?$/, "").replace(/\*$/, "");
        return codeEntity.file_path.startsWith(prefix);
      });
      if (forbidden) {
        result.scope_violations.push({
          package_id: pkg.id,
          entity_id: entity.code_entity_id,
          reason: `Entity is in forbidden_ownership path`,
        });
      } else if (!inScope && pkg.scope_paths.length > 0) {
        // Only flag if scope_paths is defined and entity is outside
        const inIncluded = pkg.included_entity_ids.includes(entity.code_entity_id);
        if (!inIncluded) {
          result.scope_violations.push({
            package_id: pkg.id,
            entity_id: entity.code_entity_id,
            reason: `Entity file "${codeEntity.file_path}" is outside package scope paths`,
          });
        }
      }
    }
  }

  // Check missing dependencies
  for (const pkg of packages) {
    for (const depId of pkg.dependencies_on_packages) {
      const depPkg = packages.find(p => p.id === depId);
      if (!depPkg) {
        result.missing_dependencies.push({
          package_id: pkg.id,
          dependency: depId,
        });
      }
    }
  }

  // Check unreviewed proposals
  for (const proposal of proposals) {
    if (proposal.status === "submitted" || proposal.status === "reviewing") {
      const proposalReviews = reviews.filter(r => r.proposal_id === proposal.id);
      if (proposalReviews.length === 0) {
        result.unreviewed_proposals.push(proposal.id);
      }
    }
  }

  return ok(result);
}

// ── v0.2: Proposal Tools ───────────────────────────────────────────────────

/**
 * §12.2 create_module_proposal
 * Creates a proposal for one work package.
 */
export function handleCreateModuleProposal(
  ctx: ToolContext,
  args: {
    id: string;
    work_package_id: string;
    module_name: string;
    module_type?: string;
    purpose?: string;
    confidence?: number;
  },
): ToolResponse<{ proposal_id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.id || args.id.trim() === "") errors.push(err("INVALID_INPUT", "Proposal id is required."));
  if (!args.work_package_id) errors.push(err("INVALID_INPUT", "work_package_id is required."));
  if (!args.module_name || args.module_name.trim() === "") errors.push(err("INVALID_INPUT", "module_name is required."));

  // Validate work package exists
  if (args.work_package_id) {
    const pkg = getWorkPackage(db, args.work_package_id);
    if (!pkg) {
      errors.push(err("WORK_PACKAGE_NOT_FOUND", `Work package not found: ${args.work_package_id}`, args.work_package_id));
    } else {
      // Check if work package already has a merged proposal
      const existingProposals = listModuleProposals(db, { work_package_id: args.work_package_id });
      const merged = existingProposals.find(p => p.status === "merged");
      if (merged) {
        errors.push(err("ALREADY_MERGED", `Work package ${args.work_package_id} already has a merged proposal: ${merged.id}`));
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  const proposal = dbCreateModuleProposal(db, {
    id: args.id,
    work_package_id: args.work_package_id,
    module_name: args.module_name,
    module_type: (args.module_type ?? "unknown") as WorkPackageType,
    purpose: args.purpose,
    confidence: args.confidence,
  });

  return ok({ proposal_id: proposal.id, status: proposal.status });
}

/**
 * §12.2 attach_proposal_entity
 * Adds owned/used/entrypoint entity evidence to a proposal.
 */
export function handleAttachProposalEntity(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    entity_type: string;
    code_entity_id: string;
    role?: string;
    evidence?: Evidence[];
    reason?: string;
    confidence?: number;
  },
): ToolResponse<{ ok: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));
  if (!args.entity_type || !["owned", "used", "entrypoint"].includes(args.entity_type)) {
    errors.push(err("INVALID_INPUT", 'entity_type must be "owned", "used", or "entrypoint".'));
  }
  if (!args.code_entity_id) errors.push(err("INVALID_INPUT", "code_entity_id is required."));

  // Validate proposal exists
  let proposal = null;
  if (args.proposal_id) {
    proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
  }

  // Validate code entity exists
  if (args.code_entity_id) {
    const entity = getCodeEntity(db, args.code_entity_id);
    if (!entity) errors.push(err("ENTITY_NOT_FOUND", `Code entity not found: ${args.code_entity_id}`, args.code_entity_id));
  }

  // Validate evidence
  errors.push(...validateEvidencePaths(args.evidence));

  // Scope validation for owned entities
  if (proposal && args.entity_type === "owned" && args.code_entity_id) {
    const pkg = getWorkPackage(db, proposal.work_package_id);
    if (pkg) {
      if (isEntityForbidden(db, args.code_entity_id, pkg)) {
        errors.push(err("SCOPE_VIOLATION", `Entity is in forbidden_ownership path for package ${pkg.id}`));
      } else if (!isEntityInScope(db, args.code_entity_id, pkg) && pkg.scope_paths.length > 0) {
        if (!pkg.included_entity_ids.includes(args.code_entity_id)) {
          errors.push(err("SCOPE_VIOLATION", `Entity is outside scope paths for package ${pkg.id}`));
        }
      }
    }
  }

  // External ref validation for used entities
  if (proposal && args.entity_type === "used" && args.code_entity_id) {
    const pkg = getWorkPackage(db, proposal.work_package_id);
    if (pkg) {
      if (!isEntityAllowedExternal(db, args.code_entity_id, pkg)) {
        errors.push(err("EXTERNAL_REF_NOT_ALLOWED", `Entity is not in allowed_external_refs for package ${pkg.id}`));
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  const result = appendProposalEntity(db, args.proposal_id, args.entity_type as "owned" | "used" | "entrypoint", {
    code_entity_id: args.code_entity_id,
    role: (args.role ?? (args.entity_type === "owned" ? "owns" : "uses")) as any,
    evidence: args.evidence ?? [],
    reason: args.reason ?? "",
    confidence: args.confidence ?? 1.0,
  });

  if (!result.ok) return fail([err("ATTACH_FAILED", result.error!)]);

  return ok({ ok: true });
}

/**
 * §12.2 add_proposal_port
 * Adds a proposed port to a proposal.
 */
export function handleAddProposalPort(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    name: string;
    direction: string;
    contract?: string;
    evidence?: Evidence[];
    confidence?: number;
  },
): ToolResponse<{ ok: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));
  if (!args.name || args.name.trim() === "") errors.push(err("INVALID_INPUT", "Port name is required."));
  if (!args.direction || !["in", "out"].includes(args.direction)) {
    errors.push(err("INVALID_INPUT", 'direction must be "in" or "out".'));
  }

  if (args.proposal_id) {
    const proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
  }

  errors.push(...validateEvidencePaths(args.evidence));

  if (errors.length > 0) return fail(errors);

  const result = appendProposalPort(db, args.proposal_id, {
    name: args.name,
    direction: args.direction as "in" | "out",
    contract: args.contract ?? "",
    evidence: args.evidence ?? [],
    confidence: args.confidence ?? 1.0,
  });

  if (!result.ok) return fail([err("ATTACH_FAILED", result.error!)]);

  return ok({ ok: true });
}

/**
 * §12.2 add_proposal_dependency
 * Adds incoming or outgoing dependency evidence.
 */
export function handleAddProposalDependency(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    direction: string;
    target_work_package_id?: string;
    target_code_entity_id?: string;
    protocol?: string;
    evidence?: Evidence[];
    reason?: string;
    confidence?: number;
  },
): ToolResponse<{ ok: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));
  if (!args.direction || !["incoming", "outgoing"].includes(args.direction)) {
    errors.push(err("INVALID_INPUT", 'direction must be "incoming" or "outgoing".'));
  }

  if (args.proposal_id) {
    const proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
  }

  errors.push(...validateEvidencePaths(args.evidence));

  if (errors.length > 0) return fail(errors);

  const result = appendProposalDependency(db, args.proposal_id, args.direction as "incoming" | "outgoing", {
    target_work_package_id: args.target_work_package_id,
    target_code_entity_id: args.target_code_entity_id,
    direction: args.direction as "incoming" | "outgoing",
    protocol: (args.protocol ?? "unknown") as ProposalProtocol,
    evidence: args.evidence ?? [],
    reason: args.reason ?? "",
    confidence: args.confidence ?? 1.0,
  });

  if (!result.ok) return fail([err("ATTACH_FAILED", result.error!)]);

  return ok({ ok: true });
}

/**
 * §12.2 add_proposal_flow
 * Adds an internal proposed flow.
 */
export function handleAddProposalFlow(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    name: string;
    entrypoint_entity_id: string;
    steps?: Array<{
      order: number;
      code_entity_id: string;
      trigger?: string;
      evidence?: Evidence[];
      confidence?: number;
    }>;
    confidence?: number;
  },
): ToolResponse<{ ok: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));
  if (!args.name || args.name.trim() === "") errors.push(err("INVALID_INPUT", "Flow name is required."));
  if (!args.entrypoint_entity_id) errors.push(err("INVALID_INPUT", "entrypoint_entity_id is required."));

  if (args.proposal_id) {
    const proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
  }

  if (args.entrypoint_entity_id) {
    const entity = getCodeEntity(db, args.entrypoint_entity_id);
    if (!entity) errors.push(err("ENTITY_NOT_FOUND", `Entrypoint entity not found: ${args.entrypoint_entity_id}`, args.entrypoint_entity_id));
  }

  if (errors.length > 0) return fail(errors);

  const steps = (args.steps ?? []).map(s => ({
    order: s.order,
    code_entity_id: s.code_entity_id,
    trigger: s.trigger ?? "",
    evidence: s.evidence ?? [],
    confidence: s.confidence ?? 1.0,
  }));

  const result = appendProposalFlow(db, args.proposal_id, {
    name: args.name,
    entrypoint_entity_id: args.entrypoint_entity_id,
    steps,
    confidence: args.confidence ?? 1.0,
  });

  if (!result.ok) return fail([err("ATTACH_FAILED", result.error!)]);

  return ok({ ok: true });
}

/**
 * §12.2 mark_proposal_gap
 * Records unresolved module-local uncertainty.
 */
export function handleMarkProposalGap(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    kind: string;
    related_entity_ids?: string[];
    description: string;
    suggested_resolution?: string;
  },
): ToolResponse<{ ok: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));
  if (!args.kind) errors.push(err("INVALID_INPUT", "kind is required."));
  if (!args.description || args.description.trim() === "") errors.push(err("INVALID_INPUT", "description is required."));

  if (args.proposal_id) {
    const proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
  }

  if (errors.length > 0) return fail(errors);

  const result = appendProposalGap(db, args.proposal_id, {
    kind: args.kind as ProposalGapKind,
    related_entity_ids: args.related_entity_ids ?? [],
    description: args.description,
    suggested_resolution: args.suggested_resolution,
  });

  if (!result.ok) return fail([err("ATTACH_FAILED", result.error!)]);

  return ok({ ok: true });
}

/**
 * §12.2 submit_module_proposal
 * Marks proposal as ready for review.
 */
export function handleSubmitModuleProposal(
  ctx: ToolContext,
  args: {
    proposal_id: string;
  },
): ToolResponse<{ proposal_id: string; status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));

  let proposal = null;
  if (args.proposal_id) {
    proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) {
      errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
    } else {
      // Validate proposal has meaningful content
      if (!proposal.purpose || proposal.purpose.trim() === "") {
        errors.push(err("INVALID_INPUT", "Proposal must have a purpose before submission."));
      }
      if (proposal.owned_code_entities.length === 0 && proposal.used_code_entities.length === 0) {
        // Allow submission if there are gaps explaining why
        if (proposal.coverage_gaps.length === 0) {
          errors.push(err("INVALID_INPUT", "Proposal must have at least one owned or used entity, or coverage gaps explaining why."));
        }
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  const result = updateModuleProposalStatus(db, args.proposal_id, "submitted");
  if (!result.ok) return fail([err("STATUS_UPDATE_FAILED", result.error!)]);

  return ok({ proposal_id: args.proposal_id, status: "submitted" });
}

// ── v0.2: Review Tools ─────────────────────────────────────────────────────

/**
 * §12.3 submit_proposal_review
 * Records a structured review for a module proposal.
 */
export function handleSubmitProposalReview(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    reviewer_agent?: string;
    status?: string;
    findings?: ReviewFinding[];
    coverage_notes?: string;
    evidence_notes?: string;
    recommended_fixes?: string[];
  },
): ToolResponse<{ review_id: string; status: string; proposal_id: string; proposal_status: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));

  // Validate proposal exists
  if (args.proposal_id) {
    const proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
  }

  // Validate findings have required fields
  if (args.findings) {
    for (const finding of args.findings) {
      if (!finding.priority || !["P0", "P1", "P2", "P3"].includes(finding.priority)) {
        errors.push(err("INVALID_INPUT", "Finding priority must be P0, P1, P2, or P3."));
      }
      if (!finding.title || finding.title.trim() === "") {
        errors.push(err("INVALID_INPUT", "Finding title is required."));
      }
      if (!finding.expected || finding.expected.trim() === "") {
        errors.push(err("INVALID_INPUT", "Finding expected is required."));
      }
      if (!finding.observed || finding.observed.trim() === "") {
        errors.push(err("INVALID_INPUT", "Finding observed is required."));
      }
      if (!finding.recommendation || finding.recommendation.trim() === "") {
        errors.push(err("INVALID_INPUT", "Finding recommendation is required."));
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  const review = dbCreateProposalReview(db, {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    proposal_id: args.proposal_id,
    reviewer_agent: args.reviewer_agent,
    status: (args.status ?? "needs_revision") as ProposalReviewStatus,
    findings: args.findings ?? [],
    coverage_notes: args.coverage_notes,
    evidence_notes: args.evidence_notes,
    recommended_fixes: args.recommended_fixes,
  });

  // Side effects: drive proposal status based on review outcome.
  // Review pass does NOT auto-approve — it moves submitted → reviewing.
  // needs_revision/reject move proposal when legal.
  const proposal = getModuleProposal(db, args.proposal_id)!;
  const reviewStatus = review.status;
  const proposalWarnings: Diagnostic[] = [];

  if (reviewStatus === "pass" && proposal.status === "submitted") {
    const transition = updateModuleProposalStatus(db, args.proposal_id, "reviewing");
    if (!transition.ok) {
      proposalWarnings.push(warn("STATUS_TRANSITION_SKIPPED", `Could not move proposal to reviewing: ${transition.error}`));
    }
  } else if (reviewStatus === "needs_revision" && (proposal.status === "submitted" || proposal.status === "reviewing")) {
    const transition = updateModuleProposalStatus(db, args.proposal_id, "needs_revision");
    if (!transition.ok) {
      proposalWarnings.push(warn("STATUS_TRANSITION_SKIPPED", `Could not move proposal to needs_revision: ${transition.error}`));
    }
  } else if (reviewStatus === "reject" && proposal.status !== "merged" && proposal.status !== "rejected") {
    const transition = updateModuleProposalStatus(db, args.proposal_id, "rejected");
    if (!transition.ok) {
      proposalWarnings.push(warn("STATUS_TRANSITION_SKIPPED", `Could not move proposal to rejected: ${transition.error}`));
    }
  }

  // Re-read proposal status after potential transition
  const updatedProposal = getModuleProposal(db, args.proposal_id)!;

  const response: ToolResponse<{ review_id: string; status: string; proposal_id: string; proposal_status: string }> = {
    ok: true,
    data: {
      review_id: review.id,
      status: review.status,
      proposal_id: args.proposal_id,
      proposal_status: updatedProposal.status,
    },
  };
  if (proposalWarnings.length > 0) {
    response.warnings = proposalWarnings;
  }
  return response;
}

/**
 * §12.3 approve_module_proposal
 * Coordinator-only: approve a reviewed proposal so it can be merged.
 * Valid from: submitted, reviewing, needs_revision.
 * Requires: at least one pass review, no unresolved P0/P1 findings.
 */
export function handleApproveModuleProposal(
  ctx: ToolContext,
  args: {
    proposal_id: string;
    coordinator_agent?: string;
    notes?: string;
  },
): ToolResponse<{
  proposal_id: string;
  status: "approved";
  previous_status: string;
  review_count: number;
  pass_review_count: number;
  unresolved_blocking_findings: number;
}> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));

  let proposal: ReturnType<typeof getModuleProposal> = null;
  if (args.proposal_id) {
    proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) {
      errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
    } else {
      // Cannot approve draft, rejected, or merged proposals
      if (proposal.status === "draft") {
        errors.push(err("INVALID_STATUS", "Cannot approve a draft proposal. Submit it first."));
      } else if (proposal.status === "rejected") {
        errors.push(err("INVALID_STATUS", "Cannot approve a rejected proposal."));
      } else if (proposal.status === "merged") {
        errors.push(err("INVALID_STATUS", "Proposal is already merged."));
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  // Check reviews
  const reviews = listProposalReviews(db, { proposal_id: args.proposal_id });
  const reviewCount = reviews.length;
  const passReviews = reviews.filter(r => r.status === "pass");
  const passReviewCount = passReviews.length;

  if (reviewCount === 0) {
    return fail([err("NO_REVIEWS", "Proposal has no reviews. At least one review is required before approval.")]);
  }

  if (passReviewCount === 0) {
    return fail([err("NO_PASS_REVIEW", "Proposal has no pass reviews. At least one pass review is required before approval.")]);
  }

  // Check if the latest review is reject (by insertion order — last element)
  const latestReview = reviews[reviews.length - 1];
  if (latestReview.status === "reject") {
    return fail([err("LATEST_REVIEW_REJECTED", "The latest review rejected this proposal. Approval is not permitted until a new pass review is submitted.")]);
  }

  // Check for unresolved P0/P1 findings across all reviews
  let unresolvedBlocking = 0;
  for (const review of reviews) {
    for (const finding of review.findings) {
      if ((finding.priority === "P0" || finding.priority === "P1") &&
          finding.resolution !== "resolved" && finding.resolution !== "rejected") {
        unresolvedBlocking++;
      }
    }
  }

  if (unresolvedBlocking > 0) {
    return fail([err("UNRESOLVED_FINDING", `Proposal has ${unresolvedBlocking} unresolved P0/P1 finding(s). Resolve or reject them before approval.`)]);
  }

  // Perform status transitions
  const previousStatus = proposal!.status;

  if (proposal!.status === "submitted") {
    // submitted → reviewing → approved
    const r1 = updateModuleProposalStatus(db, args.proposal_id, "reviewing");
    if (!r1.ok) {
      return fail([err("STATUS_UPDATE_FAILED", `Could not transition to reviewing: ${r1.error}`)]);
    }
  }

  // Now at reviewing (or was already reviewing/needs_revision)
  if (proposal!.status === "needs_revision") {
    // needs_revision → submitted → reviewing → approved is not allowed directly.
    // But we can go needs_revision → submitted → reviewing → approved.
    // However the transition table says needs_revision → submitted is legal.
    // And submitted → reviewing is legal. So we chain them.
    const r1 = updateModuleProposalStatus(db, args.proposal_id, "submitted");
    if (!r1.ok) {
      return fail([err("STATUS_UPDATE_FAILED", `Could not transition from needs_revision to submitted: ${r1.error}`)]);
    }
    const r2 = updateModuleProposalStatus(db, args.proposal_id, "reviewing");
    if (!r2.ok) {
      return fail([err("STATUS_UPDATE_FAILED", `Could not transition to reviewing: ${r2.error}`)]);
    }
  }

  // Now at reviewing → approved
  const rApprove = updateModuleProposalStatus(db, args.proposal_id, "approved");
  if (!rApprove.ok) {
    return fail([err("STATUS_UPDATE_FAILED", `Could not transition to approved: ${rApprove.error}`)]);
  }

  return ok({
    proposal_id: args.proposal_id,
    status: "approved" as const,
    previous_status: previousStatus,
    review_count: reviewCount,
    pass_review_count: passReviewCount,
    unresolved_blocking_findings: 0,
  });
}

/**
 * §12.3 list_proposal_reviews
 * Lists reviews for a proposal.
 */
export function handleListProposalReviews(
  ctx: ToolContext,
  args: { proposal_id?: string },
): ToolResponse<{ reviews: ReturnType<typeof listProposalReviews> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const reviews = listProposalReviews(db, {
    proposal_id: args.proposal_id,
  });
  return ok({ reviews });
}

/**
 * §12.3 resolve_proposal_finding
 * Marks a finding as resolved, rejected, or deferred.
 * P0/P1 cannot be deferred without coordinator override reason.
 */
export function handleResolveProposalFinding(
  ctx: ToolContext,
  args: {
    review_id: string;
    finding_index: number;
    resolution: string;
    resolution_reason?: string;
  },
): ToolResponse<{ ok: boolean }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.review_id) errors.push(err("INVALID_INPUT", "review_id is required."));
  if (args.finding_index === undefined || args.finding_index < 0) {
    errors.push(err("INVALID_INPUT", "finding_index must be a non-negative integer."));
  }
  if (!args.resolution || !["resolved", "rejected", "deferred"].includes(args.resolution)) {
    errors.push(err("INVALID_INPUT", 'resolution must be "resolved", "rejected", or "deferred".'));
  }

  let review = null;
  if (args.review_id) {
    review = getProposalReview(db, args.review_id);
    if (!review) errors.push(err("REVIEW_NOT_FOUND", `Review not found: ${args.review_id}`, args.review_id));
  }

  if (review && args.finding_index !== undefined) {
    if (args.finding_index >= review.findings.length) {
      errors.push(err("INVALID_INPUT", `Finding index ${args.finding_index} is out of range. Review has ${review.findings.length} findings.`));
    } else {
      const finding = review.findings[args.finding_index];
      // P0/P1 cannot be deferred without coordinator override reason
      if (args.resolution === "deferred" && (finding.priority === "P0" || finding.priority === "P1")) {
        if (!args.resolution_reason || args.resolution_reason.trim() === "") {
          errors.push(err("INVALID_INPUT", `P0/P1 findings cannot be deferred without a coordinator override reason.`));
        }
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  // Update the finding's resolution
  const findings = [...review!.findings];
  findings[args.finding_index] = {
    ...findings[args.finding_index],
    resolution: args.resolution as FindingResolution,
    resolution_reason: args.resolution_reason,
  };

  updateProposalReview(db, args.review_id, { findings });

  return ok({ ok: true });
}

// ── v0.2: Merge Tools ─────────────────────────────────────────────────────

/**
 * §12.4 merge_module_proposal
 * Coordinator-only operation that merges an approved proposal into the draft graph.
 * Creates draft block, attaches entities, creates ports and flows.
 */
export function handleMergeModuleProposal(
  ctx: ToolContext,
  args: {
    proposal_id: string;
  },
): ToolResponse<{ block_id: string; proposal_id: string }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const errors: Diagnostic[] = [];

  if (!args.proposal_id) errors.push(err("INVALID_INPUT", "proposal_id is required."));

  let proposal: ReturnType<typeof getModuleProposal> = null;
  if (args.proposal_id) {
    proposal = getModuleProposal(db, args.proposal_id);
    if (!proposal) {
      errors.push(err("PROPOSAL_NOT_FOUND", `Proposal not found: ${args.proposal_id}`, args.proposal_id));
    } else {
      // Check if already merged first (before checking approved status)
      const existingMappings = listMergedProposalMappings(db, { proposal_id: args.proposal_id });
      if (existingMappings.length > 0) {
        errors.push(err("ALREADY_MERGED", `Proposal ${args.proposal_id} has already been merged.`));
      }

      // Check if another proposal for the same work package has already been merged
      const wpMappings = listMergedProposalMappings(db, { work_package_id: proposal.work_package_id });
      if (wpMappings.length > 0 && !wpMappings.some(m => m.proposal_id === args.proposal_id)) {
        errors.push(err("PACKAGE_ALREADY_MERGED", `Work package ${proposal.work_package_id} already has a merged proposal (${wpMappings[0].proposal_id}). Only one proposal per package can be merged.`));
      }

      // Must be approved
      if (proposal.status !== "approved") {
        errors.push(err("NOT_APPROVED", `Proposal must be approved before merge. Current status: ${proposal.status}`));
      }

      // Check for unresolved P0/P1 findings
      const reviews = listProposalReviews(db, { proposal_id: args.proposal_id });
      for (const review of reviews) {
        for (const finding of review.findings) {
          if ((finding.priority === "P0" || finding.priority === "P1") && finding.resolution !== "resolved" && finding.resolution !== "rejected") {
            errors.push(err("UNRESOLVED_FINDING", `Unresolved ${finding.priority} finding: ${finding.title}`));
          }
        }
      }

      // Check for duplicate ownership
      const allProposals = listModuleProposals(db);
      const packages = listWorkPackages(db);
      for (const otherProposal of allProposals) {
        if (otherProposal.id === args.proposal_id || otherProposal.status === "rejected") continue;
        const otherPkg = packages.find(p => p.id === otherProposal.work_package_id);
        if (!otherPkg) continue;
        for (const entity of proposal.owned_code_entities) {
          if (entity.role !== "owns") continue;
          const conflict = otherProposal.owned_code_entities.find(
            e => e.code_entity_id === entity.code_entity_id && e.role === "owns"
          );
          if (conflict) {
            errors.push(err("DUPLICATE_OWNERSHIP", `Entity ${entity.code_entity_id} is also owned by proposal ${otherProposal.id} (package ${otherPkg.id})`));
          }
        }
      }

      // Check for scope violations
      const pkg = packages.find(p => p.id === proposal!.work_package_id);
      if (pkg) {
        for (const entity of proposal!.owned_code_entities) {
          if (entity.role !== "owns") continue;
          if (isEntityForbidden(db, entity.code_entity_id, pkg)) {
            errors.push(err("SCOPE_VIOLATION", `Entity ${entity.code_entity_id} is in forbidden_ownership path for package ${pkg.id}`));
          }
        }
      }
    }
  }

  if (errors.length > 0) return fail(errors);

  // Create draft block
  const block = dbCreateBlock(db, {
    name: proposal!.module_name,
    purpose: proposal!.purpose,
    confidence: proposal!.confidence,
  });

  // Attach owned entities
  for (const entity of proposal!.owned_code_entities) {
    dbAttachCodeEntity(db, {
      block_id: block.id,
      code_entity_id: entity.code_entity_id,
      role: entity.role,
      evidence: entity.evidence,
    });
  }

  // Attach entrypoints
  for (const entrypoint of proposal!.entrypoints) {
    dbAttachCodeEntity(db, {
      block_id: block.id,
      code_entity_id: entrypoint.code_entity_id,
      role: "entrypoint",
      evidence: entrypoint.evidence,
    });
  }

  // Create ports
  for (const port of proposal!.ports) {
    dbCreatePort(db, {
      block_id: block.id,
      name: port.name,
      direction: port.direction,
      contract: port.contract,
    });
  }

  // Create internal flows
  for (const flow of proposal!.internal_flows) {
    const createdFlow = dbCreateFlow(db, {
      name: flow.name,
      entrypoint_entity_id: flow.entrypoint_entity_id,
    });
    for (const step of flow.steps) {
      dbAppendFlowStep(db, {
        flow_id: createdFlow.id,
        block_id: block.id,
        code_entity_id: step.code_entity_id,
        trigger: step.trigger,
        evidence: step.evidence,
      });
    }
  }

  // Record proposal-to-block mapping
  createMergedProposalMapping(db, {
    proposal_id: args.proposal_id,
    work_package_id: proposal!.work_package_id,
    block_id: block.id,
  });

  // Update proposal status
  updateModuleProposalStatus(db, args.proposal_id, "merged");

  // Update work package status to "merged"
  updateWorkPackageStatus(db, proposal!.work_package_id, "merged");

  return ok({ block_id: block.id, proposal_id: args.proposal_id });
}

/**
 * §12.4 list_merged_proposals
 * Returns proposal/block merge mappings.
 */
export function handleListMergedProposals(
  ctx: ToolContext,
  args: { work_package_id?: string },
): ToolResponse<{ mappings: ReturnType<typeof listMergedProposalMappings> }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const mappings = listMergedProposalMappings(db, {
    work_package_id: args.work_package_id,
  });
  return ok({ mappings });
}

// ── v0.2: Quality Gate Tools ───────────────────────────────────────────────

/**
 * §12.5 coverage_report
 * Reports mapped/unmapped entities and directories.
 */
export function handleCoverageReport(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<{
  total_entities: number;
  mapped_entities: number;
  unmapped_entities: string[];
  unmapped_directories: string[];
  entity_coverage: number;
}> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const entities = listCodeEntities(db);
  const mappings = listBlockCodeMappings(db);

  // Find mapped entity IDs
  const mappedIds = new Set(mappings.map(m => m.code_entity_id));

  // Find unmapped entities (excluding file type)
  const unmappedEntities = entities
    .filter(e => e.type !== "file" && !mappedIds.has(e.id))
    .map(e => e.id);

  // Find unmapped directories
  const allDirs = new Set<string>();
  const mappedDirs = new Set<string>();

  for (const entity of entities) {
    if (entity.type === "file") continue;
    const dir = entity.file_path.split("/").slice(0, -1).join("/") || "root";
    allDirs.add(dir);
    if (mappedIds.has(entity.id)) {
      mappedDirs.add(dir);
    }
  }

  const unmappedDirectories = [...allDirs].filter(d => !mappedDirs.has(d));

  const totalNonFile = entities.filter(e => e.type !== "file").length;
  const entityCoverage = totalNonFile > 0 ? (totalNonFile - unmappedEntities.length) / totalNonFile : 1;

  return ok({
    total_entities: totalNonFile,
    mapped_entities: totalNonFile - unmappedEntities.length,
    unmapped_entities: unmappedEntities,
    unmapped_directories: unmappedDirectories,
    entity_coverage: entityCoverage,
  });
}

/**
 * §12.5 detect_missing_modules
 * Detects likely missing feature modules from directory structure.
 */
export function handleDetectMissingModules(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<{ missing_modules: string[] }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const entities = listCodeEntities(db);
  const blocks = listBlocks(db);
  const mappings = listBlockCodeMappings(db);

  // Feature directory patterns
  const featurePatterns = ["src/features/", "src/modules/", "src/domains/", "src/app/routes/"];

  // Find directories that look like feature modules
  const featureDirs = new Set<string>();
  for (const entity of entities) {
    if (entity.type === "file") continue;
    for (const pattern of featurePatterns) {
      if (entity.file_path.startsWith(pattern)) {
        const parts = entity.file_path.split("/");
        // Get the feature directory (e.g., src/features/auth)
        if (parts.length >= 3) {
          featureDirs.add(parts.slice(0, 3).join("/"));
        }
      }
    }
  }

  // Check which feature directories are not covered by any block
  const missingModules: string[] = [];
  for (const dir of featureDirs) {
    const dirEntities = entities.filter(e => e.file_path.startsWith(dir) && e.type !== "file");
    if (dirEntities.length === 0) continue;

    // Check if any entity in this directory is mapped to a block
    const hasMapping = dirEntities.some(e => mappings.some(m => m.code_entity_id === e.id));
    if (!hasMapping) {
      missingModules.push(dir);
    }
  }

  return ok({ missing_modules: missingModules });
}

/**
 * §12.5 detect_shared_dependencies
 * Detects shared dependency candidates.
 */
export function handleDetectSharedDependencies(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<{ candidates: SharedDependencyCandidate[] }> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const entities = listCodeEntities(db);
  const blocks = listBlocks(db);
  const mappings = listBlockCodeMappings(db);
  const edges = listCodeEdges(db);

  // Shared directory patterns
  const sharedPatterns = ["src/types/", "src/utils/", "src/hooks/", "src/lib/", "src/config/"];

  const candidates: SharedDependencyCandidate[] = [];

  for (const pattern of sharedPatterns) {
    const dirEntities = entities.filter(e => e.file_path.startsWith(pattern) && e.type !== "file");
    if (dirEntities.length === 0) continue;

    // Find which blocks use these entities
    const usedByBlocks = new Set<string>();
    for (const entity of dirEntities) {
      // Check if entity is mapped to a block
      const entityMappings = mappings.filter(m => m.code_entity_id === entity.id);
      for (const m of entityMappings) {
        usedByBlocks.add(m.block_id);
      }

      // Check if entity is referenced by edges from other blocks
      for (const edge of edges) {
        if (edge.source_entity_id === entity.id || edge.target_entity_id === entity.id) {
          const otherEntityId = edge.source_entity_id === entity.id ? edge.target_entity_id : edge.source_entity_id;
          if (otherEntityId) {
            const otherMappings = mappings.filter(m => m.code_entity_id === otherEntityId);
            for (const m of otherMappings) {
              usedByBlocks.add(m.block_id);
            }
          }
        }
      }
    }

    // Get the first entity as representative
    const representative = dirEntities[0];

    // Determine recommendation
    let recommendation: SharedDependencyCandidate["recommendation"] = "own_shared_block";
    if (pattern.includes("types/")) recommendation = "own_shared_block";
    else if (pattern.includes("utils/")) recommendation = "own_shared_block";
    else if (pattern.includes("hooks/")) recommendation = "own_shared_block";
    else if (pattern.includes("lib/")) recommendation = "app_shell";
    else if (pattern.includes("config/")) recommendation = "app_shell";

    candidates.push({
      entity_id: representative.id,
      file_path: pattern,
      name: pattern.replace("src/", "").replace("/", ""),
      used_by_packages: [...usedByBlocks],
      recommendation,
    });
  }

  return ok({ candidates });
}

/**
 * §12.5 connector_audit
 * Audits cross-block code edges and connector evidence.
 */
export function handleConnectorAudit(
  ctx: ToolContext,
  args: Record<string, never>,
): ToolResponse<{
  unexplained_edges: string[];
  weak_connectors: WeakConnector[];
}> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const edges = listCodeEdges(db);
  const mappings = listBlockCodeMappings(db);
  const connectors = listConnectors(db);
  const ports = listPorts(db);
  const unknownBoundaries = listUnknownBoundaries(db);

  // Build entity-to-block map
  const entityBlockMap = new Map<string, string>();
  for (const mapping of mappings) {
    entityBlockMap.set(mapping.code_entity_id, mapping.block_id);
  }

  // Build port-to-block map
  const portBlockMap = new Map<string, string>();
  for (const port of ports) {
    portBlockMap.set(port.id, port.block_id);
  }

  // Find unknown boundary entity IDs
  const unknownEntityIds = new Set(unknownBoundaries.flatMap(ub => ub.related_entity_ids));

  const unexplainedEdges: string[] = [];
  const weakConnectors: WeakConnector[] = [];

  // Check cross-block edges
  for (const edge of edges) {
    if (!edge.target_entity_id) continue;

    const sourceBlock = entityBlockMap.get(edge.source_entity_id);
    const targetBlock = entityBlockMap.get(edge.target_entity_id);

    // Skip if both entities are in the same block or not mapped
    if (!sourceBlock || !targetBlock || sourceBlock === targetBlock) continue;

    // Check if there's a connector between these blocks
    const hasConnector = connectors.some(c => {
      const srcBlock = portBlockMap.get(c.source_port_id);
      const tgtBlock = portBlockMap.get(c.target_port_id);
      return (srcBlock === sourceBlock && tgtBlock === targetBlock) ||
             (srcBlock === targetBlock && tgtBlock === sourceBlock);
    });

    // Check if there's an unknown boundary
    const hasUnknown = unknownEntityIds.has(edge.source_entity_id) || unknownEntityIds.has(edge.target_entity_id);

    if (!hasConnector && !hasUnknown) {
      unexplainedEdges.push(edge.id);
    }
  }

  // Check for weak connectors (connectors without evidence)
  for (const connector of connectors) {
    if (!connector.evidence || connector.evidence.length === 0) {
      weakConnectors.push({
        connector_id: connector.id,
        source_port_id: connector.source_port_id,
        target_port_id: connector.target_port_id,
        issue: "Connector has no evidence",
      });
    }
  }

  return ok({ unexplained_edges: unexplainedEdges, weak_connectors: weakConnectors });
}

/**
 * §12.5 flow_sufficiency_check
 * Evaluates whether flows are sufficient for repository complexity.
 */
export function handleFlowSufficiencyCheck(
  ctx: ToolContext,
  args: { complexity?: string },
): ToolResponse<{
  flow_count: number;
  required_flows: number;
  sufficient: boolean;
  missing_flow_recommendations: string[];
}> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const complexity = (args.complexity ?? "medium") as RepoComplexity;
  const flows = listFlows(db);
  const entities = listCodeEntities(db);

  // Minimum flow counts per PRD §11.6
  const requiredFlows: Record<RepoComplexity, number> = {
    small: 1,
    medium: 3,
    complex: 5,
  };

  const required = requiredFlows[complexity];
  const flowCount = flows.length;
  const sufficient = flowCount >= required;

  // Recommend missing flow categories
  const missingRecommendations: string[] = [];
  if (flowCount < required) {
    // Check what types of flows exist
    const hasAuthFlow = flows.some(f => f.name.toLowerCase().includes("auth") || f.name.toLowerCase().includes("login"));
    const hasListFlow = flows.some(f => f.name.toLowerCase().includes("list") || f.name.toLowerCase().includes("read"));
    const hasMutationFlow = flows.some(f => f.name.toLowerCase().includes("create") || f.name.toLowerCase().includes("update") || f.name.toLowerCase().includes("delete"));

    if (!hasAuthFlow) missingRecommendations.push("Add authentication/primary entry flow");
    if (!hasListFlow) missingRecommendations.push("Add list/detail read flow");
    if (!hasMutationFlow) missingRecommendations.push("Add create/update/delete mutation flow");
  }

  return ok({
    flow_count: flowCount,
    required_flows: required,
    sufficient,
    missing_flow_recommendations: missingRecommendations,
  });
}

/**
 * §12.5 quality_gate_report
 * Runs all quality checks and returns ready/not-ready decision.
 */
export function handleQualityGateReport(
  ctx: ToolContext,
  args: { complexity?: string },
): ToolResponse<QualityGateReport> {
  const db = requireDb(ctx);
  if (!db) return fail([noSessionError()]);

  const complexity = (args.complexity ?? "medium") as RepoComplexity;

  // Run all quality checks
  const coverageResult = handleCoverageReport(ctx, {} as any);
  const missingModulesResult = handleDetectMissingModules(ctx, {} as any);
  const sharedDepsResult = handleDetectSharedDependencies(ctx, {} as any);
  const connectorAuditResult = handleConnectorAudit(ctx, {} as any);
  const flowSufficiencyResult = handleFlowSufficiencyCheck(ctx, { complexity });

  // Compile results
  const report: QualityGateReport = {
    id: `qg-${Date.now()}`,
    created_at: new Date().toISOString(),
    repo_complexity: complexity,
    entity_coverage: coverageResult.data?.entity_coverage ?? 0,
    runtime_entity_coverage: coverageResult.data?.entity_coverage ?? 0,
    feature_directory_coverage: 1 - (missingModulesResult.data?.missing_modules.length ?? 0) / Math.max(1, (missingModulesResult.data?.missing_modules.length ?? 0) + 1),
    unmapped_entities: coverageResult.data?.unmapped_entities ?? [],
    unmapped_directories: coverageResult.data?.unmapped_directories ?? [],
    missing_feature_modules: missingModulesResult.data?.missing_modules ?? [],
    shared_dependency_candidates: sharedDepsResult.data?.candidates ?? [],
    unexplained_cross_block_edges: connectorAuditResult.data?.unexplained_edges ?? [],
    weak_connectors: connectorAuditResult.data?.weak_connectors ?? [],
    flow_count: flowSufficiencyResult.data?.flow_count ?? 0,
    missing_flow_recommendations: flowSufficiencyResult.data?.missing_flow_recommendations ?? [],
    open_review_findings: [],
    maintenance_simulation_results: [],
    ready_for_maintenance: false,
    errors: [],
    warnings: [],
  };

  // Determine readiness
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  // Coverage threshold
  const coverageThreshold = complexity === "small" ? 0.80 : 0.85;
  if (report.entity_coverage < coverageThreshold) {
    errors.push(err("LOW_COVERAGE", `Entity coverage ${report.entity_coverage.toFixed(2)} is below threshold ${coverageThreshold}`));
  }

  // Missing modules
  if (report.missing_feature_modules.length > 0) {
    warnings.push(warn("MISSING_MODULES", `${report.missing_feature_modules.length} feature module(s) not modeled: ${report.missing_feature_modules.join(", ")}`));
  }

  // Unexplained edges
  if (report.unexplained_cross_block_edges.length > 0) {
    warnings.push(warn("UNEXPLAINED_EDGES", `${report.unexplained_cross_block_edges.length} cross-block edge(s) have no connector or unknown boundary`));
  }

  // Flow sufficiency
  if (!flowSufficiencyResult.data?.sufficient) {
    const requiredFlows = flowSufficiencyResult.data?.required_flows ?? 0;
    errors.push(warn("INSUFFICIENT_FLOWS", `Flow count ${report.flow_count} is below required ${requiredFlows} for ${complexity} repository`));
  }

  // Set readiness
  report.errors = errors;
  report.warnings = warnings;
  report.ready_for_maintenance = errors.length === 0;

  return ok(report);
}
