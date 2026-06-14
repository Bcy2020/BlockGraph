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
  listCodeEntities,
  listCodeEdges,
  listConnectors,
  listFlowSteps,
  listPorts,
} from "../graph/draft.js";
import { scanRepo } from "../scanner/tsScanner.js";
import { compileDraftBlock, promoteDraftBlock, compileDraftGraph, commitSnapshot } from "../graph/compiler.js";
import type {
  CodeEntityType,
  Diagnostic,
  Evidence,
  PortDirection,
  ToolResponse,
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
 * Creates or resets an initialization session for the repository.
 */
export function handleBeginInitialization(
  ctx: ToolContext,
  args: { repo_path: string },
): ToolResponse<{ session_id: string; repo_path: string }> {
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

  ctx.db = openStore(resolved);
  ctx.repoPath = resolved;

  const sessionId = `session-${Date.now()}`;
  return ok({ session_id: sessionId, repo_path: resolved });
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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
  if (!db) return fail([err("NO_SESSION", "No active session. Call begin_initialization first.")] as Diagnostic[]);

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
