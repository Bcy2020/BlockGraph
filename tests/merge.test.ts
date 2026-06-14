/**
 * BlockGraph MCP v0.2 — Coordinator Merge Tests
 * Tests merge_module_proposal: approved merge, rejection of unapproved, duplicate ownership, scope violations.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { openStore, closeStore } from "../src/graph/store.js";
import {
  createCodeEntity,
  createWorkPackage,
  createModuleProposal,
  updateModuleProposal,
  updateModuleProposalStatus,
  appendProposalEntity,
  appendProposalPort,
  appendProposalFlow,
  createProposalReview,
  getBlock,
  listBlocks,
  listBlockCodeMappings,
  listCodeEntities,
  listPorts,
  listFlowSteps,
  listMergedProposalMappings,
} from "../src/graph/draft.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleCreateWorkPackage,
  handleCreateModuleProposal,
  handleAttachProposalEntity,
  handleAddProposalPort,
  handleAddProposalFlow,
  handleSubmitModuleProposal,
  handleSubmitProposalReview,
  handleResolveProposalFinding,
  handleMergeModuleProposal,
  handleListMergedProposals,
  handleListWorkPackages,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-merge-test-"));
}

function makeCtx(): ToolContext {
  return { db: null, repoPath: null };
}

function makeInitializedCtx(): ToolContext {
  const ctx = makeCtx();
  const tmpDir = makeTempDir();
  handleBeginInitialization(ctx, { repo_path: tmpDir });
  return ctx;
}

/** Create a full approved proposal ready for merge. */
function createApprovedProposal(ctx: ToolContext): string {
  handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth", scope_paths: ["src/auth"] });
  handleCreateModuleProposal(ctx, {
    id: "prop-auth",
    work_package_id: "wp-auth",
    module_name: "Auth Module",
    purpose: "Handle authentication",
  });

  const entity = createCodeEntity(ctx.db!, {
    type: "function",
    name: "login",
    file_path: "src/auth/login.ts",
    start_line: 1,
    end_line: 10,
  });

  handleAttachProposalEntity(ctx, {
    proposal_id: "prop-auth",
    entity_type: "owned",
    code_entity_id: entity.id,
    role: "owns",
  });

  handleAddProposalPort(ctx, {
    proposal_id: "prop-auth",
    name: "loginRequest",
    direction: "in",
    contract: "Accepts credentials",
  });

  // Submit proposal: draft -> submitted
  handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });

  // Submit review with pass
  handleSubmitProposalReview(ctx, {
    proposal_id: "prop-auth",
    status: "pass",
    findings: [],
  });

  // Transition: submitted -> reviewing -> approved
  updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
  updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");

  return "prop-auth";
}

// ── MCP Tool Handler Tests ─────────────────────────────────────────────────

describe("Merge Tool Handlers", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("handleMergeModuleProposal", () => {
    it("success: approved proposal merges into draft block", () => {
      createApprovedProposal(ctx);

      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(true);
      expect(result.data!.block_id).toBeDefined();
      expect(result.data!.proposal_id).toBe("prop-auth");

      // Verify block was created
      const block = getBlock(ctx.db!, result.data!.block_id);
      expect(block).not.toBeNull();
      expect(block!.name).toBe("Auth Module");
      expect(block!.purpose).toBe("Handle authentication");
      expect(block!.status).toBe("draft");
    });

    it("success: merge creates block mappings", () => {
      createApprovedProposal(ctx);
      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const mappings = listBlockCodeMappings(ctx.db!, { block_id: result.data!.block_id });
      expect(mappings.length).toBeGreaterThanOrEqual(1);
    });

    it("success: merge creates ports", () => {
      createApprovedProposal(ctx);
      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const ports = listPorts(ctx.db!, { block_id: result.data!.block_id });
      expect(ports).toHaveLength(1);
      expect(ports[0].name).toBe("loginRequest");
      expect(ports[0].direction).toBe("in");
    });

    it("success: merge creates internal flows", () => {
      createApprovedProposal(ctx);
      // Get the entity created by createApprovedProposal
      const entities = listCodeEntities(ctx.db!);
      expect(entities.length).toBeGreaterThanOrEqual(1);
      const entity = entities[0];

      handleAddProposalFlow(ctx, {
        proposal_id: "prop-auth",
        name: "Login Flow",
        entrypoint_entity_id: entity.id,
        steps: [{
          order: 1,
          code_entity_id: entity.id,
          trigger: "form submit",
        }],
      });

      // Re-approve (flow was added after submit, but for testing we just merge)
      updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");

      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const flowSteps = listFlowSteps(ctx.db!, { block_id: result.data!.block_id });
      expect(flowSteps.length).toBeGreaterThanOrEqual(1);
    });

    it("success: merge records proposal-to-block mapping", () => {
      createApprovedProposal(ctx);
      handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const mappings = listMergedProposalMappings(ctx.db!, { proposal_id: "prop-auth" });
      expect(mappings).toHaveLength(1);
      expect(mappings[0].work_package_id).toBe("wp-auth");
    });

    it("fails: unapproved proposal rejected", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "login",
        file_path: "src/auth/login.ts",
        start_line: 1,
        end_line: 10,
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
      });

      // Don't submit or approve — try to merge draft
      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NOT_APPROVED");
    });

    it("fails: rejected proposal rejected", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "login",
        file_path: "src/auth/login.ts",
        start_line: 1,
        end_line: 10,
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
      });

      updateModuleProposalStatus(ctx.db!, "prop-auth", "submitted");
      updateModuleProposalStatus(ctx.db!, "prop-auth", "rejected");

      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
    });

    it("fails: unresolved P0/P1 finding", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "login",
        file_path: "src/auth/login.ts",
        start_line: 1,
        end_line: 10,
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
      });

      handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });

      // Submit review with P1 finding
      handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        status: "needs_revision",
        findings: [{
          priority: "P1",
          title: "Critical issue",
          description: "Missing evidence",
          expected: "Evidence",
          observed: "No evidence",
          recommendation: "Add evidence",
        }],
      });

      // Approve anyway (shouldn't happen in real workflow, but testing merge guard)
      updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");

      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("UNRESOLVED_FINDING");
    });

    it("fails: duplicate ownership", () => {
      // Create two packages without scope restrictions
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateWorkPackage(ctx, { id: "wp-users", name: "Users" });

      // Entity that both packages will claim
      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "sharedFunc",
        file_path: "src/shared/utils.ts",
        start_line: 1,
        end_line: 10,
      });

      // First proposal
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
      handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      handleSubmitProposalReview(ctx, { proposal_id: "prop-auth", status: "pass", findings: [] });
      updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");

      // Second proposal (same entity)
      handleCreateModuleProposal(ctx, {
        id: "prop-users",
        work_package_id: "wp-users",
        module_name: "Users",
        purpose: "Users module",
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-users",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
      handleSubmitModuleProposal(ctx, { proposal_id: "prop-users" });
      handleSubmitProposalReview(ctx, { proposal_id: "prop-users", status: "pass", findings: [] });
      updateModuleProposalStatus(ctx.db!, "prop-users", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-users", "approved");

      // First merge detects duplicate ownership with second proposal
      const result1 = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result1.ok).toBe(false);
      expect(result1.errors![0].code).toBe("DUPLICATE_OWNERSHIP");
    });

    it("fails: scope violation (forbidden ownership)", () => {
      // Scope includes src/** but forbids src/utils/**
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        scope_paths: ["src/**"],
        forbidden_ownership: ["src/utils/**"],
      });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "helper",
        file_path: "src/utils/helpers.ts",
        start_line: 1,
        end_line: 5,
      });

      // Bypass attach handler to directly set owned entities (simulating a proposal
      // that was created before forbidden_ownership was added)
      updateModuleProposal(ctx.db!, "prop-auth", {
        owned_code_entities: [{
          code_entity_id: entity.id,
          role: "owns",
          evidence: [],
          reason: "test",
          confidence: 1.0,
        }],
      });

      handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      handleSubmitProposalReview(ctx, { proposal_id: "prop-auth", status: "pass", findings: [] });
      updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");

      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("SCOPE_VIOLATION");
    });

    it("fails: already merged", () => {
      createApprovedProposal(ctx);
      const mergeResult = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      if (!mergeResult.ok) console.log("First merge failed:", JSON.stringify(mergeResult.errors), "data:", JSON.stringify(mergeResult.data));
      expect(mergeResult.ok).toBe(true);

      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("ALREADY_MERGED");
    });

    it("fails: package already has merged proposal", () => {
      // Create two proposals for the same work package BEFORE merging
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth", scope_paths: ["src/auth"] });

      const entity1 = createCodeEntity(ctx.db!, {
        type: "function",
        name: "login",
        file_path: "src/auth/login.ts",
        start_line: 1,
        end_line: 10,
      });
      const entity2 = createCodeEntity(ctx.db!, {
        type: "function",
        name: "secondFunc",
        file_path: "src/auth/second.ts",
        start_line: 1,
        end_line: 5,
      });

      // First proposal
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth Module",
        purpose: "Handle authentication",
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity1.id,
        role: "owns",
      });
      handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      handleSubmitProposalReview(ctx, { proposal_id: "prop-auth", status: "pass", findings: [] });
      updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");

      // Second proposal (created before first is merged)
      handleCreateModuleProposal(ctx, {
        id: "prop-auth-2",
        work_package_id: "wp-auth",
        module_name: "Auth2",
        purpose: "Second auth module",
      });
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth-2",
        entity_type: "owned",
        code_entity_id: entity2.id,
        role: "owns",
      });
      handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth-2" });
      handleSubmitProposalReview(ctx, { proposal_id: "prop-auth-2", status: "pass", findings: [] });
      updateModuleProposalStatus(ctx.db!, "prop-auth-2", "reviewing");
      updateModuleProposalStatus(ctx.db!, "prop-auth-2", "approved");

      // Merge first proposal
      handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      // Try to merge second proposal for the same work package
      const result = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth-2" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("PACKAGE_ALREADY_MERGED");
    });

    it("updates work package status to merged", () => {
      createApprovedProposal(ctx);
      handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const wps = handleListWorkPackages(ctx, {});
      expect(wps.ok).toBe(true);
      const wp = wps.data!.packages.find((p: any) => p.id === "wp-auth");
      expect(wp!.status).toBe("merged");
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleMergeModuleProposal(noSessionCtx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
    });
  });

  describe("handleListMergedProposals", () => {
    it("success: list merged proposals", () => {
      createApprovedProposal(ctx);
      handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const result = handleListMergedProposals(ctx, {});
      expect(result.ok).toBe(true);
      expect(result.data!.mappings).toHaveLength(1);
      expect(result.data!.mappings[0].proposal_id).toBe("prop-auth");
    });

    it("success: filter by work_package_id", () => {
      createApprovedProposal(ctx);
      handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

      const result = handleListMergedProposals(ctx, { work_package_id: "wp-auth" });
      expect(result.ok).toBe(true);
      expect(result.data!.mappings).toHaveLength(1);
    });
  });
});
