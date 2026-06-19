/**
 * BlockGraph MCP v0.2.5 — Prompt Builder Tests
 * PRD §19.5 (partial): prompt includes restrictions, JSON schema, repo path, case ID
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { buildPrompt } from "../src/benchmark/prompt.js";
import { loadCase } from "../src/benchmark/cases.js";
import type { GraphCondition } from "../src/benchmark/schema.js";

const suiteDir = resolve("benchmarks/access-accuracy");
const repoPath = resolve("fixtures/ts-react-complex");

describe("Prompt Builder", () => {
  it("includes case prompt and title", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain("Login Form Submit Path");
    expect(prompt).toContain("login form");
  });

  it("includes repo path", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain(repoPath);
  });

  it("includes case ID in output schema", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain("fixture-login-flow");
  });

  it("includes no-modification rule", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain("Do not modify repository files");
  });

  it("includes JSON schema instruction", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain("Return only JSON matching the required schema");
    expect(prompt).toContain("ranked_files");
    expect(prompt).toContain("ranked_entities");
    expect(prompt).toContain("evidence");
  });

  describe("condition-specific restrictions", () => {
    const conditions: Array<{ condition: GraphCondition; restriction: string }> = [
      { condition: "no_graph", restriction: "Do not use BlockGraph MCP tools" },
      { condition: "code_facts_only", restriction: "not semantic blocks or flows" },
      { condition: "block_graph", restriction: "You may use BlockGraph block/module data" },
      { condition: "block_graph_with_flows", restriction: "block, connector, and flow data" },
      { condition: "stale_or_incomplete_graph", restriction: "graph may be stale or incomplete" },
      { condition: "block_graph_mcp", restriction: "MUST use BlockGraph MCP tools" },
    ];

    for (const { condition, restriction } of conditions) {
      it(`includes restriction for ${condition}`, async () => {
        const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
        const prompt = buildPrompt({ case_: case_!, condition, repoPath });
        expect(prompt).toContain(restriction);
      });
    }
  });

  it("includes context file paths when available", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const context = {
      condition: "block_graph_with_flows" as GraphCondition,
      code_facts_path: "/tmp/code-facts.json",
      blocks_path: "/tmp/blocks.json",
      connectors_path: "/tmp/connectors.json",
      flows_path: "/tmp/flows.json",
    };
    const prompt = buildPrompt({ case_: case_!, condition: "block_graph_with_flows", repoPath, context });
    expect(prompt).toContain("/tmp/code-facts.json");
    expect(prompt).toContain("/tmp/blocks.json");
    expect(prompt).toContain("/tmp/connectors.json");
    expect(prompt).toContain("/tmp/flows.json");
  });

  it("includes stale warning for stale condition", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const context = {
      condition: "stale_or_incomplete_graph" as GraphCondition,
      stale_warning_path: "/tmp/stale-warning.json",
      omissions: { features: ["teams"], shared_deps: ["helpers"] },
    };
    const prompt = buildPrompt({ case_: case_!, condition: "stale_or_incomplete_graph", repoPath, context });
    expect(prompt).toContain("/tmp/stale-warning.json");
    expect(prompt).toContain("teams");
  });

  it("includes entrypoint hint when available", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-login-flow");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain("LoginForm.tsx handleSubmit");
  });

  it("includes symptom for bug cases", async () => {
    const { case_ } = await loadCase(suiteDir, "fixture-comment-submit-bug");
    const prompt = buildPrompt({ case_: case_!, condition: "no_graph", repoPath });
    expect(prompt).toContain("Comments submitted but not appearing");
  });
});
