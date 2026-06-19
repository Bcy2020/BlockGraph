/**
 * BlockGraph MCP v0.2.5 — Benchmark CLI
 * Runs benchmark suites with configurable adapters and conditions.
 * PRD §16: CLI implementation.
 */
import { resolve } from "node:path";
import { runBenchmark } from "../src/benchmark/run.js";
import { createFixtureAdapter } from "../src/benchmark/adapters/fixture.js";
import { createFileAdapter } from "../src/benchmark/adapters/file.js";
import { createCommandAdapter } from "../src/benchmark/adapters/command.js";
import type { GraphCondition, AgentAdapter } from "../src/benchmark/schema.js";

// ── Argument Parsing ───────────────────────────────────────────────────────

interface CliArgs {
  suite: string;
  caseIds?: string[];
  conditions?: GraphCondition[];
  adapter: string;
  profile: string;
  answersDir?: string;
  command?: string;
  outputDir?: string;
  timeoutMs: number;
  model?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    suite: "access-accuracy",
    adapter: "fixture",
    profile: "perfect",
    timeoutMs: 600000,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
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
BlockGraph Benchmark CLI v0.2.5

Usage: pnpm benchmark [options]

Options:
  --suite <name>          Benchmark suite (default: access-accuracy)
  --case <id>             Run specific case (can repeat)
  --conditions <list>     Comma-separated conditions (default: all 5)
  --adapter <type>        Adapter: fixture, file, command (default: fixture)
  --profile <name>        Fixture profile: perfect, weak, wrong (default: perfect)
  --answers-dir <path>    Directory for file adapter answers
  --command <cmd>         Command for command adapter
  --output-dir <path>     Output directory (default: benchmarks/runs/<timestamp>)
  --timeout-ms <ms>       Timeout per case (default: 600000)
  --model <name>          Model name for reporting
  --dry-run               Load cases and build prompts without executing
  -h, --help              Show this help

Examples:
  pnpm benchmark --suite access-accuracy --adapter fixture --profile perfect
  pnpm benchmark --adapter fixture --profile weak --conditions no_graph
  pnpm benchmark --case fixture-login-flow --adapter fixture --profile perfect
  pnpm benchmark --dry-run --conditions no_graph,block_graph_with_flows
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

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = args.outputDir ?? resolve("benchmarks", "runs", timestamp);

  const adapter = createAdapter(args);

  console.log(`BlockGraph Benchmark v0.2.5`);
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

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
