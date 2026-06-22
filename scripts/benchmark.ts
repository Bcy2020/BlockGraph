/**
 * BlockGraph MCP v0.2.6 — Benchmark CLI
 * Runs benchmark suites with configurable adapters and conditions.
 * v0.2.6: Added rescore subcommand, output-file mode support.
 */
import { resolve } from "node:path";
import { runBenchmark } from "../src/benchmark/run.js";
import { rescoreRun, checkArtifactConsistency } from "../src/benchmark/rescore.js";
import { compareRuns } from "../src/benchmark/compare.js";
import { createFixtureAdapter } from "../src/benchmark/adapters/fixture.js";
import { createFileAdapter } from "../src/benchmark/adapters/file.js";
import { createCommandAdapter } from "../src/benchmark/adapters/command.js";
import type { GraphCondition, AgentAdapter } from "../src/benchmark/schema.js";

// ── Argument Parsing ───────────────────────────────────────────────────────

interface CliArgs {
  subcommand: "run" | "rescore" | "check" | "compare";
  suite: string;
  caseIds?: string[];
  conditions?: GraphCondition[];
  adapter: string;
  profile: string;
  answersDir?: string;
  command?: string;
  outputDir?: string;
  runDir?: string;
  baselineDir?: string;
  candidateDir?: string;
  timeoutMs: number;
  model?: string;
  dryRun: boolean;
  failOnMismatch: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    subcommand: "run",
    suite: "access-accuracy",
    adapter: "fixture",
    profile: "perfect",
    timeoutMs: 600000,
    dryRun: false,
    failOnMismatch: true,
  };

  // Check for subcommand
  const firstArg = argv[2];
  if (firstArg === "rescore" || firstArg === "check" || firstArg === "compare") {
    args.subcommand = firstArg;
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "rescore":
      case "check":
      case "compare":
        args.subcommand = arg;
        break;
      case "--suite":
        args.suite = next!;
        i++;
        break;
      case "--case":
        args.caseIds = (args.caseIds ?? []).concat(next!);
        i++;
        break;
      case "--conditions":
        args.conditions = next!.split(",").map((s) => s.trim() as GraphCondition);
        i++;
        break;
      case "--adapter":
        args.adapter = next!;
        i++;
        break;
      case "--profile":
        args.profile = next!;
        i++;
        break;
      case "--answers-dir":
        args.answersDir = next!;
        i++;
        break;
      case "--command":
        args.command = next!;
        i++;
        break;
      case "--output-dir":
        args.outputDir = next!;
        i++;
        break;
      case "--run":
        args.runDir = next!;
        i++;
        break;
      case "--baseline":
        args.baselineDir = next!;
        i++;
        break;
      case "--candidate":
        args.candidateDir = next!;
        i++;
        break;
      case "--timeout-ms":
        args.timeoutMs = parseInt(next!, 10);
        i++;
        break;
      case "--model":
        args.model = next!;
        i++;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--no-fail-on-mismatch":
        args.failOnMismatch = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
BlockGraph Benchmark CLI v0.2.6

Usage: pnpm benchmark [subcommand] [options]

Subcommands:
  run                   Run a benchmark suite (default)
  rescore               Rescore an existing run
  check                 Check artifact consistency of a run
  compare               Compare two runs (baseline vs candidate)

Options:
  --suite <name>          Benchmark suite (default: access-accuracy)
  --case <id>             Run specific case (can repeat)
  --conditions <list>     Comma-separated conditions (default: all)
  --adapter <type>        Adapter: fixture, file, command (default: fixture)
  --profile <name>        Fixture profile: perfect, weak, wrong (default: perfect)
  --answers-dir <path>    Directory for file adapter answers
  --command <cmd>         Command for command adapter
  --output-dir <path>     Output directory (default: benchmarks/runs/<timestamp>)
  --run <dir>             Run directory (for rescore/check subcommands)
  --baseline <dir>        Baseline run directory (for compare subcommand)
  --candidate <dir>       Candidate run directory (for compare subcommand)
  --timeout-ms <ms>       Timeout per case (default: 600000)
  --model <name>          Model name for reporting
  --dry-run               Load cases and build prompts without executing
  --no-fail-on-mismatch   Don't fail on artifact consistency mismatch
  -h, --help              Show this help

Examples:
  pnpm benchmark --suite access-accuracy --adapter fixture --profile perfect
  pnpm benchmark --adapter fixture --profile weak --conditions no_graph
  pnpm benchmark --case fixture-login-flow --adapter fixture --profile perfect
  pnpm benchmark --dry-run --conditions no_graph,block_graph_with_flows
  pnpm benchmark rescore --run benchmarks/runs/2026-06-18T15-08-41
  pnpm benchmark check --run benchmarks/runs/2026-06-18T15-08-41
  pnpm benchmark compare --baseline benchmarks/runs/no_graph --candidate benchmarks/runs/mcp_assisted

Command adapter template variables:
  {repo}          Repository path
  {case_id}       Case ID
  {condition}     Graph condition
  {output_dir}    Output directory for this case
  {prompt_file}   Path to prompt.txt
  {answer_file}   Expected path to answer.json (write final answer here)
  {mcp_config}    MCP config path (if available)
`);
}

// ── Adapter Factory ────────────────────────────────────────────────────────

function createAdapter(args: CliArgs): AgentAdapter {
  switch (args.adapter) {
    case "fixture":
      return createFixtureAdapter({
        profile: args.profile as "perfect" | "weak" | "wrong",
      });
    case "file":
      if (!args.answersDir) {
        console.error("Error: --answers-dir is required for file adapter");
        process.exit(1);
      }
      return createFileAdapter({ answersDir: resolve(args.answersDir) });
    case "command":
      if (!args.command) {
        console.error("Error: --command is required for command adapter");
        process.exit(1);
      }
      return createCommandAdapter({ command: args.command });
    default:
      console.error(`Error: Unknown adapter: ${args.adapter}`);
      process.exit(1);
  }
}

// ── Subcommands ────────────────────────────────────────────────────────────

async function cmdRun(args: CliArgs) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = args.outputDir ?? resolve("benchmarks", "runs", timestamp);

  const adapter = createAdapter(args);

  console.log(`BlockGraph Benchmark v0.2.6`);
  console.log(`Suite: ${args.suite}`);
  console.log(`Adapter: ${adapter.name}`);
  console.log(`Conditions: ${args.conditions?.join(", ") ?? "all"}`);
  console.log(`Output: ${outputDir}`);
  if (args.dryRun) console.log(`Mode: DRY RUN`);
  console.log();

  const { run } = await runBenchmark({
    suite: args.suite,
    caseIds: args.caseIds,
    conditions: args.conditions,
    adapter,
    outputDir,
    timeoutMs: args.timeoutMs,
    model: args.model,
    dryRun: args.dryRun,
  });

  if (args.dryRun) {
    console.log(`Dry run complete. Plan written to ${outputDir}/plan.json`);
    return;
  }

  // Print summary
  console.log(`\nRun ${run.id} complete.`);
  console.log(`Cases: ${run.aggregate.case_count} (${run.aggregate.failed_count} failed)`);
  console.log(`Overall score: ${run.aggregate.overall}`);

  if (Object.keys(run.aggregate.by_condition).length > 0) {
    console.log(`\nScores by condition:`);
    for (const [cond, score] of Object.entries(run.aggregate.by_condition)) {
      console.log(`  ${cond}: ${score}`);
    }
  }

  console.log(`\nReport: ${outputDir}/report.md`);
}

async function cmdRescore(args: CliArgs) {
  if (!args.runDir) {
    console.error("Error: --run is required for rescore subcommand");
    console.error("Usage: pnpm benchmark rescore --run benchmarks/runs/<run-dir>");
    process.exit(1);
  }

  const runDir = resolve(args.runDir);
  console.log(`BlockGraph Benchmark v0.2.6 — Rescore`);
  console.log(`Run directory: ${runDir}`);
  console.log();

  const result = await rescoreRun({
    runDir,
    suite: args.suite,
    failOnMismatch: args.failOnMismatch,
  });

  console.log(`Rescore complete.`);
  console.log(`  Rescored: ${result.rescored}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  Mismatches before: ${result.mismatchesBefore.length}`);
  console.log(`  Mismatches after: ${result.mismatchesAfter.length}`);
  console.log(`  Overall score: ${result.run.aggregate.overall}`);

  if (Object.keys(result.run.aggregate.by_condition).length > 0) {
    console.log(`\nScores by condition:`);
    for (const [cond, score] of Object.entries(result.run.aggregate.by_condition)) {
      console.log(`  ${cond}: ${score}`);
    }
  }

  console.log(`\nReport: ${runDir}/report.md`);
}

async function cmdCheck(args: CliArgs) {
  if (!args.runDir) {
    console.error("Error: --run is required for check subcommand");
    console.error("Usage: pnpm benchmark check --run benchmarks/runs/<run-dir>");
    process.exit(1);
  }

  const runDir = resolve(args.runDir);
  console.log(`BlockGraph Benchmark v0.2.6 — Artifact Consistency Check`);
  console.log(`Run directory: ${runDir}`);
  console.log();

  const mismatches = await checkArtifactConsistency(runDir);

  if (mismatches.length === 0) {
    console.log(`✅ All artifacts consistent.`);
  } else {
    console.log(`❌ Found ${mismatches.length} mismatches:\n`);
    for (const m of mismatches) {
      console.log(`  ${m.case_id}/${m.condition}: ${m.field}`);
      console.log(`    run.json:  ${JSON.stringify(m.run_value)}`);
      console.log(`    score.json: ${JSON.stringify(m.score_value)}`);
    }
    process.exit(1);
  }
}

async function cmdCompare(args: CliArgs) {
  if (!args.baselineDir || !args.candidateDir) {
    console.error("Error: --baseline and --candidate are required for compare subcommand");
    console.error("Usage: pnpm benchmark compare --baseline <dir> --candidate <dir>");
    process.exit(1);
  }

  const baselineDir = resolve(args.baselineDir);
  const candidateDir = resolve(args.candidateDir);
  const outputDir = args.outputDir ?? resolve("benchmarks", "runs", "compare");

  console.log(`BlockGraph Benchmark v0.2.6 — Paired Comparison`);
  console.log(`Baseline: ${baselineDir}`);
  console.log(`Candidate: ${candidateDir}`);
  console.log();

  const result = await compareRuns({ baselineDir, candidateDir, outputDir });

  console.log(`Comparison complete.`);
  console.log(`  Baseline overall: ${result.baseline_overall}`);
  console.log(`  Candidate overall: ${result.candidate_overall}`);
  console.log(`  Delta: ${result.overall_delta > 0 ? "+" : ""}${result.overall_delta}`);
  console.log();
  console.log(`  Wins: ${result.win_count}`);
  console.log(`  Losses: ${result.loss_count}`);
  console.log(`  Ties: ${result.tie_count}`);
  console.log(`  Errors: ${result.error_count}`);

  if (result.top_failure_reasons.length > 0) {
    console.log(`\nTop failure reasons:`);
    for (const reason of result.top_failure_reasons) {
      console.log(`  - ${reason}`);
    }
  }

  console.log(`\nReport: ${outputDir}/compare.md`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  switch (args.subcommand) {
    case "run":
      await cmdRun(args);
      break;
    case "rescore":
      await cmdRescore(args);
      break;
    case "check":
      await cmdCheck(args);
      break;
    case "compare":
      await cmdCompare(args);
      break;
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
