/**
 * BlockGraph MCP v0.2.7 — Prompt Builder
 * Builds deterministic, condition-aware prompts for benchmark agents.
 * v0.2.7: Explicit precision-scored first-inspection targets.
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
  sections.push("");
  sections.push("### Precision-Scored Outputs");
  sections.push("");
  sections.push("Your ranked_files, ranked_entities, and ranked_blocks are **precision-scored first-inspection targets**.");
  sections.push("They should contain the MINIMAL direct files, symbols, and blocks that a maintainer should inspect or edit first.");
  sections.push("");
  sections.push("IMPORTANT:");
  sections.push("- Rank DIRECT targets first (files that need editing, symbols that need changing)");
  sections.push("- Put contextual/transitive/passive items in `evidence` or `notes`, NOT in ranked lists");
  sections.push("- Over-broad ranked lists REDUCE your precision score");
  sections.push("- Include only files/entities/blocks that are directly relevant to the task");
  sections.push("");
  sections.push("Include evidence paths and line ranges when possible.");
  sections.push("Do not claim a flow step unless you can support it with source code or BlockGraph evidence.");
  sections.push("");
  sections.push("### Task-Specific Guidance");
  sections.push("");
  sections.push(getTaskTypeGuidance(case_.task.type));

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
      sections.push("You MUST use BlockGraph MCP tools to query the architecture model FIRST.");
      sections.push("Then inspect MINIMAL source files to verify evidence and line ranges.");
      sections.push("");
      sections.push("### MCP Workflow");
      sections.push("");
      sections.push("1. Call `begin_initialization` to connect to the repository's blockgraph.");
      sections.push("2. Use MCP tools to identify candidate blocks and entities:");
      sections.push("   - `suggest_block_candidates`: get initial block candidates");
      sections.push("   - `query_block`: get block details (ports, mappings, connected blocks)");
      sections.push("   - `query_symbols_by_block`: get code entities mapped to a block");
      sections.push("   - `list_code_entities`: search for specific entities");
      sections.push("3. Inspect ONLY the source files needed to verify evidence.");
      sections.push("4. Report results with both graph IDs AND human-readable names.");
      sections.push("");
      sections.push("### Important Constraints");
      sections.push("");
      sections.push("- **Use MCP first**, then verify with minimal source inspection");
      sections.push("- **Do NOT rank every connected block** — only rank blocks that are DIRECT localization targets");
      sections.push("- **Report canonical IDs**: use `file#symbol` format for entities, not raw scanner IDs");
      sections.push("- **Prefer human-readable names**: use block names, not just UUIDs");
      sections.push("- Aim for ≤10 MCP tool calls. Excessive queries will be penalized.");
      sections.push("- Each irrelevant block query costs points.");
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
  const isMcpCondition = condition === "block_graph_mcp";
  return {
    task_id: taskId,
    condition,
    answer: "<your explanation of the localization or analysis>",
    ranked_files: [
      {
        id: "<repo-relative file path>",
        rank: 1,
        confidence: 0.9,
        reason: "<why this file is relevant>",
      },
    ],
    ranked_entities: [
      {
        id: "<file_path#symbol_name>",
        rank: 1,
        confidence: 0.9,
        ...(isMcpCondition ? { name: "<human-readable symbol name>", canonical_id: "<file#symbol>", raw_id: "<scanner ID if different>", kind: "function|class|component|..." } : {}),
      },
    ],
    ranked_blocks: [
      {
        id: isMcpCondition ? "<block UUID or wp-* ID>" : "<block name>",
        rank: 1,
        confidence: 0.9,
        ...(isMcpCondition ? { name: "<human-readable block name>", canonical_id: "<block name>" } : {}),
      },
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

/**
 * Get task-type-specific guidance for precision-scored outputs.
 */
function getTaskTypeGuidance(taskType: string): string {
  switch (taskType) {
    case "bug_localization":
      return [
        "**Bug Localization**: Rank likely defect source files and symbols first.",
        "- Put the file containing the bug at rank 1",
        "- Rank the specific function/method/class where the bug occurs",
        "- Do NOT rank files that merely use the buggy code (put those in evidence)",
        "- Focus on root cause, not symptoms",
      ].join("\n");

    case "impact_analysis":
      return [
        "**Impact Analysis**: Rank direct changed surface and direct dependents first.",
        "- Rank the file/symbol being changed at rank 1",
        "- Rank files that directly import or call the changed symbol",
        "- Do NOT rank transitive/transitive UI consumers unless they are directly affected",
        "- Put transitive impacts in `notes`, not ranked lists",
      ].join("\n");

    case "cross_module_flow_recovery":
      return [
        "**Cross-Module Flow Recovery**: Rank files/entities in the activation path.",
        "- Rank the entrypoint file at rank 1",
        "- Follow the execution path through modules",
        "- Do NOT rank all UI shells — only those in the active path",
        "- Focus on files that execute code, not files that define types",
      ].join("\n");

    case "feature_landing_zone":
      return [
        "**Feature Landing Zone**: Rank files/blocks that would be edited or extended.",
        "- Rank the file where new code should be added at rank 1",
        "- Rank files that define the extension point or interface",
        "- Do NOT rank files that merely use the feature (put those in evidence)",
        "- Focus on modification targets, not consumers",
      ].join("\n");

    case "entrypoint_path_location":
      return [
        "**Entrypoint Path Location**: Rank the entry path and immediate handlers first.",
        "- Rank the entrypoint file (route, handler) at rank 1",
        "- Follow the execution path to the first handler",
        "- Do NOT rank all intermediate files unless they are in the direct path",
        "- Focus on the activation path, not the entire module",
      ].join("\n");

    default:
      return "Rank the most direct, relevant files, entities, and blocks for this task.";
  }
}
