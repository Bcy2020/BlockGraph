# Error Handling

Use this reference whenever a BlockGraph MCP tool fails or state is ambiguous.

For significant new failures, also read `issue-reporting.md`.

## Common Errors

| Error | Action |
|---|---|
| `NO_SESSION` | Read `recovery.md`; call `begin_initialization` or `resume_initialization`; inspect `session_status`, `list_work_packages`, and `list_module_proposals`. |
| MCP server unavailable | Stop initialization and fix MCP config. Do not hand-write graph data. |
| `NOT_APPROVED` | Check proposal reviews; resolve P0/P1 findings; call `approve_module_proposal`; retry merge. |
| `UNRESOLVED_FINDING` | Return to revision. Do not merge. |
| `INVALID_TRANSITION` | Query current status and follow the state machine. Do not repeatedly try random status updates. |
| `DUPLICATE_OWNERSHIP` | Coordinator chooses one owner; other packages change relationship to `uses` or move code to shared module. |
| `SCOPE_VIOLATION` | Fix package scope or remove/convert out-of-scope owned entity. |
| `UNDECLARED_EXTERNAL_REF` | Add allowed external ref/dependency, or stop referencing that entity. |
| `INVALID_EVIDENCE` | Re-read source and fix repo-relative path and line range. |
| `PROPOSAL_NOT_FOUND` | Call `list_module_proposals`; do not recreate unless it truly does not exist. |
| `PACKAGE_ALREADY_MERGED` | Use existing merged block; do not create a second accepted module for the same package. |
| Quality gate not ready | Treat report as revision backlog. Do not snapshot unless every exception is explicitly deferred. |

## Recovery Discipline

When blocked:

1. Query current state.
2. Identify the exact failing invariant.
3. Fix the smallest graph artifact that violates it.
4. Re-run the failing tool.
5. Record any deferred limitation.
6. If the issue is new, recurring, or required a non-obvious workaround, write an issue report under `.blockgraph/issues/`.

Never bypass MCP by editing SQLite or JSON.

## Degraded Mode

Use degraded direct graph mode only when proposal tooling is unavailable. Record:

- reason for degradation
- skipped proposal/review steps
- risks introduced
- follow-up needed

Do not claim degraded runs completed the v0.2 proposal/review protocol.

## When To Report An Issue

Write an issue report when:

- a tool contract appears missing or inconsistent
- documentation/skill instructions were insufficient
- a workflow required a workaround
- a bug blocked progress for more than one attempt
- an MCP/session/subagent behavior differed from the expected path
- quality gates exposed a systematic modeling gap

Use `issue-reporting.md` for the exact file format.
