# Review Rubrics

Use this reference for proposal review and final graph review.

## Proposal Review Checklist

For one proposal, verify:

- Each owned entity is inside work package scope.
- Shared code is not incorrectly owned by a feature package.
- Used entities are declared as external refs or dependencies.
- Evidence paths exist and line ranges are plausible.
- Ports correspond to actual boundary interactions.
- Dependencies have direction, protocol, and evidence.
- Internal flows are supported by source code.
- External library behavior is not falsely attributed to local files.
- In-scope files/entities are not missing without a coverage gap.
- Unknown boundaries are marked instead of hidden.

## Finding Severity

Use:

- `P0`: impossible to merge safely, corrupts graph protocol, or blocks initialization.
- `P1`: wrong ownership, missing core entity, false dependency, false flow, or invalid evidence that would mislead maintenance.
- `P2`: incomplete but usable model, weak evidence, missing secondary flow, unclear naming.
- `P3`: style, naming, low-risk documentation issue.

P0/P1 findings must be resolved or explicitly rejected with reason before approval.

## Reviewer Independence

The reviewer must be independent from the module worker. The coordinator's own inspection is useful but does not count as independent proposal review.

## Final Review Checklist

After merge and quality gates, verify:

- Block boundaries match repository semantics.
- Important feature directories are modeled or explicitly deferred.
- Shared dependencies are modeled as shared modules or justified.
- Cross-block code edges have connectors or unknown boundaries.
- Flows cover important entrypoints.
- Quality gate findings are resolved or documented.
- Maintenance simulations are plausible and source-backed.

Report findings first, ordered by severity.

