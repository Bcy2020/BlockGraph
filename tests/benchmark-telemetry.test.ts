/**
 * Tests for benchmark telemetry parsing.
 * PRD Phase 2: Trace Capture And Trusted Telemetry.
 */
import { describe, it, expect } from "vitest";
import {
  parseTraceContent,
  extractSelfReportTelemetry,
  type TelemetryData,
} from "../src/benchmark/telemetry.js";

describe("Telemetry Parser", () => {
  describe("parseTraceContent", () => {
    it("parses empty content as absent", () => {
      const result = parseTraceContent("");
      expect(result.quality).toBe("absent");
      expect(result.total_tool_calls).toBe(0);
      expect(result.source).toBe("none");
    });

    it("parses Claude Code stream-json format", () => {
      const trace = [
        JSON.stringify({
          type: "tool_use",
          tool: { name: "Read", input: { file_path: "src/foo.ts" } },
        }),
        JSON.stringify({
          type: "tool_use",
          tool: { name: "Grep", input: { pattern: "TODO" } },
        }),
        JSON.stringify({
          type: "tool_use",
          tool: { name: "mcp__blockgraph__query_block", input: { block_id: "auth" } },
        }),
        JSON.stringify({
          type: "tool_use",
          tool: { name: "mcp__blockgraph__list_code_entities", input: {} },
        }),
      ].join("\n");

      const result = parseTraceContent(trace);

      expect(result.quality).toBe("full");
      expect(result.total_tool_calls).toBe(4);
      expect(result.mcp_tool_calls).toBe(2);
      expect(result.used_blockgraph_mcp).toBe(true);
      expect(result.blockgraph_tool_calls).toEqual({
        query_block: 1,
        list_code_entities: 1,
      });
      expect(result.tool_calls_by_name).toEqual({
        Read: 1,
        Grep: 1,
        "mcp__blockgraph__query_block": 1,
        "mcp__blockgraph__list_code_entities": 1,
      });
    });

    it("handles partial/invalid JSON lines", () => {
      const trace = [
        JSON.stringify({ type: "tool_use", tool: { name: "Read" } }),
        "this is not json",
        JSON.stringify({ type: "tool_use", tool: { name: "Grep" } }),
      ].join("\n");

      const result = parseTraceContent(trace);

      expect(result.quality).toBe("partial");
      expect(result.total_tool_calls).toBe(2);
      expect(result.parse_errors.length).toBe(1);
    });

    it("counts file reads and unique files", () => {
      const trace = [
        JSON.stringify({
          type: "tool_use",
          tool: { name: "Read", input: { file_path: "src/foo.ts" } },
        }),
        JSON.stringify({
          type: "tool_use",
          tool: { name: "Read", input: { file_path: "src/bar.ts" } },
        }),
        JSON.stringify({
          type: "tool_use",
          tool: { name: "Read", input: { file_path: "src/foo.ts" } },
        }),
      ].join("\n");

      const result = parseTraceContent(trace);

      expect(result.file_reads).toBe(3);
      expect(result.unique_files_read).toContain("src/foo.ts");
      expect(result.unique_files_read).toContain("src/bar.ts");
      expect(result.unique_files_read.length).toBe(2);
    });

    it("identifies MCP tools by prefix", () => {
      const trace = [
        JSON.stringify({
          type: "tool_use",
          tool: { name: "mcp__blockgraph__create_block" },
        }),
        JSON.stringify({
          type: "tool_use",
          tool: { name: "mcp__github__search_code" },
        }),
      ].join("\n");

      const result = parseTraceContent(trace);

      expect(result.mcp_tool_calls).toBe(2);
      expect(result.used_blockgraph_mcp).toBe(true);
    });

    it("returns source as trace when events parsed", () => {
      const trace = JSON.stringify({
        type: "tool_use",
        tool: { name: "Read" },
      });

      const result = parseTraceContent(trace);

      expect(result.source).toBe("trace");
    });
  });

  describe("extractSelfReportTelemetry", () => {
    it("returns absent when no tools provided", () => {
      const result = extractSelfReportTelemetry(undefined);
      expect(result.quality).toBe("absent");
      expect(result.source).toBe("none");
    });

    it("extracts from used_tools array", () => {
      const usedTools = [
        { tool_name: "Read", count: 5 },
        { tool_name: "mcp__blockgraph__query_block", count: 3 },
        { tool_name: "Grep", count: 2 },
      ];

      const result = extractSelfReportTelemetry(usedTools);

      expect(result.quality).toBe("partial");
      expect(result.source).toBe("self_report");
      expect(result.total_tool_calls).toBe(10);
      expect(result.mcp_tool_calls).toBe(3);
      expect(result.used_blockgraph_mcp).toBe(true);
      expect(result.blockgraph_tool_calls).toEqual({ query_block: 3 });
    });

    it("marks as partial (self-reported)", () => {
      const result = extractSelfReportTelemetry([
        { tool_name: "Read", count: 1 },
      ]);

      expect(result.quality).toBe("partial");
      expect(result.parse_errors).toContain(
        "Self-reported telemetry - may be incomplete",
      );
    });
  });
});
