/**
 * BlockGraph MCP v0.2.7 — Telemetry Parser
 * Parses Claude Code stream-json traces to extract tool usage metrics.
 * PRD Phase 2: Trace Capture And Trusted Telemetry.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

// ── Types ─────────────────────────────────────────────────────────────────

export interface TelemetryData {
  /** Quality of telemetry extraction */
  quality: "full" | "partial" | "absent";
  /** Total tool calls made */
  total_tool_calls: number;
  /** Tool calls by name */
  tool_calls_by_name: Record<string, number>;
  /** MCP tool calls (non-native tools) */
  mcp_tool_calls: number;
  /** Whether BlockGraph MCP tools were used */
  used_blockgraph_mcp: boolean;
  /** BlockGraph MCP tool names and counts */
  blockgraph_tool_calls: Record<string, number>;
  /** File read operations */
  file_reads: number;
  /** Search/grep operations */
  search_operations: number;
  /** Unique files read */
  unique_files_read: string[];
  /** Source of telemetry data */
  source: "trace" | "self_report" | "none";
  /** Raw trace file path if available */
  trace_file?: string;
  /** Parse errors encountered */
  parse_errors: string[];
}

export interface TraceEvent {
  type: string;
  subtype?: string;
  tool?: {
    name: string;
    input?: Record<string, unknown>;
  };
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  timestamp?: string;
}

/** Known BlockGraph MCP tool prefixes */
const BLOCKGRAPH_TOOL_PREFIXES = [
  "mcp__blockgraph__",
  "blockgraph_",
];

/** Native Claude Code tools (not MCP) */
const NATIVE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoRead",
  "TodoWrite",
  "Task",
  "Skill",
];

/** File read tool names */
const READ_TOOLS = ["Read", "read_file", "mcp__filesystem__read_file"];

/** Search tool names */
const SEARCH_TOOLS = ["Glob", "Grep", "glob", "grep", "search_files"];

// ── Main Functions ────────────────────────────────────────────────────────

/**
 * Parse telemetry from a Claude Code stream-json trace file.
 */
export async function parseTraceFile(tracePath: string): Promise<TelemetryData> {
  if (!existsSync(tracePath)) {
    return createEmptyTelemetry("absent", ["Trace file not found"]);
  }

  try {
    const raw = await readFile(tracePath, "utf-8");
    return parseTraceContent(raw, tracePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createEmptyTelemetry("absent", [`Failed to read trace: ${msg}`]);
  }
}

/**
 * Parse telemetry from raw trace content (newline-delimited JSON).
 */
export function parseTraceContent(content: string, tracePath?: string): TelemetryData {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const events: TraceEvent[] = [];
  const parseErrors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      events.push(parsed);
    } catch {
      // Skip unparseable lines (may be partial output)
      // Record all parse errors for quality tracking
      parseErrors.push(`Line ${i + 1}: invalid JSON (${lines[i].length} chars)`);
    }
  }

  return extractTelemetry(events, tracePath, parseErrors);
}

/**
 * Extract telemetry from parsed trace events.
 */
function extractTelemetry(
  events: TraceEvent[],
  tracePath?: string,
  parseErrors: string[] = [],
): TelemetryData {
  const toolCallsByName: Record<string, number> = {};
  const uniqueFiles = new Set<string>();
  const blockgraphCalls: Record<string, number> = {};
  let mcpToolCalls = 0;
  let fileReads = 0;
  let searchOps = 0;
  let usedBlockgraph = false;

  for (const event of events) {
    // Look for tool_use events
    if (event.type === "tool_use" || event.subtype === "tool_use") {
      const toolName = event.tool?.name ?? extractToolName(event);
      if (!toolName) continue;

      toolCallsByName[toolName] = (toolCallsByName[toolName] ?? 0) + 1;

      // Check if MCP tool
      const isMcp = BLOCKGRAPH_TOOL_PREFIXES.some((p) => toolName.startsWith(p));
      const isNative = NATIVE_TOOLS.some((n) => toolName === n || toolName.startsWith(n.toLowerCase()));

      if (isMcp) {
        mcpToolCalls++;
        usedBlockgraph = true;
        const shortName = toolName.replace(/^mcp__blockgraph__/, "").replace(/^blockgraph_/, "");
        blockgraphCalls[shortName] = (blockgraphCalls[shortName] ?? 0) + 1;
      } else if (!isNative) {
        // Unknown tool - might be MCP
        mcpToolCalls++;
      }

      // Track file reads
      if (READ_TOOLS.some((r) => toolName.includes(r))) {
        fileReads++;
        const filePath = extractFilePath(event);
        if (filePath) uniqueFiles.add(filePath);
      }

      // Track search operations
      if (SEARCH_TOOLS.some((s) => toolName.includes(s))) {
        searchOps++;
      }
    }

    // Also check message content blocks for tool_use
    if (event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name) {
          toolCallsByName[block.name] = (toolCallsByName[block.name] ?? 0) + 1;

          const isMcp = BLOCKGRAPH_TOOL_PREFIXES.some((p) => block.name!.startsWith(p));
          if (isMcp) {
            mcpToolCalls++;
            usedBlockgraph = true;
            const shortName = block.name!.replace(/^mcp__blockgraph__/, "");
            blockgraphCalls[shortName] = (blockgraphCalls[shortName] ?? 0) + 1;
          }
        }
      }
    }
  }

  const totalToolCalls = Object.values(toolCallsByName).reduce((a, b) => a + b, 0);
  const quality = events.length > 0 ? (parseErrors.length > 0 ? "partial" : "full") : "absent";

  return {
    quality,
    total_tool_calls: totalToolCalls,
    tool_calls_by_name: toolCallsByName,
    mcp_tool_calls: mcpToolCalls,
    used_blockgraph_mcp: usedBlockgraph,
    blockgraph_tool_calls: blockgraphCalls,
    file_reads: fileReads,
    search_operations: searchOps,
    unique_files_read: [...uniqueFiles],
    source: events.length > 0 ? "trace" : "none",
    trace_file: tracePath,
    parse_errors: parseErrors,
  };
}

/**
 * Extract telemetry from agent self-report (fallback when no trace).
 */
export function extractSelfReportTelemetry(
  usedTools?: Array<{ tool_name: string; count: number }>,
): TelemetryData {
  if (!usedTools || usedTools.length === 0) {
    return createEmptyTelemetry("absent", ["No tool usage data available"]);
  }

  const toolCallsByName: Record<string, number> = {};
  const blockgraphCalls: Record<string, number> = {};
  let mcpToolCalls = 0;
  let usedBlockgraph = false;

  for (const tool of usedTools) {
    toolCallsByName[tool.tool_name] = (toolCallsByName[tool.tool_name] ?? 0) + tool.count;

    const isMcp = BLOCKGRAPH_TOOL_PREFIXES.some((p) => tool.tool_name.startsWith(p));
    if (isMcp) {
      mcpToolCalls += tool.count;
      usedBlockgraph = true;
      const shortName = tool.tool_name.replace(/^mcp__blockgraph__/, "").replace(/^blockgraph_/, "");
      blockgraphCalls[shortName] = (blockgraphCalls[shortName] ?? 0) + tool.count;
    }
  }

  const totalToolCalls = usedTools.reduce((a, b) => a + b.count, 0);

  return {
    quality: "partial",
    total_tool_calls: totalToolCalls,
    tool_calls_by_name: toolCallsByName,
    mcp_tool_calls: mcpToolCalls,
    used_blockgraph_mcp: usedBlockgraph,
    blockgraph_tool_calls: blockgraphCalls,
    file_reads: 0,
    search_operations: 0,
    unique_files_read: [],
    source: "self_report",
    parse_errors: ["Self-reported telemetry - may be incomplete"],
  };
}

/**
 * Write telemetry data to a JSON file.
 */
export async function writeTelemetry(
  telemetry: TelemetryData,
  outputDir: string,
): Promise<string> {
  const telemetryPath = resolve(outputDir, "telemetry.json");
  await writeFile(telemetryPath, JSON.stringify(telemetry, null, 2));
  return telemetryPath;
}

/**
 * Read telemetry from a case run directory.
 */
export async function readTelemetry(caseDir: string): Promise<TelemetryData | null> {
  const telemetryPath = resolve(caseDir, "telemetry.json");
  if (!existsSync(telemetryPath)) return null;

  try {
    const raw = await readFile(telemetryPath, "utf-8");
    return JSON.parse(raw) as TelemetryData;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function createEmptyTelemetry(
  quality: TelemetryData["quality"],
  errors: string[],
): TelemetryData {
  return {
    quality,
    total_tool_calls: 0,
    tool_calls_by_name: {},
    mcp_tool_calls: 0,
    used_blockgraph_mcp: false,
    blockgraph_tool_calls: {},
    file_reads: 0,
    search_operations: 0,
    unique_files_read: [],
    source: "none",
    parse_errors: errors,
  };
}

function extractToolName(event: TraceEvent): string | null {
  // Try direct tool name
  if (event.tool?.name) return event.tool.name;

  // Try from message content
  if (event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "tool_use" && block.name) {
        return block.name;
      }
    }
  }

  return null;
}

function extractFilePath(event: TraceEvent): string | null {
  // Try to extract file path from tool input
  const input = event.tool?.input;
  if (!input) return null;

  // Common file path parameter names
  const pathParams = ["file_path", "path", "filePath", "target"];
  for (const param of pathParams) {
    if (typeof input[param] === "string") {
      return input[param] as string;
    }
  }

  return null;
}
