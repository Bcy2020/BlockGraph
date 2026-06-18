# Issue Reporting

Use this reference when initialization reveals a new significant problem, workaround, blocker, documentation gap, tool contract gap, or unexpected Claude Code/MCP behavior.

## Where To Write Issues

Write issue reports inside the target repository:

```text
.blockgraph/issues/
```

Use Markdown files. `.blockgraph/` is normally local initialization state, so reports stay with the graph without polluting business source code.

File name format:

```text
YYYYMMDD-HHMM-<short-kebab-title>.md
```

Examples:

```text
.blockgraph/issues/20260618-1420-proposal-approval-workaround.md
.blockgraph/issues/20260618-1510-subagent-mcp-probe-failed.md
.blockgraph/issues/20260618-1605-quality-gate-shared-hooks-gap.md
```

## When To Report

Report when any of these happen:

- MCP tool behavior blocks or contradicts the documented workflow.
- The skill instructions are insufficient or ambiguous.
- A new workaround is needed.
- A blocker cannot be resolved within the current run.
- A recurring error requires repeated manual reasoning.
- Subagent, MCP, session, or permission behavior differs from expectation.
- The initialized graph needs a known limitation recorded for future benchmark interpretation.

Do not report ordinary proposal findings here. Proposal-specific source/model issues belong in `submit_proposal_review`. Use `.blockgraph/issues/` for workflow/tool/process issues.

## First Try To Resolve

Before reporting, attempt a bounded self-repair:

1. Query current MCP state.
2. Read the relevant reference file.
3. Retry the smallest valid operation once.
4. If needed, choose a documented fallback.
5. Continue if the fallback is safe.

Do not endlessly retry. After two failed attempts with the same root cause, write a blocker issue.

## Resolved Issue Template

Use this when the problem was handled and initialization can continue:

```markdown
# <Short Title>

Status: resolved
Severity: P1 | P2 | P3
Detected At: <ISO timestamp or local time>
Phase: <workflow phase>

## Summary

One paragraph describing what happened.

## Impact

What was blocked, slowed, or made risky.

## Evidence

- Tool call or command:
- Error code/message:
- Relevant files:
- Relevant proposal/work package IDs:

## Root Cause

Best current explanation. Mark as inference if uncertain.

## Resolution

What was changed or what workflow path solved it.

## Verification

What was run or checked after the fix.

## Follow-Up

Recommended change to BlockGraph MCP, the skill, docs, or benchmark assumptions.
```

## Blocker Issue Template

Use this when initialization cannot safely continue:

```markdown
# <Short Title>

Status: blocked
Severity: P0 | P1
Detected At: <ISO timestamp or local time>
Phase: <workflow phase>

## Summary

One paragraph describing the blocker.

## Blocking Condition

What cannot proceed and why.

## Attempts

1. Attempt:
   Result:
2. Attempt:
   Result:

## Evidence

- Tool call or command:
- Error code/message:
- Relevant files:
- Relevant proposal/work package IDs:

## Needed Decision Or Fix

What must change before continuing.

## Safe Resume Point

What state was last known valid and which MCP queries should be run after resuming.
```

## Final Report Requirement

At the end of initialization, mention:

- number of issue reports written
- unresolved blockers
- resolved workflow issues that may affect benchmark interpretation

