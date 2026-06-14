#!/usr/bin/env tsx
/**
 * BlockGraph MCP v0.2 — Smoke Test Script
 * Runs the v0.2 initialization workflow against the complex fixture.
 * Can also run against a real repository when network is available.
 *
 * Usage:
 *   pnpm tsx scripts/v02-smoke-test.ts
 *   pnpm tsx scripts/v02-smoke-test.ts --repo <repo_url> --ref <commit_sha>
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { openStore, closeStore } from "../src/graph/store.js";
import {
  createCodeEntity,
  createCodeEdge,
  createWorkPackage,
  listWorkPackages,
  updateWorkPackageStatus,
  createModuleProposal,
  updateModuleProposalStatus,
  appendProposalEntity,
  createProposalReview,
  listCodeEntities,
  listCodeEdges,
  listBlocks,
  listBlockCodeMappings,
  listFlows,
  listMergedProposalMappings,
} from "../src/graph/draft.js";
import { scanRepo } from "../src/scanner/tsScanner.js";
import { compileDraftBlock, promoteDraftBlock, compileDraftGraph, commitSnapshot } from "../src/graph/compiler.js";

// ── Configuration ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPLEX_FIXTURE_PATH = path.resolve(__dirname, "../fixtures/ts-react-complex");

// ── Helpers ────────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[v0.2-smoke] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[v0.2-smoke] ERROR: ${msg}`);
}

function logSuccess(msg: string): void {
  console.log(`[v0.2-smoke] ✓ ${msg}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let repoPath = COMPLEX_FIXTURE_PATH;

  // Parse --repo and --ref arguments
  const repoIndex = args.indexOf("--repo");
  const refIndex = args.indexOf("--ref");

  if (repoIndex !== -1 && args[repoIndex + 1]) {
    const repoUrl = args[repoIndex + 1];
    const ref = refIndex !== -1 ? args[refIndex + 1] : "main";

    log(`Cloning ${repoUrl} at ${ref}...`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-smoke-"));

    try {
      execSync(`git clone --depth 1 ${repoUrl} ${tmpDir}`, { stdio: "pipe" });
      if (ref !== "main") {
        execSync(`cd ${tmpDir} && git fetch --depth 1 origin ${ref} && git checkout ${ref}`, { stdio: "pipe" });
      }
      repoPath = tmpDir;
      log(`Cloned to ${tmpDir}`);
    } catch (err) {
      logError(`Failed to clone repository: ${err}`);
      log("Falling back to complex fixture...");
      repoPath = COMPLEX_FIXTURE_PATH;
    }
  }

  log(`Using repository: ${repoPath}`);

  // Create temp directory for database
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blockgraph-smoke-db-"));
  const dbPath = path.join(tmpDir, ".blockgraph");

  try {
    // Step 1: Initialize
    log("Step 1: Initializing...");
    const db = openStore(tmpDir);
    logSuccess("Database initialized");

    // Step 2: Scan repository
    log("Step 2: Scanning repository...");
    const scanResult = scanRepo(repoPath);

    // Persist entities
    for (const entity of scanResult.entities) {
      const existing = db.prepare("SELECT id FROM code_entities WHERE id = ?").get(entity.id) as { id: string } | undefined;
      if (existing) continue;
      createCodeEntity(db, {
        type: entity.type,
        name: entity.name,
        file_path: entity.file_path,
        start_line: entity.start_line,
        end_line: entity.end_line,
        metadata: entity.metadata,
      }, entity.id);
    }

    // Persist edges
    for (const edge of scanResult.edges) {
      const existing = db.prepare("SELECT id FROM code_edges WHERE id = ?").get(edge.id) as { id: string } | undefined;
      if (existing) continue;
      if (edge.target_entity_id) {
        const targetExists = db.prepare("SELECT id FROM code_entities WHERE id = ?").get(edge.target_entity_id) as { id: string } | undefined;
        if (!targetExists) continue;
      }
      createCodeEdge(db, {
        type: edge.type,
        source_entity_id: edge.source_entity_id,
        target_entity_id: edge.target_entity_id,
        confidence: edge.confidence,
        evidence: edge.evidence,
      }, edge.id);
    }

    logSuccess(`Scanned ${scanResult.entities.length} entities, ${scanResult.edges.length} edges`);

    // Step 3: Create work packages
    log("Step 3: Creating work packages...");

    const featureDirs = new Set<string>();
    const sharedDirs = new Set<string>();

    for (const entity of scanResult.entities) {
      if (entity.type === "file") continue;
      const parts = entity.file_path.split("/");
      if (parts[0] === "src" && parts.length >= 3) {
        if (parts[1] === "features" && parts.length >= 3) {
          featureDirs.add(`src/features/${parts[2]}`);
        } else if (["types", "utils", "hooks", "lib", "config"].includes(parts[1])) {
          sharedDirs.add(`src/${parts[1]}`);
        }
      }
    }

    // Create feature packages
    const featurePackages: Array<{ id: string; name: string; scope: string }> = [];
    for (const dir of featureDirs) {
      const name = dir.split("/").pop()!;
      const id = `wp-${name}`;
      featurePackages.push({ id, name, scope: `${dir}/**` });
      createWorkPackage(db, {
        id,
        name: `${name.charAt(0).toUpperCase() + name.slice(1)} Feature`,
        type: "feature",
        scope_paths: [`${dir}/**`],
        allowed_external_refs: ["src/lib/**", "src/types/**", "src/hooks/**", "src/components/ui/**", "src/utils/**", "src/config/**"],
      });
    }

    // Create shared packages
    const sharedPackages: Array<{ id: string; name: string; scope: string }> = [];
    for (const dir of sharedDirs) {
      const name = dir.split("/").pop()!;
      const id = `wp-shared-${name}`;
      sharedPackages.push({ id, name, scope: `${dir}/**` });
      createWorkPackage(db, {
        id,
        name: `Shared ${name.charAt(0).toUpperCase() + name.slice(1)}`,
        type: "shared",
        scope_paths: [`${dir}/**`],
      });
    }

    const allPackages = [...featurePackages, ...sharedPackages];
    logSuccess(`Created ${allPackages.length} work packages`);

    // Step 4: Create proposals
    log("Step 4: Creating module proposals...");

    for (const pkg of allPackages) {
      createModuleProposal(db, {
        id: `prop-${pkg.id}`,
        work_package_id: pkg.id,
        module_name: pkg.name,
        purpose: `${pkg.name} module`,
      });

      // Attach entities
      const entities = listCodeEntities(db, {});
      const pkgEntities = entities.filter(e => e.file_path.startsWith(pkg.scope.replace("/**", "")));
      for (const entity of pkgEntities.slice(0, 5)) {
        appendProposalEntity(db, `prop-${pkg.id}`, "owned", {
          code_entity_id: entity.id,
          role: "owns",
          evidence: [],
          reason: `Part of ${pkg.name}`,
          confidence: 0.8,
        });
      }

      // Submit proposal
      updateModuleProposalStatus(db, `prop-${pkg.id}`, "submitted");
    }

    logSuccess(`Created ${allPackages.length} proposals`);

    // Step 5: Review proposals
    log("Step 5: Reviewing proposals...");

    for (const pkg of allPackages) {
      createProposalReview(db, {
        id: `review-${pkg.id}`,
        proposal_id: `prop-${pkg.id}`,
        reviewer_agent: "smoke-test",
        status: "pass",
        findings: [],
        coverage_notes: "Automated smoke test review",
      });

      // Approve proposal
      updateModuleProposalStatus(db, `prop-${pkg.id}`, "reviewing");
      updateModuleProposalStatus(db, `prop-${pkg.id}`, "approved");
    }

    logSuccess(`Reviewed and approved ${allPackages.length} proposals`);

    // Step 6: Merge proposals
    log("Step 6: Merging proposals...");

    for (const pkg of allPackages) {
      // Get approved proposal
      const proposal = db.prepare("SELECT * FROM module_proposals WHERE id = ?").get(`prop-${pkg.id}`) as any;
      if (!proposal) continue;

      // Create block
      const blockResult = db.prepare(
        "INSERT INTO blocks (id, name, purpose, status, confidence) VALUES (?, ?, ?, 'draft', ?)"
      ).run(`block-${pkg.id}`, proposal.module_name, proposal.purpose, proposal.confidence);

      // Attach entities
      const ownedEntities = JSON.parse(proposal.owned_code_entities);
      for (const entity of ownedEntities) {
        db.prepare(
          "INSERT INTO block_code_mappings (id, block_id, code_entity_id, role, evidence) VALUES (?, ?, ?, ?, ?)"
        ).run(`mapping-${pkg.id}-${entity.code_entity_id}`, `block-${pkg.id}`, entity.code_entity_id, entity.role, JSON.stringify(entity.evidence));
      }

      // Record merge mapping
      db.prepare(
        "INSERT INTO merged_proposal_mappings (id, proposal_id, work_package_id, block_id, merged_at) VALUES (?, ?, ?, ?, ?)"
      ).run(`merge-${pkg.id}`, `prop-${pkg.id}`, pkg.id, `block-${pkg.id}`, new Date().toISOString());

      // Update proposal status
      updateModuleProposalStatus(db, `prop-${pkg.id}`, "merged");
    }

    logSuccess(`Merged ${allPackages.length} proposals`);

    // Step 7: Compile and promote blocks
    log("Step 7: Compiling and promoting blocks...");

    const blocks = listBlocks(db);
    let promotedCount = 0;
    for (const block of blocks) {
      const result = compileDraftBlock(db, block.id);
      if (result.can_promote) {
        promoteDraftBlock(db, block.id);
        promotedCount++;
      } else {
        log(`Block ${block.name} has ${result.errors.length} errors, skipping promotion`);
      }
    }

    logSuccess(`Promoted ${promotedCount}/${blocks.length} blocks`);

    // Step 8: Compile graph
    log("Step 8: Compiling graph...");
    const graphResult = compileDraftGraph(db);
    logSuccess(`Graph compile: can_commit=${graphResult.can_commit}, errors=${graphResult.errors.length}, warnings=${graphResult.warnings.length}`);

    // Step 9: Run quality gates
    log("Step 9: Running quality gates...");

    const entities = listCodeEntities(db);
    const mappings = listBlockCodeMappings(db);
    const mappedIds = new Set(mappings.map(m => m.code_entity_id));
    const unmappedCount = entities.filter(e => e.type !== "file" && !mappedIds.has(e.id)).length;
    const coverage = entities.filter(e => e.type !== "file").length > 0
      ? (entities.filter(e => e.type !== "file").length - unmappedCount) / entities.filter(e => e.type !== "file").length
      : 1;

    log(`Coverage: ${(coverage * 100).toFixed(1)}%`);
    log(`Unmapped entities: ${unmappedCount}`);

    // Step 10: Commit snapshot
    if (graphResult.can_commit) {
      log("Step 10: Committing snapshot...");
      const snapshotResult = commitSnapshot(db, "smoke-test-sha");
      if (snapshotResult.ok) {
        logSuccess(`Snapshot committed: ${snapshotResult.snapshot_id}`);
      } else {
        logError(`Snapshot failed: ${snapshotResult.errors.map(e => e.message).join(", ")}`);
      }
    } else {
      log("Step 10: Skipping snapshot (graph has errors)");
    }

    // Summary
    log("\n=== Summary ===");
    log(`Entities: ${entities.length}`);
    log(`Edges: ${listCodeEdges(db).length}`);
    log(`Blocks: ${blocks.length}`);
    log(`Flows: ${listFlows(db).length}`);
    log(`Merged proposals: ${listMergedProposalMappings(db).length}`);
    log(`Coverage: ${(coverage * 100).toFixed(1)}%`);
    log(`Graph compile: ${graphResult.can_commit ? "PASS" : "FAIL"}`);

    closeStore(db);
    logSuccess("Smoke test completed successfully!");

  } catch (err) {
    logError(`Smoke test failed: ${err}`);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  logError(`Fatal: ${err}`);
  process.exit(1);
});
