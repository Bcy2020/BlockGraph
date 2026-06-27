/**
 * BlockGraph MCP v0.2.7 — OpenModel Adapter Tests
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createOpenModelAdapter } from "../src/benchmark/adapters/openmodel.js";
import type { BenchmarkCase, AgentRunInput } from "../src/benchmark/schema.js";

const testCase: BenchmarkCase = {
  id: "test-case",
  module: "access-accuracy",
  title: "Test Case",
  description: "A test case for the openmodel adapter",
  repo: { kind: "fixture" },
  task: {
    type: "bug_localization",
    prompt: "Test connectivity.",
  },
  allowed_conditions: ["no_graph"],
  golden: {
    expected_files: [{ id: "test.ts", weight: 1 }],
    expected_entities: [{ id: "test.ts#handler" }],
    expected_blocks: [],
  },
  tags: ["test"],
};

const baseInput: AgentRunInput = {
  run_id: "test-run",
  case: testCase,
  condition: "no_graph",
  repo_path: "/tmp/test-repo",
  prompt: "Return a JSON answer",
  output_dir: "/tmp/openmodel-test",
  timeout_ms: 60000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenModel Adapter", () => {
  it("createOpenModelAdapter returns an adapter with name", () => {
    const adapter = createOpenModelAdapter({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
    });
    expect(adapter.name).toBe("openmodel-deepseek-v4-flash");
  });

  it("createOpenModelAdapter accepts custom baseUrl", () => {
    const adapter = createOpenModelAdapter({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      baseUrl: "https://custom.example.com",
    });
    expect(adapter.name).toBe("openmodel-deepseek-v4-flash");
  });

  it("parses a mocked OpenModel response", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "blockgraph-openmodel-"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg-test",
          type: "message",
          role: "assistant",
          model: "deepseek-v4-flash",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 20 },
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task_id: "test-case",
                answer: "Mock answer",
                ranked_files: [{ id: "test.ts", rank: 1, confidence: 0.9, reason: "target" }],
                ranked_entities: [],
                ranked_blocks: [],
                evidence: [],
                confidence: 0.9,
                used_blockgraph: false,
              }),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOpenModelAdapter({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
    });

    try {
      const result = await adapter.run({ ...baseInput, output_dir: outputDir });
      expect(result.final_answer.task_id).toBe("test-case");
      expect(result.final_answer.condition).toBe("no_graph");
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("surfaces API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad key", { status: 401, statusText: "Unauthorized" })),
    );

    const adapter = createOpenModelAdapter({
      apiKey: "dummy-key",
      model: "deepseek-v4-flash",
    });

    await expect(adapter.run(baseInput)).rejects.toThrow(/OpenModel API error/);
  });
});
