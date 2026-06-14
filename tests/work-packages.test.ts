/**
 * BlockGraph MCP v0.2 — Work Package Tests
 * Tests work package CRUD, status transitions, conflict checks, and MCP tool handlers.
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
  getWorkPackage,
  listWorkPackages,
  updateWorkPackageStatus,
  deleteWorkPackage,
  createModuleProposal,
  updateModuleProposal,
} from "../src/graph/draft.js";
import type { ToolContext } from "../src/mcp/tools.js";
import {
  handleBeginInitialization,
  handleCreateWorkPackage,
  handleListWorkPackages,
  handleUpdateWorkPackageStatus,
  handleCheckWorkPackageConflicts,
} from "../src/mcp/tools.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-wp-test-"));
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

describe("Work Package Service", () => {
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

  it("create work package succeeds", () => {
    const pkg = createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth Feature",
      type: "feature",
      scope_paths: ["src/features/auth/**"],
    });

    expect(pkg.id).toBe("wp-auth");
    expect(pkg.name).toBe("Auth Feature");
    expect(pkg.type).toBe("feature");
    expect(pkg.status).toBe("planned");
    expect(pkg.scope_paths).toEqual(["src/features/auth/**"]);
  });

  it("get work package returns stored data", () => {
    createWorkPackage(db, {
      id: "wp-auth",
      name: "Auth Feature",
      type: "feature",
      scope_paths: ["src/features/auth/**"],
      allowed_external_refs: ["src/lib/api-client.ts"],
      open_questions: ["Should we split login and signup?"],
    });

    const pkg = getWorkPackage(db, "wp-auth");
    expect(pkg).not.toBeNull();
    expect(pkg!.id).toBe("wp-auth");
    expect(pkg!.allowed_external_refs).toEqual(["src/lib/api-client.ts"]);
    expect(pkg!.open_questions).toEqual(["Should we split login and signup?"]);
  });

  it("get work package returns null for missing ID", () => {
    expect(getWorkPackage(db, "nonexistent")).toBeNull();
  });

  it("list work packages returns all", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createWorkPackage(db, { id: "wp-users", name: "Users" });

    const packages = listWorkPackages(db);
    expect(packages).toHaveLength(2);
  });

  it("list work packages filters by status", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    createWorkPackage(db, { id: "wp-users", name: "Users" });

    const planned = listWorkPackages(db, { status: "planned" });
    expect(planned).toHaveLength(2);

    const approved = listWorkPackages(db, { status: "approved" });
    expect(approved).toHaveLength(0);
  });

  it("list work packages filters by type", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth", type: "feature" });
    createWorkPackage(db, { id: "wp-shared", name: "Shared", type: "shared" });

    const features = listWorkPackages(db, { type: "feature" });
    expect(features).toHaveLength(1);
    expect(features[0].id).toBe("wp-auth");
  });

  it("legal status transitions succeed", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });

    // planned -> assigned
    let result = updateWorkPackageStatus(db, "wp-auth", "assigned");
    expect(result.ok).toBe(true);

    // assigned -> proposed
    result = updateWorkPackageStatus(db, "wp-auth", "proposed");
    expect(result.ok).toBe(true);

    // proposed -> reviewing
    result = updateWorkPackageStatus(db, "wp-auth", "reviewing");
    expect(result.ok).toBe(true);

    // reviewing -> approved
    result = updateWorkPackageStatus(db, "wp-auth", "approved");
    expect(result.ok).toBe(true);

    const pkg = getWorkPackage(db, "wp-auth");
    expect(pkg!.status).toBe("approved");
  });

  it("illegal status transitions fail", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });

    // planned -> approved (skipping intermediate states)
    const result = updateWorkPackageStatus(db, "wp-auth", "approved");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Illegal status transition");
  });

  it("merged status is terminal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    updateWorkPackageStatus(db, "wp-auth", "assigned");
    updateWorkPackageStatus(db, "wp-auth", "proposed");
    updateWorkPackageStatus(db, "wp-auth", "reviewing");
    updateWorkPackageStatus(db, "wp-auth", "approved");
    updateWorkPackageStatus(db, "wp-auth", "merged");

    const result = updateWorkPackageStatus(db, "wp-auth", "assigned");
    expect(result.ok).toBe(false);
  });

  it("rejected status is terminal", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    updateWorkPackageStatus(db, "wp-auth", "rejected");

    const result = updateWorkPackageStatus(db, "wp-auth", "planned");
    expect(result.ok).toBe(false);
  });

  it("deferred can transition back to planned", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    updateWorkPackageStatus(db, "wp-auth", "deferred");

    const result = updateWorkPackageStatus(db, "wp-auth", "planned");
    expect(result.ok).toBe(true);
  });

  it("update status fails for missing package", () => {
    const result = updateWorkPackageStatus(db, "nonexistent", "assigned");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("delete work package succeeds", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    expect(deleteWorkPackage(db, "wp-auth")).toBe(true);
    expect(getWorkPackage(db, "wp-auth")).toBeNull();
  });

  it("duplicate package ID is rejected at DB level", () => {
    createWorkPackage(db, { id: "wp-auth", name: "Auth" });
    expect(() => {
      createWorkPackage(db, { id: "wp-auth", name: "Auth 2" });
    }).toThrow();
  });
});

// ── MCP Tool Handler Tests ─────────────────────────────────────────────────

describe("Work Package Tool Handlers", () => {
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

  describe("handleCreateWorkPackage", () => {
    it("success: creates work package", () => {
      const result = handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth Feature",
        type: "feature",
        scope_paths: ["src/features/auth/**"],
      });

      expect(result.ok).toBe(true);
      expect(result.data!.work_package_id).toBe("wp-auth");
      expect(result.data!.status).toBe("planned");
    });

    it("fails: missing id", () => {
      const result = handleCreateWorkPackage(ctx, {
        id: "",
        name: "Auth Feature",
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("fails: missing name", () => {
      const result = handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "",
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_INPUT");
    });

    it("fails: duplicate ID", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      const result = handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth 2" });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("DUPLICATE_ID");
    });

    it("fails: invalid included entity ID", () => {
      const result = handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        included_entity_ids: ["nonexistent"],
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("ENTITY_NOT_FOUND");
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleCreateWorkPackage(noSessionCtx, {
        id: "wp-auth",
        name: "Auth",
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("NO_SESSION");
    });
  });

  describe("handleListWorkPackages", () => {
    it("success: lists all packages", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateWorkPackage(ctx, { id: "wp-users", name: "Users" });

      const result = handleListWorkPackages(ctx, {});
      expect(result.ok).toBe(true);
      expect(result.data!.packages).toHaveLength(2);
    });

    it("success: filters by status", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateWorkPackage(ctx, { id: "wp-users", name: "Users" });

      const result = handleListWorkPackages(ctx, { status: "planned" });
      expect(result.ok).toBe(true);
      expect(result.data!.packages).toHaveLength(2);
    });

    it("success: filters by type", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth", type: "feature" });
      handleCreateWorkPackage(ctx, { id: "wp-shared", name: "Shared", type: "shared" });

      const result = handleListWorkPackages(ctx, { type: "feature" });
      expect(result.ok).toBe(true);
      expect(result.data!.packages).toHaveLength(1);
      expect(result.data!.packages[0].id).toBe("wp-auth");
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleListWorkPackages(noSessionCtx, {});
      expect(result.ok).toBe(false);
    });
  });

  describe("handleUpdateWorkPackageStatus", () => {
    it("success: legal transition", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });

      const result = handleUpdateWorkPackageStatus(ctx, {
        id: "wp-auth",
        status: "assigned",
      });

      expect(result.ok).toBe(true);
      expect(result.data!.status).toBe("assigned");
    });

    it("fails: illegal transition", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });

      const result = handleUpdateWorkPackageStatus(ctx, {
        id: "wp-auth",
        status: "approved",
      });

      expect(result.ok).toBe(false);
      expect(result.errors![0].code).toBe("INVALID_TRANSITION");
    });

    it("fails: missing package", () => {
      const result = handleUpdateWorkPackageStatus(ctx, {
        id: "nonexistent",
        status: "assigned",
      });

      expect(result.ok).toBe(false);
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleUpdateWorkPackageStatus(noSessionCtx, {
        id: "wp-auth",
        status: "assigned",
      });

      expect(result.ok).toBe(false);
    });
  });

  describe("handleCheckWorkPackageConflicts", () => {
    it("returns no conflicts for isolated packages", () => {
      handleCreateWorkPackage(ctx, { id: "wp-auth", name: "Auth" });
      handleCreateWorkPackage(ctx, { id: "wp-users", name: "Users" });

      const result = handleCheckWorkPackageConflicts(ctx, {} as any);
      expect(result.ok).toBe(true);
      expect(result.data!.duplicate_ownership).toHaveLength(0);
      expect(result.data!.scope_violations).toHaveLength(0);
      expect(result.data!.missing_dependencies).toHaveLength(0);
    });

    it("detects missing dependencies", () => {
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        dependencies_on_packages: ["wp-shared"],
      });

      const result = handleCheckWorkPackageConflicts(ctx, {} as any);
      expect(result.ok).toBe(true);
      expect(result.data!.missing_dependencies).toHaveLength(1);
      expect(result.data!.missing_dependencies[0].dependency).toBe("wp-shared");
    });

    it("detects duplicate ownership across proposals", () => {
      // Setup: create two packages and proposals with same owned entity
      handleCreateWorkPackage(ctx, {
        id: "wp-auth",
        name: "Auth",
        scope_paths: ["src/features/auth"],
      });
      handleCreateWorkPackage(ctx, {
        id: "wp-users",
        name: "Users",
        scope_paths: ["src/features/users"],
      });

      // Seed a code entity
      const entity = seedCodeEntity(ctx.db!, { file_path: "src/features/auth/login.ts" });

      // Create proposals with duplicate ownership
      const proposal1 = createModuleProposal(ctx.db!, {
        id: "prop-auth",
        work_package_id: "wp-auth",
        module_name: "Auth Module",
      });
      updateModuleProposal(ctx.db!, "prop-auth", {
        owned_code_entities: [{
          code_entity_id: entity.id,
          role: "owns",
          evidence: [],
          reason: "test",
          confidence: 1.0,
        }],
      });

      const proposal2 = createModuleProposal(ctx.db!, {
        id: "prop-users",
        work_package_id: "wp-users",
        module_name: "Users Module",
      });
      updateModuleProposal(ctx.db!, "prop-users", {
        owned_code_entities: [{
          code_entity_id: entity.id,
          role: "owns",
          evidence: [],
          reason: "test",
          confidence: 1.0,
        }],
      });

      const result = handleCheckWorkPackageConflicts(ctx, {} as any);
      expect(result.ok).toBe(true);
      expect(result.data!.duplicate_ownership).toHaveLength(1);
      expect(result.data!.duplicate_ownership[0].code_entity_id).toBe(entity.id);
      expect(result.data!.duplicate_ownership[0].claiming_packages).toContain("wp-auth");
      expect(result.data!.duplicate_ownership[0].claiming_packages).toContain("wp-users");
    });

    it("fails: no session", () => {
      const noSessionCtx = makeCtx();
      const result = handleCheckWorkPackageConflicts(noSessionCtx, {} as any);
      expect(result.ok).toBe(false);
    });
  });
});
