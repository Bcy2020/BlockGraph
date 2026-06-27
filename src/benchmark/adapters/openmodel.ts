/**
 * BlockGraph MCP v0.2.7 — OpenModel API Adapter
 * Calls OpenModel API (POST /v1/messages) with Anthropic Messages format
 * for DeepSeek / Qwen / other models via the OpenModel gateway.
 *
 * Endpoint: POST https://api.openmodel.ai/v1/messages
 * Auth: Bearer om-<key>
 * Protocol: Anthropic Messages API (not Responses API — DeepSeek only supports /v1/messages)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentFinalAnswerSchema, type AgentFinalAnswer } from "../schema.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

export interface OpenModelAdapterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface OpenModelMessage {
  role: "user" | "assistant";
  content: string;
}

interface OpenModelResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{
    type: string;
    text?: string;
    thinking?: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export function createOpenModelAdapter(options: OpenModelAdapterOptions): AgentAdapter {
  const {
    apiKey,
    model,
    baseUrl = "https://api.openmodel.ai",
  } = options;

  const endpoint = `${baseUrl}/v1/messages`;

  return {
    name: `openmodel-${model}`,
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const startTime = Date.now();
      const { output_dir, prompt, case: case_, condition } = input;

      await mkdir(output_dir, { recursive: true });

      // Write prompt for audit
      await writeFile(resolve(output_dir, "prompt.txt"), prompt, "utf-8");

      // Build system + user messages
      // The prompt already contains task + rules + condition + schema,
      // so we put it as the user message and optionally add instructions as system
      const messages: OpenModelMessage[] = [
        {
          role: "user",
          content: prompt,
        },
      ];

      // Call OpenModel API
      const response = await callOpenModelApi(endpoint, apiKey, model, messages);

      // Extract text from response
      const textContent = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");

      // Write raw response for audit
      await writeFile(
        resolve(output_dir, "raw-output.txt"),
        JSON.stringify(response, null, 2),
        "utf-8",
      );

      // Parse the model's text response as JSON answer
      const finalAnswer = parseModelAnswer(textContent, case_.id, condition, output_dir);

      const duration_ms = Date.now() - startTime;

      return {
        final_answer: finalAnswer,
        raw_output: response,
        duration_ms,
        telemetry: {
          tool_calls: 0,
          read_calls: 0,
          grep_calls: 0,
          mcp_calls: condition === "block_graph_mcp" ? 1 : 0,
          unique_files_read: [],
        },
      };
    },
  };
}

// ── API Call ─────────────────────────────────────────────────────────────────

async function callOpenModelApi(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: OpenModelMessage[],
  maxTokens = 8192,
): Promise<OpenModelResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "(no body)");
      throw new Error(
        `OpenModel API error: ${res.status} ${res.statusText}\n` +
        `Body: ${errorBody.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as OpenModelResponse;

    if (data.type !== "message") {
      throw new Error(
        `Unexpected response type: ${(data as unknown as Record<string, unknown>).type ?? "unknown"}`,
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Answer Parsing ───────────────────────────────────────────────────────────

function parseModelAnswer(
  text: string,
  taskId: string,
  condition: string,
  outputDir: string,
): AgentFinalAnswer {
  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  // Try to find a JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*"task_id"[\s\S]*\}/) ?? jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Could not extract JSON answer from model output.\n` +
      `First 300 chars: ${text.slice(0, 300)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse model output as JSON: ${msg}\nFirst 500 chars: ${text.slice(0, 500)}`);
  }

  // Validate and fix
  const result = AgentFinalAnswerSchema.safeParse(parsed);
  if (result.success) return result.data;

  // Try to fix common issues
  const fixed = tryFixAnswer(parsed, taskId, condition);
  if (fixed) {
    const recheck = AgentFinalAnswerSchema.safeParse(fixed);
    if (recheck.success) return recheck.data;
  }

  // Report validation errors
  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `Model answer failed schema validation:\n${issues}\n` +
    `Keys present: ${Object.keys(parsed as object).join(", ")}`,
  );
}

function tryFixAnswer(
  parsed: unknown,
  taskId: string,
  condition: string,
): unknown {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = { ...(parsed as Record<string, unknown>) };

  if (!obj.task_id) obj.task_id = taskId;
  if (!obj.condition) obj.condition = condition;
  if (!obj.ranked_files) obj.ranked_files = [];
  if (!obj.ranked_entities) obj.ranked_entities = [];
  if (!obj.ranked_blocks) obj.ranked_blocks = [];
  if (!obj.evidence) obj.evidence = [];
  if (obj.confidence === undefined) obj.confidence = 0.5;
  if (obj.used_blockgraph === undefined) obj.used_blockgraph = condition !== "no_graph";
  if (!obj.answer) obj.answer = "";

  return obj;
}
