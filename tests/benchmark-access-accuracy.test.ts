/**
 * BlockGraph MCP v0.2.5 — Access Accuracy Evaluator Tests
 * PRD §19.2: perfect/weak/wrong scoring, flow scoring, evidence, telemetry
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { evaluateAccessAccuracy } from "../src/benchmark/evaluators/accessAccuracy.js";
import { loadCase } from "../src/benchmark/cases.js";
import type { AgentFinalAnswer, GraphCondition } from "../src/benchmark/schema.js";

const suiteDir = resolve("benchmarks/access-accuracy");
const repoPath = resolve("fixtures/ts-react-complex");
const condition: GraphCondition = "no_graph";

// ── Test Answers ───────────────────────────────────────────────────────────

function perfectLoginAnswer(): AgentFinalAnswer {
  return {
    task_id: "fixture-login-flow",
    condition,
    answer: "The login flow activates LoginForm → authService.loginUser → apiClient",
    ranked_files: [
      { id: "src/features/auth/LoginForm.tsx", rank: 1 },
      { id: "src/features/auth/authService.ts", rank: 2 },
      { id: "src/lib/apiClient.ts", rank: 3 },
      { id: "src/hooks/useAuth.ts", rank: 4 },
      { id: "src/types/user.ts", rank: 5 },
    ],
    ranked_entities: [
      { id: "src/features/auth/LoginForm.tsx#LoginForm", rank: 1 },
      { id: "src/features/auth/authService.ts#loginUser", rank: 2 },
      { id: "src/lib/apiClient.ts#apiClient", rank: 3 },
      { id: "src/hooks/useAuth.ts#useAuth", rank: 4 },
      { id: "src/types/user.ts#User", rank: 5 },
    ],
    ranked_blocks: [
      { id: "Auth", rank: 1 },
      { id: "Shared API Client", rank: 2 },
    ],
    predicted_flow_order: [
      "src/features/auth/LoginForm.tsx#LoginForm",
      "src/features/auth/authService.ts#loginUser",
      "src/lib/apiClient.ts#apiClient",
    ],
    evidence: [
      { file_path: "src/features/auth/LoginForm.tsx", start_line: 1, end_line: 50 },
      { file_path: "src/features/auth/authService.ts", start_line: 1, end_line: 30 },
      { file_path: "src/lib/apiClient.ts", start_line: 1, end_line: 40 },
    ],
    confidence: 0.95,
    used_blockgraph: false,
  };
}

function weakLoginAnswer(): AgentFinalAnswer {
  return {
    task_id: "fixture-login-flow",
    condition,
    answer: "LoginForm and authService are involved",
    ranked_files: [
      { id: "src/features/auth/LoginForm.tsx", rank: 1 },
      { id: "src/features/auth/authService.ts", rank: 2 },
    ],
    ranked_entities: [
      { id: "src/features/auth/LoginForm.tsx#LoginForm", rank: 1 },
    ],
    ranked_blocks: [
      { id: "Auth", rank: 1 },
    ],
    predicted_flow_order: [
      "src/features/auth/LoginForm.tsx#LoginForm",
    ],
    evidence: [
      { file_path: "src/features/auth/LoginForm.tsx", start_line: 1, end_line: 50 },
    ],
    confidence: 0.5,
    used_blockgraph: false,
  };
}

function wrongLoginAnswer(): AgentFinalAnswer {
  return {
    task_id: "fixture-login-flow",
    condition,
    answer: "The teams feature handles login",
    ranked_files: [
      { id: "src/features/teams/TeamList.tsx", rank: 1 },
      { id: "src/features/teams/teamService.ts", rank: 2 },
    ],
    ranked_entities: [
      { id: "src/features/teams/TeamList.tsx#TeamList", rank: 1 },
      { id: "src/features/teams/teamService.ts#fetchTeams", rank: 2 },
    ],
    ranked_blocks: [
      { id: "Teams", rank: 1 },
    ],
    predicted_flow_order: [
      "src/features/teams/TeamList.tsx#TeamList",
      "src/features/teams/teamService.ts#fetchTeams",
    ],
    evidence: [
      { file_path: "src/features/teams/TeamList.tsx", start_line: 1, end_line: 20 },
    ],
    confidence: 0.3,
    used_blockgraph: false,
  };
}

function mustNotIncludeAnswer(): AgentFinalAnswer {
  const base = perfectLoginAnswer();
  return {
    ...base,
    ranked_files: [
      ...base.ranked_files,
      { id: "src/features/teams/TeamList.tsx", rank: 6 }, // must_not_include
    ],
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Access Accuracy Evaluator", () => {
  let loginCase: Awaited<ReturnType<typeof loadCase>>["case_"];

  async function loadFixtureCase() {
    const result = await loadCase(suiteDir, "fixture-login-flow");
    loginCase = result.case_;
  }

  it("loads fixture case", async () => {
    await loadFixtureCase();
    expect(loginCase).not.toBeNull();
  });

  describe("perfect answer", () => {
    it("scores near 1 for accuracy", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.accuracy_score).toBeGreaterThan(0.85);
      expect(score.accuracy.file_f1).toBeGreaterThan(0.8);
      expect(score.accuracy.entity_f1).toBeGreaterThan(0.8);
      expect(score.accuracy.block_f1).toBeGreaterThan(0.8);
    });

    it("has high top-k hits", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.accuracy.top1_file_hit).toBe(1);
      expect(score.accuracy.top3_file_hit).toBe(1);
      expect(score.accuracy.top1_entity_hit).toBe(1);
    });

    it("has perfect flow order", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.accuracy.flow_order_score).toBe(1);
    });

    it("has high evidence score", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.evidence_score).toBeGreaterThan(0.8);
    });
  });

  describe("weak answer", () => {
    it("scores lower than perfect", async () => {
      await loadFixtureCase();
      const perfect = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      const weak = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: weakLoginAnswer(),
        repo_path: repoPath,
      });
      expect(weak.overall_score).toBeLessThan(perfect.overall_score);
      expect(weak.accuracy_score).toBeLessThan(perfect.accuracy_score);
    });

    it("has lower recall than perfect", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: weakLoginAnswer(),
        repo_path: repoPath,
      });
      // Weak answer misses apiClient, useAuth, User
      expect(score.accuracy.file_recall).toBeLessThan(1);
      expect(score.accuracy.entity_recall).toBeLessThan(1);
    });
  });

  describe("wrong answer", () => {
    it("scores very low", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: wrongLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.overall_score).toBeLessThan(0.3);
      expect(score.accuracy.file_recall).toBe(0);
      expect(score.accuracy.entity_recall).toBe(0);
      expect(score.accuracy.block_recall).toBe(0);
    });
  });

  describe("must_not_include penalty", () => {
    it("applies penalty for banned items in predictions", async () => {
      await loadFixtureCase();
      const perfect = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      const withMNI = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: mustNotIncludeAnswer(),
        repo_path: repoPath,
      });
      expect(withMNI.accuracy.must_not_include_penalty).toBeGreaterThan(0);
      expect(withMNI.overall_score).toBeLessThan(perfect.overall_score);
    });
  });

  describe("flow order scoring", () => {
    it("scores 1 for exact match", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.accuracy.flow_order_score).toBe(1);
    });

    it("scores < 1 for partial order", async () => {
      await loadFixtureCase();
      const answer: AgentFinalAnswer = {
        ...perfectLoginAnswer(),
        predicted_flow_order: [
          "src/features/auth/authService.ts#loginUser",
          "src/features/auth/LoginForm.tsx#LoginForm", // reversed
          "src/lib/apiClient.ts#apiClient",
        ],
      };
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer,
        repo_path: repoPath,
      });
      // LCS of [authService, LoginForm, apiClient] vs [LoginForm, authService, apiClient] = 2/3
      expect(score.accuracy.flow_order_score).toBeLessThan(1);
      expect(score.accuracy.flow_order_score).toBeGreaterThan(0);
    });

    it("scores 0 for completely wrong order with no overlap", async () => {
      await loadFixtureCase();
      const answer: AgentFinalAnswer = {
        ...perfectLoginAnswer(),
        predicted_flow_order: ["nonexistent1", "nonexistent2"],
      };
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer,
        repo_path: repoPath,
      });
      expect(score.accuracy.flow_order_score).toBe(0);
    });
  });

  describe("evidence validation", () => {
    it("validates existing file paths", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.evidence.evidence_file_exists_rate).toBeGreaterThan(0.8);
    });

    it("penalizes nonexistent file paths", async () => {
      await loadFixtureCase();
      const answer: AgentFinalAnswer = {
        ...perfectLoginAnswer(),
        evidence: [
          { file_path: "src/nonexistent/file.ts", start_line: 1, end_line: 10 },
          { file_path: "src/features/auth/LoginForm.tsx", start_line: 1, end_line: 50 },
        ],
      };
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer,
        repo_path: repoPath,
      });
      expect(score.evidence.evidence_file_exists_rate).toBeLessThan(1);
      expect(score.evidence.unsupported_claim_count).toBeGreaterThan(0);
    });
  });

  describe("missing efficiency telemetry", () => {
    it("does not fail scoring when telemetry is null", async () => {
      await loadFixtureCase();
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer: perfectLoginAnswer(),
        repo_path: repoPath,
      });
      expect(score.efficiency_score).toBeNull();
      expect(score.overall_score).toBeGreaterThan(0);
    });
  });

  describe("empty predictions", () => {
    it("handles empty ranked lists gracefully", async () => {
      await loadFixtureCase();
      const answer: AgentFinalAnswer = {
        task_id: "fixture-login-flow",
        condition,
        answer: "I don't know",
        ranked_files: [],
        ranked_entities: [],
        ranked_blocks: [],
        evidence: [],
        confidence: 0,
        used_blockgraph: false,
      };
      const score = evaluateAccessAccuracy({
        case_: loginCase!,
        condition,
        answer,
        repo_path: repoPath,
      });
      expect(score.accuracy.file_precision).toBe(0);
      expect(score.accuracy.file_recall).toBe(0);
      expect(score.accuracy.file_f1).toBe(0);
      expect(score.overall_score).toBeLessThanOrEqual(0.2);
    });
  });
});
