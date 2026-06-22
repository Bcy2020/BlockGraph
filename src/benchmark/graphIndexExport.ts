/**
 * BlockGraph MCP v0.2.7 — Graph Index Export
 * Exports frozen graph-index.json from actual .blockgraph/blockgraph.db.
 * PRD Phase 3: Frozen Graph Index From Actual Graph State.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { GraphIndex, GraphIndexBlock, GraphIndexEntity } from "./idResolver.js";
import { openStore, closeStore } from "../graph/store.js";
import {
  listBlocks,
  listBlockCodeMappings,
  listPorts,
  listConnectors,
  listFlows,
  listFlowSteps,
  listCodeEntities,
  listCodeEdges,
} from "../graph/draft.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ExportGraphIndexOptions {
  /** Path to the .blockgraph/blockgraph.db file */
  dbPath: string;
  /** Output directory for graph-index.json */
  outputDir: string;
  /** Source type for metadata */
  source: "live_db" | "synthetic" | "fixture";
  /** Repository path for entity resolution */
  repoPath?: string;
}

export interface ExportGraphIndexResult {
  /** Path to the exported graph-index.json */
  indexPath: string;
  /** The exported graph index */
  index: GraphIndexExport;
  /** Any warnings during export */
  warnings: string[];
}

export interface GraphIndexExport extends GraphIndex {
  /** Provenance metadata */
  provenance: {
    source_db_path: string;
    export_timestamp: string;
    graph_index_source: "live_db" | "synthetic" | "fixture";
    block_count: number;
    entity_count: number;
    port_count: number;
    connector_count: number;
    flow_count: number;
  };
  /** Port information */
  ports: GraphIndexPort[];
  /** Connector information */
  connectors: GraphIndexConnector[];
  /** Flow information */
  flows: GraphIndexFlow[];
}

export interface GraphIndexPort {
  id: string;
  block_id: string;
  block_name: string;
  name: string;
  direction: "in" | "out";
  contract: string;
}

export interface GraphIndexConnector {
  id: string;
  source_port_id: string;
  source_block_name: string;
  target_port_id: string;
  target_block_name: string;
  protocol: string;
}

export interface GraphIndexFlow {
  id: string;
  name: string;
  entrypoint_entity_id: string;
  steps: Array<{
    order: number;
    block_id: string;
    block_name: string;
    code_entity_id: string;
    entity_canonical_id: string;
    trigger: string;
  }>;
}

// ── Main Export Function ──────────────────────────────────────────────────

/**
 * Export a frozen graph index from an actual .blockgraph database.
 * This ensures MCP runs use the same graph state for scoring.
 */
export async function exportGraphIndexFromDb(
  options: ExportGraphIndexOptions,
): Promise<ExportGraphIndexResult> {
  const { dbPath, outputDir, source, repoPath } = options;
  const warnings: string[] = [];

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  await mkdir(outputDir, { recursive: true });

  // Open the database
  const db = openStore(dbPath);

  try {
    // Read all graph data from the database
    const blocks = listBlocks(db);
    const mappings = listBlockCodeMappings(db);
    const ports = listPorts(db);
    const connectors = listConnectors(db);
    const flows = listFlows(db);
    const flowSteps = listFlowSteps(db);
    const entities = listCodeEntities(db);

    // Build block index with aliases and mapped entities
    const indexBlocks: GraphIndexBlock[] = blocks.map((block) => {
      // Get mapped entities for this block
      const blockMappings = mappings.filter((m) => m.block_id === block.id);
      const mappedEntityIds = blockMappings.map((m) => {
        const entity = entities.find((e) => e.id === m.code_entity_id);
        return entity ? `${entity.file_path}#${entity.name}` : m.code_entity_id;
      });

      return {
        id: block.id,
        name: block.name,
        slug: blockNameToSlug(block.name),
        aliases: getBlockAliases(block.name, block.id),
        mapped_entities: mappedEntityIds,
      };
    });

    // Build entity index with canonical and raw IDs
    const indexEntities: GraphIndexEntity[] = entities.map((entity) => ({
      canonical_id: `${entity.file_path}#${entity.name}`,
      raw_ids: [
        `${entity.file_path}:${entity.type}:${entity.name}:${entity.start_line}`,
        entity.id, // UUID from database
      ],
      file_path: entity.file_path,
      symbol_name: entity.name,
      kind: entity.type,
      line: entity.start_line,
    }));

    // Build port index
    const indexPorts: GraphIndexPort[] = ports.map((port) => {
      const block = blocks.find((b) => b.id === port.block_id);
      return {
        id: port.id,
        block_id: port.block_id,
        block_name: block?.name ?? "unknown",
        name: port.name,
        direction: port.direction,
        contract: port.contract,
      };
    });

    // Build connector index
    const indexConnectors: GraphIndexConnector[] = connectors.map((conn) => {
      const sourcePort = ports.find((p) => p.id === conn.source_port_id);
      const targetPort = ports.find((p) => p.id === conn.target_port_id);
      const sourceBlock = sourcePort ? blocks.find((b) => b.id === sourcePort.block_id) : null;
      const targetBlock = targetPort ? blocks.find((b) => b.id === targetPort.block_id) : null;

      return {
        id: conn.id,
        source_port_id: conn.source_port_id,
        source_block_name: sourceBlock?.name ?? "unknown",
        target_port_id: conn.target_port_id,
        target_block_name: targetBlock?.name ?? "unknown",
        protocol: conn.protocol,
      };
    });

    // Build flow index
    const indexFlows: GraphIndexFlow[] = flows.map((flow) => {
      const steps = flowSteps
        .filter((s) => s.flow_id === flow.id)
        .sort((a, b) => a.order - b.order)
        .map((step) => {
          const block = blocks.find((b) => b.id === step.block_id);
          const entity = entities.find((e) => e.id === step.code_entity_id);
          return {
            order: step.order,
            block_id: step.block_id,
            block_name: block?.name ?? "unknown",
            code_entity_id: step.code_entity_id,
            entity_canonical_id: entity ? `${entity.file_path}#${entity.name}` : step.code_entity_id,
            trigger: step.trigger,
          };
        });

      return {
        id: flow.id,
        name: flow.name,
        entrypoint_entity_id: flow.entrypoint_entity_id,
        steps,
      };
    });

    // Build the complete export
    const exportData: GraphIndexExport = {
      blocks: indexBlocks,
      entities: indexEntities,
      ports: indexPorts,
      connectors: indexConnectors,
      flows: indexFlows,
      provenance: {
        source_db_path: dbPath,
        export_timestamp: new Date().toISOString(),
        graph_index_source: source,
        block_count: blocks.length,
        entity_count: entities.length,
        port_count: ports.length,
        connector_count: connectors.length,
        flow_count: flows.length,
      },
    };

    // Write the frozen graph index
    const indexPath = resolve(outputDir, "graph-index.json");
    await writeFile(indexPath, JSON.stringify(exportData, null, 2));

    return {
      indexPath,
      index: exportData,
      warnings,
    };
  } finally {
    closeStore(db);
  }
}

/**
 * Export graph index for synthetic/fixture graph conditions.
 * Uses the buildFixtureGraph data instead of a real database.
 */
export async function exportSyntheticGraphIndex(
  outputDir: string,
  repoPath: string,
  options?: { includeFlows?: boolean; omitFeatures?: string[] },
): Promise<ExportGraphIndexResult> {
  await mkdir(outputDir, { recursive: true });

  // This is a synthetic graph - we'll need to build it from fixture definitions
  // For now, we mark it as synthetic and provide minimal structure
  const warnings = ["Synthetic graph index - not from actual MCP state"];

  const exportData: GraphIndexExport = {
    blocks: [],
    entities: [],
    ports: [],
    connectors: [],
    flows: [],
    provenance: {
      source_db_path: "synthetic",
      export_timestamp: new Date().toISOString(),
      graph_index_source: "synthetic",
      block_count: 0,
      entity_count: 0,
      port_count: 0,
      connector_count: 0,
      flow_count: 0,
    },
  };

  const indexPath = resolve(outputDir, "graph-index.json");
  await writeFile(indexPath, JSON.stringify(exportData, null, 2));

  return {
    indexPath,
    index: exportData,
    warnings,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function blockNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getBlockAliases(name: string, id: string): string[] {
  const aliases: string[] = [name.toLowerCase()];
  if (id !== name.toLowerCase()) aliases.push(id);

  // Common aliases for fixture blocks
  const aliasMap: Record<string, string[]> = {
    "auth": ["authentication", "auth feature", "login"],
    "discussions": ["discussion", "discussion feature"],
    "comments": ["comment", "comment feature"],
    "teams": ["team", "team feature"],
    "users": ["user", "user feature", "user profile"],
    "shared api client": ["api client", "http client", "api"],
    "shared types": ["types", "type definitions"],
    "shared hooks": ["hooks", "react hooks"],
  };

  const lowerName = name.toLowerCase();
  for (const [key, values] of Object.entries(aliasMap)) {
    if (lowerName.includes(key) || key.includes(lowerName)) {
      aliases.push(...values);
    }
  }

  return [...new Set(aliases)];
}
