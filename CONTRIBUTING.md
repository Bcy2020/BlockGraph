# Contributing to BlockGraph MCP

This document defines the collaboration, implementation, review, and acceptance rules for BlockGraph MCP.

It applies to human contributors, coding agents, review agents, and maintainers.

## 1. Project Mental Model

BlockGraph MCP implements an architecture-first repository maintenance method. It is not a generic graph CRUD service, a Mermaid generator, or only a call graph.

The product maintains three related graph layers:

1. **Code Fact Graph**
   - Mechanical facts generated from source code.
   - Contains code entities and code edges.
   - Agents must not invent code facts when a scanner result should be authoritative.

2. **Block Graph**
   - Semantic decomposition into maintainable modules.
   - Contains blocks, ports, connectors, and code mappings.
   - It is a semantic projection over the Code Fact Graph, not free-floating documentation.

3. **Flow Graph**
   - Describes how an entrypoint activates blocks and code entities.
   - Each flow step must remain anchored to code evidence.

All semantic graph changes follow:

```text
draft -> compile -> promote -> snapshot
```

The accepted graph must not be edited directly. Snapshots are immutable and append-only.

## 2. Sources of Authority

When documents disagree, use this order:

1. The current versioned PRD in `docs/`
2. `CLAUDE.md`
3. This `CONTRIBUTING.md`
4. Public API contracts and tests
5. `HOT.md`

`HOT.md` records current progress. It does not redefine product requirements.

If a requirement remains ambiguous, record the ambiguity and ask a maintainer before making a difficult-to-reverse product decision.

## 3. Collaboration Roles

### Maintainer

The maintainer:

- defines product scope and version goals
- approves PRD changes
- resolves disputed architecture decisions
- decides whether compatibility breaks are acceptable
- accepts or rejects contributions

### Implementation Contributor

An implementation contributor may be a human or an agent. It:

- implements the assigned scope
- updates or adds tests
- runs required verification
- documents relevant decisions and limitations
- performs a self-review before requesting independent review

### Independent Reviewer

The reviewer must evaluate actual repository state rather than trusting summaries.

The reviewer:

- must not be the same agent instance that performed the implementation
- should begin with fresh context
- reads the PRD and project rules independently
- inspects implementation and tests
- runs verification commands
- reports findings before summaries
- does not silently repair findings during the review pass

After review, the implementation contributor fixes accepted findings. The reviewer may then verify the fixes.

## 4. One-Writer Rule

Only one contributor may actively edit a given worktree at a time.

Parallel agents may:

- research independent questions
- inspect code read-only
- design test cases
- perform an independent review
- validate an external repository

Parallel agents must not:

- edit the same worktree concurrently
- independently rewrite shared files
- update `HOT.md` while another agent is using it as the active progress log
- cross a phase boundary without the primary contributor coordinating the transition

Use separate branches or worktrees when parallel edits are necessary. The primary contributor remains responsible for integration and final verification.

## 5. Change Workflow

Every behavioral change should follow this sequence:

1. **Understand**
   - Read the relevant PRD, project rules, implementation, and tests.
   - Identify the current phase or release target.

2. **Scope**
   - State what will change.
   - State what will not change.
   - Identify affected graph layers, MCP tools, storage tables, and tests.

3. **Implement**
   - Follow existing architecture and naming.
   - Keep changes focused.
   - Do not introduce future-version features without approval.

4. **Verify**
   - Run focused tests during implementation.
   - Run the full required verification before declaring completion.

5. **Self-review**
   - Compare implementation against requirements.
   - Check error paths, persistence behavior, and public contracts.
   - Update documentation and progress records.

6. **Independent review**
   - A fresh reviewer evaluates the implementation using Section 10.

7. **Resolve findings**
   - Fix accepted findings.
   - Document rejected findings with a technical reason.
   - Rerun affected and full verification.

8. **Accept**
   - A maintainer confirms the acceptance criteria.

## 6. Architecture Requirements

Contributions must preserve these invariants:

- MCP tools are the primary product interface.
- Agents do not directly write graph JSON or SQLite records as the normal workflow.
- Code facts originate from scanners or other explicit fact providers.
- Semantic graph edits begin in draft state.
- Invalid drafts cannot be promoted.
- The accepted graph changes only through promotion.
- Invalid graphs cannot produce snapshots.
- Snapshots remain immutable and tied to a git SHA.
- Non-root semantic blocks require code mappings and valid evidence.
- Connectors and flow steps require evidence.
- Unknown boundaries are explicit; uncertainty must not be hidden.
- Tool responses remain structured and provide actionable diagnostics.

Any proposal to relax one of these invariants requires a PRD or architecture decision change before implementation.

## 7. Scope And Compatibility

For each contribution:

- follow the current version's stated goals and non-goals
- avoid unrelated refactors
- do not add dependencies without a concrete need
- preserve existing MCP tool names and response shapes unless a breaking change is approved
- add a migration or compatibility note for schema changes
- document new error codes and validation behavior

Changes to any of the following should begin with an issue or design discussion:

- graph semantics
- draft/accepted state transitions
- SQLite schema
- MCP tool input/output contracts
- snapshot format
- evidence rules
- scanner language support

## 8. Testing Requirements

At minimum, code changes must pass:

```bash
pnpm test
pnpm exec tsc --noEmit -p tsconfig.json
```

Behavioral changes must include tests for:

- the successful path
- invalid input
- missing references
- state-transition rejection where applicable
- persistence or retrieval where applicable
- structured diagnostic output

Scanner changes should include fixture-based tests.

Compiler changes should test both errors and warnings.

MCP tool changes should test handlers without requiring an interactive MCP client.

Initialization workflow changes should include an end-to-end test.

External repository tests must:

- use a documented public repository
- pin a commit SHA
- clone into a temporary directory
- avoid modifying the source repository
- clean up temporary state
- distinguish warnings from errors

Tests must not depend on mutable upstream branches or unpinned releases.

## 9. Contribution And Pull Request Requirements

A contribution should include:

- a concise statement of the problem
- the chosen solution
- important alternatives considered
- tests added or changed
- exact verification commands and results
- known limitations
- compatibility or migration impact

Before requesting review:

- ensure generated output and local databases are not committed
- ensure no secrets, credentials, or proxy settings are committed
- inspect `git diff`
- run the required verification
- update documentation when public behavior changes

Commit messages should describe the behavioral change, not the editing activity.

## 10. Independent Review Standard

An independent review is required before a milestone, release, or large behavioral change is considered complete.

### 10.1 Reviewer Inputs

The reviewer must read:

- the current PRD
- `CLAUDE.md`
- this document
- relevant source and test files
- the actual diff, when a baseline commit exists

The reviewer may read `HOT.md` for orientation, but must verify every relevant claim.

### 10.2 Required Review Areas

The reviewer must check:

1. **Requirement coverage**
   - Map implementation to each applicable PRD requirement and acceptance criterion.
   - Identify requirements that are missing, partial, or implemented differently.

2. **Architecture integrity**
   - Confirm the three-graph mental model is preserved.
   - Confirm draft, compile, promote, and snapshot boundaries are enforced.
   - Confirm accepted state cannot be mutated through unintended paths.

3. **Data integrity**
   - Check foreign references, transactions, deletion behavior, and snapshot immutability.
   - Check stable IDs and repository-relative evidence paths.
   - Check line-range and confidence validation.

4. **MCP contract correctness**
   - Check tool registration, input validation, response shape, error handling, and diagnostics.
   - Check that documented tools are actually callable.

5. **Scanner correctness**
   - Check supported file selection and ignored directories.
   - Check entity and edge detection.
   - Check unresolved references and confidence behavior.
   - Check deterministic or stable behavior where promised.

6. **Compiler correctness**
   - Check required errors cannot degrade into warnings.
   - Check warning conditions are useful and do not block valid work.
   - Check promotion and snapshot gates cannot be bypassed.

7. **Failure behavior**
   - Inspect malformed input, missing files, invalid repositories, duplicate operations, and partial failures.
   - Check errors are actionable and do not corrupt stored state.

8. **Test quality**
   - Confirm tests assert behavior rather than only implementation details.
   - Look for missing negative tests and false-positive tests.
   - Run the full test suite and typecheck.

9. **Security and operational safety**
   - Check path traversal, accidental scanning outside the repository, command injection, unsafe temporary directories, secret leakage, and destructive filesystem behavior.

10. **Documentation**
    - Confirm README, agent guidance, tool contracts, and known limitations match actual behavior.

11. **Scope control**
    - Identify non-goal implementation, unnecessary complexity, and undocumented behavioral expansion.

### 10.3 Finding Severity

Use these priorities:

- **P0 Critical**: data loss, arbitrary command execution, secret exposure, or the main workflow is fundamentally unusable.
- **P1 High**: a required acceptance criterion fails, architecture invariants can be bypassed, or common usage produces incorrect state.
- **P2 Medium**: meaningful correctness, reliability, compatibility, or test gap with a practical failure scenario.
- **P3 Low**: localized quality or documentation issue with limited behavioral impact.

Do not report personal style preferences unless they create a concrete maintenance or correctness risk.

### 10.4 Finding Format

Each finding must include:

- priority and short title
- exact file and line when possible
- expected behavior
- observed behavior
- concrete failure scenario or evidence
- recommended direction, without requiring a specific implementation unless necessary

Example:

```text
[P1] Snapshot contents can change after commit
File: src/graph/compiler.ts:120

Expected: A committed snapshot is immutable.
Observed: The snapshot references live accepted rows instead of copied versioned rows.
Impact: Later promotions can alter the historical snapshot.
Recommendation: Persist snapshot-owned graph records or an immutable serialized representation.
```

If no actionable findings exist, state that clearly and list remaining test gaps or residual risks.

### 10.5 Review Output Order

The review response must be ordered as:

1. Findings, highest severity first
2. Open questions or assumptions
3. Acceptance-criteria coverage
4. Verification commands and results
5. Short overall assessment

The reviewer must not bury findings below a long summary.

## 11. Review Agent Prompt

Use this prompt for a fresh independent review agent:

```text
Perform an independent code review of BlockGraph MCP.

Read:
- docs/blockgraph-mcp-v0.1-prd.md
- CLAUDE.md
- CONTRIBUTING.md
- the actual source and tests

Use HOT.md only as an orientation aid; do not trust its completion claims without verification.

Do not modify files during the first review pass.

Review the implementation against every applicable PRD requirement and acceptance criterion. Check architecture invariants, SQLite integrity, MCP contracts, scanner behavior, compiler and promotion gates, snapshot immutability, failure behavior, path safety, test quality, documentation accuracy, and v0.1 scope control.

Run:
- pnpm test
- pnpm exec tsc --noEmit -p tsconfig.json
- the documented external repository smoke test when available

Report findings first, ordered P0 to P3. For each finding include an exact file/line reference, expected and observed behavior, a realistic failure scenario, and a recommended direction. Do not report style preferences without concrete impact.

Then provide:
- open questions or assumptions
- a checklist mapping every PRD acceptance criterion to PASS, PARTIAL, or FAIL with evidence
- exact verification commands and results
- a short overall assessment

If there are no findings, say so explicitly and identify residual risks or untested areas.
```

## 12. Review Resolution Protocol

After a review:

1. The implementation contributor records each finding.
2. The maintainer or primary contributor marks it:
   - accepted
   - rejected with reason
   - deferred with target version
3. Accepted findings are fixed by one writer.
4. Relevant focused tests are added.
5. Full verification is rerun.
6. The independent reviewer verifies the fixes without expanding scope.

A milestone is complete only when:

- no P0 or P1 finding remains
- accepted P2 findings are fixed or explicitly deferred by a maintainer
- required tests and typecheck pass
- acceptance criteria are evidenced
- documentation reflects actual behavior

## 13. Community Conduct

Keep technical discussion specific, evidence-based, and respectful.

- Critique behavior and design, not people.
- State assumptions.
- Prefer reproducible examples.
- Treat uncertainty as useful information.
- Do not pressure contributors to accept unverified automated output.
- Human and agent contributions are held to the same correctness and review standards.

As the community grows, maintainers may add a separate code of conduct and governance policy.
