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
  handleResumeInitialization,
  handleSessionStatus,
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
  handleCreateWorkPackage,
  handleListWorkPackages,
  handleUpdateWorkPackageStatus,
  handleCheckWorkPackageConflicts,
  handleCreateModuleProposal,
  handleAttachProposalEntity,
  handleAddProposalPort,
  handleAddProposalDependency,
  handleAddProposalFlow,
  handleMarkProposalGap,
  handleUpdateModuleProposal,
  handleSubmitModuleProposal,
  handleSubmitProposalReview,
  handleApproveModuleProposal,
  handleListProposalReviews,
  handleResolveProposalFinding,
  handleMergeModuleProposal,
  handleListMergedProposals,
  handleListModuleProposals,
  handleCoverageReport,
  handleDetectMissingModules,
  handleDetectSharedDependencies,
  handleConnectorAudit,
  handleFlowSufficiencyCheck,
  handleQualityGateReport,
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
      description: "Create or reconnect an initialization session for a repository. If .blockgraph/blockgraph.db exists with prior data, returns resumed: true. Does not delete existing data.",
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

  // resume_initialization
  server.registerTool(
    "resume_initialization",
    {
      description: "Reconnect to an existing BlockGraph session. Same behavior as begin_initialization — opens existing DB or creates new one. Use this name to make recovery intent explicit.",
      inputSchema: {
        repo_path: z.string().describe("Absolute or relative path to the repository root."),
      },
    },
    async (args) => {
      const result = handleResumeInitialization(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // session_status
  server.registerTool(
    "session_status",
    {
      description: "Check whether there is an active in-memory BlockGraph session. When active, returns repo path, DB path, and graph summary.",
      inputSchema: {},
    },
    async (args) => {
      const result = handleSessionStatus(ctx, args as any);
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

  // ── v0.2: Work Package Tools ─────────────────────────────────────────────

  // §12.1 create_work_package
  server.registerTool(
    "create_work_package",
    {
      description: "Create a planned work package with isolation boundaries for parallel initialization.",
      inputSchema: {
        id: z.string().describe("Stable kebab-case ID (e.g. wp-auth)."),
        name: z.string().describe("Work package name."),
        type: z.enum(["feature", "app_shell", "shared", "ui", "testing", "config", "infrastructure", "unknown"]).optional().describe("Work package type."),
        scope_paths: z.array(z.string()).optional().describe("Repo-relative paths this package owns."),
        included_entity_ids: z.array(z.string()).optional().describe("Explicitly included code entity IDs."),
        excluded_entity_ids: z.array(z.string()).optional().describe("Excluded code entity IDs."),
        allowed_external_refs: z.array(z.string()).optional().describe("Entities this package may reference as uses."),
        forbidden_ownership: z.array(z.string()).optional().describe("Paths this package must not claim."),
        dependencies_on_packages: z.array(z.string()).optional().describe("IDs of packages this depends on."),
        owner_agent: z.string().optional().describe("Agent assigned to this package."),
        open_questions: z.array(z.string()).optional().describe("Open questions for this package."),
        notes: z.string().optional().describe("Additional notes."),
      },
    },
    async (args) => {
      const result = handleCreateWorkPackage(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.1 list_work_packages
  server.registerTool(
    "list_work_packages",
    {
      description: "List work packages by status or type.",
      inputSchema: {
        status: z.enum(["planned", "assigned", "proposed", "reviewing", "needs_revision", "approved", "merged", "rejected", "deferred"]).optional().describe("Filter by status."),
        type: z.enum(["feature", "app_shell", "shared", "ui", "testing", "config", "infrastructure", "unknown"]).optional().describe("Filter by type."),
      },
    },
    async (args) => {
      const result = handleListWorkPackages(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.1 update_work_package_status
  server.registerTool(
    "update_work_package_status",
    {
      description: "Update work package status. Enforces legal status transitions.",
      inputSchema: {
        id: z.string().describe("Work package ID."),
        status: z.enum(["planned", "assigned", "proposed", "reviewing", "needs_revision", "approved", "merged", "rejected", "deferred"]).describe("New status."),
      },
    },
    async (args) => {
      const result = handleUpdateWorkPackageStatus(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.1 check_work_package_conflicts
  server.registerTool(
    "check_work_package_conflicts",
    {
      description: "Report duplicate ownership, scope violations, missing dependencies, and unreviewed proposals.",
      inputSchema: {},
    },
    async (args) => {
      const result = handleCheckWorkPackageConflicts(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // ── v0.2: Proposal Tools ────────────────────────────────────────────────

  // §12.2 create_module_proposal
  server.registerTool(
    "create_module_proposal",
    {
      description: "Create a module proposal for a work package. Proposals are intermediate artifacts, not accepted graph data.",
      inputSchema: {
        id: z.string().describe("Proposal ID."),
        work_package_id: z.string().describe("Work package this proposal belongs to."),
        module_name: z.string().describe("Proposed module name."),
        module_type: z.enum(["feature", "app_shell", "shared", "ui", "testing", "config", "infrastructure", "unknown"]).optional().describe("Module type."),
        purpose: z.string().optional().describe("Module purpose description."),
        confidence: z.number().optional().describe("Confidence score 0-1."),
      },
    },
    async (args) => {
      const result = handleCreateModuleProposal(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 attach_proposal_entity
  server.registerTool(
    "attach_proposal_entity",
    {
      description: "Add owned/used/entrypoint entity evidence to a proposal. Validates scope for owned entities.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        entity_type: z.enum(["owned", "used", "entrypoint"]).describe("Entity relationship type."),
        code_entity_id: z.string().describe("Code entity ID."),
        role: z.string().optional().describe('Role: owns, uses, entrypoint, adapter, helper.'),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence for the mapping."),
        reason: z.string().optional().describe("Why this entity belongs here."),
        confidence: z.number().optional().describe("Confidence score 0-1."),
      },
    },
    async (args) => {
      const result = handleAttachProposalEntity(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 add_proposal_port
  server.registerTool(
    "add_proposal_port",
    {
      description: "Add a proposed port to a proposal.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        name: z.string().describe("Port name."),
        direction: z.enum(["in", "out"]).describe("Port direction."),
        contract: z.string().optional().describe("Natural language contract."),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence."),
        confidence: z.number().optional().describe("Confidence score 0-1."),
      },
    },
    async (args) => {
      const result = handleAddProposalPort(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 add_proposal_dependency
  server.registerTool(
    "add_proposal_dependency",
    {
      description: "Add incoming or outgoing dependency evidence to a proposal.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        direction: z.enum(["incoming", "outgoing"]).describe("Dependency direction."),
        target_work_package_id: z.string().optional().describe("Target work package ID."),
        target_code_entity_id: z.string().optional().describe("Target code entity ID."),
        protocol: z.enum(["function_call", "http", "event", "state", "render", "config", "type", "unknown"]).optional().describe("Protocol."),
        evidence: z.array(EvidenceSchema).optional().describe("Evidence."),
        reason: z.string().optional().describe("Reason for dependency."),
        confidence: z.number().optional().describe("Confidence score 0-1."),
      },
    },
    async (args) => {
      const result = handleAddProposalDependency(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 add_proposal_flow
  server.registerTool(
    "add_proposal_flow",
    {
      description: "Add an internal proposed flow to a proposal.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        name: z.string().describe("Flow name."),
        entrypoint_entity_id: z.string().describe("Entrypoint code entity ID."),
        steps: z.array(z.object({
          order: z.number(),
          code_entity_id: z.string(),
          trigger: z.string().optional(),
          evidence: z.array(EvidenceSchema).optional(),
          confidence: z.number().optional(),
        })).optional().describe("Flow steps."),
        confidence: z.number().optional().describe("Confidence score 0-1."),
      },
    },
    async (args) => {
      const result = handleAddProposalFlow(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 mark_proposal_gap
  server.registerTool(
    "mark_proposal_gap",
    {
      description: "Record unresolved module-local uncertainty in a proposal.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        kind: z.enum(["missing_entity", "unclear_ownership", "missing_dependency", "weak_evidence", "needs_coordinator_decision", "other"]).describe("Gap type."),
        related_entity_ids: z.array(z.string()).optional().describe("Related code entity IDs."),
        description: z.string().describe("Gap description."),
        suggested_resolution: z.string().optional().describe("Suggested resolution."),
      },
    },
    async (args) => {
      const result = handleMarkProposalGap(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 update_module_proposal
  server.registerTool(
    "update_module_proposal",
    {
      description: "Update editable fields (purpose, module_name, confidence) on a draft or needs_revision proposal. Does not change status or entity lists.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        purpose: z.string().optional().describe("Updated module purpose."),
        module_name: z.string().optional().describe("Updated module name."),
        confidence: z.number().min(0).max(1).optional().describe("Updated confidence score 0-1."),
      },
    },
    async (args) => {
      const result = handleUpdateModuleProposal(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.2 submit_module_proposal
  server.registerTool(
    "submit_module_proposal",
    {
      description: "Mark a module proposal as ready for review. Validates proposal has meaningful content.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID to submit."),
      },
    },
    async (args) => {
      const result = handleSubmitModuleProposal(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // ── v0.2: Review Tools ──────────────────────────────────────────────────

  // §12.3 submit_proposal_review
  server.registerTool(
    "submit_proposal_review",
    {
      description: "Record a structured review for a module proposal. Findings include priority, expected, observed, and recommendation.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID to review."),
        reviewer_agent: z.string().optional().describe("Reviewer agent identifier."),
        status: z.enum(["pass", "needs_revision", "reject"]).optional().describe("Review status."),
        findings: z.array(z.object({
          priority: z.enum(["P0", "P1", "P2", "P3"]),
          title: z.string(),
          description: z.string().optional(),
          file_path: z.string().optional(),
          start_line: z.number().optional(),
          code_entity_id: z.string().optional(),
          expected: z.string(),
          observed: z.string(),
          recommendation: z.string(),
        })).optional().describe("Structured review findings."),
        coverage_notes: z.string().optional().describe("Coverage notes."),
        evidence_notes: z.string().optional().describe("Evidence notes."),
        recommended_fixes: z.array(z.string()).optional().describe("Recommended fixes."),
      },
    },
    async (args) => {
      const result = handleSubmitProposalReview(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.3 approve_module_proposal
  server.registerTool(
    "approve_module_proposal",
    {
      description: "Coordinator-only: approve a reviewed proposal so it can be merged. Requires at least one pass review and no unresolved P0/P1 findings.",
      inputSchema: {
        proposal_id: z.string().describe("Proposal ID."),
        coordinator_agent: z.string().optional().describe("Coordinator agent identifier."),
        notes: z.string().optional().describe("Approval notes."),
      },
    },
    async (args) => {
      const result = handleApproveModuleProposal(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.3 list_proposal_reviews
  server.registerTool(
    "list_proposal_reviews",
    {
      description: "List reviews and findings for a proposal.",
      inputSchema: {
        proposal_id: z.string().optional().describe("Filter by proposal ID."),
      },
    },
    async (args) => {
      const result = handleListProposalReviews(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.3 resolve_proposal_finding
  server.registerTool(
    "resolve_proposal_finding",
    {
      description: "Mark a review finding as resolved, rejected, or deferred. P0/P1 cannot be deferred without coordinator override reason.",
      inputSchema: {
        review_id: z.string().describe("Review ID."),
        finding_index: z.number().int().min(0).describe("Index of the finding to resolve."),
        resolution: z.enum(["resolved", "rejected", "deferred"]).describe("Resolution status."),
        resolution_reason: z.string().optional().describe("Reason for resolution. Required for deferring P0/P1."),
      },
    },
    async (args) => {
      const result = handleResolveProposalFinding(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // ── v0.2: Merge Tools ───────────────────────────────────────────────────

  // §12.4 merge_module_proposal
  server.registerTool(
    "merge_module_proposal",
    {
      description: "Coordinator-only: merge an approved proposal into the draft graph. Creates block, attaches entities, ports, and flows.",
      inputSchema: {
        proposal_id: z.string().describe("Approved proposal ID to merge."),
      },
    },
    async (args) => {
      const result = handleMergeModuleProposal(ctx, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.4 list_merged_proposals
  server.registerTool(
    "list_merged_proposals",
    {
      description: "List proposal-to-block merge mappings.",
      inputSchema: {
        work_package_id: z.string().optional().describe("Filter by work package ID."),
      },
    },
    async (args) => {
      const result = handleListMergedProposals(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // list_module_proposals
  server.registerTool(
    "list_module_proposals",
    {
      description: "List module proposals with optional filters. After reconnect, use this to inspect proposal progress before deciding whether to review, approve, merge, or revise.",
      inputSchema: {
        work_package_id: z.string().optional().describe("Filter by work package ID."),
        status: z.enum(["draft", "submitted", "reviewing", "needs_revision", "approved", "merged", "rejected"]).optional().describe("Filter by proposal status."),
      },
    },
    async (args) => {
      const result = handleListModuleProposals(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // ── v0.2: Quality Gate Tools ─────────────────────────────────────────────

  // §12.5 coverage_report
  server.registerTool(
    "coverage_report",
    {
      description: "Report mapped/unmapped entities and directories.",
      inputSchema: {},
    },
    async (args) => {
      const result = handleCoverageReport(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.5 detect_missing_modules
  server.registerTool(
    "detect_missing_modules",
    {
      description: "Detect likely missing feature modules from directory structure and code facts.",
      inputSchema: {},
    },
    async (args) => {
      const result = handleDetectMissingModules(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.5 detect_shared_dependencies
  server.registerTool(
    "detect_shared_dependencies",
    {
      description: "Detect shared dependency candidates (utils, types, hooks, lib, config).",
      inputSchema: {},
    },
    async (args) => {
      const result = handleDetectSharedDependencies(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.5 connector_audit
  server.registerTool(
    "connector_audit",
    {
      description: "Audit cross-block code edges and connector evidence.",
      inputSchema: {},
    },
    async (args) => {
      const result = handleConnectorAudit(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.5 flow_sufficiency_check
  server.registerTool(
    "flow_sufficiency_check",
    {
      description: "Evaluate whether flows are sufficient for repository complexity.",
      inputSchema: {
        complexity: z.enum(["small", "medium", "complex"]).optional().describe("Repository complexity level."),
      },
    },
    async (args) => {
      const result = handleFlowSufficiencyCheck(ctx, args as any);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    },
  );

  // §12.5 quality_gate_report
  server.registerTool(
    "quality_gate_report",
    {
      description: "Run all quality checks and return ready/not-ready decision.",
      inputSchema: {
        complexity: z.enum(["small", "medium", "complex"]).optional().describe("Repository complexity level."),
      },
    },
    async (args) => {
      const result = handleQualityGateReport(ctx, args as any);
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
