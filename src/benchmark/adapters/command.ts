/**
 * BlockGraph MCP v0.2.7 — Command Adapter
 * Executes an external command (e.g., claude -p, opencode run) for benchmark scoring.
 * v0.2.7: Added trace/debug capture, telemetry extraction, explicit MCP config handling.
 */
import { spawn, execSync } from "node:child_process";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { AgentFinalAnswerSchema, type AgentFinalAnswer } from "../schema.js";
import { parseTraceFile, extractSelfReportTelemetry, writeTelemetry, type TelemetryData } from "../telemetry.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

export interface CommandAdapterOptions {
  command: string;
}

export function createCommandAdapter(options: CommandAdapterOptions): AgentAdapter {
  const { command } = options;

  return {
    name: "command",
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const startTime = Date.now();
      const { output_dir, prompt, timeout_ms, case: case_, condition } = input;

      // Write prompt to file
      await mkdir(output_dir, { recursive: true });
      const promptFile = resolve(output_dir, "prompt.txt");
      await writeFile(promptFile, prompt, "utf-8");

      // Expected answer file path
      const answerFile = resolve(output_dir, "answer.json");

      // Trace/debug file paths for telemetry capture
      const traceFile = resolve(output_dir, "trace.jsonl");
      const debugFile = resolve(output_dir, "debug.log");
      const stdoutFile = resolve(output_dir, "stdout.txt");
      const stderrFile = resolve(output_dir, "stderr.txt");

      // Build empty MCP config path for no_graph isolation
      const emptyMcpConfig = resolve(output_dir, "prepared-repo", ".benchmark-empty-mcp.json");
      const mcpConfigPath = condition === "no_graph" && existsSync(emptyMcpConfig)
        ? emptyMcpConfig
        : (input.graph_context?.mcp_config_path ?? "");

      // Substitute template variables in command
      const resolvedCommand = command
        .replace(/\{repo\}/g, input.repo_path.replace(/\\/g, "/"))
        .replace(/\{case_id\}/g, case_.id)
        .replace(/\{condition\}/g, condition)
        .replace(/\{output_dir\}/g, output_dir.replace(/\\/g, "/"))
        .replace(/\{prompt_file\}/g, promptFile.replace(/\\/g, "/"))
        .replace(/\{answer_file\}/g, answerFile.replace(/\\/g, "/"))
        .replace(/\{mcp_config\}/g, mcpConfigPath.replace(/\\/g, "/"))
        .replace(/\{trace_file\}/g, traceFile.replace(/\\/g, "/"))
        .replace(/\{debug_file\}/g, debugFile.replace(/\\/g, "/"))
        .replace(/\{stdout_file\}/g, stdoutFile.replace(/\\/g, "/"))
        .replace(/\{stderr_file\}/g, stderrFile.replace(/\\/g, "/"));

      // Write resolved command for audit
      await writeFile(
        resolve(output_dir, "resolved-command.json"),
        JSON.stringify({
          original: command,
          resolved: resolvedCommand,
          condition,
          mcp_config_path: mcpConfigPath,
          strict_mcp_config: condition === "block_graph_mcp" || condition === "no_graph",
          timestamp: new Date().toISOString(),
        }, null, 2),
      );

      // Execute command
      const { stdout, stderr, exitCode } = await executeCommand(
        resolvedCommand,
        prompt,
        timeout_ms,
      );

      // Write raw output (always preserve for audit)
      const rawOutputFile = resolve(output_dir, "raw-output.txt");
      await writeFile(rawOutputFile, `=== STDOUT ===\n${stdout}\n=== STDERR ===\n${stderr}`, "utf-8");

      // Also write separate stdout/stderr files for easier parsing
      await writeFile(stdoutFile, stdout, "utf-8");
      await writeFile(stderrFile, stderr, "utf-8");

      // Extract telemetry from trace or self-report
      let telemetry: TelemetryData;

      // Try to parse trace file first
      if (existsSync(traceFile)) {
        telemetry = await parseTraceFile(traceFile);
      } else {
        // Fall back to self-reported tool usage from answer
        // (will be extracted after answer parsing)
        telemetry = extractSelfReportTelemetry(undefined);
      }

      // FR2: Prefer reading answer file over stdout extraction
      // Check for answer file FIRST — even if exit code is non-zero (e.g., ECONNRESET during shutdown),
      // the agent may have completed its work successfully before the cleanup error occurred.
      let finalAnswer: AgentFinalAnswer;

      if (existsSync(answerFile)) {
        finalAnswer = await parseAnswerFile(answerFile);
      } else if (exitCode !== 0) {
        throw new Error(
          `Command exited with code ${exitCode} and no answer file was written.\n` +
          `Command: ${resolvedCommand}\n` +
          `Stderr: ${stderr.slice(0, 500)}`,
        );
      } else {
        finalAnswer = parseAgentAnswer(stdout, case_.id, condition, output_dir);
      }

      // Update telemetry with self-report if trace was absent
      if (telemetry.source === "none" && finalAnswer.used_tools) {
        telemetry = extractSelfReportTelemetry(finalAnswer.used_tools);
      }

      // Write telemetry
      await writeTelemetry(telemetry, output_dir);

      const duration_ms = Date.now() - startTime;

      return {
        final_answer: finalAnswer,
        raw_output: stdout,
        duration_ms,
        telemetry,
      };
    },
  };
}

// ── Command Execution ──────────────────────────────────────────────────────

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function executeCommand(
  command: string,
  stdin: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd" : "sh";
    const shellArgs = isWin ? ["/c", command] : ["-c", command];

    const proc = spawn(shell, shellArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    // P0-1: Manual timeout since spawn() doesn't support timeout option
    // On Windows, SIGTERM doesn't kill the process tree — use taskkill instead
    const timer = setTimeout(() => {
      killed = true;
      if (isWin && proc.pid) {
        try {
          execSync(`taskkill /F /T /PID ${proc.pid}`, { windowsHide: true });
        } catch {
          // taskkill may fail if process already exited — fall back to SIGTERM
          proc.kill("SIGTERM");
        }
      } else {
        proc.kill("SIGTERM");
      }
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Command failed to start: ${err.message}`));
    });

    // Write prompt to stdin
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

// ── Answer File Parsing (FR2) ─────────────────────────────────────────────

/**
 * Parse answer from a JSON file written by the agent.
 * Validates against AgentFinalAnswerSchema with precise error messages.
 */
async function parseAnswerFile(answerFile: string): Promise<AgentFinalAnswer> {
  let raw: string;
  try {
    raw = await readFile(answerFile, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read answer file ${answerFile}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const jsonErr = err as Error;
    // Extract position info from JSON parse error
    const posMatch = jsonErr.message?.match(/position\s+(\d+)/i);
    const pos = posMatch ? parseInt(posMatch[1], 10) : null;
    const context = pos !== null ? extractJsonContext(raw, pos) : raw.slice(0, 200);
    throw new Error(
      `Invalid JSON in answer file ${answerFile}:\n` +
      `  ${jsonErr.message}\n` +
      (pos !== null ? `  Near position ${pos}: ...${context}...\n` : "") +
      `  File size: ${raw.length} bytes`,
    );
  }

  const result = AgentFinalAnswerSchema.safeParse(parsed);
  if (result.success) return result.data;

  // Build detailed validation error message
  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Answer file ${answerFile} failed schema validation:\n${issues}\n` +
    `Keys present: ${Object.keys(parsed as object).join(", ")}`,
  );
}

/**
 * Extract context around a position in a JSON string for error messages.
 */
function extractJsonContext(raw: string, pos: number): string {
  const start = Math.max(0, pos - 40);
  const end = Math.min(raw.length, pos + 40);
  return raw.slice(start, end);
}

// ── Stdout Answer Parsing ─────────────────────────────────────────────────

function parseAgentAnswer(
  stdout: string,
  taskId: string,
  condition: string,
  outputDir: string,
): AgentFinalAnswer {
  // Try to extract JSON from stdout
  // First, try to unwrap Claude Code result format
  let parseTarget = stdout;
  try {
    const outer = JSON.parse(stdout);
    if (outer.result && typeof outer.result === "string") {
      parseTarget = outer.result;
    }
  } catch {
    // Not JSON-wrapped, use raw stdout
  }

  // Look for JSON in markdown code blocks first
  const codeBlockMatch = parseTarget.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    const result = tryParseJson(inner, taskId, condition);
    if (result) return result;
  }

  // Fall back to finding any JSON object with task_id
  const jsonMatch = parseTarget.match(/\{[\s\S]*"task_id"[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Could not extract JSON answer from command output.\n` +
      `Expected either:\n` +
      `  1. A JSON file at ${resolve(outputDir, "answer.json")}\n` +
      `  2. A JSON object with "task_id" field in stdout\n\n` +
      `No answer file found and stdout parsing failed.\n` +
      `Stdout length: ${stdout.length} chars\n` +
      `First 300 chars: ${stdout.slice(0, 300)}`,
    );
  }

  const result = tryParseJson(jsonMatch[0], taskId, condition);
  if (result) return result;

  // Precise parse error
  let parseError = "";
  try {
    JSON.parse(jsonMatch[0]);
  } catch (err: unknown) {
    const jsonErr = err as Error;
    const posMatch = jsonErr.message?.match(/position\s+(\d+)/i);
    const pos = posMatch ? parseInt(posMatch[1], 10) : null;
    parseError = pos !== null
      ? `JSON parse error at position ${pos}: ${jsonErr.message}`
      : `JSON parse error: ${jsonErr.message}`;
  }

  throw new Error(
    `Found JSON-like content but failed to parse.\n` +
    `${parseError}\n` +
    `Content length: ${jsonMatch[0].length} chars\n` +
    `First 300 chars: ${jsonMatch[0].slice(0, 300)}`,
  );
}

function tryParseJson(
  jsonStr: string,
  taskId: string,
  condition: string,
): AgentFinalAnswer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  const result = AgentFinalAnswerSchema.safeParse(parsed);
  if (result.success) return result.data;

  // Try to fix common issues
  const fixed = tryFixAnswer(parsed, taskId, condition);
  if (fixed) {
    const recheck = AgentFinalAnswerSchema.safeParse(fixed);
    if (recheck.success) return recheck.data;
  }

  return null;
}

function tryFixAnswer(
  parsed: unknown,
  taskId: string,
  condition: string,
): unknown {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = { ...parsed as Record<string, unknown> };

  // Fix missing task_id
  if (!obj.task_id) obj.task_id = taskId;
  // Fix missing condition
  if (!obj.condition) obj.condition = condition;
  // Fix missing arrays
  if (!obj.ranked_files) obj.ranked_files = [];
  if (!obj.ranked_entities) obj.ranked_entities = [];
  if (!obj.ranked_blocks) obj.ranked_blocks = [];
  if (!obj.evidence) obj.evidence = [];
  // Fix missing confidence
  if (obj.confidence === undefined) obj.confidence = 0.5;
  // Fix missing used_blockgraph
  if (obj.used_blockgraph === undefined) obj.used_blockgraph = false;
  // Fix missing answer
  if (!obj.answer) obj.answer = "";

  return obj;
}
