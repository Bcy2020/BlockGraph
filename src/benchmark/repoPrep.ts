/**
 * BlockGraph MCP v0.2.7 — Repository Preparation for Condition Isolation
 * Ensures no_graph and block_graph_mcp conditions are genuinely isolated.
 * PRD Phase 1: Condition Isolation.
 */
import { mkdir, cp, rm, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { existsSync } from "node:fs";
import type { GraphCondition } from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PrepareBenchmarkRepoOptions {
  caseId: string;
  condition: GraphCondition;
  sourceRepoPath: string;
  outputDir: string;
  suiteDir?: string;
}

export interface IsolationMetadata {
  condition: GraphCondition;
  case_id: string;
  source_repo_path: string;
  prepared_repo_path: string;
  removed_artifacts: string[];
  mcp_config_path: string | null;
  strict_mcp_config_expected: boolean;
  isolation_warnings: string[];
  fairness_gates: FairnessGateStatus;
}

export interface FairnessGateStatus {
  condition_isolation_ok: boolean;
  explicit_mcp_config_ok: boolean;
  graph_index_frozen_ok: boolean;
  issues: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Directories and files to exclude from prepared repos (always) */
const ALWAYS_EXCLUDE = [
  "node_modules",
  ".git",
  "benchmarks/runs",
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
];

/** MCP-specific artifacts to remove for no_graph condition */
const NO_GRAPH_REMOVE = [
  ".blockgraph",
  ".mcp.json",
  ".claude",
  "CLAUDE.md",
];

/** MCP config template for block_graph_mcp condition */
const MCP_SERVER_CONFIG = {
  mcpServers: {
    blockgraph: {
      type: "stdio",
      command: "pnpm",
      args: ["--dir", "{repo_dir}", "exec", "tsx", "src/mcp/server.ts"],
      env: {},
    },
  },
};

// ── Main Function ─────────────────────────────────────────────────────────

/**
 * Prepare an isolated benchmark repository for a specific case and condition.
 * - Copies the source repo to a deterministic output directory.
 * - Removes inappropriate artifacts based on condition.
 * - Generates MCP config for block_graph_mcp.
 * - Returns isolation metadata with fairness gate status.
 */
export async function prepareBenchmarkRepo(
  options: PrepareBenchmarkRepoOptions,
): Promise<IsolationMetadata> {
  const { caseId, condition, sourceRepoPath, outputDir } = options;

  // Validate source exists
  if (!existsSync(sourceRepoPath)) {
    throw new Error(`Source repo path does not exist: ${sourceRepoPath}`);
  }

  // Deterministic prepared repo path
  const preparedRepoPath = resolve(outputDir, "prepared-repo");
  const removedArtifacts: string[] = [];
  const warnings: string[] = [];

  // Clean and create prepared repo directory
  if (existsSync(preparedRepoPath)) {
    await rm(preparedRepoPath, { recursive: true, force: true });
  }
  await mkdir(preparedRepoPath, { recursive: true });

  // Copy source repo (excluding always-exclude directories)
  await copyRepoFiltered(sourceRepoPath, preparedRepoPath, ALWAYS_EXCLUDE);

  // Condition-specific preparation
  let mcpConfigPath: string | null = null;
  let strictMcpConfigExpected = false;

  switch (condition) {
    case "no_graph":
      // Remove all MCP-related artifacts
      for (const artifact of NO_GRAPH_REMOVE) {
        const artifactPath = resolve(preparedRepoPath, artifact);
        if (existsSync(artifactPath)) {
          await rm(artifactPath, { recursive: true, force: true });
          removedArtifacts.push(artifact);
        }
      }
      // Write empty MCP config to ensure no ambient MCP tools
      const emptyMcpConfig = resolve(preparedRepoPath, ".benchmark-empty-mcp.json");
      await writeFile(emptyMcpConfig, JSON.stringify({ mcpServers: {} }, null, 2));
      strictMcpConfigExpected = true;
      break;

    case "block_graph_mcp":
      // Keep .blockgraph data available
      const blockgraphDir = resolve(preparedRepoPath, ".blockgraph");
      if (!existsSync(blockgraphDir)) {
        warnings.push("No .blockgraph directory found in source repo");
      }
      // Generate per-case MCP config
      mcpConfigPath = resolve(preparedRepoPath, "graph-context", "mcp-config.json");
      await mkdir(resolve(preparedRepoPath, "graph-context"), { recursive: true });
      const mcpConfig = {
        ...MCP_SERVER_CONFIG,
        mcpServers: {
          ...MCP_SERVER_CONFIG.mcpServers,
          blockgraph: {
            ...MCP_SERVER_CONFIG.mcpServers.blockgraph,
            args: MCP_SERVER_CONFIG.mcpServers.blockgraph.args.map((a) =>
              a === "{repo_dir}" ? preparedRepoPath.replace(/\\/g, "/") : a,
            ),
          },
        },
      };
      await writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
      strictMcpConfigExpected = true;
      break;

    case "code_facts_only":
    case "block_graph":
    case "block_graph_with_flows":
    case "stale_or_incomplete_graph":
      // These use synthetic graphs — remove MCP artifacts
      for (const artifact of [".blockgraph", ".mcp.json"]) {
        const artifactPath = resolve(preparedRepoPath, artifact);
        if (existsSync(artifactPath)) {
          await rm(artifactPath, { recursive: true, force: true });
          removedArtifacts.push(artifact);
        }
      }
      break;
  }

  // Run fairness gate checks
  const fairnessGates = await checkFairnessGates(
    preparedRepoPath,
    condition,
    mcpConfigPath,
  );

  // Check for residual MCP artifacts in no_graph
  if (condition === "no_graph") {
    const residualMcp = await findMcpArtifacts(preparedRepoPath);
    if (residualMcp.length > 0) {
      fairnessGates.condition_isolation_ok = false;
      fairnessGates.issues.push(
        `Residual MCP artifacts found in no_graph repo: ${residualMcp.join(", ")}`,
      );
    }
  }

  const metadata: IsolationMetadata = {
    condition,
    case_id: caseId,
    source_repo_path: sourceRepoPath,
    prepared_repo_path: preparedRepoPath,
    removed_artifacts: removedArtifacts,
    mcp_config_path: mcpConfigPath,
    strict_mcp_config_expected: strictMcpConfigExpected,
    isolation_warnings: warnings,
    fairness_gates: fairnessGates,
  };

  // Write isolation metadata
  const metadataPath = resolve(outputDir, "isolation-metadata.json");
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

  return metadata;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Copy a repository, excluding specified directories and files.
 */
async function copyRepoFiltered(
  src: string,
  dest: string,
  exclude: string[],
): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyRepoFiltered(srcPath, destPath, exclude);
    } else {
      await cp(srcPath, destPath);
    }
  }
}

/**
 * Check fairness gates for a prepared repo.
 */
async function checkFairnessGates(
  preparedRepoPath: string,
  condition: GraphCondition,
  mcpConfigPath: string | null,
): Promise<FairnessGateStatus> {
  const issues: string[] = [];

  // Check condition isolation
  let conditionIsolationOk = true;
  if (condition === "no_graph") {
    // no_graph should not have .blockgraph or .mcp.json
    if (existsSync(resolve(preparedRepoPath, ".blockgraph"))) {
      conditionIsolationOk = false;
      issues.push("no_graph repo contains .blockgraph directory");
    }
    if (existsSync(resolve(preparedRepoPath, ".mcp.json"))) {
      conditionIsolationOk = false;
      issues.push("no_graph repo contains .mcp.json");
    }
  }

  // Check explicit MCP config
  let explicitMcpConfigOk = true;
  if (condition === "block_graph_mcp") {
    if (!mcpConfigPath || !existsSync(mcpConfigPath)) {
      explicitMcpConfigOk = false;
      issues.push("block_graph_mcp repo missing generated MCP config");
    }
  }

  // Graph index frozen - will be checked during scoring
  const graphIndexFrozenOk = condition !== "block_graph_mcp" || existsSync(
    resolve(preparedRepoPath, "graph-context", "graph-index.json"),
  );

  return {
    condition_isolation_ok: conditionIsolationOk,
    explicit_mcp_config_ok: explicitMcpConfigOk,
    graph_index_frozen_ok: graphIndexFrozenOk,
    issues,
  };
}

/**
 * Find any remaining MCP artifacts in a prepared repo.
 */
async function findMcpArtifacts(repoPath: string): Promise<string[]> {
  const found: string[] = [];
  const checkPaths = [
    ".blockgraph",
    ".mcp.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
  ];

  for (const p of checkPaths) {
    if (existsSync(resolve(repoPath, p))) {
      found.push(p);
    }
  }

  return found;
}

/**
 * Get the prepared repo path for a case run (if it exists).
 */
export function getPreparedRepoPath(outputDir: string): string | null {
  const preparedPath = resolve(outputDir, "prepared-repo");
  return existsSync(preparedPath) ? preparedPath : null;
}

/**
 * Read isolation metadata from a case run directory.
 */
export async function readIsolationMetadata(
  outputDir: string,
): Promise<IsolationMetadata | null> {
  const metadataPath = resolve(outputDir, "isolation-metadata.json");
  if (!existsSync(metadataPath)) return null;

  try {
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(metadataPath, "utf-8"),
    );
    return JSON.parse(raw) as IsolationMetadata;
  } catch {
    return null;
  }
}
