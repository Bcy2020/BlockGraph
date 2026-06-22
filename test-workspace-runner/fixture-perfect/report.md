# BlockGraph Benchmark Report

**Run ID:** run-6e171290
**Created:** 2026-06-21T15:04:00.090Z
**Benchmark Version:** 0.2.7
**Adapter:** fixture-perfect

## Aggregate Scores

**Overall Score:** 0.9915
**Cases:** 10 (0 failed)

### Score by Condition

| Condition | Overall | File F1 | Entity F1 | Block F1 | Flow Order | Evidence | Duration |
|-----------|---------|---------|-----------|----------|------------|----------|----------|
| no_graph | 0.9915 | 1 | 0.9919 | 0.9333 | 1 | 1 | 164ms |

## Per-Case Results

| Case | Condition | Overall | File F1 | Entity F1 | Block F1 | Top-1 File | Top-3 File | Evidence | Status |
|------|-----------|---------|---------|-----------|----------|------------|------------|----------|--------|
| fixture-api-endpoint-map | no_graph | 0.9907 | 1 | 0.9189 | 1 | 1 | 1 | 1 | ✅ |
| fixture-auth-impact | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-comment-submit-bug | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-component-prop-trace | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-discussion-cross-flow | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-error-handling-gaps | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-login-flow | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-orphaned-code | no_graph | 0.9238 | 1 | 1 | 0.3333 | 1 | 1 | 1 | ✅ |
| fixture-shared-dep-impact | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |
| fixture-team-feature-landing | no_graph | 1 | 1 | 1 | 1 | 1 | 1 | 1 | ✅ |

## Top-K Hit Rates

| Metric | Average |
|--------|---------|
| Top-1 File Hit | 1 |
| Top-3 File Hit | 1 |
| Top-5 File Hit | 1 |
| Top-1 Entity Hit | 1 |
| Top-3 Entity Hit | 1 |

## Evidence Validity

| Metric | Average |
|--------|---------|
| File Exists Rate | 1 |
| Line Valid Rate | 1 |
| Entity Valid Rate | 1 |
| Unsupported Claims | 0 |

## ID Resolution Diagnostics

| Metric | Average |
|--------|---------|
| Resolved Blocks | 0 |
| Unresolved Blocks | 4 |
| Resolved Entities | 6.4 |
| Unresolved Entities | 0 |

### Resolution Methods

| Method | Count |
|--------|-------|
| exact | 125 |
| unresolved | 40 |

## Warnings

- Unresolved blocks: Shared API Client, Auth, Discussions, Comments, Teams, Users
- Unresolved blocks: Auth, Shared API Client, Discussions, Comments, Teams, Users
- Unresolved blocks: Comments, Discussions
- Unresolved blocks: Discussions, Shared API Client
- Unresolved blocks: Discussions, Comments, Shared API Client
- Unresolved blocks: Auth, Comments, Discussions, Teams, Users
- Unresolved blocks: Auth, Shared API Client
- Unresolved blocks: Auth, Discussions, Comments, Teams, Users
- Missing required block(s): Shared Types
- Unresolved blocks: Shared API Client, Auth, Discussions, Comments, Teams, Users
- Unresolved blocks: Teams, Shared API Client, Shared Types

## Artifacts

- Run JSON: `run.json`
- Event Log: `events.jsonl`
- fixture-api-endpoint-map/no_graph: `cases/fixture-api-endpoint-map/no_graph/`
- fixture-auth-impact/no_graph: `cases/fixture-auth-impact/no_graph/`
- fixture-comment-submit-bug/no_graph: `cases/fixture-comment-submit-bug/no_graph/`
- fixture-component-prop-trace/no_graph: `cases/fixture-component-prop-trace/no_graph/`
- fixture-discussion-cross-flow/no_graph: `cases/fixture-discussion-cross-flow/no_graph/`
- fixture-error-handling-gaps/no_graph: `cases/fixture-error-handling-gaps/no_graph/`
- fixture-login-flow/no_graph: `cases/fixture-login-flow/no_graph/`
- fixture-orphaned-code/no_graph: `cases/fixture-orphaned-code/no_graph/`
- fixture-shared-dep-impact/no_graph: `cases/fixture-shared-dep-impact/no_graph/`
- fixture-team-feature-landing/no_graph: `cases/fixture-team-feature-landing/no_graph/`
