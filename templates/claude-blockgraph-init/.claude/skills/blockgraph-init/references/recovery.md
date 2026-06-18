# Recovery

Use this reference when starting, resuming, after compaction, or after any `NO_SESSION` error.

## What Persists

BlockGraph stores graph data in:

```text
<target-repo>/.blockgraph/blockgraph.db
```

An MCP server restart can lose the in-memory database handle, but graph data may still exist.

## Start Or Resume Checklist

1. Confirm target repository path.
2. Call `begin_initialization({ repo_path })` or `resume_initialization({ repo_path })`.
3. Call `session_status`.
4. Call `list_work_packages`.
5. Call `list_module_proposals`.
6. Call `list_merged_proposals`.
7. Call `coverage_report`.
8. Call `quality_gate_report`.

Continue from the first incomplete unit:

- planned/assigned work package
- draft/submitted/reviewing/needs_revision proposal
- approved but unmerged proposal
- merged but unpromoted block
- graph with failing quality gate

## Do Not Duplicate

Before creating new artifacts, check whether they already exist:

- work package IDs
- proposal IDs
- merged proposal mappings
- block names and code mappings
- flows

If an artifact exists, continue it instead of recreating it.

## After Context Compression

Reload only what is needed:

1. `SKILL.md`
2. `references/recovery.md`
3. `references/workflow.md` only if the current phase is unclear
4. `references/error-handling.md` only if a tool failed
5. `references/issue-reporting.md` if the previous run recorded issues or blockers

Then inspect MCP state.

## Resume With Existing Issues

If `.blockgraph/issues/` exists, inspect unresolved blocker reports before continuing. Resolved issues may explain prior workarounds and should be considered when interpreting current graph state.
