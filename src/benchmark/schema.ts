/**
 * BlockGraph MCP v0.2.5 — Benchmark Schemas
 * Zod schemas for benchmark cases, goldens, answers, runs, and events.
 * Matches PRD §11 exactly.
 */
import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────

export const BenchmarkModuleSchema = z.enum(["access-accuracy"]);
export type BenchmarkModule = z.infer<typeof BenchmarkModuleSchema>;

export const GraphConditionSchema = z.enum([
  "no_graph",
  "code_facts_only",
  "block_graph",
  "block_graph_with_flows",
  "stale_or_incomplete_graph",
  "block_graph_mcp",
]);
export type GraphCondition = z.infer<typeof GraphConditionSchema>;

export const AccessAccuracyTaskTypeSchema = z.enum([
  "entrypoint_path_location",
  "bug_localization",
  "impact_analysis",
  "feature_landing_zone",
  "cross_module_flow_recovery",
]);
export type AccessAccuracyTaskType = z.infer<typeof AccessAccuracyTaskTypeSchema>;

// ── Weighted Expected Item ─────────────────────────────────────────────────

export const WeightedExpectedItemSchema = z.object({
  id: z.string(),
  weight: z.number().optional(),
  required: z.boolean().optional(),
});
export type WeightedExpectedItem = z.infer<typeof WeightedExpectedItemSchema>;

// ── Golden Answer ──────────────────────────────────────────────────────────

export const AccessAccuracyGoldenSchema = z.object({
  expected_files: z.array(WeightedExpectedItemSchema),
  expected_entities: z.array(WeightedExpectedItemSchema),
  expected_blocks: z.array(WeightedExpectedItemSchema),
  expected_flow_order: z.array(z.string()).optional(),
  acceptable_alternatives: z
    .object({
      files: z.array(z.string()).optional(),
      entities: z.array(z.string()).optional(),
      blocks: z.array(z.string()).optional(),
    })
    .optional(),
  must_not_include: z
    .object({
      files: z.array(z.string()).optional(),
      entities: z.array(z.string()).optional(),
      blocks: z.array(z.string()).optional(),
    })
    .optional(),
  notes: z.string().optional(),
});
export type AccessAccuracyGolden = z.infer<typeof AccessAccuracyGoldenSchema>;

// ── Benchmark Case ─────────────────────────────────────────────────────────

export const BenchmarkCaseSchema = z.object({
  id: z.string().min(1),
  module: BenchmarkModuleSchema,
  title: z.string().min(1),
  description: z.string(),
  repo: z.object({
    kind: z.enum(["fixture", "local", "git"]),
    path: z.string().optional(),
    url: z.string().optional(),
    ref: z.string().optional(),
  }),
  task: z.object({
    type: AccessAccuracyTaskTypeSchema,
    prompt: z.string().min(1),
    entrypoint_hint: z.string().optional(),
    symptom: z.string().optional(),
    changed_surface: z.string().optional(),
  }),
  allowed_conditions: z.array(GraphConditionSchema).min(1),
  golden: AccessAccuracyGoldenSchema,
  tags: z.array(z.string()),
});
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

// ── Agent Final Answer ─────────────────────────────────────────────────────

export const RankedItemSchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});
export type RankedItem = z.infer<typeof RankedItemSchema>;

export const EvidenceRefSchema = z.object({
  file_path: z.string(),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  code_entity_id: z.string().optional(),
  note: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ToolUseSummarySchema = z.object({
  tool_name: z.string(),
  count: z.number().int().min(0),
});
export type ToolUseSummary = z.infer<typeof ToolUseSummarySchema>;

export const AgentFinalAnswerSchema = z.object({
  task_id: z.string(),
  condition: GraphConditionSchema,
  answer: z.string(),
  ranked_files: z.array(RankedItemSchema),
  ranked_entities: z.array(RankedItemSchema),
  ranked_blocks: z.array(RankedItemSchema),
  predicted_flow_order: z.array(z.string()).optional(),
  evidence: z.array(EvidenceRefSchema),
  confidence: z.number().min(0).max(1),
  used_blockgraph: z.boolean(),
  used_tools: z.array(ToolUseSummarySchema).optional(),
  notes: z.string().optional(),
});
export type AgentFinalAnswer = z.infer<typeof AgentFinalAnswerSchema>;

// ── Scoring ────────────────────────────────────────────────────────────────

export const AccuracyMetricsSchema = z.object({
  file_precision: z.number(),
  file_recall: z.number(),
  file_f1: z.number(),
  entity_precision: z.number(),
  entity_recall: z.number(),
  entity_f1: z.number(),
  block_precision: z.number(),
  block_recall: z.number(),
  block_f1: z.number(),
  top1_file_hit: z.number(),
  top3_file_hit: z.number(),
  top5_file_hit: z.number(),
  top1_entity_hit: z.number(),
  top3_entity_hit: z.number(),
  flow_order_score: z.number(),
  must_not_include_penalty: z.number(),
  unsupported_evidence_penalty: z.number(),
});
export type AccuracyMetrics = z.infer<typeof AccuracyMetricsSchema>;

export const EfficiencyMetricsSchema = z.object({
  reported_tool_calls: z.number().int().nullable(),
  reported_read_calls: z.number().int().nullable(),
  reported_grep_calls: z.number().int().nullable(),
  reported_mcp_calls: z.number().int().nullable(),
  unique_files_read: z.number().int().nullable(),
  search_waste_ratio: z.number().nullable(),
  duration_ms: z.number().nullable(),
});
export type EfficiencyMetrics = z.infer<typeof EfficiencyMetricsSchema>;

export const EvidenceMetricsSchema = z.object({
  evidence_file_exists_rate: z.number(),
  evidence_line_valid_rate: z.number(),
  evidence_entity_valid_rate: z.number(),
  unsupported_claim_count: z.number().int(),
});
export type EvidenceMetrics = z.infer<typeof EvidenceMetricsSchema>;

export const CaseScoreSchema = z.object({
  case_id: z.string(),
  condition: GraphConditionSchema,
  accuracy: AccuracyMetricsSchema,
  efficiency: EfficiencyMetricsSchema,
  evidence: EvidenceMetricsSchema,
  accuracy_score: z.number(),
  efficiency_score: z.number().nullable(),
  evidence_score: z.number(),
  overall_score: z.number(),
  warnings: z.array(z.string()),
});
export type CaseScore = z.infer<typeof CaseScoreSchema>;

// ── Benchmark Run ──────────────────────────────────────────────────────────

export const BenchmarkCaseRunSchema = z.object({
  case_id: z.string(),
  condition: GraphConditionSchema,
  adapter: z.string(),
  model: z.string().optional(),
  final_answer: AgentFinalAnswerSchema.nullable(),
  score: CaseScoreSchema.nullable(),
  duration_ms: z.number(),
  error: z.string().optional(),
});
export type BenchmarkCaseRun = z.infer<typeof BenchmarkCaseRunSchema>;

export const BenchmarkAggregateScoreSchema = z.object({
  overall: z.number(),
  by_condition: z.record(GraphConditionSchema, z.number()),
  case_count: z.number().int(),
  failed_count: z.number().int(),
});
export type BenchmarkAggregateScore = z.infer<typeof BenchmarkAggregateScoreSchema>;

export const BenchmarkRunSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  benchmark_version: z.string(),
  git_sha: z.string().optional(),
  adapter: z.string(),
  model: z.string().optional(),
  cases: z.array(BenchmarkCaseRunSchema),
  aggregate: BenchmarkAggregateScoreSchema,
});
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;

// ── Events ─────────────────────────────────────────────────────────────────

export const BenchmarkEventTypeSchema = z.enum([
  "run_started",
  "case_started",
  "repo_prepared",
  "graph_condition_prepared",
  "agent_started",
  "agent_finished",
  "agent_failed",
  "score_computed",
  "case_finished",
  "run_finished",
]);
export type BenchmarkEventType = z.infer<typeof BenchmarkEventTypeSchema>;

export const BenchmarkEventSchema = z.object({
  ts: z.string(),
  run_id: z.string(),
  case_id: z.string().optional(),
  condition: GraphConditionSchema.optional(),
  type: BenchmarkEventTypeSchema,
  data: z.unknown().optional(),
});
export type BenchmarkEvent = z.infer<typeof BenchmarkEventSchema>;

// ── Graph Condition Context ────────────────────────────────────────────────

export const GraphConditionContextSchema = z.object({
  condition: GraphConditionSchema,
  code_facts_path: z.string().optional(),
  blocks_path: z.string().optional(),
  connectors_path: z.string().optional(),
  flows_path: z.string().optional(),
  stale_warning_path: z.string().optional(),
  mcp_config_path: z.string().optional(),
  temp_repo_path: z.string().optional(),
  omissions: z
    .object({
      features: z.array(z.string()).optional(),
      flows: z.array(z.string()).optional(),
      shared_deps: z.array(z.string()).optional(),
    })
    .optional(),
});
export type GraphConditionContext = z.infer<typeof GraphConditionContextSchema>;

// ── Adapter Interface ──────────────────────────────────────────────────────

export interface AgentRunInput {
  run_id: string;
  case: BenchmarkCase;
  condition: GraphCondition;
  repo_path: string;
  graph_context?: GraphConditionContext;
  prompt: string;
  output_dir: string;
  timeout_ms: number;
}

export interface AgentRunResult {
  final_answer: AgentFinalAnswer;
  raw_output?: unknown;
  events?: BenchmarkEvent[];
  duration_ms: number;
  telemetry?: AgentTelemetry;
}

export interface AgentTelemetry {
  tool_calls?: number;
  read_calls?: number;
  grep_calls?: number;
  mcp_calls?: number;
  unique_files_read?: string[];
}

export interface AgentAdapter {
  name: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

// ── Evaluator Interface ────────────────────────────────────────────────────

export interface EvaluatorInput {
  case_: BenchmarkCase;
  condition: GraphCondition;
  answer: AgentFinalAnswer;
  repo_path: string;
}

export interface Evaluator {
  name: string;
  evaluate(input: EvaluatorInput): CaseScore;
}
