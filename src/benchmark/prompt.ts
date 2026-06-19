/**
 * BlockGraph MCP v0.2.5 — Prompt Builder
 * Builds deterministic, condition-aware prompts for benchmark agents.
 * PRD §13: prompting rules.
 */
import type {
  BenchmarkCase,
  GraphCondition,
  GraphConditionContext,
} from "./schema.js";

export interface BuildPromptInput {
  case_: BenchmarkCase;
  condition: GraphCondition;
  repoPath: string;
  context?: GraphConditionContext;
}

/**
 * Build a deterministic prompt for a benchmark case and condition.
 * The prompt includes the case task, condition restrictions, repository path,
 * context file paths, and the required JSON answer schema.
 */
export function buildPrompt(input: BuildPromptInput): string {
  const { case_, condition, repoPath, context } = input;

  const sections: string[] = [];

  // ── Header ───────────────────────────────────────────────────────────────
  sections.push(`## Task: ${case_.title}`);
  sections.push("");
  sections.push(case_.task.prompt);

  if (case_.task.entrypoint_hint) {
    sections.push(`\nEntrypoint hint: ${case_.task.entrypoint_hint}`);
  }
  if (case_.task.symptom) {
    sections.push(`\nSymptom: ${case_.task.symptom}`);
  }
  if (case_.task.changed_surface) {
    sections.push(`\nChanged surface: ${case_.task.changed_surface}`);
  }

  // ── Repository ───────────────────────────────────────────────────────────
  sections.push("");
  sections.push(`## Repository`);
  sections.push("");
  sections.push(`Repository path: ${repoPath}`);

  // ── Shared Rules ─────────────────────────────────────────────────────────
  sections.push("");
  sections.push("## Rules");
  sections.push("");
  sections.push("Do not modify repository files.");
  sections.push("Your task is localization and explanation only.");
  sections.push("Return only JSON matching the required schema.");
  sections.push("Rank the most relevant files, entities, and blocks.");
  sections.push("Include evidence paths and line ranges when possible.");
  sections.push("Do not claim a flow step unless you can support it with source code or BlockGraph evidence.");

  // ── Condition-Specific Instructions ──────────────────────────────────────
  sections.push("");
  sections.push("## Context Condition");
  sections.push("");
  sections.push(`Condition: ${condition}`);
  sections.push("");

  switch (condition) {
    case "no_graph":
      sections.push("Do not use BlockGraph MCP tools or .blockgraph data.");
      sections.push("Use ordinary repository inspection only.");
      break;

    case "code_facts_only":
      sections.push("You may use scanner/code fact data, but not semantic blocks or flows.");
      if (context?.code_facts_path) {
        sections.push(`\nCode facts are available at: ${context.code_facts_path}`);
      }
      break;

    case "block_graph":
      sections.push("You may use BlockGraph block/module data.");
      sections.push("Prefer graph-guided search, but verify claims against source files.");
      if (context?.code_facts_path) {
        sections.push(`\nCode facts: ${context.code_facts_path}`);
      }
      if (context?.blocks_path) {
        sections.push(`Blocks: ${context.blocks_path}`);
      }
      if (context?.connectors_path) {
        sections.push(`Connectors: ${context.connectors_path}`);
      }
      break;

    case "block_graph_with_flows":
      sections.push("You may use BlockGraph block, connector, and flow data.");
      sections.push("Use flows to guide activation path reconstruction, but verify claims against source files.");
      if (context?.code_facts_path) {
        sections.push(`\nCode facts: ${context.code_facts_path}`);
      }
      if (context?.blocks_path) {
        sections.push(`Blocks: ${context.blocks_path}`);
      }
      if (context?.connectors_path) {
        sections.push(`Connectors: ${context.connectors_path}`);
      }
      if (context?.flows_path) {
        sections.push(`Flows: ${context.flows_path}`);
      }
      break;

    case "block_graph_mcp":
      sections.push("You MUST use BlockGraph MCP tools to query the architecture model.");
      sections.push("Do NOT read source files directly — use the graph to locate relevant code.");
      sections.push("");
      sections.push("Available MCP tools:");
      sections.push("- begin_initialization: connect to the repository's blockgraph (call this first)");
      sections.push("- query_block: get block details (ports, mappings, connectors)");
      sections.push("- query_symbols_by_block: get code entities mapped to a block");
      sections.push("- list_code_entities: list code entities with filters");
      sections.push("- list_code_edges: list code edges with filters");
      sections.push("- suggest_block_candidates: suggest blocks from heuristics");
      sections.push("");
      sections.push("Goal: PRECISION over exploration.");
      sections.push("1. Call begin_initialization to connect.");
      sections.push("2. Use suggest_block_candidates or list_code_entities to identify relevant blocks.");
      sections.push("3. Use query_block to get block details and mapped entities.");
      sections.push("4. Report only the blocks and entities you are confident about.");
      sections.push("");
      sections.push("Constraints:");
      sections.push("- Aim for ≤10 MCP tool calls. Excessive queries will be penalized.");
      sections.push("- Each irrelevant block query costs points. Only query blocks you believe are relevant.");
      sections.push("- Do NOT scan the repository yourself. The graph IS the source of truth.");
      if (context?.mcp_config_path) {
        sections.push(`\nMCP config: ${context.mcp_config_path}`);
      }
      break;

    case "stale_or_incomplete_graph":
      sections.push("The graph may be stale or incomplete.");
      sections.push("Use it as a hint, not as truth.");
      sections.push("Flag any contradictions between source code and graph.");
      if (context?.code_facts_path) {
        sections.push(`\nCode facts: ${context.code_facts_path}`);
      }
      if (context?.blocks_path) {
        sections.push(`Blocks: ${context.blocks_path}`);
      }
      if (context?.connectors_path) {
        sections.push(`Connectors: ${context.connectors_path}`);
      }
      if (context?.flows_path) {
        sections.push(`Flows: ${context.flows_path}`);
      }
      if (context?.stale_warning_path) {
        sections.push(`\nStale graph warning: ${context.stale_warning_path}`);
      }
      if (context?.omissions) {
        sections.push(`\nKnown omissions: ${JSON.stringify(context.omissions)}`);
      }
      break;
  }

  // ── Required Output Schema ───────────────────────────────────────────────
  sections.push("");
  sections.push("## Required Output");
  sections.push("");
  sections.push("Return a single JSON object matching this schema:");
  sections.push("");
  sections.push("```json");
  sections.push(JSON.stringify(buildExampleAnswer(case_.id, condition), null, 2));
  sections.push("```");

  return sections.join("\n");
}

/**
 * Build the example JSON answer for the prompt.
 */
function buildExampleAnswer(taskId: string, condition: GraphCondition): object {
  return {
    task_id: taskId,
    condition,
    answer: "<your explanation of the localization or analysis>",
    ranked_files: [
      { id: "<repo-relative file path>", rank: 1, confidence: 0.9, reason: "<why this file is relevant>" },
    ],
    ranked_entities: [
      { id: "<file_path#symbol_name>", rank: 1, confidence: 0.9 },
    ],
    ranked_blocks: [
      { id: "<block name or ID>", rank: 1, confidence: 0.9 },
    ],
    predicted_flow_order: ["<file_path#symbol_name>", "..."],
    evidence: [
      { file_path: "<repo-relative path>", start_line: 1, end_line: 50, note: "<what this evidence shows>" },
    ],
    confidence: 0.8,
    used_blockgraph: condition !== "no_graph",
    notes: "<any caveats or observations>",
  };
}
