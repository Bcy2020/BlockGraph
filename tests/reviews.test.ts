/**
 * BlockGraph MCP v0.2 — Proposal Review Tests
 * Tests review submission, finding resolution, approval blocking rules.
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
  updateModuleProposalStatus,
  appendProposalEntity,
  createProposalReview,
  getProposalReview,
  listProposalReviews,
  updateProposalReview,
} from "../src/graph/draft.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleCreateWorkPackage,
  handleCreateModuleProposal,
  handleAttachProposalEntity,
  handleSubmitModuleProposal,
  handleSubmitProposalReview,
  handleListProposalReviews,
  handleResolveProposalFinding,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-review-test-"));
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

function seedProposal(db: Database.Database): string {
  createWorkPackage(db, { id: "wp-auth", name: "Auth" });
  createModuleProposal(db, {
    id: "prop-auth",
    work_package_id: "wp-auth",
    module_name: "Auth Module",
    purpose: "Handle authentication",
  });
  const entity = createCodeEntity(db, {
    type: "function",
    name: "login",
    file_path: "src/auth/login.ts",
    start_line: 1,
    end_line: 10,
  });
  appendProposalEntity(db, "prop-auth", "owned", {
    code_entity_id: entity.id,
    role: "owns",
    evidence: [],
    reason: "Core login",
    confidence: 0.9,
  });
  return "prop-auth";
}

// ── Service Layer Tests ────────────────────────────────────────────────────

describe("Proposal Review Service", () => {
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

  it("create review succeeds", () => {
    seedProposal(db);

    const review = createProposalReview(db, {
      id: "review-1",
      proposal_id: "prop-auth",
      status: "needs_revision",
      findings: [{
        priority: "P1",
        title: "Missing evidence",
        description: "No file evidence provided",
        expected: "Evidence with file path and line range",
        observed: "Empty evidence array",
        recommendation: "Add source code evidence",
      }],
      coverage_notes: "Good coverage",
      evidence_notes: "Needs more evidence",
      recommended_fixes: ["Add evidence to owned entities"],
    });

    expect(review.id).toBe("review-1");
    expect(review.proposal_id).toBe("prop-auth");
    expect(review.status).toBe("needs_revision");
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].priority).toBe("P1");
  });

  it("get review returns stored data", () => {
    seedProposal(db);
    createProposalReview(db, {
      id: "review-1",
      proposal_id: "prop-auth",
      findings: [{
        priority: "P2",
        title: "Test finding",
        description: "Test",
        expected: "Expected",
        observed: "Observed",
        recommendation: "Fix it",
      }],
    });

    const review = getProposalReview(db, "review-1");
    expect(review).not.toBeNull();
    expect(review!.findings).toHaveLength(1);
  });

  it("list reviews filters by proposal_id", () => {
    seedProposal(db);
    createProposalReview(db, { id: "review-1", proposal_id: "prop-auth" });
    createProposalReview(db, { id: "review-2", proposal_id: "prop-auth" });

    const reviews = listProposalReviews(db, { proposal_id: "prop-auth" });
    expect(reviews).toHaveLength(2);
  });

  it("update review findings", () => {
    seedProposal(db);
    createProposalReview(db, {
      id: "review-1",
      proposal_id: "prop-auth",
      findings: [{
        priority: "P1",
        title: "Finding 1",
        description: "Test",
        expected: "Expected",
        observed: "Observed",
        recommendation: "Fix",
      }],
    });

    const findings = getProposalReview(db, "review-1")!.findings;
    findings[0].resolution = "resolved";
    findings[0].resolution_reason = "Fixed by adding evidence";

    const updated = updateProposalReview(db, "review-1", { findings });
    expect(updated).toBe(true);

    const review = getProposalReview(db, "review-1");
    expect(review!.findings[0].resolution).toBe("resolved");
  });
});

// ── MCP Tool Handler Tests ─────────────────────────────────────────────────

describe("Review Tool Handlers", () => {
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

  describe("handleSubmitProposalReview", () => {
    it("success: submit review with findings", () => {
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

      const result = handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        status: "needs_revision",
        findings: [{
          priority: "P1",
          title: "Missing evidence",
          description: "No file evidence provided",
          expected: "Evidence provided",
          observed: "No evidence",
          recommendation: "Add evidence",
        }],
        coverage_notes: "Good coverage",
      });

      expect(result.ok).toBe(true);
      expect(result.data!.review_id).toBeDefined();
      expect(result.data!.status).toBe("needs_revision");
    });

    it("fails: missing proposal", () => {
      const result = handleSubmitProposalReview(ctx, {
        proposal_id: "nonexistent",
        findings: [{
          priority: "P1",
          title: "Test",
          description: "Test description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("PROPOSAL_NOT_FOUND");
    });

    it("fails: malformed finding", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        findings: [{
          priority: "INVALID" as any,
          title: "Test",
          description: "Test description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      expect(result.ok).toBe(false);
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleSubmitProposalReview(noSessionCtx, {
        proposal_id: "prop-auth",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("handleListProposalReviews", () => {
    it("success: list reviews", () => {
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

      handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        findings: [{
          priority: "P2",
          title: "Test",
          description: "Test description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      const result = handleListProposalReviews(ctx, { proposal_id: "prop-auth" });
      expect(result.ok).toBe(true);
      expect(result.data!.reviews).toHaveLength(1);
    });
  });

  describe("handleResolveProposalFinding", () => {
    it("success: resolve finding", () => {
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

      const reviewResult = handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        findings: [{
          priority: "P2",
          title: "Test finding",
          description: "Test description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      const result = handleResolveProposalFinding(ctx, {
        review_id: reviewResult.data!.review_id,
        finding_index: 0,
        resolution: "resolved",
        resolution_reason: "Fixed",
      });

      expect(result.ok).toBe(true);
    });

    it("fails: defer P1 without reason", () => {
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

      const reviewResult = handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        findings: [{
          priority: "P1",
          title: "Critical finding",
          description: "Critical issue description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      const result = handleResolveProposalFinding(ctx, {
        review_id: reviewResult.data!.review_id,
        finding_index: 0,
        resolution: "deferred",
      });

      expect(result.ok).toBe(false);
    });

    it("success: defer P1 with coordinator reason", () => {
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

      const reviewResult = handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        findings: [{
          priority: "P1",
          title: "Critical finding",
          description: "Critical issue description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      const result = handleResolveProposalFinding(ctx, {
        review_id: reviewResult.data!.review_id,
        finding_index: 0,
        resolution: "deferred",
        resolution_reason: "Coordinator override: will fix in next iteration",
      });

      expect(result.ok).toBe(true);
    });

    it("fails: finding index out of range", () => {
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

      const reviewResult = handleSubmitProposalReview(ctx, {
        proposal_id: "prop-auth",
        findings: [{
          priority: "P2",
          title: "Test",
          description: "Test description",
          expected: "Expected",
          observed: "Observed",
          recommendation: "Fix",
        }],
      });

      const result = handleResolveProposalFinding(ctx, {
        review_id: reviewResult.data!.review_id,
        finding_index: 5,
        resolution: "resolved",
      });

      expect(result.ok).toBe(false);
    });
  });
});
