/**
 * BlockGraph MCP v0.2.7 — Repository Preparation Tests
 * Tests condition isolation and fairness gates.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { prepareBenchmarkRepo, readIsolationMetadata, type IsolationMetadata } from "../src/benchmark/repoPrep.js";

const TEST_DIR = resolve("test-tmp-repo-prep");
const FIXTURE_REPO = resolve("fixtures/ts-react-complex");

describe("Repository Preparation", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("prepareBenchmarkRepo", () => {
    it("should prepare no_graph repo without MCP artifacts", async () => {
      const metadata = await prepareBenchmarkRepo({
        caseId: "test-case",
        condition: "no_graph",
        sourceRepoPath: FIXTURE_REPO,
        outputDir: TEST_DIR,
      });

      expect(metadata.condition).toBe("no_graph");
      expect(metadata.prepared_repo_path).toBeTruthy();
      expect(existsSync(metadata.prepared_repo_path)).toBe(true);

      // Should not have .blockgraph
      const blockgraphPath = resolve(metadata.prepared_repo_path, ".blockgraph");
      expect(existsSync(blockgraphPath)).toBe(false);

      // Should not have .mcp.json
      const mcpJsonPath = resolve(metadata.prepared_repo_path, ".mcp.json");
      expect(existsSync(mcpJsonPath)).toBe(false);

      // Should have empty MCP config
      const emptyMcpPath = resolve(metadata.prepared_repo_path, ".benchmark-empty-mcp.json");
      expect(existsSync(emptyMcpPath)).toBe(true);

      // Fairness gates should pass
      expect(metadata.fairness_gates.condition_isolation_ok).toBe(true);
    });

    it("should prepare block_graph_mcp repo with graph data", async () => {
      // Create a mock .blockgraph directory in source
      const mockBlockgraph = resolve(FIXTURE_REPO, ".blockgraph");
      await mkdir(mockBlockgraph, { recursive: true });
      await writeFile(resolve(mockBlockgraph, "test.json"), "{}");

      try {
        const metadata = await prepareBenchmarkRepo({
          caseId: "test-case",
          condition: "block_graph_mcp",
          sourceRepoPath: FIXTURE_REPO,
          outputDir: TEST_DIR,
        });

        expect(metadata.condition).toBe("block_graph_mcp");
        expect(metadata.mcp_config_path).toBeTruthy();
        expect(existsSync(metadata.mcp_config_path!)).toBe(true);

        // Should have graph-context directory
        const graphContextDir = resolve(metadata.prepared_repo_path, "graph-context");
        expect(existsSync(graphContextDir)).toBe(true);

        // Should have mcp-config.json
        const mcpConfigPath = resolve(graphContextDir, "mcp-config.json");
        expect(existsSync(mcpConfigPath)).toBe(true);

        // Fairness gates should pass
        expect(metadata.fairness_gates.explicit_mcp_config_ok).toBe(true);
      } finally {
        await rm(mockBlockgraph, { recursive: true, force: true });
      }
    });

    it("should write isolation metadata", async () => {
      const metadata = await prepareBenchmarkRepo({
        caseId: "test-case",
        condition: "no_graph",
        sourceRepoPath: FIXTURE_REPO,
        outputDir: TEST_DIR,
      });

      const metadataPath = resolve(TEST_DIR, "isolation-metadata.json");
      expect(existsSync(metadataPath)).toBe(true);

      const readMetadata = await readIsolationMetadata(TEST_DIR);
      expect(readMetadata).toBeTruthy();
      expect(readMetadata!.condition).toBe("no_graph");
      expect(readMetadata!.case_id).toBe("test-case");
    });

    it("should exclude node_modules and .git", async () => {
      const metadata = await prepareBenchmarkRepo({
        caseId: "test-case",
        condition: "no_graph",
        sourceRepoPath: FIXTURE_REPO,
        outputDir: TEST_DIR,
      });

      // Check that common exclusions are not present
      const nodeModulesPath = resolve(metadata.prepared_repo_path, "node_modules");
      expect(existsSync(nodeModulesPath)).toBe(false);

      const gitPath = resolve(metadata.prepared_repo_path, ".git");
      expect(existsSync(gitPath)).toBe(false);
    });
  });

  describe("Fairness Gates", () => {
    it("should detect residual MCP artifacts in no_graph", async () => {
      // Create a source repo with .blockgraph
      const mockSource = resolve(TEST_DIR, "mock-source");
      await mkdir(mockSource, { recursive: true });
      await writeFile(resolve(mockSource, "test.ts"), "console.log('test')");
      await mkdir(resolve(mockSource, ".blockgraph"), { recursive: true });

      const metadata = await prepareBenchmarkRepo({
        caseId: "test-case",
        condition: "no_graph",
        sourceRepoPath: mockSource,
        outputDir: resolve(TEST_DIR, "output"),
      });

      // .blockgraph should be removed
      const blockgraphPath = resolve(metadata.prepared_repo_path, ".blockgraph");
      expect(existsSync(blockgraphPath)).toBe(false);

      // Fairness gate should pass (artifacts removed)
      expect(metadata.fairness_gates.condition_isolation_ok).toBe(true);
    });

    it("should require MCP config for block_graph_mcp", async () => {
      const metadata = await prepareBenchmarkRepo({
        caseId: "test-case",
        condition: "block_graph_mcp",
        sourceRepoPath: FIXTURE_REPO,
        outputDir: TEST_DIR,
      });

      expect(metadata.fairness_gates.explicit_mcp_config_ok).toBe(true);
      expect(metadata.mcp_config_path).toBeTruthy();
    });
  });
});
