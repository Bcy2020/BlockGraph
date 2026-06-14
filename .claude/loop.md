# BlockGraph Watchdog — Loop Instructions

> This file defines the /loop watchdog for BlockGraph MCP.
> The **goal** is the primary execution mechanism (driven by user prompt).
> The **loop** is a monitoring mechanism only — it audits, never substitutes.

## Watchdog Behavior

On each iteration, perform these checks in order:

### 1. Scope Check

Read CLAUDE.md §v0.1 Non-Goals. Confirm current work does NOT include:
- Multi-language support beyond TS/JS
- Visual graph UI
- Runtime tracing / Playwright / OpenTelemetry
- Neo4j or external graph databases
- Automatic perfect module decomposition
- Automatic business-code modification
- Full architecture-first feature-change protocol
- Complex refactor support
- Distributed storage or server authentication

If scope drift is detected:
- Emit a concise warning with exact files or changes involved.
- Give a concrete remediation that returns work to the current PRD phase.
- Do not modify code or start a new phase.
- Do not require user input unless remediation would discard user work or change the PRD.

### 2. Phase Check

Read HOT.md. Confirm:
- Current phase is explicitly recorded.
- Current phase is strictly sequential (no skipping).
- If HOT.md says "Phase N complete", verify that Phase N deliverables actually exist on disk.

If phase state is inconsistent:
- Emit a concise warning describing the mismatch.
- State the exact HOT.md or implementation correction required.
- Do not begin a new phase.

### 3. Test Check

If HOT.md claims a phase is complete:
- Run `pnpm test` (or the relevant test command for that phase).
- Confirm all tests pass.
- If tests fail, report the failing command and the shortest useful failure summary.
- Recommend continuing within the current phase until tests pass.
- Do not require user input unless the same external blocker is recorded on three consecutive audits.

If no phase is claimed complete, skip this check.

### 4. HOT.md Freshness Check

After any code change:
- Confirm HOT.md has been updated to reflect the current state.
- Specifically: completed items, current goal, blockers, verification commands run.
- If HOT.md is stale, report the exact section that needs correction.
- Do not edit HOT.md concurrently with the primary goal agent.

## Loop Constraints

- The loop MUST NOT begin new phases or write code autonomously.
- The loop MUST NOT modify CLAUDE.md or PRD.
- The loop MUST NOT modify HOT.md while the primary goal is active; this avoids concurrent edits.
- The loop MAY read any file for audit purposes.
- The loop SHOULD surface findings as concise, actionable warnings.
- The loop is advisory. The Stop hook and test suite are the enforcement mechanisms.
- A recoverable implementation or test failure is not a reason to ask the user. The primary goal agent should fix it within the current phase.
- Ask for user input only for an external blocker, a requested PRD change, or an operation that would discard existing work.

## Restore Protocol

After context compaction or resume:
1. Read `CLAUDE.md`.
2. Read `HOT.md`.
3. Read `docs/blockgraph-mcp-v0.1-prd.md`.
4. Resume only from the current phase and next step recorded in `HOT.md`.

If the loop or stop hook is missing or corrupted:
1. Re-read this file (`.claude/loop.md`).
2. Re-read `.claude/settings.json` — confirm `hooks.Stop` entry exists.
3. If either file is missing, recreate from this description and CLAUDE.md rules.
4. Record restoration in HOT.md.
