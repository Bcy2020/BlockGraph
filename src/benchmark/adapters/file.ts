/**
 * BlockGraph MCP v0.2.5 — File Adapter
 * Reads agent answers from a user-provided directory.
 * Allows scoring previously saved agent answers without re-running the agent.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentFinalAnswerSchema, type AgentFinalAnswer } from "../schema.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

export interface FileAdapterOptions {
  answersDir: string;
}

export function createFileAdapter(options: FileAdapterOptions): AgentAdapter {
  const { answersDir } = options;

  return {
    name: "file",
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const startTime = Date.now();

      // Try multiple filename patterns
      const patterns = [
        `${input.case.id}.${input.condition}.json`,
        `${input.case.id}.json`,
      ];

      let raw: string | null = null;
      let usedFile: string | null = null;

      for (const pattern of patterns) {
        const filepath = resolve(answersDir, pattern);
        try {
          raw = await readFile(filepath, "utf-8");
          usedFile = filepath;
          break;
        } catch {
          // try next pattern
        }
      }

      if (raw === null || usedFile === null) {
        throw new Error(
          `Answer file not found in ${answersDir} for case ${input.case.id}.\n` +
          `Tried: ${patterns.map((p) => resolve(answersDir, p)).join(", ")}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid JSON in answer file: ${usedFile}`);
      }

      const result = AgentFinalAnswerSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Invalid answer schema in ${usedFile}: ${issues}`);
      }

      const finalAnswer: AgentFinalAnswer = result.data;
      const duration_ms = Date.now() - startTime;

      return {
        final_answer: finalAnswer,
        raw_output: parsed,
        duration_ms,
      };
    },
  };
}
