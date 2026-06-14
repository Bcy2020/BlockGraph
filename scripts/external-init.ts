#!/usr/bin/env tsx
/**
 * BlockGraph MCP v0.1 — External Repository Smoke Test
 * PRD §13.4: Clones a public repo at a fixed SHA and runs the initialization pipeline.
 *
 * Usage:
 *   pnpm test:external-init --repo <repo_url> --ref <commit_sha>
 *
 * Default (documented target):
 *   pnpm test:external-init
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createToolContext, handleBeginInitialization, handleScanRepo, handleListCodeEntities, handleSuggestBlockCandidates, handleCreateBlock, handleAttachCodeEntity, handleCreateFlow, handleAppendFlowStep, handleCompileDraftBlock, handlePromoteDraftBlock, handleCompileDraftGraph, handleCommitSnapshot } from "../src/mcp/tools.js";
import type { ToolContext } from "../src/mcp/tools.js";

// ── Parse args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// Default target: a small, well-known TypeScript project
const DEFAULT_REPO = "https://github.com/sindresorhus/is.git";
const DEFAULT_REF = "v6.0.0";

const repoUrl = getArg("--repo") ?? DEFAULT_REPO;
const ref = getArg("--ref") ?? DEFAULT_REF;

console.log(`\n=== BlockGraph External Init Smoke Test ===`);
console.log(`Repository: ${repoUrl}`);
console.log(`Ref: ${ref}\n`);

// ── Clone ──────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-ext-"));
const cloneDir = path.join(tmpDir, "repo");

console.log(`Cloning to ${cloneDir}...`);
try {
  execSync(`git clone --depth 1 ${repoUrl} ${cloneDir}`, { stdio: "pipe" });
} catch (err) {
  console.error("Failed to clone repository:", err);
  process.exit(1);
}

console.log(`Checking out ${ref}...`);
try {
  // For shallow clones, we may need to fetch the specific ref
  try {
    execSync(`git fetch origin ${ref}`, { cwd: cloneDir, stdio: "pipe" });
  } catch {
    // If fetch fails, the ref might already be checked out (shallow clone default)
  }
  try {
    execSync(`git checkout ${ref}`, { cwd: cloneDir, stdio: "pipe" });
  } catch {
    // If checkout fails, try resetting to the ref
    try {
      execSync(`git reset --hard ${ref}`, { cwd: cloneDir, stdio: "pipe" });
    } catch {
      console.log("Warning: Could not checkout exact ref, using HEAD");
    }
  }
} catch (err) {
  console.error("Failed to checkout ref:", err);
  process.exit(1);
}

// ── Run initialization pipeline ────────────────────────────────────────────

const ctx: ToolContext = { db: null, repoPath: null };
let exitCode = 0;

try {
  // Step 1: Begin initialization
  console.log("\n1. begin_initialization...");
  const initResult = handleBeginInitialization(ctx, { repo_path: cloneDir });
  if (!initResult.ok) {
    console.error("FAIL: begin_initialization", initResult.errors);
    process.exit(1);
  }
  console.log("   OK");

  // Step 2: Scan repo
  console.log("2. scan_repo...");
  const scanResult = handleScanRepo(ctx, { repo_path: cloneDir });
  if (!scanResult.ok) {
    console.error("FAIL: scan_repo", scanResult.errors);
    process.exit(1);
  }
  console.log(`   Scanned: ${scanResult.data!.entity_count} entities, ${scanResult.data!.edge_count} edges, ${scanResult.data!.unsupported_file_count} unsupported`);

  // Step 3: List entities
  console.log("3. list_code_entities...");
  const entitiesResult = handleListCodeEntities(ctx, {});
  if (!entitiesResult.ok) {
    console.error("FAIL: list_code_entities", entitiesResult.errors);
    process.exit(1);
  }
  console.log(`   Found ${entitiesResult.data!.entities.length} entities`);

  // Step 4: Suggest block candidates
  console.log("4. suggest_block_candidates...");
  const candidatesResult = handleSuggestBlockCandidates(ctx, { strategy: "mixed" });
  if (!candidatesResult.ok) {
    console.error("FAIL: suggest_block_candidates", candidatesResult.errors);
    process.exit(1);
  }
  const candidates = candidatesResult.data!.candidates;
  console.log(`   Suggested ${candidates.length} candidate blocks`);

  // Step 5: Create root block
  console.log("5. Creating root block...");
  const rootBlock = handleCreateBlock(ctx, {
    name: path.basename(cloneDir),
    purpose: `Architecture model for ${path.basename(cloneDir)}`,
  });
  if (!rootBlock.ok) {
    console.error("FAIL: create_block (root)", rootBlock.errors);
    process.exit(1);
  }
  console.log(`   Root block: ${rootBlock.data!.block_id}`);

  // Step 6: Create blocks from candidates (up to 5)
  const blocksToCreate = candidates.slice(0, 5);
  const blockIds: string[] = [];

  for (const candidate of blocksToCreate) {
    console.log(`6. Creating block "${candidate.name}"...`);
    const blockResult = handleCreateBlock(ctx, {
      name: candidate.name,
      purpose: candidate.reason,
      parent_id: rootBlock.data!.block_id,
    });
    if (!blockResult.ok) {
      console.error(`   WARN: Could not create block "${candidate.name}":`, blockResult.errors);
      continue;
    }
    blockIds.push(blockResult.data!.block_id);

    // Attach code entities to the block
    let attached = 0;
    for (const entityId of candidate.code_entity_ids.slice(0, 10)) {
      const attachResult = handleAttachCodeEntity(ctx, {
        block_id: blockResult.data!.block_id,
        code_entity_id: entityId,
        role: "owns",
      });
      if (attachResult.ok) attached++;
    }
    console.log(`   Block ${blockResult.data!.block_id}: attached ${attached} entities`);
  }

  // Step 7: Create a flow if we have entities
  if (entitiesResult.data!.entities.length > 0) {
    const entryEntity = entitiesResult.data!.entities.find((e) => e.type === "function" || e.type === "component") ?? entitiesResult.data!.entities[0];
    console.log(`7. Creating flow with entrypoint "${entryEntity.name}"...`);
    const flowResult = handleCreateFlow(ctx, {
      name: `Main ${entryEntity.name} Flow`,
      entrypoint_entity_id: entryEntity.id,
    });
    if (flowResult.ok && blockIds.length > 0) {
      // Add a flow step for each block
      for (let i = 0; i < Math.min(blockIds.length, 3); i++) {
        const stepResult = handleAppendFlowStep(ctx, {
          flow_id: flowResult.data!.flow_id,
          block_id: blockIds[i],
          code_entity_id: entryEntity.id,
          trigger: "entry",
        });
        if (stepResult.ok) {
          console.log(`   Flow step ${stepResult.data!.order} added`);
        }
      }
    }
  }

  // Step 8: Compile each block
  console.log("\n8. Compiling blocks...");
  let compileErrors = 0;
  for (const blockId of blockIds) {
    const compileResult = handleCompileDraftBlock(ctx, { block_id: blockId });
    if (!compileResult.ok) {
      compileErrors++;
      console.error(`   Block ${blockId} has errors:`, compileResult.errors?.map((e) => e.code));
    }
  }
  console.log(`   ${blockIds.length - compileErrors}/${blockIds.length} blocks compiled OK`);

  // Step 9: Promote valid blocks
  console.log("9. Promoting blocks...");
  let promoted = 0;
  for (const blockId of blockIds) {
    const promoteResult = handlePromoteDraftBlock(ctx, { block_id: blockId });
    if (promoteResult.ok) promoted++;
  }
  console.log(`   ${promoted} blocks promoted`);

  // Step 10: Compile graph
  console.log("10. Compiling graph...");
  const graphResult = handleCompileDraftGraph(ctx, {});
  if (!graphResult.ok) {
    console.error("   Graph has errors:", graphResult.errors?.map((e) => e.code));
    exitCode = 1;
  } else {
    console.log("   Graph compiles OK");
    if (graphResult.warnings && graphResult.warnings.length > 0) {
      console.log(`   ${graphResult.warnings.length} warning(s)`);
    }

    // Step 11: Commit snapshot
    console.log("11. Committing snapshot...");
    const headSha = execSync("git rev-parse HEAD", { cwd: cloneDir, encoding: "utf8" }).trim();
    const snapshotResult = handleCommitSnapshot(ctx, { git_sha: headSha });
    if (!snapshotResult.ok) {
      console.error("   FAIL: commit_snapshot", snapshotResult.errors);
      exitCode = 1;
    } else {
      console.log(`   Snapshot committed: ${snapshotResult.data!.snapshot_id}`);
    }
  }

  console.log("\n=== Result ===");
  if (exitCode === 0) {
    console.log("PASS: External repository smoke test completed successfully.");
  } else {
    console.log("FAIL: External repository smoke test had errors.");
  }
} catch (err) {
  console.error("Unexpected error:", err);
  exitCode = 1;
} finally {
  // Cleanup
  if (ctx.db) {
    ctx.db.close();
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

process.exit(exitCode);
