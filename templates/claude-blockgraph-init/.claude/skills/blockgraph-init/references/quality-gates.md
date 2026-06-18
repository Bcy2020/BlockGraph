# Quality Gates

Use this reference before declaring initialization ready or committing a snapshot.

## Required Checks

Run:

```text
compile_draft_graph
coverage_report
detect_missing_modules
detect_shared_dependencies
connector_audit
flow_sufficiency_check
quality_gate_report
```

## Snapshot Preconditions

Commit a snapshot only when:

- `compile_draft_graph` has no errors.
- `quality_gate_report.ready_for_maintenance` is true, or every exception is explicitly deferred.
- No open P0/P1 proposal review finding remains.
- All approved proposals that should be included are merged.
- Important blocks are promoted.
- Final independent review has no blocking findings.
- Maintenance simulations pass at least 2/3.

## Coverage Expectations

For complex repositories:

- entity coverage should be high enough to guide maintenance
- feature directories must be modeled or explicitly deferred
- shared types/utils/hooks/lib/config should be modeled or justified

Silent omissions are not allowed.

## Connector Expectations

High-confidence cross-block code edges must be explained by:

- a connector
- an unknown boundary
- a documented exclusion/deferred issue

Do not create connectors without evidence.

## Flow Expectations

Complex apps should include multiple flow categories:

- authentication or primary entry flow
- list/detail read flow
- create/update/delete mutation flow
- profile/settings/admin flow when present
- cross-feature integration flow when present

If runtime behavior occurs inside an external library, label it as external behavior.

