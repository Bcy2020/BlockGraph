/**
 * BlockGraph MCP v0.2.5 — Report Generator
 * Produces JSON and Markdown reports from benchmark run data.
 * PRD §17: report format requirements.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BenchmarkRun, BenchmarkCaseRun, GraphCondition } from "./schema.js";

/**
 * Write run.json and report.md to the output directory.
 */
export async function writeReports(
  run: BenchmarkRun,
  outputDir: string,
): Promise<void> {
  // Write run.json
  await writeFile(
    resolve(outputDir, "run.json"),
    JSON.stringify(run, null, 2),
  );

  // Write report.md
  const report = buildMarkdownReport(run);
  await writeFile(resolve(outputDir, "report.md"), report);
}

// ── Markdown Report ────────────────────────────────────────────────────────

function buildMarkdownReport(run: BenchmarkRun): string {
  const lines: string[] = [];

  lines.push("# BlockGraph Benchmark Report");
  lines.push("");
  lines.push(`**Run ID:** ${run.id}`);
  lines.push(`**Created:** ${run.created_at}`);
  lines.push(`**Benchmark Version:** ${run.benchmark_version}`);
  lines.push(`**Adapter:** ${run.adapter}`);
  if (run.model) lines.push(`**Model:** ${run.model}`);
  if (run.git_sha) lines.push(`**Git SHA:** ${run.git_sha}`);
  lines.push("");

  // ── Aggregate ──────────────────────────────────────────────────────────
  lines.push("## Aggregate Scores");
  lines.push("");
  lines.push(`**Overall Score:** ${run.aggregate.overall}`);
  lines.push(`**Cases:** ${run.aggregate.case_count} (${run.aggregate.failed_count} failed)`);
  lines.push("");

  // ── Condition Comparison Table ─────────────────────────────────────────
  const conditions = Object.keys(run.aggregate.by_condition) as GraphCondition[];
  if (conditions.length > 0) {
    lines.push("### Score by Condition");
    lines.push("");
    lines.push("| Condition | Overall | File F1 | Entity F1 | Block F1 | Flow Order | Evidence | Duration |");
    lines.push("|-----------|---------|---------|-----------|----------|------------|----------|----------|");

    for (const cond of conditions) {
      const condRuns = run.cases.filter((c) => c.condition === cond && c.score);
      if (condRuns.length === 0) continue;

      const avgScore = run.aggregate.by_condition[cond];
      const avgFileF1 = avg(condRuns.map((c) => c.score!.accuracy.file_f1));
      const avgEntityF1 = avg(condRuns.map((c) => c.score!.accuracy.entity_f1));
      const avgBlockF1 = avg(condRuns.map((c) => c.score!.accuracy.block_f1));
      const avgFlow = avg(condRuns.map((c) => c.score!.accuracy.flow_order_score));
      const avgEvidence = avg(condRuns.map((c) => c.score!.evidence_score));
      const avgDuration = avg(condRuns.map((c) => c.duration_ms));

      lines.push(
        `| ${cond} | ${fmt(avgScore)} | ${fmt(avgFileF1)} | ${fmt(avgEntityF1)} | ${fmt(avgBlockF1)} | ${fmt(avgFlow)} | ${fmt(avgEvidence)} | ${Math.round(avgDuration)}ms |`,
      );
    }
    lines.push("");
  }

  // ── Per-Case Table ─────────────────────────────────────────────────────
  lines.push("## Per-Case Results");
  lines.push("");
  lines.push("| Case | Condition | Overall | File F1 | Entity F1 | Block F1 | Top-1 File | Top-3 File | Evidence | Status |");
  lines.push("|------|-----------|---------|---------|-----------|----------|------------|------------|----------|--------|");

  for (const cr of run.cases) {
    if (cr.error) {
      lines.push(`| ${cr.case_id} | ${cr.condition} | — | — | — | — | — | — | — | ❌ ${truncate(cr.error, 30)} |`);
    } else if (cr.score) {
      const s = cr.score;
      lines.push(
        `| ${cr.case_id} | ${cr.condition} | ${fmt(s.overall_score)} | ${fmt(s.accuracy.file_f1)} | ${fmt(s.accuracy.entity_f1)} | ${fmt(s.accuracy.block_f1)} | ${fmt(s.accuracy.top1_file_hit)} | ${fmt(s.accuracy.top3_file_hit)} | ${fmt(s.evidence_score)} | ✅ |`,
      );
    }
  }
  lines.push("");

  // ── Top-K Hit Rates ────────────────────────────────────────────────────
  const scoredRuns = run.cases.filter((c) => c.score);
  if (scoredRuns.length > 0) {
    lines.push("## Top-K Hit Rates");
    lines.push("");
    lines.push("| Metric | Average |");
    lines.push("|--------|---------|");
    lines.push(`| Top-1 File Hit | ${fmt(avg(scoredRuns.map((c) => c.score!.accuracy.top1_file_hit)))} |`);
    lines.push(`| Top-3 File Hit | ${fmt(avg(scoredRuns.map((c) => c.score!.accuracy.top3_file_hit)))} |`);
    lines.push(`| Top-5 File Hit | ${fmt(avg(scoredRuns.map((c) => c.score!.accuracy.top5_file_hit)))} |`);
    lines.push(`| Top-1 Entity Hit | ${fmt(avg(scoredRuns.map((c) => c.score!.accuracy.top1_entity_hit)))} |`);
    lines.push(`| Top-3 Entity Hit | ${fmt(avg(scoredRuns.map((c) => c.score!.accuracy.top3_entity_hit)))} |`);
    lines.push("");
  }

  // ── Evidence Validity ──────────────────────────────────────────────────
  if (scoredRuns.length > 0) {
    lines.push("## Evidence Validity");
    lines.push("");
    lines.push("| Metric | Average |");
    lines.push("|--------|---------|");
    lines.push(`| File Exists Rate | ${fmt(avg(scoredRuns.map((c) => c.score!.evidence.evidence_file_exists_rate)))} |`);
    lines.push(`| Line Valid Rate | ${fmt(avg(scoredRuns.map((c) => c.score!.evidence.evidence_line_valid_rate)))} |`);
    lines.push(`| Entity Valid Rate | ${fmt(avg(scoredRuns.map((c) => c.score!.evidence.evidence_entity_valid_rate)))} |`);
    lines.push(`| Unsupported Claims | ${avg(scoredRuns.map((c) => c.score!.evidence.unsupported_claim_count))} |`);
    lines.push("");
  }

  // ── Warnings ───────────────────────────────────────────────────────────
  const allWarnings = scoredRuns.flatMap((c) => c.score!.warnings);
  if (allWarnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of allWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  // ── Failed Cases ───────────────────────────────────────────────────────
  const failed = run.cases.filter((c) => c.error);
  if (failed.length > 0) {
    lines.push("## Failed Cases");
    lines.push("");
    for (const f of failed) {
      lines.push(`- **${f.case_id}** (${f.condition}): ${f.error}`);
    }
    lines.push("");
  }

  // ── Artifacts ──────────────────────────────────────────────────────────
  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- Run JSON: \`run.json\``);
  lines.push(`- Event Log: \`events.jsonl\``);
  for (const cr of run.cases) {
    lines.push(`- ${cr.case_id}/${cr.condition}: \`cases/${cr.case_id}/${cr.condition}/\``);
  }
  lines.push("");

  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmt(n: number): string {
  return (Math.round(n * 10000) / 10000).toString();
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}
