#!/usr/bin/env node
/**
 * BlockGraph MCP v0.1 — MCP Server Skeleton
 * Registers all Phase 2 tools via the high-level McpServer API.
 * Connects over stdio transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  createToolContext,
  handleBeginInitialization,
  handleCreateBlock,
  handleAttachCodeEntity,
  handleCreatePort,
  handleConnectPorts,
  handleCreateFlow,
  handleAppendFlowStep,
  handleMarkUnknownBoundary,
  handleQueryBlock,
  handleQuerySymbolsByBlock,
  handleScanRepo,
  handleListCodeEntities,
  handleListCodeEdges,
  handleCompileDraftBlock,
  handlePromoteDraftBlock,
  handleCompileDraftGraph,
  handleCommitSnapshot,
  handleSuggestBlockCandidates,
} from "./tools.js";
import type { ToolContext } from "./tools.js";

// ── Zod schemas for tool inputs ────────────────────────────────────────────

const EvidenceSchema = z.object({
  file_path: z.string(),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  code_entity_id: z.string().optional(),
  note: z.string().optional(),
});

// ── Server setup ───────────────────────────────────────────────────────────

export function createServer(): { server: McpServer; ctx: ToolContext } {
  const server = new McpServer({
    name: "blockgraph-mcp",
    version: "0.1.0",
  });

  const ctx = createToolContext();

  // §9.1 begin_initialization
  server.registerTool(
    "begin_initialization",
    {
      description: "Create or reset an initialization session for a repository. Initializes SQLite storage.",
      inputSchema: {
        repo_path: z.string().describe("Absolute or relative path to the repository root."),
      },
    },
    async (args) => {
      const result = handleBeginInitialization(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.6 create_block
  server.registerTool(
    "create_block",
    {
      description: "Create a draft block (semantic module). If parent_id is provided, it must reference an existing block.",
      inputSchema: {
        name: z.string().describe("Block name."),
        purpose: z.string().optional().describe("Block purpose description."),
        parent_id: z.string().optional().nullable().describe("Parent block ID for nested blocks."),
      },
    },
    async (args) => {
      const result = handleCreateBlock(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.7 attach_code_entity
  server.registerTool(
    "attach_code_entity",
    {
      description: "Attach a code entity to a block with a role and evidence. Maps code to architecture blocks.",
      inputSchema: {
        block_id: z.string().describe("Target block ID."),
        code_entity_id: z.string().describe("Code entity to attach."),
        role: z.string().optional().describe('Mapping role: owns, uses, entrypoint, adapter, helper. Default "owns".'),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence referencing file paths and line ranges."),
      },
    },
    async (args) => {
      const result = handleAttachCodeEntity(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.8 create_port
  server.registerTool(
    "create_port",
    {
      description: "Create a port (boundary interface) for a block.",
      inputSchema: {
        block_id: z.string().describe("Block ID to create port for."),
        name: z.string().describe("Port name."),
        direction: z.enum(["in", "out"]).describe('Port direction: "in" or "out".'),
        contract: z.string().optional().describe("Natural language contract description."),
      },
    },
    async (args) => {
      const result = handleCreatePort(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.9 connect_ports
  server.registerTool(
    "connect_ports",
    {
      description: "Create a connector between two ports (source must be out, target must be in).",
      inputSchema: {
        source_port_id: z.string().describe("Source port ID (must have direction 'out')."),
        target_port_id: z.string().describe("Target port ID (must have direction 'in')."),
        protocol: z.string().optional().describe('Protocol: function_call, http, event, state, render, unknown.'),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence for the connector."),
      },
    },
    async (args) => {
      const result = handleConnectPorts(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.10 create_flow
  server.registerTool(
    "create_flow",
    {
      description: "Create a draft flow (entrypoint-triggered business process).",
      inputSchema: {
        name: z.string().describe("Flow name."),
        entrypoint_entity_id: z.string().describe("Code entity that triggers this flow."),
      },
    },
    async (args) => {
      const result = handleCreateFlow(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.11 append_flow_step
  server.registerTool(
    "append_flow_step",
    {
      description: "Append a step to a draft flow. Order is auto-assigned.",
      inputSchema: {
        flow_id: z.string().describe("Flow ID."),
        block_id: z.string().describe("Block involved in this step."),
        code_entity_id: z.string().describe("Code entity involved in this step."),
        trigger: z.string().optional().describe("What triggers this step."),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence for the step."),
      },
    },
    async (args) => {
      const result = handleAppendFlowStep(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.12 mark_unknown_boundary
  server.registerTool(
    "mark_unknown_boundary",
    {
      description: "Record an unresolved cross-module boundary when a connector cannot be confidently modeled.",
      inputSchema: {
        related_entity_ids: z.array(z.string()).min(1).describe("Code entity IDs involved."),
        reason: z.string().describe("Why this boundary is unknown."),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence."),
      },
    },
    async (args) => {
      const result = handleMarkUnknownBoundary(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.17 query_block
  server.registerTool(
    "query_block",
    {
      description: "Query block details including ports, mappings, connectors, and flow steps.",
      inputSchema: {
        block_id: z.string().describe("Block ID to query."),
      },
    },
    async (args) => {
      const result = handleQueryBlock(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.18 query_symbols_by_block
  server.registerTool(
    "query_symbols_by_block",
    {
      description: "Return all code entities mapped to a block.",
      inputSchema: {
        block_id: z.string().describe("Block ID."),
      },
    },
    async (args) => {
      const result = handleQuerySymbolsByBlock(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.2 scan_repo
  server.registerTool(
    "scan_repo",
    {
      description: "Scan TypeScript/TSX/JS/JSX files in a repository and generate a code fact graph.",
      inputSchema: {
        repo_path: z.string().describe("Path to the repository root."),
      },
    },
    async (args) => {
      const result = handleScanRepo(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.3 list_code_entities
  server.registerTool(
    "list_code_entities",
    {
      description: "List code entities with optional filters.",
      inputSchema: {
        filter: z.object({
          type: z.string().optional(),
          file_path: z.string().optional(),
          name_contains: z.string().optional(),
        }).optional(),
      },
    },
    async (args) => {
      const result = handleListCodeEntities(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.4 list_code_edges
  server.registerTool(
    "list_code_edges",
    {
      description: "List code edges with optional filters.",
      inputSchema: {
        filter: z.object({
          type: z.string().optional(),
          source_entity_id: z.string().optional(),
          target_entity_id: z.string().optional(),
        }).optional(),
      },
    },
    async (args) => {
      const result = handleListCodeEdges(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.13 compile_draft_block
  server.registerTool(
    "compile_draft_block",
    {
      description: "Validate a single draft block and its associated mappings, ports, connectors, and flow steps.",
      inputSchema: {
        block_id: z.string().describe("Draft block ID to compile."),
      },
    },
    async (args) => {
      const result = handleCompileDraftBlock(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.14 promote_draft_block
  server.registerTool(
    "promote_draft_block",
    {
      description: "Promote a valid draft block to accepted status. Fails if compile has errors.",
      inputSchema: {
        block_id: z.string().describe("Draft block ID to promote."),
      },
    },
    async (args) => {
      const result = handlePromoteDraftBlock(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.15 compile_draft_graph
  server.registerTool(
    "compile_draft_graph",
    {
      description: "Validate the entire draft/accepted graph before snapshot commit.",
      inputSchema: {},
    },
    async (args) => {
      const result = handleCompileDraftGraph(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.16 commit_snapshot
  server.registerTool(
    "commit_snapshot",
    {
      description: "Create an immutable snapshot of the accepted graph tied to a git SHA.",
      inputSchema: {
        git_sha: z.string().describe("Git commit SHA to tie the snapshot to."),
      },
    },
    async (args) => {
      const result = handleCommitSnapshot(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §9.5 suggest_block_candidates
  server.registerTool(
    "suggest_block_candidates",
    {
      description: "Suggest candidate blocks from the code graph using heuristics.",
      inputSchema: {
        strategy: z.enum(["directory", "route", "component", "mixed"]).optional().describe("Heuristic strategy: directory, route, component, or mixed."),
      },
    },
    async (args) => {
      const result = handleSuggestBlockCandidates(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  return { server, ctx };
}

// ── Main entry ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
