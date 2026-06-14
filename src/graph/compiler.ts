/**
 * BlockGraph MCP v0.1 — Compiler / Validator
 * Enforces the draft → compile → promote → snapshot protocol.
 * PRD §9.13–§9.16.
 */
import type Database from "better-sqlite3";
import type { Diagnostic } from "./schema.js";
import {
  getBlock,
  getCodeEntity,
  listBlocks,
  listBlockCodeMappings,
  listCodeEdges,
  listCodeEntities,
  listConnectors,
  listFlowSteps,
  listFlows,
  listPorts,
  listUnknownBoundaries,
  updateBlockStatus,
  updateFlowStatus,
  createSnapshot,
  getSnapshot,
} from "./draft.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompileBlockResult {
  block_id: string;
  can_promote: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export interface CompileGraphResult {
  can_commit: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function err(code: string, message: string, entity_id?: string, suggested_fix?: string): Diagnostic {
  return {
    code,
    message,
    severity: "error",
    ...(entity_id ? { entity_id } : {}),
    ...(suggested_fix ? { suggested_fix } : {}),
  };
}

function warn(code: string, message: string, entity_id?: string): Diagnostic {
  return {
    code,
    message,
    severity: "warning",
    ...(entity_id ? { entity_id } : {}),
  };
}

function validateEvidence(evidence: unknown[]): Diagnostic[] {
  const errors: Diagnostic[] = [];
  if (!Array.isArray(evidence)) return errors;
  for (const ev of evidence) {
    if (typeof ev !== "object" || ev === null) continue;
    const e = ev as Record<string, unknown>;
    if (!e.file_path || (typeof e.file_path === "string" && e.file_path.trim() === "")) {
      errors.push(err("INVALID_EVIDENCE", "Evidence file_path must be non-empty."));
    }
    if (typeof e.start_line === "number" && typeof e.end_line === "number") {
      if (e.start_line < 1) {
        errors.push(err("INVALID_EVIDENCE", "Evidence start_line must be >= 1."));
      }
      if (e.end_line < e.start_line) {
        errors.push(err("INVALID_EVIDENCE", "Evidence end_line must be >= start_line."));
      }
    }
  }
  return errors;
}

// ── §9.13 compile_draft_block ──────────────────────────────────────────────

export function compileDraftBlock(db: Database.Database, blockId: string): CompileBlockResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  // Block must exist
  const block = getBlock(db, blockId);
  if (!block) {
    errors.push(err("BLOCK_NOT_FOUND", `Block not found: ${blockId}`, blockId));
    return { block_id: blockId, can_promote: false, errors, warnings };
  }

  // Non-empty name
  if (!block.name || block.name.trim() === "") {
    errors.push(err("EMPTY_NAME", "Block name must be non-empty.", blockId));
  }

  // Non-empty purpose
  if (!block.purpose || block.purpose.trim() === "") {
    errors.push(err("EMPTY_PURPOSE", "Block purpose must be non-empty.", blockId));
  }

  // Check if root block (no parent)
  const isRoot = block.parent_id === null;

  // Non-root blocks must have at least one code entity mapping
  const mappings = listBlockCodeMappings(db, { block_id: blockId });
  if (!isRoot && mappings.length === 0) {
    errors.push(err("NO_CODE_MAPPING", "Non-root block must have at least one code entity mapping.", blockId));
  }

  // Validate mapped code entities exist
  for (const mapping of mappings) {
    const entity = getCodeEntity(db, mapping.code_entity_id);
    if (!entity) {
      errors.push(err("MISSING_CODE_ENTITY", `Mapped code entity not found: ${mapping.code_entity_id}`, mapping.code_entity_id));
    }
    // Validate evidence on mappings
    errors.push(...validateEvidence(mapping.evidence));
  }

  // Validate ports belong to existing blocks
  const ports = listPorts(db, { block_id: blockId });
  for (const port of ports) {
    const portBlock = getBlock(db, port.block_id);
    if (!portBlock) {
      errors.push(err("ORPHAN_PORT", `Port ${port.id} references non-existent block: ${port.block_id}`, port.id));
    }
  }

  // Validate connectors referencing this block's ports
  const portIds = new Set(ports.map((p) => p.id));
  const allConnectors = listConnectors(db);
  for (const connector of allConnectors) {
    if (portIds.has(connector.source_port_id) || portIds.has(connector.target_port_id)) {
      const srcPort = ports.find((p) => p.id === connector.source_port_id);
      const srcPortOther = !srcPort ? listPorts(db).find((p) => p.id === connector.source_port_id) : undefined;
      const tgtPort = ports.find((p) => p.id === connector.target_port_id);
      const tgtPortOther = !tgtPort ? listPorts(db).find((p) => p.id === connector.target_port_id) : undefined;

      if (!srcPort && !srcPortOther) {
        errors.push(err("MISSING_PORT", `Connector ${connector.id} references non-existent source port: ${connector.source_port_id}`, connector.id));
      }
      if (!tgtPort && !tgtPortOther) {
        errors.push(err("MISSING_PORT", `Connector ${connector.id} references non-existent target port: ${connector.target_port_id}`, connector.id));
      }
      errors.push(...validateEvidence(connector.evidence));
    }
  }

  // Validate flow steps referencing this block
  const flowSteps = listFlowSteps(db, { block_id: blockId });
  for (const step of flowSteps) {
    const entity = getCodeEntity(db, step.code_entity_id);
    if (!entity) {
      errors.push(err("MISSING_CODE_ENTITY", `Flow step ${step.id} references non-existent code entity: ${step.code_entity_id}`, step.id));
    }
    errors.push(...validateEvidence(step.evidence));
  }

  // Warning: cross-block code edges without connector or unknown boundary
  if (mappings.length > 0) {
    const entityIds = new Set(mappings.map((m) => m.code_entity_id));
    const allEdges = listCodeEdges(db);
    const unknownBoundaries = listUnknownBoundaries(db);
    const unknownEntityIds = new Set(unknownBoundaries.flatMap((ub) => ub.related_entity_ids));

    for (const edge of allEdges) {
      if (!edge.target_entity_id) continue;
      const sourceInBlock = entityIds.has(edge.source_entity_id);
      const targetInBlock = entityIds.has(edge.target_entity_id);
      if (sourceInBlock && !targetInBlock) {
        // Cross-block edge outward: check if target has unknown boundary
        const hasUnknown = unknownEntityIds.has(edge.target_entity_id);
        if (!hasUnknown) {
          warnings.push(warn("CROSS_BLOCK_EDGE", `Cross-block code edge ${edge.id} has no connector or unknown boundary.`, edge.id));
        }
      } else if (!sourceInBlock && targetInBlock) {
        // Cross-block edge inward: check if source has unknown boundary
        const hasUnknown = unknownEntityIds.has(edge.source_entity_id);
        if (!hasUnknown) {
          warnings.push(warn("CROSS_BLOCK_EDGE", `Cross-block code edge ${edge.id} (incoming) has no connector or unknown boundary.`, edge.id));
        }
      }
    }
  }

  // Warning: low confidence
  if (block.confidence < 0.5) {
    warnings.push(warn("LOW_CONFIDENCE", `Block confidence is low (${block.confidence}).`, blockId));
  }

  const can_promote = errors.length === 0;
  return { block_id: blockId, can_promote, errors, warnings };
}

// ── §9.14 promote_draft_block ──────────────────────────────────────────────

export function promoteDraftBlock(db: Database.Database, blockId: string): CompileBlockResult {
  // Run compile first
  const compileResult = compileDraftBlock(db, blockId);
  if (!compileResult.can_promote) {
    return compileResult;
  }

  // Set block status to accepted
  updateBlockStatus(db, blockId, "accepted");

  return compileResult;
}

// ── §9.15 compile_draft_graph ──────────────────────────────────────────────

export function compileDraftGraph(db: Database.Database): CompileGraphResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];

  const allBlocks = listBlocks(db);
  const allMappings = listBlockCodeMappings(db);
  const allCodeEntities = listCodeEntities(db);
  const allCodeEdges = listCodeEdges(db);
  const allConnectors = listConnectors(db);
  const allFlows = listFlows(db);
  const allFlowSteps = listFlowSteps(db);
  const allPorts = listPorts(db);
  const allUnknownBoundaries = listUnknownBoundaries(db);

  const blockMap = new Map(allBlocks.map((b) => [b.id, b]));
  const entityIds = new Set(allCodeEntities.map((e) => e.id));
  const portIds = new Set(allPorts.map((p) => p.id));
  const flowIds = new Set(allFlows.map((f) => f.id));
  const unknownEntityIds = new Set(allUnknownBoundaries.flatMap((ub) => ub.related_entity_ids));

  // All non-root accepted/draft blocks must have evidence mappings
  for (const block of allBlocks) {
    if (block.parent_id === null) continue; // root blocks exempt
    if (block.status === "draft" || block.status === "accepted") {
      const blockMappings = allMappings.filter((m) => m.block_id === block.id);
      if (blockMappings.length === 0) {
        errors.push(err("NO_CODE_MAPPING", `Non-root block "${block.name}" (${block.id}) has no code entity mapping.`, block.id));
      }
    }
  }

  // All accepted connectors must reference existing ports
  for (const connector of allConnectors) {
    if (!portIds.has(connector.source_port_id)) {
      errors.push(err("MISSING_PORT", `Connector ${connector.id} references non-existent source port: ${connector.source_port_id}`, connector.id));
    }
    if (!portIds.has(connector.target_port_id)) {
      errors.push(err("MISSING_PORT", `Connector ${connector.id} references non-existent target port: ${connector.target_port_id}`, connector.id));
    }
    errors.push(...validateEvidence(connector.evidence));
  }

  // All accepted flow steps must reference existing flows, blocks, and code entities
  for (const step of allFlowSteps) {
    if (!flowIds.has(step.flow_id)) {
      errors.push(err("MISSING_FLOW", `Flow step ${step.id} references non-existent flow: ${step.flow_id}`, step.id));
    }
    if (!blockMap.has(step.block_id)) {
      errors.push(err("MISSING_BLOCK", `Flow step ${step.id} references non-existent block: ${step.block_id}`, step.id));
    }
    if (!entityIds.has(step.code_entity_id)) {
      errors.push(err("MISSING_CODE_ENTITY", `Flow step ${step.id} references non-existent code entity: ${step.code_entity_id}`, step.id));
    }
    errors.push(...validateEvidence(step.evidence));
  }

  // No accepted entity may reference a deleted/missing code entity
  for (const mapping of allMappings) {
    if (!entityIds.has(mapping.code_entity_id)) {
      errors.push(err("MISSING_CODE_ENTITY", `Block-code mapping ${mapping.id} references non-existent code entity: ${mapping.code_entity_id}`, mapping.id));
    }
  }

  for (const flow of allFlows) {
    if (!entityIds.has(flow.entrypoint_entity_id)) {
      errors.push(err("MISSING_CODE_ENTITY", `Flow ${flow.id} references non-existent entrypoint entity: ${flow.entrypoint_entity_id}`, flow.id));
    }
  }

  // Validate all evidence
  for (const mapping of allMappings) {
    errors.push(...validateEvidence(mapping.evidence));
  }

  // Warning: draft blocks remain unpromoted
  const draftBlocks = allBlocks.filter((b) => b.status === "draft");
  if (draftBlocks.length > 0) {
    warnings.push(warn("UNPROMOTED_DRAFTS", `${draftBlocks.length} draft block(s) remain unpromoted.`));
  }

  // Warning: cross-block code edges without connector or unknown boundary
  for (const edge of allCodeEdges) {
    if (!edge.target_entity_id) continue;
    // Check if source and target are in different blocks
    const sourceBlocks = allMappings.filter((m) => m.code_entity_id === edge.source_entity_id).map((m) => m.block_id);
    const targetBlocks = allMappings.filter((m) => m.code_entity_id === edge.target_entity_id).map((m) => m.block_id);
    if (sourceBlocks.length > 0 && targetBlocks.length > 0) {
      const inDifferentBlocks = !sourceBlocks.some((sb) => targetBlocks.includes(sb));
      if (inDifferentBlocks) {
        const hasUnknown = unknownEntityIds.has(edge.target_entity_id) || unknownEntityIds.has(edge.source_entity_id);
        if (!hasUnknown) {
          warnings.push(warn("CROSS_BLOCK_EDGE", `Cross-block code edge ${edge.id} has no connector or unknown boundary.`, edge.id));
        }
      }
    }
  }

  // Warning: no flows exist
  if (allFlows.length === 0) {
    warnings.push(warn("NO_FLOWS", "No flows exist in the graph."));
  }

  const can_commit = errors.length === 0;
  return { can_commit, errors, warnings };
}

// ── §9.16 commit_snapshot ──────────────────────────────────────────────────

export function commitSnapshot(
  db: Database.Database,
  gitSha: string,
): { ok: boolean; snapshot_id?: string; errors: Diagnostic[]; warnings: Diagnostic[] } {
  const errors: Diagnostic[] = [];

  if (!gitSha || gitSha.trim() === "") {
    errors.push(err("INVALID_INPUT", "git_sha is required and must be non-empty."));
    return { ok: false, errors, warnings: [] };
  }

  // Run compile_draft_graph
  const graphResult = compileDraftGraph(db);
  if (!graphResult.can_commit) {
    return { ok: false, errors: graphResult.errors, warnings: graphResult.warnings };
  }

  // Create immutable snapshot
  const snapshot = createSnapshot(db, { git_sha: gitSha });
  return { ok: true, snapshot_id: snapshot.id, errors: [], warnings: graphResult.warnings };
}
