/**
 * BlockGraph MCP v0.2 — Module Proposal Tests
 * Tests proposal CRUD, scope validation, status transitions, and MCP tool handlers.
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
  getModuleProposal,
  listModuleProposals,
  updateModuleProposalStatus,
  appendProposalEntity,
  appendProposalPort,
  appendProposalDependency,
  appendProposalFlow,
  appendProposalGap,
  isEntityInScope,
  isEntityForbidden,
  isEntityAllowedExternal,
} from "../src/graph/draft.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleCreateModuleProposal,
  handleAttachProposalEntity,
  handleAddProposalPort,
  handleAddProposalDependency,
  handleAddProposalFlow,
  handleMarkProposalGap,
  handleUpdateModuleProposal,
  handleSubmitModuleProposal,
  handleSubmitProposalReview,
  handleCreateWorkPackage,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-proposal-test-"));
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

function seedCodeEntity(
  db: Database.Database,
  overrides?: Partial<{ type: string; name: string; file_path: string }>,
) {
  return createCodeEntity(db, {
    type: (overrides?.type as any) ?? "function",
    name: overrides?.name ?? "testFunc",
    file_path: overrides?.file_path ?? "src/test.ts",
    start_line: 1,
    end_line: 5,
  });
}

// ── Service Layer Tests ────────────────────────────────────────────────────

describe("Module Proposal Service", () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTempDir();
    db = openStore(tmpDir);
  });

  afterEach(() => {
    closeStore(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create proposal succeeds", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    const proposal = createModuleProposal(db, {
      id: "prop-auth",
      work_package_id: "wp-auth",
      module_name: "Auth Module",
      purpose: "Handle authentication",
    });

    expect(proposal.id).toBe("prop-auth");
    expect(proposal.work_package_id).toBe("wp-auth");
    expect(proposal.status).toBe("draft");
    expect(proposal.purpose).toBe("Handle authentication");
  });

  it("get proposal returns stored data", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, {
      id: "prop-auth",
      work_package_id: "wp-auth",
      module_name: "Auth Module",
    });

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal).not.toBeNull();
    expect(proposal!.module_name).toBe("Auth Module");
  });

  it("list proposals filters by work_package_id", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createWorkPackage(db, { id: "wp-users", name: "Users" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });
    createModuleProposal(db, { id: "prop-users", work_package_id: "wp-users", module_name: "Users" });

    const authProposals = listModuleProposals(db, { work_package_id: "wp-auth" });
    expect(authProposals).toHaveLength(1);
    expect(authProposals[0].id).toBe("prop-auth");
  });

  it("proposal status transitions work", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });

    // draft -> submitted
    let result = updateModuleProposalStatus(db, "prop-auth", "submitted");
    expect(result.ok).toBe(true);

    // submitted -> reviewing
    result = updateModuleProposalStatus(db, "prop-auth", "reviewing");
    expect(result.ok).toBe(true);

    // reviewing -> approved
    result = updateModuleProposalStatus(db, "prop-auth", "approved");
    expect(result.ok).toBe(true);

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal!.status).toBe("approved");
  });

  it("illegal proposal status transitions fail", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });

    // draft -> approved (skipping intermediate states)
    const result = updateModuleProposalStatus(db, "prop-auth", "approved");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Illegal");
  });

  it("append owned entity to proposal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });
    const entity = seedCodeEntity(db, { file_path: "src/auth/login.ts" });

    const result = appendProposalEntity(db, "prop-auth", "owned", {
      code_entity_id: entity.id,
      role: "owns",
      evidence: [],
      reason: "Core auth logic",
      confidence: 0.9,
    });

    expect(result.ok).toBe(true);

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal!.owned_code_entities).toHaveLength(1);
    expect(proposal!.owned_code_entities[0].code_entity_id).toBe(entity.id);
  });

  it("append port to proposal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });

    const result = appendProposalPort(db, "prop-auth", {
      name: "loginRequest",
      direction: "in",
      contract: "Accepts credentials",
      evidence: [],
      confidence: 0.9,
    });

    expect(result.ok).toBe(true);

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal!.ports).toHaveLength(1);
  });

  it("append dependency to proposal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });

    const result = appendProposalDependency(db, "prop-auth", "outgoing", {
      target_code_entity_id: "some-api-client",
      direction: "outgoing",
      protocol: "function_call",
      evidence: [],
      reason: "Calls API client for login",
      confidence: 0.8,
    });

    expect(result.ok).toBe(true);

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal!.outgoing_dependencies).toHaveLength(1);
  });

  it("append flow to proposal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });
    const entity = seedCodeEntity(db);

    const result = appendProposalFlow(db, "prop-auth", {
      name: "Login Flow",
      entrypoint_entity_id: entity.id,
      steps: [{
        order: 1,
        code_entity_id: entity.id,
        trigger: "form submit",
        evidence: [],
        confidence: 0.9,
      }],
      confidence: 0.8,
    });

    expect(result.ok).toBe(true);

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal!.internal_flows).toHaveLength(1);
    expect(proposal!.internal_flows[0].steps).toHaveLength(1);
  });

  it("append gap to proposal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createModuleProposal(db, { id: "prop-auth", work_package_id: "wp-auth", module_name: "Auth" });

    const result = appendProposalGap(db, "prop-auth", {
      kind: "missing_entity",
      related_entity_ids: [],
      description: "Missing password reset flow",
      suggested_resolution: "Add password reset handler",
    });

    expect(result.ok).toBe(true);

    const proposal = getModuleProposal(db, "prop-auth");
    expect(proposal!.coverage_gaps).toHaveLength(1);
  });
});

// ── Scope Validation Tests ─────────────────────────────────────────────────

describe("Scope Validation", () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = makeTempDir();
    db = openStore(tmpDir);
  });

  afterEach(() => {
    closeStore(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("entity in scope returns true", () => {
    const entity = seedCodeEntity(db, { file_path: "src/features/auth/login.ts" });
    const pkg = createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth",
      scope_paths: ["src/features/auth/**"],
    });

    expect(isEntityInScope(db, entity.id, pkg)).toBe(true);
  });

  it("entity outside scope returns false", () => {
    const entity = seedCodeEntity(db, { file_path: "src/features/users/profile.ts" });
    const pkg = createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth",
      scope_paths: ["src/features/auth/**"],
    });

    expect(isEntityInScope(db, entity.id, pkg)).toBe(false);
  });

  it("entity in forbidden ownership returns true", () => {
    const entity = seedCodeEntity(db, { file_path: "src/utils/helpers.ts" });
    const pkg = createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth",
      scope_paths: ["src/features/auth/**"],
      forbidden_ownership: ["src/utils/**"],
    });

    expect(isEntityForbidden(db, entity.id, pkg)).toBe(true);
  });

  it("entity in allowed external refs returns true", () => {
    const entity = seedCodeEntity(db, { file_path: "src/lib/api-client.ts" });
    const pkg = createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth",
      scope_paths: ["src/features/auth/**"],
      allowed_external_refs: ["src/lib/**"],
    });

    expect(isEntityAllowedExternal(db, entity.id, pkg)).toBe(true);
  });

  it("entity not in allowed external refs returns false", () => {
    const entity = seedCodeEntity(db, { file_path: "src/lib/other.ts" });
    const pkg = createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth",
      scope_paths: ["src/features/auth/**"],
      allowed_external_refs: ["src/lib/api-client.ts"],
    });

    expect(isEntityAllowedExternal(db, entity.id, pkg)).toBe(false);
  });
});

// ── MCP Tool Handler Tests ─────────────────────────────────────────────────

describe("Proposal Tool Handlers", () => {
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

  describe("handleCreateModuleProposal", () => {
    it("success: creates proposal", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });

      const result = handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth Module",
        purpose: "Handle authentication",
      });

      expect(result.ok).toBe(true);
      expect(result.data!.proposal_id).toBe("prop-auth");
      expect(result.data!.status).toBe("draft");
    });

    it("fails: missing work package", () => {
      const result = handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "nonexistent",
        module_name: "Auth Module",
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("WORK_PACKAGE_NOT_FOUND");
    });

    it("fails: missing purpose on submit", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth Module",
      });

      const result = handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleCreateModuleProposal(noSessionCtx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("handleAttachProposalEntity", () => {
    it("success: attach owned entity in scope", () => {
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        scope_paths: ["src/features/auth"],
      });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "login",
        file_path: "src/features/auth/login.ts",
        start_line: 1,
        end_line: 10,
      });

      const result = handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
        reason: "Core login function",
      });

      expect(result.ok).toBe(true);
    });

    it("fails: owned entity outside scope", () => {
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        scope_paths: ["src/features/auth"],
      });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "getUsers",
        file_path: "src/features/users/list.ts",
        start_line: 1,
        end_line: 10,
      });

      const result = handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("SCOPE_VIOLATION");
    });

    it("fails: owned entity in forbidden path", () => {
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        scope_paths: ["src/features/**"],
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

      const result = handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("SCOPE_VIOLATION");
    });

    it("fails: used entity not in allowed external refs", () => {
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        scope_paths: ["src/features/auth"],
        allowed_external_refs: ["src/lib/api-client.ts"],
      });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const entity = createCodeEntity(ctx.db!, {
        type: "function",
        name: "otherFunc",
        file_path: "src/lib/other-module.ts",
        start_line: 1,
        end_line: 5,
      });

      const result = handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "used",
        code_entity_id: entity.id,
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("EXTERNAL_REF_NOT_ALLOWED");
    });
  });

  describe("handleSubmitModuleProposal", () => {
    it("success: submit with purpose and entities", () => {
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

      const result = handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(true);
      expect(result.data!.status).toBe("submitted");
    });

    it("fails: no purpose", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
      });

      const result = handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
    });

    it("fails: no entities and no gaps", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
    });
  });

  describe("handleUpdateModuleProposal", () => {
    it("success: update purpose", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "",
      });

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        purpose: "Handle authentication and session management",
      });
      expect(result.ok).toBe(true);
      expect(result.data!.updated_fields).toContain("purpose");

      // Attach entity so submit can succeed
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

      // Verify the proposal can now be submitted (purpose is no longer empty)
      const submitResult = handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(submitResult.ok).toBe(true);
    });

    it("success: update module_name", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        module_name: "Authentication Module",
      });
      expect(result.ok).toBe(true);
      expect(result.data!.updated_fields).toContain("module_name");
    });

    it("success: update confidence", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        confidence: 0.8,
      });
      expect(result.ok).toBe(true);
      expect(result.data!.updated_fields).toContain("confidence");
    });

    it("success: update multiple fields", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        purpose: "Updated purpose",
        module_name: "Updated Name",
        confidence: 0.5,
      });
      expect(result.ok).toBe(true);
      expect(result.data!.updated_fields).toHaveLength(3);
    });

    it("success: update needs_revision proposal", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
      // Move to needs_revision via review side effect
      handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        status: "needs_revision",
        findings: [{
          priority: "P1",
          title: "Issue",
          description: "Desc",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        purpose: "Fixed purpose",
      });
      expect(result.ok).toBe(true);
    });

    it("fails: submitted proposal not editable", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      // Attach entity so submit succeeds
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

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        purpose: "Should fail",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_STATUS");
    });

    it("fails: no fields provided", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleUpdateModuleProposal(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("fails: empty purpose", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "prop-auth",
        purpose: "",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("fails: proposal not found", () => {
      const result = handleUpdateModuleProposal(ctx, {
        proposal_id: "nonexistent",
        purpose: "Test",
      });
      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("PROPOSAL_NOT_FOUND");
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleUpdateModuleProposal(noSessionCtx, {
        proposal_id: "prop-auth",
        purpose: "Test",
      });
      expect(result.ok).toBe(false);
    });
  });
});
