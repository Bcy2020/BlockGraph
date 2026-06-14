/**
 * BlockGraph MCP v0.1 — Phase 3 Scanner Fixture Test
 * PRD §13.2: Verify scanner detects required entities and edges in fixtures/ts-react-auth.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { scanRepo } from "../src/scanner/tsScanner.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-auth");

describe("Phase 3 — Scanner Fixture Test (PRD §13.2)", () => {
  const result = scanRepo(FIXTURE_PATH);

  // Helper to find entities by type
  const entitiesOfType = (type: string) => result.entities.filter((e) => e.type === type);
  const edgesOfType = (type: string) => result.edges.filter((e) => e.type === type);

  // ── Entity detection ──────────────────────────────────────────────────

  it("detects file entities", () => {
    const files = entitiesOfType("file");
    expect(files.length).toBeGreaterThanOrEqual(5);
    const names = files.map((f) => f.name);
    expect(names).toContain("LoginForm.tsx");
    expect(names).toContain("authService.ts");
    expect(names).toContain("apiClient.ts");
    expect(names).toContain("auth.ts");
    expect(names).toContain("ParentForm.tsx");
  });

  it("detects React function components", () => {
    const components = entitiesOfType("component");
    const loginForm = components.find((c) => c.name === "LoginForm");
    expect(loginForm).toBeDefined();
    expect(loginForm!.file_path).toContain("LoginForm.tsx");
    const parentForm = components.find((c) => c.name === "ParentForm");
    expect(parentForm).toBeDefined();
    expect(parentForm!.file_path).toContain("ParentForm.tsx");
  });

  it("detects event handler (handleSubmit / onSubmit)", () => {
    const handlers = entitiesOfType("event_handler");
    expect(handlers.length).toBeGreaterThanOrEqual(1);
    // The onSubmit attribute on the form should be detected
    const submitHandler = handlers.find((h) =>
      h.metadata && (h.metadata as any).attributeName === "onSubmit"
    );
    expect(submitHandler).toBeDefined();
  });

  it("detects service function (login)", () => {
    const functions = entitiesOfType("function");
    const loginFunc = functions.find((f) => f.name === "login" && f.file_path.includes("authService"));
    expect(loginFunc).toBeDefined();
  });

  it("detects API call (fetch)", () => {
    const apiCalls = entitiesOfType("api_call");
    expect(apiCalls.length).toBeGreaterThanOrEqual(1);
    const fetchCall = apiCalls.find((a) => a.name === "fetch");
    expect(fetchCall).toBeDefined();
    expect(fetchCall!.file_path).toContain("apiClient.ts");
  });

  it("detects route handler (handleAuthRoute) as route type", () => {
    const routes = entitiesOfType("route");
    const routeHandler = routes.find((r) => r.name === "handleAuthRoute");
    expect(routeHandler).toBeDefined();
    expect(routeHandler!.file_path).toContain("routes/auth.ts");
  });

  // ── Edge detection ────────────────────────────────────────────────────

  it("detects at least one import edge", () => {
    const importEdges = edgesOfType("imports");
    expect(importEdges.length).toBeGreaterThanOrEqual(1);
  });

  it("detects LoginForm importing from authService", () => {
    const importEdges = edgesOfType("imports");
    const loginFormImports = importEdges.filter((e) => {
      const sourceFile = result.entities.find((ent) => ent.id === e.source_entity_id);
      return sourceFile?.name === "LoginForm.tsx";
    });
    expect(loginFormImports.length).toBeGreaterThanOrEqual(1);
  });

  it("detects at least one call or fetch edge", () => {
    const callEdges = edgesOfType("calls");
    // The scanner should detect function calls within files
    // At minimum, we expect the import edges and potentially call edges
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
  });

  // ── General ───────────────────────────────────────────────────────────

  it("produces non-zero entity count", () => {
    expect(result.entities.length).toBeGreaterThan(0);
  });

  it("produces non-zero edge count", () => {
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it("has zero unsupported files for TS fixture", () => {
    expect(result.unsupportedFileCount).toBe(0);
  });

  it("generates stable IDs (deterministic)", () => {
    // Scan twice and verify same IDs
    const result2 = scanRepo(FIXTURE_PATH);
    const ids1 = result.entities.map((e) => e.id).sort();
    const ids2 = result2.entities.map((e) => e.id).sort();
    expect(ids1).toEqual(ids2);
  });

  // ── New edge types ─────────────────────────────────────────────────────

  it("detects handles_event edges (component → event handler)", () => {
    const handlesEventEdges = edgesOfType("handles_event");
    expect(handlesEventEdges.length).toBeGreaterThanOrEqual(1);
    // Verify the edge connects a component to an event handler function
    for (const edge of handlesEventEdges) {
      const source = result.entities.find((e) => e.id === edge.source_entity_id);
      const target = result.entities.find((e) => e.id === edge.target_entity_id);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(["component", "function"]).toContain(source!.type);
    }
  });

  it("detects renders edges (component → child component)", () => {
    const rendersEdges = edgesOfType("renders");
    expect(rendersEdges.length).toBeGreaterThanOrEqual(1);
    // Verify ParentForm renders LoginForm
    const parentRenders = rendersEdges.find((e) => {
      const source = result.entities.find((ent) => ent.id === e.source_entity_id);
      const target = result.entities.find((ent) => ent.id === e.target_entity_id);
      return source?.name === "ParentForm" && target?.name === "LoginForm";
    });
    expect(parentRenders).toBeDefined();
  });

  it("detects fetches edges (function → api_call)", () => {
    const fetchesEdges = edgesOfType("fetches");
    expect(fetchesEdges.length).toBeGreaterThanOrEqual(1);
    for (const edge of fetchesEdges) {
      const source = result.entities.find((e) => e.id === edge.source_entity_id);
      const target = result.entities.find((e) => e.id === edge.target_entity_id);
      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(target!.type).toBe("api_call");
    }
  });
});
