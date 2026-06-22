/**
 * BlockGraph MCP v0.2.6 — ID Resolver Tests
 * PRD FR4: block/entity/file ID resolution with diagnostics.
 */
import { describe, it, expect } from "vitest";
import {
  resolveBlockId,
  resolveEntityId,
  resolveFileId,
  buildResolutionDiagnostics,
  type GraphIndex,
} from "../src/benchmark/idResolver.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const testGraphIndex: GraphIndex = {
  blocks: [
    {
      id: "9c3777cf-1234-5678-abcd-ef0123456789",
      name: "Auth",
      slug: "auth",
      aliases: ["Auth Feature", "Authentication"],
      mapped_entities: ["src/features/auth/authService.ts#loginUser"],
    },
    {
      id: "wp-teams-001",
      name: "Teams",
      slug: "teams",
      aliases: ["Team Management"],
      mapped_entities: [],
    },
    {
      id: "shared-api-client-id",
      name: "Shared API Client",
      slug: "shared-api-client",
      aliases: ["API Client", "HTTP Client"],
      mapped_entities: [],
    },
  ],
  entities: [
    {
      canonical_id: "src/features/auth/authService.ts#loginUser",
      raw_ids: [
        "src/features/auth/authService.ts:function:loginUser:4",
        "src/features/auth/authService.ts:function:loginUser:12",
      ],
      file_path: "src/features/auth/authService.ts",
      symbol_name: "loginUser",
      kind: "function",
      line: 4,
    },
    {
      canonical_id: "src/lib/apiClient.ts#apiClient",
      raw_ids: ["src/lib/apiClient.ts:function:apiClient:3"],
      file_path: "src/lib/apiClient.ts",
      symbol_name: "apiClient",
      kind: "function",
      line: 3,
    },
  ],
};

// ── Block Resolution Tests ────────────────────────────────────────────────

describe("resolveBlockId", () => {
  it("resolves exact name match", () => {
    const result = resolveBlockId("Auth", testGraphIndex);
    expect(result.canonical).toBe("Auth");
    expect(result.method).toBe("exact");
  });

  it("resolves exact ID match", () => {
    const result = resolveBlockId("9c3777cf-1234-5678-abcd-ef0123456789", testGraphIndex);
    expect(result.canonical).toBe("Auth");
    expect(result.method).toBe("exact");
  });

  it("resolves UUID match", () => {
    const result = resolveBlockId("9c3777cf-1234-5678-abcd-ef0123456789", testGraphIndex);
    expect(result.canonical).toBe("Auth");
    expect(["exact", "uuid"]).toContain(result.method);
  });

  it("resolves wp-* prefix to block name", () => {
    const result = resolveBlockId("wp-teams", testGraphIndex);
    expect(result.canonical).toBe("Teams");
    expect(result.method).toBe("wp_prefix");
  });

  it("resolves slug match", () => {
    const result = resolveBlockId("shared-api-client", testGraphIndex);
    expect(result.canonical).toBe("Shared API Client");
    expect(["exact", "slug"]).toContain(result.method);
  });

  it("resolves alias match", () => {
    const result = resolveBlockId("Authentication", testGraphIndex);
    expect(result.canonical).toBe("Auth");
    expect(result.method).toBe("alias");
  });

  it("resolves case-insensitive match", () => {
    const result = resolveBlockId("auth", testGraphIndex);
    expect(result.canonical).toBe("Auth");
    // "auth" matches via exact name on slug, or case_insensitive
    expect(["exact", "slug", "case_insensitive"]).toContain(result.method);
  });

  it("resolves partial or alias match", () => {
    const result = resolveBlockId("API Client", testGraphIndex);
    expect(result.canonical).toBe("Shared API Client");
    // "API Client" matches via alias
    expect(["exact", "alias", "partial"]).toContain(result.method);
  });

  it("returns unresolved for unknown block", () => {
    const result = resolveBlockId("nonexistent", testGraphIndex);
    expect(result.canonical).toBe("nonexistent");
    expect(result.method).toBe("unresolved");
  });

  it("returns unresolved when no graph index", () => {
    const result = resolveBlockId("Auth");
    expect(result.canonical).toBe("Auth");
    expect(result.method).toBe("unresolved");
  });
});

// ── Entity Resolution Tests ───────────────────────────────────────────────

describe("resolveEntityId", () => {
  it("resolves exact canonical match", () => {
    const result = resolveEntityId("src/features/auth/authService.ts#loginUser", testGraphIndex);
    expect(result.canonical).toBe("src/features/auth/authService.ts#loginUser");
    expect(result.method).toBe("exact");
  });

  it("resolves scanner format to canonical", () => {
    const result = resolveEntityId("src/features/auth/authService.ts:function:loginUser:4", testGraphIndex);
    expect(result.canonical).toBe("src/features/auth/authService.ts#loginUser");
    expect(result.method).toBe("scanner_id");
  });

  it("resolves scanner format with different line number", () => {
    const result = resolveEntityId("src/features/auth/authService.ts:function:loginUser:12", testGraphIndex);
    expect(result.canonical).toBe("src/features/auth/authService.ts#loginUser");
    expect(result.method).toBe("scanner_id");
  });

  it("normalizes scanner format without graph index", () => {
    const result = resolveEntityId("src/foo.ts:function:bar:7");
    expect(result.canonical).toBe("src/foo.ts#bar");
    expect(result.method).toBe("scanner_id");
  });

  it("returns unresolved for unknown entity", () => {
    const result = resolveEntityId("src/unknown.ts#unknown", testGraphIndex);
    expect(result.canonical).toBe("src/unknown.ts#unknown");
    expect(result.method).toBe("unresolved");
  });
});

// ── File Resolution Tests ─────────────────────────────────────────────────

describe("resolveFileId", () => {
  it("returns canonical file path", () => {
    const result = resolveFileId("src/features/auth/LoginForm.tsx");
    expect(result.canonical).toBe("src/features/auth/LoginForm.tsx");
    expect(result.method).toBe("exact");
  });

  it("normalizes backslashes", () => {
    const result = resolveFileId("src\\features\\auth\\LoginForm.tsx");
    expect(result.canonical).toBe("src/features/auth/LoginForm.tsx");
  });
});

// ── Resolution Diagnostics Tests ──────────────────────────────────────────

describe("buildResolutionDiagnostics", () => {
  it("counts resolved and unresolved blocks", () => {
    const diagnostics = buildResolutionDiagnostics(
      [{ id: "Auth" }, { id: "nonexistent" }],
      [],
      [],
      testGraphIndex,
    );

    expect(diagnostics.resolved_blocks).toHaveLength(1);
    expect(diagnostics.unresolved_blocks).toHaveLength(1);
    expect(diagnostics.resolved_blocks[0].canonical).toBe("Auth");
    expect(diagnostics.unresolved_blocks[0].raw).toBe("nonexistent");
  });

  it("counts resolved and unresolved entities", () => {
    const diagnostics = buildResolutionDiagnostics(
      [],
      [
        { id: "src/features/auth/authService.ts:function:loginUser:4" },
        { id: "src/unknown.ts#unknown" },
      ],
      [],
      testGraphIndex,
    );

    expect(diagnostics.resolved_entities).toHaveLength(1);
    expect(diagnostics.unresolved_entities).toHaveLength(1);
  });

  it("handles empty graph index", () => {
    const diagnostics = buildResolutionDiagnostics(
      [{ id: "Auth" }],
      [{ id: "src/foo.ts#bar" }],
      [{ id: "src/foo.ts" }],
    );

    expect(diagnostics.resolved_blocks).toHaveLength(0);
    expect(diagnostics.unresolved_blocks).toHaveLength(1);
  });
});
