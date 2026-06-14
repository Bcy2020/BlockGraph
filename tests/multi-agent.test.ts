/**
 * BlockGraph MCP v0.2 — Multi-Agent Protocol Simulation Tests
 * Simulates multiple agents working on different packages, creating proposals,
 * reviewing them, and merging them. Tests conflict detection and quality gates.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { openStore, closeStore } from "../src/graph/store.js";
import {
  createCodeEntity,
  createCodeEdge,
  createWorkPackage,
  getWorkPackage,
  listWorkPackages,
  updateWorkPackageStatus,
  createModuleProposal,
  getModuleProposal,
  updateModuleProposalStatus,
  appendProposalEntity,
  appendProposalPort,
  createProposalReview,
  getProposalReview,
  listProposalReviews,
  listMergedProposalMappings,
  getBlock,
  listBlocks,
  listBlockCodeMappings,
} from "../src/graph/draft.js";
import { scanRepo } from "../src/scanner/tsScanner.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleScanRepo,
  handleCreateWorkPackage,
  handleListWorkPackages,
  handleUpdateWorkPackageStatus,
  handleCheckWorkPackageConflicts,
  handleCreateModuleProposal,
  handleAttachProposalEntity,
  handleAddProposalPort,
  handleSubmitModuleProposal,
  handleSubmitProposalReview,
  handleResolveProposalFinding,
  handleMergeModuleProposal,
  handleListMergedProposals,
  handleCoverageReport,
  handleDetectMissingModules,
  handleDetectSharedDependencies,
  handleConnectorAudit,
  handleFlowSufficiencyCheck,
  handleQualityGateReport,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const COMPLEX_FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-complex");

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-multi-agent-test-"));
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

// ── Multi-Agent Simulation Tests ───────────────────────────────────────────

describe("Multi-Agent Protocol Simulation", () => {
  let tmpDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = makeTempDir();
    ctx = makeInitializedCtx();
    // Scan the complex fixture
    handleScanRepo(ctx, { repo_path: COMPLEX_FIXTURE_PATH });
  });

  afterEach(() => {
    if (ctx.db) closeStore(ctx.db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("simulates parallel package creation and proposal workflow", () => {
    // Step 1: Coordinator creates work packages
    handleCreateWorkPackage(ctx, {
      id: "wp-auth",
      name: "Auth Feature",
      type: "feature",
      scope_paths: ["src/features/auth/**"],
      allowed_external_refs: ["src/lib/**", "src/types/**", "src/hooks/**", "src/components/ui/**"],
    });

    handleCreateWorkPackage(ctx, {
      id: "wp-discussions",
      name: "Discussions Feature",
      type: "feature",
      scope_paths: ["src/features/discussions/**"],
      allowed_external_refs: ["src/lib/**", "src/types/**", "src/hooks/**", "src/components/ui/**"],
    });

    handleCreateWorkPackage(ctx, {
      id: "wp-shared-types",
      name: "Shared Types",
      type: "shared",
      scope_paths: ["src/types/**"],
    });

    // Verify packages created
    const packages = listWorkPackages(ctx.db!);
    expect(packages).toHaveLength(3);

    // Step 2: Module agents create proposals (simulated)
    // Auth agent
    handleCreateModuleProposal(ctx, {
      id: "prop-auth",
      work_package_id: "wp-auth",
      module_name: "Auth Module",
      module_type: "feature",
      purpose: "Handle user authentication",
    });

    // Get auth entities
    const authEntities = listCodeEntities(ctx.db!, { file_path: "src/features/auth" });
    for (const entity of authEntities.slice(0, 3)) {
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
    }

    // Discussions agent
    handleCreateModuleProposal(ctx, {
      id: "prop-discussions",
      work_package_id: "wp-discussions",
      module_name: "Discussions Module",
      module_type: "feature",
      purpose: "Manage discussions and comments",
    });

    const discussionEntities = listCodeEntities(ctx.db!, { file_path: "src/features/discussions" });
    for (const entity of discussionEntities.slice(0, 3)) {
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-discussions",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
    }

    // Shared types agent
    handleCreateModuleProposal(ctx, {
      id: "prop-shared-types",
      work_package_id: "wp-shared-types",
      module_name: "Shared Types",
      module_type: "shared",
      purpose: "Common type definitions",
    });

    const typeEntities = listCodeEntities(ctx.db!, { file_path: "src/types" });
    for (const entity of typeEntities) {
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-shared-types",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
    }

    // Step 3: Submit proposals
    handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
    handleSubmitModuleProposal(ctx, { proposal_id: "prop-discussions" });
    handleSubmitModuleProposal(ctx, { proposal_id: "prop-shared-types" });

    // Step 4: Independent reviews
    handleSubmitProposalReview(ctx, {
      proposal_id: "prop-auth",
      reviewer_agent: "reviewer-1",
      status: "pass",
      findings: [],
      coverage_notes: "Good coverage of auth feature",
    });

    handleSubmitProposalReview(ctx, {
      proposal_id: "prop-discussions",
      reviewer_agent: "reviewer-2",
      status: "pass",
      findings: [],
      coverage_notes: "Good coverage of discussions feature",
    });

    handleSubmitProposalReview(ctx, {
      proposal_id: "prop-shared-types",
      reviewer_agent: "reviewer-3",
      status: "pass",
      findings: [],
      coverage_notes: "All types covered",
    });

    // Step 5: Approve proposals
    updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
    updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");
    updateModuleProposalStatus(ctx.db!, "prop-discussions", "reviewing");
    updateModuleProposalStatus(ctx.db!, "prop-discussions", "approved");
    updateModuleProposalStatus(ctx.db!, "prop-shared-types", "reviewing");
    updateModuleProposalStatus(ctx.db!, "prop-shared-types", "approved");

    // Step 6: Coordinator merges proposals
    const merge1 = handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });
    expect(merge1.ok).toBe(true);

    const merge2 = handleMergeModuleProposal(ctx, { proposal_id: "prop-discussions" });
    expect(merge2.ok).toBe(true);

    const merge3 = handleMergeModuleProposal(ctx, { proposal_id: "prop-shared-types" });
    expect(merge3.ok).toBe(true);

    // Step 7: Verify merged blocks
    const blocks = listBlocks(ctx.db!);
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const mappings = listMergedProposalMappings(ctx.db!);
    expect(mappings).toHaveLength(3);
  });

  it("conflict checker detects unreviewed proposals", () => {
    // Create package and submit proposal without review
    handleCreateWorkPackage(ctx, {
      id: "wp-auth",
      name: "Auth Feature",
      type: "feature",
      scope_paths: ["src/features/auth/**"],
    });

    handleCreateModuleProposal(ctx, {
      id: "prop-auth",
      work_package_id: "wp-auth",
      module_name: "Auth",
      purpose: "Auth module",
    });

    const authEntities = listCodeEntities(ctx.db!, { file_path: "src/features/auth" });
    if (authEntities.length > 0) {
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: authEntities[0].id,
        role: "owns",
      });
    }

    handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });

    // Check conflicts — should detect unreviewed proposal
    const conflicts = handleCheckWorkPackageConflicts(ctx, {} as any);
    expect(conflicts.ok).toBe(true);
    expect(conflicts.data!.unreviewed_proposals).toContain("prop-auth");
  });

  it("quality gates detect missing teams feature", () => {
    // Scan repo but don't model teams feature
    handleCreateWorkPackage(ctx, {
      id: "wp-auth",
      name: "Auth Feature",
      type: "feature",
      scope_paths: ["src/features/auth/**"],
    });

    handleCreateModuleProposal(ctx, {
      id: "prop-auth",
      work_package_id: "wp-auth",
      module_name: "Auth",
      purpose: "Auth module",
    });

    const authEntities = listCodeEntities(ctx.db!, { file_path: "src/features/auth" });
    for (const entity of authEntities.slice(0, 2)) {
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
    }

    handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
    handleSubmitProposalReview(ctx, { proposal_id: "prop-auth", status: "pass", findings: [] });
    updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
    updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");
    handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

    // Run quality gates
    const missingModules = handleDetectMissingModules(ctx, {} as any);
    expect(missingModules.ok).toBe(true);
    // Should detect teams, discussions, comments, users as missing
    expect(missingModules.data!.missing_modules.length).toBeGreaterThanOrEqual(1);
  });

  it("quality gates detect shared dependencies", () => {
    const sharedDeps = handleDetectSharedDependencies(ctx, {} as any);
    expect(sharedDeps.ok).toBe(true);
    // Should detect types, utils, hooks, lib, config as shared
    expect(sharedDeps.data!.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("quality gate report returns not ready for incomplete model", () => {
    // Only model auth feature
    handleCreateWorkPackage(ctx, {
      id: "wp-auth",
      name: "Auth Feature",
      type: "feature",
      scope_paths: ["src/features/auth/**"],
    });

    handleCreateModuleProposal(ctx, {
      id: "prop-auth",
      work_package_id: "wp-auth",
      module_name: "Auth",
      purpose: "Auth module",
    });

    const authEntities = listCodeEntities(ctx.db!, { file_path: "src/features/auth" });
    for (const entity of authEntities.slice(0, 2)) {
      handleAttachProposalEntity(ctx, {
        proposal_id: "prop-auth",
        entity_type: "owned",
        code_entity_id: entity.id,
        role: "owns",
      });
    }

    handleSubmitModuleProposal(ctx, { proposal_id: "prop-auth" });
    handleSubmitProposalReview(ctx, { proposal_id: "prop-auth", status: "pass", findings: [] });
    updateModuleProposalStatus(ctx.db!, "prop-auth", "reviewing");
    updateModuleProposalStatus(ctx.db!, "prop-auth", "approved");
    handleMergeModuleProposal(ctx, { proposal_id: "prop-auth" });

    // Run quality gate report
    const report = handleQualityGateReport(ctx, { complexity: "complex" });
    expect(report.ok).toBe(true);
    expect(report.data!.ready_for_maintenance).toBe(false);
  });

  it("full initialization loop with quality gate readiness", () => {
    // Model all features
    const featurePackages = [
      { id: "wp-auth", name: "Auth", scope: "src/features/auth/**" },
      { id: "wp-discussions", name: "Discussions", scope: "src/features/discussions/**" },
      { id: "wp-comments", name: "Comments", scope: "src/features/comments/**" },
      { id: "wp-teams", name: "Teams", scope: "src/features/teams/**" },
      { id: "wp-users", name: "Users", scope: "src/features/users/**" },
    ];

    const sharedPackages = [
      { id: "wp-shared-types", name: "Shared Types", scope: "src/types/**" },
      { id: "wp-shared-utils", name: "Shared Utils", scope: "src/utils/**" },
      { id: "wp-shared-hooks", name: "Shared Hooks", scope: "src/hooks/**" },
    ];

    // Create all packages
    for (const pkg of featurePackages) {
      handleCreateWorkPackage(ctx, {
        id: pkg.id,
        name: pkg.name,
        type: "feature",
        scope_paths: [pkg.scope],
        allowed_external_refs: ["src/lib/**", "src/types/**", "src/hooks/**", "src/components/ui/**", "src/utils/**", "src/config/**"],
      });
    }

    for (const pkg of sharedPackages) {
      handleCreateWorkPackage(ctx, {
        id: pkg.id,
        name: pkg.name,
        type: "shared",
        scope_paths: [pkg.scope],
      });
    }

    // Create and approve proposals for each package
    for (const pkg of [...featurePackages, ...sharedPackages]) {
      handleCreateModuleProposal(ctx, {
        id: `prop-${pkg.id}`,
        work_package_id: pkg.id,
        module_name: pkg.name,
        purpose: `${pkg.name} module`,
      });

      const entities = listCodeEntities(ctx.db!, { file_path: pkg.scope.replace("/**", "") });
      for (const entity of entities.slice(0, 3)) {
        handleAttachProposalEntity(ctx, {
          proposal_id: `prop-${pkg.id}`,
          entity_type: "owned",
          code_entity_id: entity.id,
          role: "owns",
        });
      }

      handleSubmitModuleProposal(ctx, { proposal_id: `prop-${pkg.id}` });
      handleSubmitProposalReview(ctx, { proposal_id: `prop-${pkg.id}`, status: "pass", findings: [] });
      updateModuleProposalStatus(ctx.db!, `prop-${pkg.id}`, "reviewing");
      updateModuleProposalStatus(ctx.db!, `prop-${pkg.id}`, "approved");
    }

    // Merge all proposals
    for (const pkg of [...featurePackages, ...sharedPackages]) {
      const result = handleMergeModuleProposal(ctx, { proposal_id: `prop-${pkg.id}` });
      expect(result.ok).toBe(true);
    }

    // Run quality gate report
    const report = handleQualityGateReport(ctx, { complexity: "complex" });
    expect(report.ok).toBe(true);
    // With all features modeled, coverage should be higher than empty
    expect(report.data!.entity_coverage).toBeGreaterThan(0);
    expect(report.data!.flow_count).toBeDefined();
  });
});

// ── Helper ─────────────────────────────────────────────────────────────────

function listCodeEntities(db: Database.Database, filter?: { file_path?: string }) {
  let sql = `SELECT * FROM code_entities WHERE 1=1`;
  const params: unknown[] = [];
  if (filter?.file_path) {
    sql += ` AND file_path LIKE ?`;
    params.push(`${filter.file_path}%`);
  }
  return db.prepare(sql).all(...params) as Array<{
    id: string;
    type: string;
    name: string;
    file_path: string;
    start_line: number;
    end_line: number;
  }>;
}
