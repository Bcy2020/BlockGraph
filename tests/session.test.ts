/**
 * BlockGraph MCP v0.2.1 — Session Reconnect & Recovery Tests
 * Tests begin_initialization resumed detection, resume_initialization, session_status,
 * list_module_proposals, and improved NO_SESSION messages.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { closeStore } from "../src/graph/store.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleResumeInitialization,
  handleSessionStatus,
  handleListModuleProposals,
  handleCreateWorkPackage,
  handleCreateModuleProposal,
  handleCoverageReport,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-session-test-"));
}

function makeCtx(): ToolContext {
  return { db: null, repoPath: null };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Session Reconnect & Recovery", () => {
  let tmpDir: string;
  const openCtxs: ToolContext[] = [];

  function trackCtx(): ToolContext {
    const ctx = makeCtx();
    openCtxs.push(ctx);
    return ctx;
  }

  beforeEach(() => {
    tmpDir = makeTempDir();
    openCtxs.length = 0;
  });

  afterEach(() => {
    for (const ctx of openCtxs) {
      if (ctx.db) {
        try { closeStore(ctx.db); } catch { /* ignore */ }
        ctx.db = null;
      }
    }
    // Retry cleanup with delay to handle Windows file lock release
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows may hold locks briefly after SQLite close; retry once
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* give up */ }
    }
  });

  describe("handleBeginInitialization — resumed detection", () => {
    it("returns resumed: false on empty repo", () => {
      const ctx = trackCtx();
      const result = handleBeginInitialization(ctx, { repo_path: tmpDir });

      expect(result.ok).toBe(true);
      expect(result.data!.resumed).toBe(false);
      expect(result.data!.db_path).toContain("blockgraph.db");
      expect(result.data!.summary).toBeDefined();
      expect(result.data!.summary.code_entities).toBe(0);
      expect(result.data!.summary.blocks).toBe(0);
    });

    it("returns resumed: true on repo with existing graph data", () => {
      // First session: create data
      const ctx1 = trackCtx();
      handleBeginInitialization(ctx1, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx1, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx1, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      closeStore(ctx1.db!);
      ctx1.db = null;

      // Second session: should detect existing data
      const ctx2 = trackCtx();
      const result = handleBeginInitialization(ctx2, { repo_path: tmpDir });

      expect(result.ok).toBe(true);
      expect(result.data!.resumed).toBe(true);
      expect(result.data!.summary.work_packages).toBe(1);
      expect(result.data!.summary.module_proposals).toBe(1);
    });

    it("does not delete existing data on reconnect", () => {
      // First session: create data
      const ctx1 = trackCtx();
      handleBeginInitialization(ctx1, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx1, { id: "wp-auth", name: "Auth" });
      closeStore(ctx1.db!);
      ctx1.db = null;

      // Second session: reconnect
      const ctx2 = trackCtx();
      handleBeginInitialization(ctx2, { repo_path: tmpDir });

      // Verify data still exists
      const result = handleCreateModuleProposal(ctx2, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      expect(result.ok).toBe(true);
    });

    it("returns DB_OPEN_FAILED on corrupted database file", () => {
      // Use a separate temp dir to avoid locking issues in afterEach cleanup
      const corruptTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-corrupt-test-"));
      try {
        const dbDir = path.join(corruptTmpDir, ".blockgraph");
        fs.mkdirSync(dbDir, { recursive: true });
        // Write a 4KB file of random-looking data that SQLite will reject
        const corruptData = Buffer.alloc(4096, 0xAB);
        fs.writeFileSync(path.join(dbDir, "blockgraph.db"), corruptData);

        const ctx = makeCtx();
        const result = handleBeginInitialization(ctx, { repo_path: corruptTmpDir });

        expect(result.ok).toBe(false);
        expect(result.errors![0].code).toBe("DB_OPEN_FAILED");
        expect(result.errors![0].message).toContain("corrupted");
      } finally {
        // Best-effort cleanup of the separate temp dir
        try { fs.rmSync(corruptTmpDir, { recursive: true, force: true }); } catch { /* ignore lock */ }
      }
    });
  });

  describe("handleResumeInitialization", () => {
    it("works identically to begin_initialization", () => {
      const ctx = trackCtx();
      const result = handleResumeInitialization(ctx, { repo_path: tmpDir });

      expect(result.ok).toBe(true);
      expect(result.data!.resumed).toBe(false);
      expect(result.data!.summary).toBeDefined();
    });

    it("detects existing data on resume", () => {
      // First session
      const ctx1 = trackCtx();
      handleBeginInitialization(ctx1, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx1, { id: "wp-auth", name: "Auth" });
      closeStore(ctx1.db!);
      ctx1.db = null;

      // Resume
      const ctx2 = trackCtx();
      const result = handleResumeInitialization(ctx2, { repo_path: tmpDir });

      expect(result.ok).toBe(true);
      expect(result.data!.resumed).toBe(true);
      expect(result.data!.summary.work_packages).toBe(1);
    });
  });

  describe("handleSessionStatus", () => {
    it("returns inactive before initialization", () => {
      const ctx = trackCtx();
      const result = handleSessionStatus(ctx, {});

      expect(result.ok).toBe(true);
      expect(result.data!.active).toBe(false);
      expect(result.data!.repo_path).toBeUndefined();
    });

    it("returns active with repo path and summary after initialization", () => {
      const ctx = trackCtx();
      handleBeginInitialization(ctx, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });

      const result = handleSessionStatus(ctx, {});

      expect(result.ok).toBe(true);
      expect(result.data!.active).toBe(true);
      expect(result.data!.repo_path).toBe(tmpDir);
      expect(result.data!.db_path).toContain("blockgraph.db");
      expect(result.data!.summary!.work_packages).toBe(1);
    });
  });

  describe("handleListModuleProposals", () => {
    it("fails with improved NO_SESSION message", () => {
      const ctx = trackCtx();
      const result = handleListModuleProposals(ctx, {});

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
      expect(result.errors![0].message).toContain("begin_initialization");
      expect(result.errors![0].message).toContain("resume_initialization");
    });

    it("lists all proposals", () => {
      const ctx = trackCtx();
      handleBeginInitialization(ctx, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleListModuleProposals(ctx, {});
      expect(result.ok).toBe(true);
      expect(result.data!.proposals).toHaveLength(1);
      expect(result.data!.proposals[0].id).toBe("prop-auth");
    });

    it("filters by work_package_id", () => {
      const ctx = trackCtx();
      handleBeginInitialization(ctx, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateWorkPackage(ctx, { id: "wp-users", name: "Users" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      handleCreateModuleProposal(ctx, {
        id: "prop-users",
        work_package_id: "wp-users",
        module_name: "Users",
        purpose: "Users module",
      });

      const result = handleListModuleProposals(ctx, { work_package_id: "wp-auth" });
      expect(result.ok).toBe(true);
      expect(result.data!.proposals).toHaveLength(1);
      expect(result.data!.proposals[0].id).toBe("prop-auth");
    });

    it("filters by status", () => {
      const ctx = trackCtx();
      handleBeginInitialization(ctx, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateModuleProposal(ctx, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });

      const result = handleListModuleProposals(ctx, { status: "draft" });
      expect(result.ok).toBe(true);
      expect(result.data!.proposals).toHaveLength(1);

      const result2 = handleListModuleProposals(ctx, { status: "approved" });
      expect(result2.ok).toBe(true);
      expect(result2.data!.proposals).toHaveLength(0);
    });
  });

  describe("NO_SESSION message improvement", () => {
    it("coverage_report returns improved NO_SESSION message", () => {
      const ctx = trackCtx();
      const result = handleCoverageReport(ctx, {} as any);

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
      expect(result.errors![0].message).toContain("begin_initialization");
      expect(result.errors![0].message).toContain("resume_initialization");
      expect(result.errors![0].message).toContain(".blockgraph/blockgraph.db");
    });
  });

  describe("reconnect preserves all data", () => {
    it("work packages and proposals survive reconnect", () => {
      // First session: create data
      const ctx1 = trackCtx();
      handleBeginInitialization(ctx1, { repo_path: tmpDir });
      handleCreateWorkPackage(ctx1, { id: "wp-auth", name: "Auth" });
      handleCreateWorkPackage(ctx1, { id: "wp-users", name: "Users" });
      handleCreateModuleProposal(ctx1, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth",
        purpose: "Auth module",
      });
      closeStore(ctx1.db!);
      ctx1.db = null;

      // Second session: reconnect and verify
      const ctx2 = trackCtx();
      const initResult = handleBeginInitialization(ctx2, { repo_path: tmpDir });
      expect(initResult.data!.resumed).toBe(true);

      const proposals = handleListModuleProposals(ctx2, {});
      expect(proposals.data!.proposals).toHaveLength(1);

      const wps = handleCreateWorkPackage(ctx2, { id: "wp-auth", name: "Auth" });
      // Should fail — wp-auth already exists
      expect(wps.ok).toBe(false);
      expect(wps.errors![0].code).toBe("DUPLICATE_ID");
    });
  });
});
