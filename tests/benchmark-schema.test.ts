/**
 * BlockGraph MCP v0.2.5 — Benchmark Schema & Case Loader Tests
 * PRD §19.1: schema tests, valid/invalid case loading, duplicate case ID rejection
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import {
  BenchmarkCaseSchema,
  AgentFinalAnswerSchema,
  GraphConditionSchema,
  WeightedExpectedItemSchema,
  AccessAccuracyGoldenSchema,
  BenchmarkEventSchema,
  CaseScoreSchema,
} from "../src/benchmark/schema.js";
import { loadCases, loadCase } from "../src/benchmark/cases.js";

// ── Schema Validation ──────────────────────────────────────────────────────

describe("Benchmark Schemas", () => {
  describe("GraphConditionSchema", () => {
    it("accepts all five conditions", () => {
      const conditions = [
        "no_graph",
        "code_facts_only",
        "block_graph",
        "block_graph_with_flows",
        "stale_or_incomplete_graph",
        "block_graph_mcp",
      ];
      for (const c of conditions) {
        expect(GraphConditionSchema.parse(c)).toBe(c);
      }
    });

    it("rejects invalid condition", () => {
      const result = GraphConditionSchema.safeParse("invalid_condition");
      expect(result.success).toBe(false);
    });
  });

  describe("WeightedExpectedItemSchema", () => {
    it("accepts minimal item", () => {
      expect(WeightedExpectedItemSchema.parse({ id: "test" })).toEqual({ id: "test" });
    });

    it("accepts full item", () => {
      const item = { id: "test", weight: 2.5, required: true };
      expect(WeightedExpectedItemSchema.parse(item)).toEqual(item);
    });

    it("rejects missing id", () => {
      const result = WeightedExpectedItemSchema.safeParse({ weight: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("AccessAccuracyGoldenSchema", () => {
    it("accepts minimal golden", () => {
      const golden = {
        expected_files: [{ id: "src/test.ts" }],
        expected_entities: [],
        expected_blocks: [],
      };
      expect(AccessAccuracyGoldenSchema.parse(golden)).toBeTruthy();
    });

    it("accepts golden with all optional fields", () => {
      const golden = {
        expected_files: [{ id: "src/test.ts", weight: 2, required: true }],
        expected_entities: [{ id: "src/test.ts#Foo" }],
        expected_blocks: [{ id: "Block1" }],
        expected_flow_order: ["step1", "step2"],
        acceptable_alternatives: { files: { "src/test.ts": ["alt.ts"] } },
        must_not_include: { files: ["bad.ts"] },
        notes: "test notes",
      };
      expect(AccessAccuracyGoldenSchema.parse(golden)).toBeTruthy();
    });
  });

  describe("BenchmarkCaseSchema", () => {
    it("accepts valid case", () => {
      const case_ = {
        id: "test-case",
        module: "access-accuracy",
        title: "Test Case",
        description: "A test case",
        repo: { kind: "fixture", path: "fixtures/test" },
        task: {
          type: "entrypoint_path_location",
          prompt: "Test prompt",
        },
        allowed_conditions: ["no_graph", "block_graph"],
        golden: {
          expected_files: [{ id: "src/test.ts" }],
          expected_entities: [],
          expected_blocks: [],
        },
        tags: ["test"],
      };
      expect(BenchmarkCaseSchema.parse(case_)).toBeTruthy();
    });

    it("rejects empty id", () => {
      const case_ = {
        id: "",
        module: "access-accuracy",
        title: "Test",
        description: "",
        repo: { kind: "fixture" },
        task: { type: "bug_localization", prompt: "Test" },
        allowed_conditions: ["no_graph"],
        golden: { expected_files: [], expected_entities: [], expected_blocks: [] },
        tags: [],
      };
      const result = BenchmarkCaseSchema.safeParse(case_);
      expect(result.success).toBe(false);
    });

    it("rejects invalid module", () => {
      const case_ = {
        id: "test",
        module: "invalid-module",
        title: "Test",
        description: "",
        repo: { kind: "fixture" },
        task: { type: "bug_localization", prompt: "Test" },
        allowed_conditions: ["no_graph"],
        golden: { expected_files: [], expected_entities: [], expected_blocks: [] },
        tags: [],
      };
      const result = BenchmarkCaseSchema.safeParse(case_);
      expect(result.success).toBe(false);
    });

    it("rejects empty allowed_conditions", () => {
      const case_ = {
        id: "test",
        module: "access-accuracy",
        title: "Test",
        description: "",
        repo: { kind: "fixture" },
        task: { type: "bug_localization", prompt: "Test" },
        allowed_conditions: [],
        golden: { expected_files: [], expected_entities: [], expected_blocks: [] },
        tags: [],
      };
      const result = BenchmarkCaseSchema.safeParse(case_);
      expect(result.success).toBe(false);
    });
  });

  describe("AgentFinalAnswerSchema", () => {
    it("accepts valid answer", () => {
      const answer = {
        task_id: "test-case",
        condition: "no_graph",
        answer: "The relevant files are...",
        ranked_files: [{ id: "src/test.ts", rank: 1 }],
        ranked_entities: [],
        ranked_blocks: [],
        evidence: [{ file_path: "src/test.ts", start_line: 1, end_line: 10 }],
        confidence: 0.8,
        used_blockgraph: false,
      };
      expect(AgentFinalAnswerSchema.parse(answer)).toBeTruthy();
    });

    it("accepts answer with all optional fields", () => {
      const answer = {
        task_id: "test",
        condition: "block_graph_with_flows",
        answer: "Full answer",
        ranked_files: [{ id: "f.ts", rank: 1, confidence: 0.9, reason: "because" }],
        ranked_entities: [{ id: "f.ts#X", rank: 1 }],
        ranked_blocks: [{ id: "B1", rank: 1 }],
        predicted_flow_order: ["step1"],
        evidence: [{ file_path: "f.ts" }],
        confidence: 1.0,
        used_blockgraph: true,
        used_tools: [{ tool_name: "list_code_entities", count: 3 }],
        notes: "extra notes",
      };
      expect(AgentFinalAnswerSchema.parse(answer)).toBeTruthy();
    });

    it("rejects confidence > 1", () => {
      const answer = {
        task_id: "test",
        condition: "no_graph",
        answer: "test",
        ranked_files: [],
        ranked_entities: [],
        ranked_blocks: [],
        evidence: [],
        confidence: 1.5,
        used_blockgraph: false,
      };
      const result = AgentFinalAnswerSchema.safeParse(answer);
      expect(result.success).toBe(false);
    });

    it("rejects rank < 1", () => {
      const answer = {
        task_id: "test",
        condition: "no_graph",
        answer: "test",
        ranked_files: [{ id: "f.ts", rank: 0 }],
        ranked_entities: [],
        ranked_blocks: [],
        evidence: [],
        confidence: 0.5,
        used_blockgraph: false,
      };
      const result = AgentFinalAnswerSchema.safeParse(answer);
      expect(result.success).toBe(false);
    });
  });

  describe("BenchmarkEventSchema", () => {
    it("accepts valid event", () => {
      const event = {
        ts: "2026-06-18T00:00:00Z",
        run_id: "run-1",
        type: "run_started",
      };
      expect(BenchmarkEventSchema.parse(event)).toBeTruthy();
    });

    it("accepts event with all optional fields", () => {
      const event = {
        ts: "2026-06-18T00:00:00Z",
        run_id: "run-1",
        case_id: "case-1",
        condition: "block_graph",
        type: "score_computed",
        data: { score: 0.85 },
      };
      expect(BenchmarkEventSchema.parse(event)).toBeTruthy();
    });

    it("rejects invalid event type", () => {
      const event = {
        ts: "2026-06-18T00:00:00Z",
        run_id: "run-1",
        type: "invalid_event",
      };
      const result = BenchmarkEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });
});

// ── Case Loader ────────────────────────────────────────────────────────────

describe("Case Loader", () => {
  const suiteDir = resolve("benchmarks/access-accuracy");

  it("loads all fixture cases", async () => {
    const result = await loadCases(suiteDir);
    expect(result.errors).toEqual([]);
    expect(result.cases.length).toBeGreaterThanOrEqual(10);
    const ids = result.cases.map((c) => c.id);
    expect(ids).toContain("fixture-login-flow");
    expect(ids).toContain("fixture-comment-submit-bug");
    expect(ids).toContain("fixture-auth-impact");
    expect(ids).toContain("fixture-team-feature-landing");
    expect(ids).toContain("fixture-discussion-cross-flow");
    expect(ids).toContain("fixture-orphaned-code");
    expect(ids).toContain("fixture-api-endpoint-map");
    expect(ids).toContain("fixture-shared-dep-impact");
    expect(ids).toContain("fixture-error-handling-gaps");
    expect(ids).toContain("fixture-component-prop-trace");
  });

  it("each case has valid golden with expected items", async () => {
    const result = await loadCases(suiteDir);
    for (const case_ of result.cases) {
      expect(case_.golden.expected_files.length).toBeGreaterThan(0);
      expect(case_.golden.expected_entities.length).toBeGreaterThan(0);
      expect(case_.golden.expected_blocks.length).toBeGreaterThan(0);
      expect(case_.allowed_conditions.length).toBeGreaterThan(0);
    }
  });

  it("loads single case by ID", async () => {
    const result = await loadCase(suiteDir, "fixture-login-flow");
    expect(result.error).toBeNull();
    expect(result.case_).not.toBeNull();
    expect(result.case_!.id).toBe("fixture-login-flow");
  });

  it("returns error for missing case", async () => {
    const result = await loadCase(suiteDir, "nonexistent-case");
    expect(result.case_).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain("File not found");
  });

  describe("with temp directory", () => {
    const tmpDir = resolve("test-workspace-benchmark");

    async function setup() {
      await mkdir(resolve(tmpDir, "cases"), { recursive: true });
    }

    async function cleanup() {
      await rm(tmpDir, { recursive: true, force: true });
    }

    it("rejects invalid JSON", async () => {
      await setup();
      try {
        await writeFile(resolve(tmpDir, "cases", "bad.json"), "not json");
        const result = await loadCases(tmpDir);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain("Invalid JSON");
        expect(result.cases).toHaveLength(0);
      } finally {
        await cleanup();
      }
    });

    it("rejects schema validation failure", async () => {
      await setup();
      try {
        await writeFile(
          resolve(tmpDir, "cases", "bad-schema.json"),
          JSON.stringify({ id: "", module: "invalid" }),
        );
        const result = await loadCases(tmpDir);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain("Schema validation failed");
      } finally {
        await cleanup();
      }
    });

    it("rejects duplicate case IDs", async () => {
      await setup();
      try {
        const validCase = {
          id: "duplicate-id",
          module: "access-accuracy",
          title: "Case 1",
          description: "",
          repo: { kind: "fixture" },
          task: { type: "bug_localization", prompt: "Test" },
          allowed_conditions: ["no_graph"],
          golden: { expected_files: [], expected_entities: [], expected_blocks: [] },
          tags: [],
        };
        await writeFile(
          resolve(tmpDir, "cases", "case1.json"),
          JSON.stringify(validCase),
        );
        await writeFile(
          resolve(tmpDir, "cases", "case2.json"),
          JSON.stringify({ ...validCase, title: "Case 2" }),
        );
        const result = await loadCases(tmpDir);
        expect(result.cases).toHaveLength(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].message).toContain("Duplicate case ID");
      } finally {
        await cleanup();
      }
    });

    it("handles missing cases directory", async () => {
      const result = await loadCases(resolve(tmpDir, "nonexistent"));
      expect(result.cases).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Cannot read cases directory");
    });
  });
});
