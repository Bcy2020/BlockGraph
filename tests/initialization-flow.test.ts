/**
 * BlockGraph MCP v0.1 — Phase 5 Initialization Flow Test
 * PRD §13.3: Full end-to-end initialization loop over fixtures/ts-react-auth.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  handleBeginInitialization,
  handleScanRepo,
  handleListCodeEntities,
  handleCreateBlock,
  handleAttachCodeEntity,
  handleCreatePort,
  handleConnectPorts,
  handleCreateFlow,
  handleAppendFlowStep,
  handleCompileDraftBlock,
  handlePromoteDraftBlock,
  handleCompileDraftGraph,
  handleCommitSnapshot,
  handleQueryBlock,
  createToolContext,
} from "../src/mcp/tools.js";
import type { ToolContext } from "../src/mcp/tools.js";
import { getBlock, listBlocks, listFlows, listFlowSteps, listBlockCodeMappings, getSnapshot } from "../src/graph/draft.js";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-auth");

describe("Phase 5 — Initialization Flow Test (PRD §13.3)", () => {
  let ctx: ToolContext;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-init-test-"));
    // Copy fixture to temp dir so we don't create .blockgraph in the fixture
    const fixtureCopy = path.join(tmpDir, "repo");
    fs.cpSync(FIXTURE_PATH, fixtureCopy, {
      recursive: true,
      filter: (src) => !src.includes(".blockgraph"),
    });
    ctx = createToolContext();
    handleBeginInitialization(ctx, { repo_path: fixtureCopy });
  });

  afterEach(() => {
    if (ctx.db) {
      ctx.db.close();
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("completes the full initialization loop", () => {
    // ── Step 1: Scan repo ───────────────────────────────────────────────
    const scanResult = handleScanRepo(ctx, { repo_path: ctx.repoPath! });
    expect(scanResult.ok).toBe(true);
    expect(scanResult.data!.entity_count).toBeGreaterThan(0);
    expect(scanResult.data!.edge_count).toBeGreaterThan(0);

    // ── Step 2: List code entities ──────────────────────────────────────
    const entitiesResult = handleListCodeEntities(ctx, {});
    expect(entitiesResult.ok).toBe(true);
    const entities = entitiesResult.data!.entities;

    // Find specific entities we need for the test
    const loginFormComponent = entities.find((e) => e.type === "component" && e.name === "LoginForm");
    const loginFunc = entities.find((e) => e.type === "function" && e.name === "login" && e.file_path.includes("authService"));
    const postFunc = entities.find((e) => e.type === "function" && e.name === "post" && e.file_path.includes("apiClient"));
    const handleAuthRoute = entities.find((e) => e.type === "function" && e.name === "handleAuthRoute");

    expect(loginFormComponent).toBeDefined();
    expect(loginFunc).toBeDefined();
    expect(postFunc).toBeDefined();

    // ── Step 3: Create root block ───────────────────────────────────────
    const rootBlock = handleCreateBlock(ctx, {
      name: "Auth Feature",
      purpose: "Authentication feature covering login flow",
    });
    expect(rootBlock.ok).toBe(true);

    // ── Step 4: Create child blocks ─────────────────────────────────────
    const authUI = handleCreateBlock(ctx, {
      name: "Auth UI",
      purpose: "Login form UI components",
      parent_id: rootBlock.data!.block_id,
    });
    expect(authUI.ok).toBe(true);

    const authService = handleCreateBlock(ctx, {
      name: "Auth Service",
      purpose: "Authentication business logic",
      parent_id: rootBlock.data!.block_id,
    });
    expect(authService.ok).toBe(true);

    const apiClient = handleCreateBlock(ctx, {
      name: "API Client",
      purpose: "HTTP client for API calls",
      parent_id: rootBlock.data!.block_id,
    });
    expect(apiClient.ok).toBe(true);

    // ── Step 5: Attach code entities to blocks ──────────────────────────
    const attachLoginForm = handleAttachCodeEntity(ctx, {
      block_id: authUI.data!.block_id,
      code_entity_id: loginFormComponent!.id,
      role: "owns",
      evidence: [{ file_path: loginFormComponent!.file_path, start_line: loginFormComponent!.start_line, end_line: loginFormComponent!.end_line, note: "LoginForm component" }],
    });
    expect(attachLoginForm.ok).toBe(true);

    const attachLoginFunc = handleAttachCodeEntity(ctx, {
      block_id: authService.data!.block_id,
      code_entity_id: loginFunc!.id,
      role: "owns",
      evidence: [{ file_path: loginFunc!.file_path, start_line: loginFunc!.start_line, end_line: loginFunc!.end_line, note: "login function" }],
    });
    expect(attachLoginFunc.ok).toBe(true);

    const attachPostFunc = handleAttachCodeEntity(ctx, {
      block_id: apiClient.data!.block_id,
      code_entity_id: postFunc!.id,
      role: "owns",
      evidence: [{ file_path: postFunc!.file_path, start_line: postFunc!.start_line, end_line: postFunc!.end_line, note: "post function" }],
    });
    expect(attachPostFunc.ok).toBe(true);

    // ── Step 6: Create ports ────────────────────────────────────────────
    const authUIOutPort = handleCreatePort(ctx, {
      block_id: authUI.data!.block_id,
      name: "submitCredentials",
      direction: "out",
      contract: "Submits username/password to auth service",
    });
    expect(authUIOutPort.ok).toBe(true);

    const authServiceInPort = handleCreatePort(ctx, {
      block_id: authService.data!.block_id,
      name: "loginRequest",
      direction: "in",
      contract: "Receives login credentials",
    });
    expect(authServiceInPort.ok).toBe(true);

    const authServiceOutPort = handleCreatePort(ctx, {
      block_id: authService.data!.block_id,
      name: "httpAuthRequest",
      direction: "out",
      contract: "Sends HTTP auth request to API",
    });
    expect(authServiceOutPort.ok).toBe(true);

    const apiClientInPort = handleCreatePort(ctx, {
      block_id: apiClient.data!.block_id,
      name: "request",
      direction: "in",
      contract: "Receives HTTP request parameters",
    });
    expect(apiClientInPort.ok).toBe(true);

    // ── Step 7: Connect ports with evidence ─────────────────────────────
    const conn1 = handleConnectPorts(ctx, {
      source_port_id: authUIOutPort.data!.port_id,
      target_port_id: authServiceInPort.data!.port_id,
      protocol: "function_call",
      evidence: [{ file_path: "src/LoginForm.tsx", start_line: 1, end_line: 20, note: "LoginForm calls authService.login" }],
    });
    expect(conn1.ok).toBe(true);

    const conn2 = handleConnectPorts(ctx, {
      source_port_id: authServiceOutPort.data!.port_id,
      target_port_id: apiClientInPort.data!.port_id,
      protocol: "function_call",
      evidence: [{ file_path: "src/authService.ts", start_line: 1, end_line: 20, note: "authService calls apiClient.post" }],
    });
    expect(conn2.ok).toBe(true);

    // ── Step 8: Create flow ─────────────────────────────────────────────
    const flow = handleCreateFlow(ctx, {
      name: "Submit Login",
      entrypoint_entity_id: loginFormComponent!.id,
    });
    expect(flow.ok).toBe(true);

    // ── Step 9: Add flow steps ──────────────────────────────────────────
    const step1 = handleAppendFlowStep(ctx, {
      flow_id: flow.data!.flow_id,
      block_id: authUI.data!.block_id,
      code_entity_id: loginFormComponent!.id,
      trigger: "form submit",
      evidence: [{ file_path: "src/LoginForm.tsx", start_line: 10, end_line: 13, note: "handleSubmit calls login" }],
    });
    expect(step1.ok).toBe(true);
    expect(step1.data!.order).toBe(1);

    const step2 = handleAppendFlowStep(ctx, {
      flow_id: flow.data!.flow_id,
      block_id: authService.data!.block_id,
      code_entity_id: loginFunc!.id,
      trigger: "login call",
      evidence: [{ file_path: "src/authService.ts", start_line: 1, end_line: 10, note: "login function" }],
    });
    expect(step2.ok).toBe(true);
    expect(step2.data!.order).toBe(2);

    const step3 = handleAppendFlowStep(ctx, {
      flow_id: flow.data!.flow_id,
      block_id: apiClient.data!.block_id,
      code_entity_id: postFunc!.id,
      trigger: "post call",
      evidence: [{ file_path: "src/apiClient.ts", start_line: 1, end_line: 10, note: "post function" }],
    });
    expect(step3.ok).toBe(true);
    expect(step3.data!.order).toBe(3);

    // ── Step 10: Compile each block ─────────────────────────────────────
    const compileUI = handleCompileDraftBlock(ctx, { block_id: authUI.data!.block_id });
    expect(compileUI.ok).toBe(true);
    expect(compileUI.data!.can_promote).toBe(true);

    const compileService = handleCompileDraftBlock(ctx, { block_id: authService.data!.block_id });
    expect(compileService.ok).toBe(true);
    expect(compileService.data!.can_promote).toBe(true);

    const compileClient = handleCompileDraftBlock(ctx, { block_id: apiClient.data!.block_id });
    expect(compileClient.ok).toBe(true);
    expect(compileClient.data!.can_promote).toBe(true);

    // ── Step 11: Promote each block ─────────────────────────────────────
    const promoteUI = handlePromoteDraftBlock(ctx, { block_id: authUI.data!.block_id });
    expect(promoteUI.ok).toBe(true);
    expect(promoteUI.data!.status).toBe("accepted");

    const promoteService = handlePromoteDraftBlock(ctx, { block_id: authService.data!.block_id });
    expect(promoteService.ok).toBe(true);

    const promoteClient = handlePromoteDraftBlock(ctx, { block_id: apiClient.data!.block_id });
    expect(promoteClient.ok).toBe(true);

    // ── Step 12: Compile graph ──────────────────────────────────────────
    const graphCompile = handleCompileDraftGraph(ctx, {});
    expect(graphCompile.ok).toBe(true);
    expect(graphCompile.data!.can_commit).toBe(true);

    // ── Step 13: Commit snapshot ────────────────────────────────────────
    const snapshot = handleCommitSnapshot(ctx, { git_sha: "abc123def456789" });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.data!.snapshot_id).toBeTruthy();

    // ── Assertions ──────────────────────────────────────────────────────

    // Snapshot exists
    const snapshotRecord = getSnapshot(ctx.db!, snapshot.data!.snapshot_id);
    expect(snapshotRecord).not.toBeNull();
    expect(snapshotRecord!.git_sha).toBe("abc123def456789");

    // Blocks are accepted
    const allBlocks = listBlocks(ctx.db!);
    const acceptedBlocks = allBlocks.filter((b) => b.status === "accepted");
    expect(acceptedBlocks.length).toBeGreaterThanOrEqual(3);

    // Flow exists
    const flows = listFlows(ctx.db!);
    expect(flows.length).toBe(1);
    expect(flows[0].name).toBe("Submit Login");

    // Flow has ordered steps
    const flowSteps = listFlowSteps(ctx.db!, { flow_id: flow.data!.flow_id });
    expect(flowSteps.length).toBe(3);
    expect(flowSteps[0].order).toBe(1);
    expect(flowSteps[1].order).toBe(2);
    expect(flowSteps[2].order).toBe(3);

    // Mappings exist
    const mappings = listBlockCodeMappings(ctx.db!);
    expect(mappings.length).toBeGreaterThanOrEqual(3);
  });
});
