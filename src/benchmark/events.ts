/**
 * BlockGraph MCP v0.2.5 — Event Logger
 * Writes JSONL event logs for benchmark runs.
 * PRD §11.5: event log format.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { BenchmarkEvent, BenchmarkEventType, GraphCondition } from "./schema.js";

export class EventLogger {
  private filePath: string;
  private runId: string;
  private buffer: BenchmarkEvent[] = [];

  constructor(outputDir: string, runId: string) {
    this.filePath = resolve(outputDir, "events.jsonl");
    this.runId = runId;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
  }

  log(
    type: BenchmarkEventType,
    data?: {
      case_id?: string;
      condition?: GraphCondition;
      data?: unknown;
    },
  ): BenchmarkEvent {
    const event: BenchmarkEvent = {
      ts: new Date().toISOString(),
      run_id: this.runId,
      type,
      case_id: data?.case_id,
      condition: data?.condition,
      data: data?.data,
    };
    this.buffer.push(event);
    return event;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(this.filePath, lines, "utf-8");
    this.buffer = [];
  }

  getEvents(): BenchmarkEvent[] {
    return [...this.buffer];
  }
}
