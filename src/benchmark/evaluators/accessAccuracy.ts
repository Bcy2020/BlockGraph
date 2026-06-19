/**
 * BlockGraph MCP v0.2.5 — Access Accuracy Evaluator
 * Scores agent answers against golden answers.
 * PRD §12: accuracy, efficiency, evidence metrics, and aggregate scoring.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentFinalAnswer,
  AccessAccuracyGolden,
  WeightedExpectedItem,
  RankedItem,
  AccuracyMetrics,
  EfficiencyMetrics,
  EvidenceMetrics,
  CaseScore,
  GraphCondition,
} from "../schema.js";
import type { EvaluatorInput } from "../schema.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function defaultWeight(item: WeightedExpectedItem): number {
  return item.weight ?? 1;
}

function isRequired(item: WeightedExpectedItem): boolean {
  return item.required !== false; // default true
}

/**
 * Match quality: 0 = no match, 1 = exact, 0.5 = same-file (partial).
 */
type MatchQuality = 0 | 0.5 | 1;

/**
 * Normalize entity ID from scanner format to golden format.
 * Scanner: src/foo.ts:function:Name:7 → Golden: src/foo.ts#Name
 * Also handles: src/foo.ts#Name (already normalized)
 */
function normalizeEntityId(id: string): string {
  // Already in golden format
  if (id.includes("#") && !id.includes(":")) return id;
  // Scanner format: path:type:name:line
  const parts = id.split(":");
  if (parts.length >= 3) {
    const filePath = parts[0];
    const name = parts[2];
    return `${filePath}#${name}`;
  }
  return id;
}

/**
 * Check how well a predicted ID matches an expected ID or acceptable alternative.
 * Supports:
 * - Exact match
 * - Normalized entity ID match (scanner format vs golden format)
 * - Case-insensitive match (for block names)
 * - Same-file match (partial)
 * - Acceptable alternatives
 */
function matchQuality(
  predictedId: string,
  expectedId: string,
  acceptableAlternatives?: string[],
): MatchQuality {
  // Exact match
  if (predictedId === expectedId) return 1;
  // Acceptable alternatives
  if (acceptableAlternatives?.includes(predictedId)) return 1;
  // Case-insensitive match (for block names without #)
  if (!predictedId.includes("#") && !expectedId.includes("#")) {
    if (predictedId.toLowerCase() === expectedId.toLowerCase()) return 1;
    // Partial match: "Auth Feature" matches "Auth", "API Client" matches "Shared API Client"
    const predLower = predictedId.toLowerCase();
    const expLower = expectedId.toLowerCase();
    if (predLower.includes(expLower) || expLower.includes(predLower)) return 1;
    // Work package ID normalization: "wp-auth" → "auth", "wp-api-client" → "api client"
    const predNorm = predLower.replace(/^wp-/, "").replace(/-/g, " ");
    const expNorm = expLower.replace(/^wp-/, "").replace(/-/g, " ");
    if (predNorm === expNorm) return 1;
    if (predNorm.includes(expNorm) || expNorm.includes(predNorm)) return 1;
  }
  // Normalized entity ID match (scanner format vs golden format)
  const normPred = normalizeEntityId(predictedId);
  const normExp = normalizeEntityId(expectedId);
  if (normPred === normExp) return 1;
  if (normPred.toLowerCase() === normExp.toLowerCase()) return 1;
  // Same-file entity match: src/foo.ts#A matches src/foo.ts#B (partial)
  const predFile = normPred.split("#")[0];
  const expFile = normExp.split("#")[0];
  if (predFile === expFile && normPred.includes("#") && normExp.includes("#")) {
    return 0.5;
  }
  // Acceptable alternatives with normalization
  if (acceptableAlternatives?.some((alt) => normalizeEntityId(alt) === normPred)) return 1;
  return 0;
}

/**
 * Backward-compatible boolean match check.
 */
function matchesExpected(
  predictedId: string,
  expectedId: string,
  acceptableAlternatives?: string[],
): boolean {
  return matchQuality(predictedId, expectedId, acceptableAlternatives) > 0;
}

/**
 * Compute precision, recall, F1 for a set of expected items vs ranked predictions.
 * Uses matchQuality for partial credit (same-file = 0.5).
 */
function computePRF(
  expected: WeightedExpectedItem[],
  ranked: RankedItem[],
  acceptableAlternatives?: string[],
): { precision: number; recall: number; f1: number } {
  if (expected.length === 0 && ranked.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  if (expected.length === 0) {
    return { precision: 0, recall: 1, f1: 0 };
  }
  if (ranked.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const predictedIds = ranked.map((r) => r.id);
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const item of expected) {
    const w = defaultWeight(item);
    totalWeight += w;
    // Best match quality across all predictions
    let bestQuality: MatchQuality = 0;
    for (const pid of predictedIds) {
      const q = matchQuality(pid, item.id, acceptableAlternatives);
      if (q > bestQuality) bestQuality = q;
      if (bestQuality === 1) break; // can't do better
    }
    matchedWeight += w * bestQuality;
  }

  // Precision: how many predictions have any match (full or partial)
  let correctPredictions = 0;
  for (const pid of predictedIds) {
    const hasMatch = expected.some((e) => matchesExpected(pid, e.id, acceptableAlternatives));
    if (hasMatch) correctPredictions++;
  }

  const precision = ranked.length > 0 ? correctPredictions / ranked.length : 0;
  const recall = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1 };
}

/**
 * Compute top-k hit rate: does at least one expected item appear in the top k predictions?
 */
function topKHit(
  expected: WeightedExpectedItem[],
  ranked: RankedItem[],
  k: number,
  acceptableAlternatives?: string[],
): number {
  if (expected.length === 0) return 1;
  const topK = ranked.slice(0, k);
  for (const item of expected) {
    if (topK.some((r) => matchesExpected(r.id, item.id, acceptableAlternatives))) {
      return 1;
    }
  }
  return 0;
}

/**
 * Compute flow order score using LCS (Longest Common Subsequence).
 * Returns 0-1 where 1 is perfect order match.
 * Uses same-file matching for flow step comparison.
 */
function flowOrderScore(
  predicted: string[] | undefined,
  expected: string[] | undefined,
): number {
  if (!expected || expected.length === 0) return 1; // no expectation → perfect
  if (!predicted || predicted.length === 0) return 0;

  // Normalize: extract file paths for same-file matching, with scanner format support
  const normalize = (id: string) => normalizeEntityId(id).split("#")[0];

  // LCS with fuzzy matching
  const m = predicted.length;
  const n = expected.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const exact = predicted[i - 1] === expected[j - 1];
      const sameFile = normalize(predicted[i - 1]) === normalize(expected[j - 1]);
      if (exact || sameFile) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n] / n;
}

/**
 * Count must_not_include violations in ranked predictions.
 */
function mustNotIncludePenalty(
  ranked: RankedItem[],
  mustNotInclude?: { files?: string[]; entities?: string[]; blocks?: string[] },
): number {
  if (!mustNotInclude) return 0;
  let penalty = 0;
  const allBanned = [
    ...(mustNotInclude.files ?? []),
    ...(mustNotInclude.entities ?? []),
    ...(mustNotInclude.blocks ?? []),
  ];
  for (const r of ranked) {
    if (allBanned.includes(r.id)) penalty++;
  }
  return penalty;
}

// ── Main Evaluator ─────────────────────────────────────────────────────────

export function evaluateAccessAccuracy(input: EvaluatorInput): CaseScore {
  const { case_, condition, answer, repo_path } = input;
  const golden = case_.golden as AccessAccuracyGolden;
  const warnings: string[] = [];

  // ── Accuracy Metrics ───────────────────────────────────────────────────

  const filePRF = computePRF(
    golden.expected_files,
    answer.ranked_files,
    golden.acceptable_alternatives?.files,
  );
  const entityPRF = computePRF(
    golden.expected_entities,
    answer.ranked_entities,
    golden.acceptable_alternatives?.entities,
  );
  const blockPRF = computePRF(
    golden.expected_blocks,
    answer.ranked_blocks,
    golden.acceptable_alternatives?.blocks,
  );

  const top1File = topKHit(golden.expected_files, answer.ranked_files, 1, golden.acceptable_alternatives?.files);
  const top3File = topKHit(golden.expected_files, answer.ranked_files, 3, golden.acceptable_alternatives?.files);
  const top5File = topKHit(golden.expected_files, answer.ranked_files, 5, golden.acceptable_alternatives?.files);
  const top1Entity = topKHit(golden.expected_entities, answer.ranked_entities, 1, golden.acceptable_alternatives?.entities);
  const top3Entity = topKHit(golden.expected_entities, answer.ranked_entities, 3, golden.acceptable_alternatives?.entities);

  const flowScore = flowOrderScore(answer.predicted_flow_order, golden.expected_flow_order);

  const mniPenalty = mustNotIncludePenalty(
    [...answer.ranked_files, ...answer.ranked_entities, ...answer.ranked_blocks],
    golden.must_not_include,
  );

  // Unsupported evidence penalty
  let unsupportedPenalty = 0;
  for (const ev of answer.evidence) {
    if (ev.file_path) {
      const fullPath = resolve(repo_path, ev.file_path);
      if (!existsSync(fullPath)) {
        unsupportedPenalty++;
      }
    }
  }

  const accuracy: AccuracyMetrics = {
    file_precision: filePRF.precision,
    file_recall: filePRF.recall,
    file_f1: filePRF.f1,
    entity_precision: entityPRF.precision,
    entity_recall: entityPRF.recall,
    entity_f1: entityPRF.f1,
    block_precision: blockPRF.precision,
    block_recall: blockPRF.recall,
    block_f1: blockPRF.f1,
    top1_file_hit: top1File,
    top3_file_hit: top3File,
    top5_file_hit: top5File,
    top1_entity_hit: top1Entity,
    top3_entity_hit: top3Entity,
    flow_order_score: flowScore,
    must_not_include_penalty: mniPenalty,
    unsupported_evidence_penalty: unsupportedPenalty,
  };

  // ── Efficiency Metrics ─────────────────────────────────────────────────

  const efficiency: EfficiencyMetrics = {
    reported_tool_calls: null,
    reported_read_calls: null,
    reported_grep_calls: null,
    reported_mcp_calls: null,
    unique_files_read: null,
    search_waste_ratio: null,
    duration_ms: null,
  };

  // ── Evidence Metrics ───────────────────────────────────────────────────

  let evidenceFileExists = 0;
  let evidenceLineValid = 0;
  let evidenceTotal = answer.evidence.length;

  for (const ev of answer.evidence) {
    const fullPath = resolve(repo_path, ev.file_path);
    if (existsSync(fullPath)) {
      evidenceFileExists++;
      // Line validity: start_line <= end_line, both positive (tolerant check)
      if (ev.start_line !== undefined && ev.end_line !== undefined) {
        if (ev.start_line > 0 && ev.end_line > 0 && ev.start_line <= ev.end_line) {
          evidenceLineValid++;
        }
      } else if (ev.start_line === undefined && ev.end_line === undefined) {
        // No line info → not invalid
        evidenceLineValid++;
      }
    }
  }

  // Entity validity: predicted entities exist in golden or acceptable alternatives
  let entityValidCount = 0;
  const allValidEntityIds = new Set([
    ...golden.expected_entities.map((e) => e.id),
    ...(golden.acceptable_alternatives?.entities ?? []),
  ]);
  for (const r of answer.ranked_entities) {
    if (allValidEntityIds.has(r.id)) entityValidCount++;
  }

  const evidence: EvidenceMetrics = {
    evidence_file_exists_rate: evidenceTotal > 0 ? evidenceFileExists / evidenceTotal : 1,
    evidence_line_valid_rate: evidenceTotal > 0 ? evidenceLineValid / evidenceTotal : 1,
    evidence_entity_valid_rate: answer.ranked_entities.length > 0
      ? entityValidCount / answer.ranked_entities.length
      : 1,
    unsupported_claim_count: unsupportedPenalty + mniPenalty,
  };

  // ── Scores ─────────────────────────────────────────────────────────────

  const accuracyScore =
    (filePRF.f1 + entityPRF.f1 + blockPRF.f1 + top1File + top3File + top1Entity + flowScore) / 7;

  const evidenceScore =
    (evidence.evidence_file_exists_rate +
      evidence.evidence_line_valid_rate +
      evidence.evidence_entity_valid_rate) /
    3;

  const hasEfficiency =
    efficiency.reported_tool_calls !== null ||
    efficiency.duration_ms !== null;

  let overallScore: number;
  let efficiencyScore: number | null;

  if (hasEfficiency) {
    efficiencyScore = 0.5; // placeholder when real telemetry exists
    overallScore = 0.7 * accuracyScore + 0.2 * evidenceScore + 0.1 * efficiencyScore;
  } else {
    efficiencyScore = null;
    overallScore = 0.8 * accuracyScore + 0.2 * evidenceScore;
  }

  // Apply penalties
  let penaltyDeduction = (mniPenalty * 0.05 + unsupportedPenalty * 0.03);

  // MCP-specific penalties (only for block_graph_mcp condition)
  const recallAvg = (filePRF.recall + entityPRF.recall + blockPRF.recall) / 3;
  if (condition === "block_graph_mcp" && answer.used_tools) {
    const totalMcpCalls = answer.used_tools
      .filter((t) => !["Read", "Glob", "Grep", "Bash"].includes(t.tool_name))
      .reduce((sum, t) => sum + t.count, 0);

    // Excessive MCP call penalty: >20 calls → -0.05
    if (totalMcpCalls > 20) {
      penaltyDeduction += 0.05;
      warnings.push(`Excessive MCP calls: ${totalMcpCalls} (limit recommended: 10)`);
    }

    // Irrelevant block query penalty: predicted blocks not in golden
    const expectedBlockIds = new Set([
      ...golden.expected_blocks.map((b) => b.id),
      ...(golden.acceptable_alternatives?.blocks ?? []),
    ]);
    const irrelevantBlocks = answer.ranked_blocks.filter(
      (b) => !expectedBlockIds.has(b.id) && !Array.from(expectedBlockIds).some(
        (eb) => eb.toLowerCase() === b.id.toLowerCase(),
      ),
    );
    if (irrelevantBlocks.length > 0) {
      penaltyDeduction += irrelevantBlocks.length * 0.03;
      warnings.push(`Irrelevant block queries: ${irrelevantBlocks.map((b) => b.id).join(", ")}`);
    }

    // MCP efficiency bonus: ≤10 calls with high recall → +0.02
    if (totalMcpCalls <= 10 && recallAvg > 0.8) {
      overallScore += 0.02;
    }
  }

  overallScore = Math.max(0, overallScore - penaltyDeduction);

  return {
    case_id: case_.id,
    condition,
    accuracy,
    efficiency,
    evidence,
    accuracy_score: round4(accuracyScore),
    efficiency_score: efficiencyScore !== null ? round4(efficiencyScore) : null,
    evidence_score: round4(evidenceScore),
    overall_score: round4(overallScore),
    warnings,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
