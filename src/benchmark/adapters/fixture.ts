/**
 * BlockGraph MCP v0.2.5 — Fixture Adapter
 * Reads predefined answers from fixture-answers/<profile>/<case_id>.<condition>.json.
 * Used for deterministic testing of the benchmark pipeline.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AgentFinalAnswerSchema, type AgentFinalAnswer } from "../schema.js";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "./types.js";

export interface FixtureAdapterOptions {
  profile: "perfect" | "weak" | "wrong";
  answersDir?: string; // defaults to benchmarks/<suite>/fixture-answers
}

export function createFixtureAdapter(options: FixtureAdapterOptions): AgentAdapter {
  const { profile, answersDir } = options;

  return {
    name: `fixture-${profile}`,
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      const startTime = Date.now();

      // Determine answers directory
      const suiteName = input.case.module;
      const baseDir = answersDir ?? resolve("benchmarks", suiteName, "fixture-answers");
      const filename = `${input.case.id}.${input.condition}.json`;
      const filepath = resolve(baseDir, profile, filename);

      // Read and parse the answer file
      let raw: string;
      try {
        raw = await readFile(filepath, "utf-8");
      } catch {
        throw new Error(
          `Fixture answer not found: ${filepath}\n` +
          `Expected: benchmarks/${suiteName}/fixture-answers/${profile}/${filename}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Invalid JSON in fixture answer: ${filepath}`);
      }

      const result = AgentFinalAnswerSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Invalid fixture answer schema in ${filepath}: ${issues}`);
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
