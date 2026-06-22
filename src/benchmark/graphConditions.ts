/**
 * BlockGraph MCP v0.2.7 — Graph Condition Preparation
 * Prepares graph context files for each benchmark condition.
 * v0.2.7: Exports frozen graph index from actual MCP graph state.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { scanRepo } from "../scanner/tsScanner.js";
import {
  createCodeEntity,
  createCodeEdge,
  createBlock,
  attachCodeEntity,
  createPort,
  createConnector,
  createFlow,
  appendFlowStep,
  listCodeEntities,
  listCodeEdges,
  listBlocks,
  listBlockCodeMappings,
  listPorts,
  listConnectors,
  listFlows,
  listFlowSteps,
} from "../graph/draft.js";
import { openStore, closeStore } from "../graph/store.js";
import { exportGraphIndexFromDb, exportSyntheticGraphIndex } from "./graphIndexExport.js";
import type { GraphCondition, GraphConditionContext } from "./schema.js";
import type Database from "better-sqlite3";

export interface PrepareGraphConditionResult {
  context: GraphConditionContext;
  warnings: string[];
}

/**
 * Prepare graph condition context for a benchmark case.
 * Writes context JSON files to the output directory.
 */
export async function prepareGraphCondition(
  repoPath: string,
  outputDir: string,
  condition: GraphCondition,
): Promise<PrepareGraphConditionResult> {
  const warnings: string[] = [];
  const contextDir = resolve(outputDir, "graph-context");
  await mkdir(contextDir, { recursive: true });

  const context: GraphConditionContext = { condition };

  switch (condition) {
    case "no_graph":
      // No graph context — agent uses ordinary code search only
      break;

    case "code_facts_only": {
      const result = scanRepo(repoPath);
      const codeFactsPath = resolve(contextDir, "code-facts.json");
      await writeFile(
        codeFactsPath,
        JSON.stringify(
          { entities: result.entities, edges: result.edges },
          null,
          2,
        ),
      );
      context.code_facts_path = codeFactsPath;
      break;
    }

    case "block_graph": {
      const graph = buildFixtureGraph(repoPath);
      const codeFactsPath = resolve(contextDir, "code-facts.json");
      const blocksPath = resolve(contextDir, "blocks.json");
      const connectorsPath = resolve(contextDir, "connectors.json");

      await writeFile(codeFactsPath, JSON.stringify({ entities: graph.entities, edges: graph.edges }, null, 2));
      await writeFile(blocksPath, JSON.stringify(graph.blocks, null, 2));
      await writeFile(connectorsPath, JSON.stringify(graph.connectors, null, 2));

      // FR3: Export frozen graph index for ID resolution
      await exportGraphIndex(repoPath, contextDir);

      context.code_facts_path = codeFactsPath;
      context.blocks_path = blocksPath;
      context.connectors_path = connectorsPath;
      break;
    }

    case "block_graph_with_flows": {
      const graph = buildFixtureGraph(repoPath, { includeFlows: true });
      const codeFactsPath = resolve(contextDir, "code-facts.json");
      const blocksPath = resolve(contextDir, "blocks.json");
      const connectorsPath = resolve(contextDir, "connectors.json");
      const flowsPath = resolve(contextDir, "flows.json");

      await writeFile(codeFactsPath, JSON.stringify({ entities: graph.entities, edges: graph.edges }, null, 2));
      await writeFile(blocksPath, JSON.stringify(graph.blocks, null, 2));
      await writeFile(connectorsPath, JSON.stringify(graph.connectors, null, 2));
      await writeFile(flowsPath, JSON.stringify(graph.flows, null, 2));

      // FR3: Export frozen graph index for ID resolution
      await exportGraphIndex(repoPath, contextDir);

      context.code_facts_path = codeFactsPath;
      context.blocks_path = blocksPath;
      context.connectors_path = connectorsPath;
      context.flows_path = flowsPath;
      break;
    }

    case "block_graph_mcp": {
      // Write MCP config for agent to connect to BlockGraph MCP server
      const mcpConfig = {
        mcpServers: {
          blockgraph: {
            type: "stdio",
            command: "pnpm",
            args: ["--dir", resolve(".").replace(/\\/g, "/"), "exec", "tsx", "src/mcp/server.ts"],
            env: {},
          },
        },
      };
      const mcpConfigPath = resolve(contextDir, "mcp-config.json");
      await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      context.mcp_config_path = mcpConfigPath;

      // v0.2.7: Export frozen graph index from actual .blockgraph DB if available
      const blockgraphDbPath = resolve(repoPath, ".blockgraph", "blockgraph.db");
      if (existsSync(blockgraphDbPath)) {
        await exportGraphIndexFromDb({
          dbPath: blockgraphDbPath,
          outputDir: contextDir,
          source: "live_db",
          repoPath,
        });
      } else {
        // No actual DB available - export synthetic graph index
        await exportSyntheticGraphIndex(contextDir, repoPath);
        warnings.push("No .blockgraph/blockgraph.db found - exported synthetic graph index");
      }
      break;
    }

    case "stale_or_incomplete_graph": {
      const graph = buildFixtureGraph(repoPath, {
        includeFlows: true,
        omitFeatures: ["teams"],
        omitSharedDeps: ["helpers"],
      });

      const codeFactsPath = resolve(contextDir, "code-facts.json");
      const blocksPath = resolve(contextDir, "blocks.json");
      const connectorsPath = resolve(contextDir, "connectors.json");
      const flowsPath = resolve(contextDir, "flows.json");
      const staleWarningPath = resolve(contextDir, "stale-warning.json");

      await writeFile(codeFactsPath, JSON.stringify({ entities: graph.entities, edges: graph.edges }, null, 2));
      await writeFile(blocksPath, JSON.stringify(graph.blocks, null, 2));
      await writeFile(connectorsPath, JSON.stringify(graph.connectors, null, 2));
      await writeFile(flowsPath, JSON.stringify(graph.flows, null, 2));

      // FR3: Export frozen graph index for ID resolution
      await exportGraphIndex(repoPath, contextDir);

      const omissions = {
        features: ["teams"],
        shared_deps: ["helpers"],
        flows: [],
      };
      await writeFile(staleWarningPath, JSON.stringify({
        warning: "This graph is intentionally incomplete. The teams feature and shared-hooks utility are omitted.",
        omissions,
      }, null, 2));

      context.code_facts_path = codeFactsPath;
      context.blocks_path = blocksPath;
      context.connectors_path = connectorsPath;
      context.flows_path = flowsPath;
      context.stale_warning_path = staleWarningPath;
      context.omissions = omissions;
      warnings.push("Stale/incomplete graph: teams feature and helpers utility omitted");
      break;
    }
  }

  return { context, warnings };
}

// ── Fixture Graph Builder ──────────────────────────────────────────────────

interface FixtureGraphOptions {
  includeFlows?: boolean;
  omitFeatures?: string[];
  omitSharedDeps?: string[];
}

interface FixtureGraphResult {
  entities: ReturnType<typeof listCodeEntities>;
  edges: ReturnType<typeof listCodeEdges>;
  blocks: Array<{ id: string; name: string; purpose: string }>;
  connectors: Array<{ source_block: string; target_block: string; protocol: string }>;
  flows?: Array<{ name: string; steps: Array<{ block: string; entity_id: string; trigger: string }> }>;
}

/**
 * Build a minimal fixture graph for the ts-react-complex fixture.
 * Uses an in-memory DB to scan and structure the data.
 */
function buildFixtureGraph(
  repoPath: string,
  options: FixtureGraphOptions = {},
): FixtureGraphResult {
  const { includeFlows = false, omitFeatures = [], omitSharedDeps = [] } = options;

  // Scan the repo
  const scanResult = scanRepo(repoPath);
  const entities = scanResult.entities;
  const edges = scanResult.edges;

  // Define block structure based on fixture layout
  const blockDefs = [
    {
      id: "auth",
      name: "Auth",
      purpose: "User authentication — login form, auth service, auth hooks",
      filePrefix: "src/features/auth/",
      entityPrefixes: ["src/features/auth/", "src/hooks/useAuth"],
    },
    {
      id: "discussions",
      name: "Discussions",
      purpose: "Discussion listing and management",
      filePrefix: "src/features/discussions/",
      entityPrefixes: ["src/features/discussions/"],
    },
    {
      id: "comments",
      name: "Comments",
      purpose: "Comment submission and management",
      filePrefix: "src/features/comments/",
      entityPrefixes: ["src/features/comments/"],
    },
    {
      id: "teams",
      name: "Teams",
      purpose: "Team listing and management",
      filePrefix: "src/features/teams/",
      entityPrefixes: ["src/features/teams/"],
    },
    {
      id: "users",
      name: "Users",
      purpose: "User profile management",
      filePrefix: "src/features/users/",
      entityPrefixes: ["src/features/users/"],
    },
    {
      id: "shared-api-client",
      name: "Shared API Client",
      purpose: "HTTP client used by all feature services",
      filePrefix: "src/lib/",
      entityPrefixes: ["src/lib/apiClient"],
    },
    {
      id: "shared-types",
      name: "Shared Types",
      purpose: "TypeScript type definitions shared across features",
      filePrefix: "src/types/",
      entityPrefixes: ["src/types/"],
    },
    {
      id: "shared-hooks",
      name: "Shared Hooks",
      purpose: "Reusable React hooks",
      filePrefix: "src/hooks/",
      entityPrefixes: ["src/hooks/"],
    },
  ];

  // Filter out omitted features and shared deps
  const filteredDefs = blockDefs.filter((def) => {
    if (def.id === "teams" && omitFeatures.includes("teams")) return false;
    if (def.id === "shared-hooks" && omitSharedDeps.includes("helpers")) return false;
    return true;
  });

  const blocks = filteredDefs.map((def) => ({
    id: def.id,
    name: def.name,
    purpose: def.purpose,
  }));

  // Build connectors between blocks that share edges
  const connectors: FixtureGraphResult["connectors"] = [];
  const connectorSet = new Set<string>();

  function addConnector(source: string, target: string, protocol: string) {
    const key = `${source}->${target}`;
    if (!connectorSet.has(key)) {
      connectorSet.add(key);
      connectors.push({ source_block: source, target_block: target, protocol });
    }
  }

  // Auth → Shared API Client (authService uses apiClient)
  if (!omitFeatures.includes("auth")) addConnector("auth", "shared-api-client", "function_call");
  if (!omitFeatures.includes("discussions")) addConnector("discussions", "shared-api-client", "function_call");
  if (!omitFeatures.includes("comments")) addConnector("comments", "shared-api-client", "function_call");
  if (!omitFeatures.includes("teams")) addConnector("teams", "shared-api-client", "function_call");
  if (!omitFeatures.includes("users")) addConnector("users", "shared-api-client", "function_call");

  // Build flows if requested
  let flows: FixtureGraphResult["flows"];
  if (includeFlows) {
    flows = [
      {
        name: "Login Flow",
        steps: [
          { block: "auth", entity_id: "LoginForm", trigger: "form submit" },
          { block: "auth", entity_id: "loginUser", trigger: "service call" },
          { block: "shared-api-client", entity_id: "apiClient", trigger: "HTTP request" },
        ],
      },
      {
        name: "Discussion View Flow",
        steps: [
          { block: "discussions", entity_id: "DiscussionList", trigger: "component mount" },
          { block: "discussions", entity_id: "fetchDiscussions", trigger: "service call" },
          { block: "shared-api-client", entity_id: "apiClient", trigger: "HTTP request" },
        ],
      },
    ];
  }

  return { entities, edges, blocks, connectors, flows };
}

// ── Graph Index Export (v0.2.7: uses graphIndexExport.ts) ─────────────────

import type { GraphIndex, GraphIndexBlock, GraphIndexEntity } from "./idResolver.js";

/**
 * Export frozen graph index for ID resolution during scoring.
 * For synthetic/fixture conditions, builds from fixture definitions.
 * For block_graph_mcp, use exportGraphIndexFromDb instead.
 */
export async function exportGraphIndex(
  repoPath: string,
  contextDir: string,
): Promise<string> {
  const graph = buildFixtureGraph(repoPath, { includeFlows: true });

  const indexBlocks: GraphIndexBlock[] = graph.blocks.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.id,
    aliases: getBlockAliases(b.name, b.id),
    mapped_entities: getMappedEntities(graph.entities, b.id),
  }));

  const indexEntities: GraphIndexEntity[] = graph.entities.map((e) => ({
    canonical_id: `${e.file_path}#${e.name}`,
    raw_ids: [`${e.file_path}:${e.type}:${e.name}:${e.start_line}`],
    file_path: e.file_path,
    symbol_name: e.name,
    kind: e.type,
    line: e.start_line,
  }));

  const graphIndex: GraphIndex = {
    blocks: indexBlocks,
    entities: indexEntities,
  };

  const indexPath = resolve(contextDir, "graph-index.json");
  await writeFile(indexPath, JSON.stringify({
    ...graphIndex,
    provenance: {
      source_db_path: "synthetic",
      export_timestamp: new Date().toISOString(),
      graph_index_source: "synthetic",
      block_count: indexBlocks.length,
      entity_count: indexEntities.length,
    },
  }, null, 2));
  return indexPath;
}

function getBlockAliases(name: string, id: string): string[] {
  const aliases: string[] = [name.toLowerCase()];
  if (id !== name.toLowerCase()) aliases.push(id);
  // Common aliases
  if (name === "Auth") aliases.push("Authentication", "Auth Feature");
  if (name === "Shared API Client") aliases.push("API Client", "HTTP Client");
  return aliases;
}

function getMappedEntities(entities: Array<{ file_path: string; name: string }>, blockId: string): string[] {
  const prefixMap: Record<string, string[]> = {
    "auth": ["src/features/auth/", "src/hooks/useAuth"],
    "discussions": ["src/features/discussions/"],
    "comments": ["src/features/comments/"],
    "teams": ["src/features/teams/"],
    "users": ["src/features/users/"],
    "shared-api-client": ["src/lib/apiClient"],
    "shared-types": ["src/types/"],
    "shared-hooks": ["src/hooks/"],
  };
  const prefixes = prefixMap[blockId] ?? [];
  return entities
    .filter((e) => prefixes.some((p) => e.file_path.startsWith(p)))
    .map((e) => `${e.file_path}#${e.name}`);
}
