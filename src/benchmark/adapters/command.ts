/**
 * BlockGraph MCP v0.2.5 — Command Adapter
 * Executes an external command (e.g., claude -p, opencode run) for benchmark scoring.
 * PRD §14.4: command adapter implementation.
 */
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { AgentFinalAnswerSchema, type AgentFinalAnswer } from "../schema.js";
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

      // Substitute template variables in command
      const resolvedCommand = command
        .replace(/\{repo\}/g, input.repo_path.replace(/\\/g, "/"))
        .replace(/\{case_id\}/g, case_.id)
        .replace(/\{condition\}/g, condition)
        .replace(/\{output_dir\}/g, output_dir.replace(/\\/g, "/"))
        .replace(/\{prompt_file\}/g, promptFile.replace(/\\/g, "/"))
        .replace(/\{mcp_config\}/g, (input.graph_context?.mcp_config_path ?? "").replace(/\\/g, "/"));

      // Execute command
      const { stdout, stderr, exitCode } = await executeCommand(
        resolvedCommand,
        prompt,
        timeout_ms,
      );

      // Write raw output
      const rawOutputFile = resolve(output_dir, "raw-output.txt");
      await writeFile(rawOutputFile, `=== STDOUT ===\n${stdout}\n=== STDERR ===\n${stderr}`, "utf-8");

      if (exitCode !== 0) {
        throw new Error(
          `Command exited with code ${exitCode}.\n` +
          `Command: ${resolvedCommand}\n` +
          `Stderr: ${stderr.slice(0, 500)}`,
        );
      }

      // Try to parse JSON from stdout
      const finalAnswer = parseAgentAnswer(stdout, case_.id, condition, output_dir);
      const duration_ms = Date.now() - startTime;

      return {
        final_answer: finalAnswer,
        raw_output: stdout,
        duration_ms,
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
    const proc = spawn("sh", ["-c", command], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      reject(new Error(`Command failed to start: ${err.message}`));
    });

    // Write prompt to stdin
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

// ── Answer Parsing ─────────────────────────────────────────────────────────

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
      `Expected a JSON object with "task_id" field.\n` +
      `Output (first 500 chars): ${stdout.slice(0, 500)}`,
    );
  }

  const result = tryParseJson(jsonMatch[0], taskId, condition);
  if (result) return result;

  throw new Error(
    `Found JSON-like content but failed to parse.\n` +
    `Content (first 500 chars): ${jsonMatch[0].slice(0, 500)}`,
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
