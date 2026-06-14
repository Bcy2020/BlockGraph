/**
 * Agent Initialization Flow Test — via MCP stdio transport.
 * Follows docs/agent-initialization-skill.md exactly.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-auth");

async function main() {
  // Copy fixture to temp dir
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-mcp-init-"));
  const repoPath = path.join(tmpDir, "repo");
  fs.cpSync(FIXTURE_PATH, repoPath, { recursive: true });

  console.log(`Temp repo: ${repoPath}`);

  // Create transport pointing to the server
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", path.resolve(__dirname, "../src/mcp/server.ts")],
    cwd: path.resolve(__dirname, ".."),
  });

  const client = new Client({ name: "init-test-client", version: "0.1.0" });
  await client.connect(transport);
  console.log("Connected to MCP server\n");

  async function callTool(name, args) {
    console.log(`--- Calling: ${name} ---`);
    console.log(`  Args: ${JSON.stringify(args)}`);
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text || "";
    const parsed = JSON.parse(text);
    console.log(`  Result: ${text.substring(0, 500)}`);
    console.log();
    return parsed;
  }

  try {
    // Step 1: begin_initialization
    const init = await callTool("begin_initialization", { repo_path: repoPath });
    if (!init.ok) throw new Error(`begin_initialization failed: ${JSON.stringify(init)}`);

    // Step 2: scan_repo
    const scan = await callTool("scan_repo", { repo_path: repoPath });
    if (!scan.ok) throw new Error(`scan_repo failed: ${JSON.stringify(scan)}`);
    console.log(`  Entities: ${scan.data.entity_count}, Edges: ${scan.data.edge_count}\n`);

    // Step 3: list_code_entities
    const entitiesResult = await callTool("list_code_entities", {});
    if (!entitiesResult.ok) throw new Error("list_code_entities failed");
    const entities = entitiesResult.data.entities;

    const loginFormComponent = entities.find(e => e.type === "component" && e.name === "LoginForm");
    const loginFunc = entities.find(e => e.type === "function" && e.name === "login" && e.file_path.includes("authService"));
    const postFunc = entities.find(e => e.type === "function" && e.name === "post" && e.file_path.includes("apiClient"));

    console.log(`  LoginForm: ${loginFormComponent?.id}`);
    console.log(`  login: ${loginFunc?.id}`);
    console.log(`  post: ${postFunc?.id}\n`);

    if (!loginFormComponent || !loginFunc || !postFunc) {
      throw new Error("Could not find required code entities");
    }

    // Step 4: Create root block
    const rootBlock = await callTool("create_block", {
      name: "Auth Feature",
      purpose: "Authentication feature covering login flow",
    });
    if (!rootBlock.ok) throw new Error("create_block (root) failed");

    // Step 5: Create child blocks
    const authUI = await callTool("create_block", {
      name: "Auth UI",
      purpose: "Login form UI components",
      parent_id: rootBlock.data.block_id,
    });
    if (!authUI.ok) throw new Error("create_block (Auth UI) failed");

    const authServiceBlock = await callTool("create_block", {
      name: "Auth Service",
      purpose: "Authentication business logic",
      parent_id: rootBlock.data.block_id,
    });
    if (!authServiceBlock.ok) throw new Error("create_block (Auth Service) failed");

    const apiClientBlock = await callTool("create_block", {
      name: "API Client",
      purpose: "HTTP client for API calls",
      parent_id: rootBlock.data.block_id,
    });
    if (!apiClientBlock.ok) throw new Error("create_block (API Client) failed");

    // Step 6: Attach code entities
    const attach1 = await callTool("attach_code_entity", {
      block_id: authUI.data.block_id,
      code_entity_id: loginFormComponent.id,
      role: "owns",
      evidence: [{ file_path: loginFormComponent.file_path, start_line: loginFormComponent.start_line, end_line: loginFormComponent.end_line, note: "LoginForm component" }],
    });
    if (!attach1.ok) throw new Error("attach LoginForm failed");

    const attach2 = await callTool("attach_code_entity", {
      block_id: authServiceBlock.data.block_id,
      code_entity_id: loginFunc.id,
      role: "owns",
      evidence: [{ file_path: loginFunc.file_path, start_line: loginFunc.start_line, end_line: loginFunc.end_line, note: "login function" }],
    });
    if (!attach2.ok) throw new Error("attach login failed");

    const attach3 = await callTool("attach_code_entity", {
      block_id: apiClientBlock.data.block_id,
      code_entity_id: postFunc.id,
      role: "owns",
      evidence: [{ file_path: postFunc.file_path, start_line: postFunc.start_line, end_line: postFunc.end_line, note: "post function" }],
    });
    if (!attach3.ok) throw new Error("attach post failed");

    // Step 7: Create ports
    const authUIOutPort = await callTool("create_port", {
      block_id: authUI.data.block_id,
      name: "submitCredentials",
      direction: "out",
      contract: "Submits username/password to auth service",
    });
    if (!authUIOutPort.ok) throw new Error("create_port (authUI out) failed");

    const authServiceInPort = await callTool("create_port", {
      block_id: authServiceBlock.data.block_id,
      name: "loginRequest",
      direction: "in",
      contract: "Receives login credentials",
    });
    if (!authServiceInPort.ok) throw new Error("create_port (authService in) failed");

    const authServiceOutPort = await callTool("create_port", {
      block_id: authServiceBlock.data.block_id,
      name: "httpAuthRequest",
      direction: "out",
      contract: "Sends HTTP auth request to API",
    });
    if (!authServiceOutPort.ok) throw new Error("create_port (authService out) failed");

    const apiClientInPort = await callTool("create_port", {
      block_id: apiClientBlock.data.block_id,
      name: "request",
      direction: "in",
      contract: "Receives HTTP request parameters",
    });
    if (!apiClientInPort.ok) throw new Error("create_port (apiClient in) failed");

    // Step 8: Connect ports
    const conn1 = await callTool("connect_ports", {
      source_port_id: authUIOutPort.data.port_id,
      target_port_id: authServiceInPort.data.port_id,
      protocol: "function_call",
      evidence: [{ file_path: "src/LoginForm.tsx", start_line: 1, end_line: 20, note: "LoginForm calls authService.login" }],
    });
    if (!conn1.ok) throw new Error("connect_ports (UI->Service) failed");

    const conn2 = await callTool("connect_ports", {
      source_port_id: authServiceOutPort.data.port_id,
      target_port_id: apiClientInPort.data.port_id,
      protocol: "function_call",
      evidence: [{ file_path: "src/authService.ts", start_line: 1, end_line: 20, note: "authService calls apiClient.post" }],
    });
    if (!conn2.ok) throw new Error("connect_ports (Service->API) failed");

    // Step 9: Create flow
    const flow = await callTool("create_flow", {
      name: "Submit Login",
      entrypoint_entity_id: loginFormComponent.id,
    });
    if (!flow.ok) throw new Error("create_flow failed");

    // Step 10: Add flow steps
    const step1 = await callTool("append_flow_step", {
      flow_id: flow.data.flow_id,
      block_id: authUI.data.block_id,
      code_entity_id: loginFormComponent.id,
      trigger: "form submit",
      evidence: [{ file_path: "src/LoginForm.tsx", start_line: 10, end_line: 13, note: "handleSubmit calls login" }],
    });
    if (!step1.ok) throw new Error("append_flow_step 1 failed");

    const step2 = await callTool("append_flow_step", {
      flow_id: flow.data.flow_id,
      block_id: authServiceBlock.data.block_id,
      code_entity_id: loginFunc.id,
      trigger: "login call",
      evidence: [{ file_path: "src/authService.ts", start_line: 1, end_line: 10, note: "login function" }],
    });
    if (!step2.ok) throw new Error("append_flow_step 2 failed");

    const step3 = await callTool("append_flow_step", {
      flow_id: flow.data.flow_id,
      block_id: apiClientBlock.data.block_id,
      code_entity_id: postFunc.id,
      trigger: "post call",
      evidence: [{ file_path: "src/apiClient.ts", start_line: 1, end_line: 10, note: "post function" }],
    });
    if (!step3.ok) throw new Error("append_flow_step 3 failed");

    // Step 11: Compile each block
    const compileUI = await callTool("compile_draft_block", { block_id: authUI.data.block_id });
    if (!compileUI.ok || !compileUI.data.can_promote) throw new Error("compile Auth UI failed");

    const compileService = await callTool("compile_draft_block", { block_id: authServiceBlock.data.block_id });
    if (!compileService.ok || !compileService.data.can_promote) throw new Error("compile Auth Service failed");

    const compileClient = await callTool("compile_draft_block", { block_id: apiClientBlock.data.block_id });
    if (!compileClient.ok || !compileClient.data.can_promote) throw new Error("compile API Client failed");

    // Step 12: Promote each block
    const promoteUI = await callTool("promote_draft_block", { block_id: authUI.data.block_id });
    if (!promoteUI.ok) throw new Error("promote Auth UI failed");

    const promoteService = await callTool("promote_draft_block", { block_id: authServiceBlock.data.block_id });
    if (!promoteService.ok) throw new Error("promote Auth Service failed");

    const promoteClient = await callTool("promote_draft_block", { block_id: apiClientBlock.data.block_id });
    if (!promoteClient.ok) throw new Error("promote API Client failed");

    // Step 13: Compile graph
    const graphCompile = await callTool("compile_draft_graph", {});
    if (!graphCompile.ok || !graphCompile.data.can_commit) throw new Error("compile_draft_graph failed");

    // Step 14: Commit snapshot
    const snapshot = await callTool("commit_snapshot", { git_sha: "abc123def456789" });
    if (!snapshot.ok) throw new Error("commit_snapshot failed");

    console.log("=== ALL STEPS COMPLETED SUCCESSFULLY ===");
    console.log(`Snapshot ID: ${snapshot.data.snapshot_id}`);
  } catch (err) {
    console.error("FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
