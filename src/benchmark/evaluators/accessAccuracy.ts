/**
 * BlockGraph MCP v0.2.7 — Access Accuracy Evaluator
 * Scores agent answers against golden answers.
 * v0.2.7: Condition-neutral scoring, improved path/entity resolution.
 */
import { existsSync, readFileSync } from "node:fs";
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
  ResolutionDiagnosticsSummary,
} from "../schema.js";
import type { EvaluatorInput } from "../schema.js";
import {
  resolveBlockId,
  resolveEntityId,
  resolveFileId,
  buildResolutionDiagnostics,
  type GraphIndex,
} from "../idResolver.js";

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
 * Check for missing required items and emit warnings.
 */
function checkMissingRequired(
  expected: WeightedExpectedItem[],
  ranked: RankedItem[],
  category: string,
  warnings: string[],
  acceptableAlternatives?: Record<string, string[]>,
): void {
  const required = expected.filter((e) => isRequired(e));
  if (required.length === 0) return;

  const missing = required.filter((item) => {
    const hasMatch = ranked.some((r) => matchQuality(r.id, item.id, acceptableAlternatives) > 0);
    return !hasMatch;
  });

  if (missing.length > 0) {
    warnings.push(
      `Missing required ${category}(s): ${missing.map((m) => m.id).join(", ")}`,
    );
  }
}

/**
 * Normalize entity ID from scanner format to golden format.
 * Scanner: src/foo.ts:function:Name:7 → Golden: src/foo.ts#Name
 */
function normalizeEntityId(id: string): string {
  if (id.includes("#") && !id.includes(":")) return id;
  const parts = id.split(":");
  if (parts.length >= 3) {
    const filePath = parts[0];
    const name = parts[2];
    return `${filePath}#${name}`;
  }
  return id;
}

/**
 * Normalize a file path for comparison: strip leading fixtures prefix.
 */
function normalizeFilePath(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith("fixtures/")) {
    const parts = normalized.split("/");
    // fixtures/<name>/src/... -> src/...
    if (parts.length >= 3 && parts[2] === "src") {
      return parts.slice(3).join("/");
    }
    if (parts.length >= 2) {
      return parts.slice(1).join("/");
    }
  }
  return normalized;
}

/**
 * Check if two block names match (case-insensitive, prefix/word-boundary).
 * Does NOT use substring matching to avoid "Comments Feature" matching "Comments".
 */
function blockNameMatch(a: string, b: string): boolean {
  const normA = a.toLowerCase().replace(/^wp-/, "").replace(/-/g, " ").trim();
  const normB = b.toLowerCase().replace(/^wp-/, "").replace(/-/g, " ").trim();
  if (normA === normB) return true;
  // Prefix match: "comments" matches "comments feature" but NOT "discussions"
  if (normA.startsWith(normB + " ") || normB.startsWith(normA + " ")) return true;
  return false;
}

/**
 * Check how well a predicted ID matches an expected ID or acceptable alternative.
 * acceptableAlternatives is a per-item mapping: { expectedId: [alt1, alt2, ...] }
 */
function matchQuality(
  predictedId: string,
  expectedId: string,
  acceptableAlternatives?: Record<string, string[]>,
): MatchQuality {
  if (predictedId === expectedId) return 1;

  // Per-item acceptable alternatives (Bug 2 fix: only match this expected item's alternatives)
  const altsForThisItem = acceptableAlternatives?.[expectedId];
  if (altsForThisItem?.includes(predictedId)) return 1;

  // File path matching (Bug 1 fix: no substring, normalize and compare exactly)
  if (predictedId.includes("/") && expectedId.includes("/")) {
    const normPred = normalizeFilePath(predictedId);
    const normExp = normalizeFilePath(expectedId);
    if (normPred === normExp) return 1;
    if (normPred.toLowerCase() === normExp.toLowerCase()) return 1;
  }

  // Block name matching (Bug 3 fix: prefix/word-boundary, not substring)
  if (!predictedId.includes("#") && !expectedId.includes("#") && !predictedId.includes("/") && !expectedId.includes("/")) {
    if (blockNameMatch(predictedId, expectedId)) return 1;
  }

  // Normalized entity ID match (handles scanner format → canonical)
  const normPred = normalizeEntityId(predictedId);
  const normExp = normalizeEntityId(expectedId);
  if (normPred === normExp) return 1;
  if (normPred.toLowerCase() === normExp.toLowerCase()) return 1;

  // Same-file entity match (partial credit)
  const predFile = normPred.split("#")[0];
  const expFile = normExp.split("#")[0];
  if (predFile === expFile && normPred.includes("#") && normExp.includes("#")) {
    return 0.5;
  }

  // Acceptable alternatives with normalization (per-item)
  if (altsForThisItem?.some((alt) => normalizeEntityId(alt) === normPred)) return 1;
  return 0;
}

/**
 * Match quality using ID resolution.
 * If graphIndex is available, resolves IDs before matching.
 */
function matchQualityWithResolution(
  predictedId: string,
  expectedId: string,
  acceptableAlternatives?: Record<string, string[]>,
  graphIndex?: GraphIndex,
  resolveAs?: "block" | "entity",
): MatchQuality {
  // First try direct match
  const direct = matchQuality(predictedId, expectedId, acceptableAlternatives);
  if (direct === 1) return 1;

  // If we have a graph index, try resolving
  if (graphIndex) {
    const resolveFn = resolveAs === "block" ? resolveBlockId : resolveEntityId;
    const resolvedPred = resolveFn(predictedId, graphIndex);
    const resolvedExp = resolveFn(expectedId, graphIndex);

    // Compare resolved canonical forms
    if (resolvedPred.canonical === resolvedExp.canonical) return 1;
    if (resolvedPred.canonical.toLowerCase() === resolvedExp.canonical.toLowerCase()) return 1;

    // Check per-item acceptable alternatives with resolution
    const altsForThisItem = acceptableAlternatives?.[expectedId];
    if (altsForThisItem) {
      for (const alt of altsForThisItem) {
        const resolvedAlt = resolveFn(alt, graphIndex);
        if (resolvedPred.canonical === resolvedAlt.canonical) return 1;
      }
    }
  }

  return direct;
}

function matchesExpected(
  predictedId: string,
  expectedId: string,
  acceptableAlternatives?: Record<string, string[]>,
): boolean {
  return matchQuality(predictedId, expectedId, acceptableAlternatives) > 0;
}

/**
 * Compute precision, recall, F1 for a set of expected items vs ranked predictions.
 * scoringMode:
 *   - "all_required": each golden item must be individually matched (weighted recall)
 *   - "any_hit": if ANY prediction matches ANY golden item (or its alternatives), recall = 1
 */
function computePRF(
  expected: WeightedExpectedItem[],
  ranked: RankedItem[],
  acceptableAlternatives?: Record<string, string[]>,
  graphIndex?: GraphIndex,
  resolveAs?: "block" | "entity",
  scoringMode: "all_required" | "any_hit" = "all_required",
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

  // Bug 4 fix: normalize predicted IDs to deduplicate scanner vs canonical format
  const normalizedPredictedIds = ranked.map((r) => normalizeEntityId(r.id));
  const uniquePredictedIds = [...new Set(normalizedPredictedIds)];

  // Precision: how many unique predictions have any match (same for both modes)
  const counted = new Set<string>();
  for (const pid of uniquePredictedIds) {
    if (counted.has(pid)) continue;
    const hasMatch = expected.some((e) =>
      matchQualityWithResolution(pid, e.id, acceptableAlternatives, graphIndex, resolveAs) > 0,
    );
    if (hasMatch) counted.add(pid);
  }
  const precision = uniquePredictedIds.length > 0 ? counted.size / uniquePredictedIds.length : 0;

  // Recall: depends on scoring mode
  let recall: number;

  if (scoringMode === "any_hit") {
    // any_hit: if any prediction matches any golden item, recall = 1
    const hasAnyMatch = uniquePredictedIds.some((pid) =>
      expected.some((e) =>
        matchQualityWithResolution(pid, e.id, acceptableAlternatives, graphIndex, resolveAs) > 0,
      ),
    );
    recall = hasAnyMatch ? 1 : 0;
  } else {
    // all_required: weighted recall (each golden item individually scored)
    let matchedWeight = 0;
    let totalWeight = 0;
    for (const item of expected) {
      const w = defaultWeight(item);
      totalWeight += w;
      let bestQuality: MatchQuality = 0;
      for (const pid of uniquePredictedIds) {
        const q = matchQualityWithResolution(pid, item.id, acceptableAlternatives, graphIndex, resolveAs);
        if (q > bestQuality) bestQuality = q;
        if (bestQuality === 1) break;
      }
      matchedWeight += w * bestQuality;
    }
    recall = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }

  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function topKHit(
  expected: WeightedExpectedItem[],
  ranked: RankedItem[],
  k: number,
  acceptableAlternatives?: Record<string, string[]>,
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

function flowOrderScore(
  predicted: string[] | undefined,
  expected: string[] | undefined,
): number {
  if (!expected || expected.length === 0) return 1;
  if (!predicted || predicted.length === 0) return 0;

  const normalize = (id: string) => normalizeEntityId(id).split("#")[0];
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
  const { case_, condition, answer, repo_path, graphIndex } = input;
  const golden = case_.golden as AccessAccuracyGolden;
  const warnings: string[] = [];

  // ── ID Resolution ──────────────────────────────────────────────────────

  const diagnostics = buildResolutionDiagnostics(
    answer.ranked_blocks,
    answer.ranked_entities,
    answer.ranked_files,
    graphIndex,
    repo_path,
  );

  // Build resolution summary
  const resolution: ResolutionDiagnosticsSummary = {
    resolved_blocks: diagnostics.resolved_blocks.length,
    unresolved_blocks: diagnostics.unresolved_blocks.length,
    resolved_entities: diagnostics.resolved_entities.length,
    unresolved_entities: diagnostics.unresolved_entities.length,
    resolution_methods: diagnostics.resolution_methods,
  };

  // Add warnings for unresolved IDs
  if (diagnostics.unresolved_blocks.length > 0) {
    warnings.push(
      `Unresolved blocks: ${diagnostics.unresolved_blocks.map((r) => r.raw).join(", ")}`,
    );
  }
  if (diagnostics.unresolved_entities.length > 0) {
    warnings.push(
      `Unresolved entities: ${diagnostics.unresolved_entities.map((r) => r.raw).join(", ")}`,
    );
  }

  // ── Accuracy Metrics ───────────────────────────────────────────────────

  // P1-2: Check for missing required items
  checkMissingRequired(golden.expected_files, answer.ranked_files, "file", warnings, golden.acceptable_alternatives?.files);
  checkMissingRequired(golden.expected_entities, answer.ranked_entities, "entity", warnings, golden.acceptable_alternatives?.entities);
  checkMissingRequired(golden.expected_blocks, answer.ranked_blocks, "block", warnings, golden.acceptable_alternatives?.blocks);

  const scoringMode = golden.scoring_mode ?? "all_required";

  const filePRF = computePRF(
    golden.expected_files,
    answer.ranked_files,
    golden.acceptable_alternatives?.files,
    undefined,
    undefined,
    scoringMode,
  );
  const entityPRF = computePRF(
    golden.expected_entities,
    answer.ranked_entities,
    golden.acceptable_alternatives?.entities,
    graphIndex,
    "entity",
    scoringMode,
  );
  const blockPRF = computePRF(
    golden.expected_blocks,
    answer.ranked_blocks,
    golden.acceptable_alternatives?.blocks,
    graphIndex,
    "block",
    scoringMode,
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
  // FR7: Separate entity existence from golden match

  let evidenceFileExists = 0;
  let evidenceLineValid = 0;
  let evidenceTotal = answer.evidence.length;

  // FR7: Validate line ranges against actual file length
  const lineCountCache = new Map<string, number>();
  for (const ev of answer.evidence) {
    const fullPath = resolve(repo_path, ev.file_path);
    if (existsSync(fullPath)) {
      evidenceFileExists++;
      if (ev.start_line !== undefined && ev.end_line !== undefined) {
        if (ev.start_line > 0 && ev.end_line > 0 && ev.start_line <= ev.end_line) {
          // Check against actual file length
          const fileLines = getFileLineCount(fullPath, lineCountCache);
          if (ev.end_line <= fileLines) {
            evidenceLineValid++;
          }
        }
      } else if (ev.start_line === undefined && ev.end_line === undefined) {
        evidenceLineValid++;
      }
    }
  }

  // Entity existence: does the entity exist in source/graph (not just golden)?
  let entityExistenceCount = 0;
  let entityGoldenMatchCount = 0;

  const allValidEntityIds = new Set([
    ...golden.expected_entities.map((e) => e.id),
    ...Object.values(golden.acceptable_alternatives?.entities ?? {}).flat(),
  ]);

  for (const r of answer.ranked_entities) {
    // Check existence: in golden/acceptable
    if (allValidEntityIds.has(r.id)) {
      entityExistenceCount++;
      entityGoldenMatchCount++;
    } else if (graphIndex) {
      // Check if entity exists in graph index
      const resolved = resolveEntityId(r.id, graphIndex);
      if (resolved.method !== "unresolved") {
        entityExistenceCount++;
      }
    }
  }

  const evidence: EvidenceMetrics = {
    evidence_file_exists_rate: evidenceTotal > 0 ? evidenceFileExists / evidenceTotal : 1,
    evidence_line_valid_rate: evidenceTotal > 0 ? evidenceLineValid / evidenceTotal : 1,
    evidence_entity_valid_rate: answer.ranked_entities.length > 0
      ? entityExistenceCount / answer.ranked_entities.length
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
    efficiencyScore = 0.5;
    overallScore = 0.7 * accuracyScore + 0.2 * evidenceScore + 0.1 * efficiencyScore;
  } else {
    efficiencyScore = null;
    overallScore = 0.8 * accuracyScore + 0.2 * evidenceScore;
  }

  // Apply penalties
  let penaltyDeduction = (mniPenalty * 0.05 + unsupportedPenalty * 0.03);

  // MCP-specific penalties
  const recallAvg = (filePRF.recall + entityPRF.recall + blockPRF.recall) / 3;
  if (condition === "block_graph_mcp" && answer.used_tools) {
    const totalMcpCalls = answer.used_tools
      .filter((t) => !["Read", "Glob", "Grep", "Bash"].includes(t.tool_name))
      .reduce((sum, t) => sum + t.count, 0);

    if (totalMcpCalls > 20) {
      penaltyDeduction += 0.05;
      warnings.push(`Excessive MCP calls: ${totalMcpCalls} (limit recommended: 10)`);
    }

    const expectedBlockIds = new Set([
      ...golden.expected_blocks.map((b) => b.id),
      ...Object.values(golden.acceptable_alternatives?.blocks ?? {}).flat(),
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
    resolution,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Get file line count with caching.
 */
function getFileLineCount(filePath: string, cache: Map<string, number>): number {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").length;
    cache.set(filePath, lines);
    return lines;
  } catch {
    // If we can't read the file, return Infinity to not penalize line ranges
    return Infinity;
  }
}
