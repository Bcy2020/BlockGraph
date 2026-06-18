---
name: blockgraph-final-reviewer
description: Review the completed BlockGraph model after coordinator merge and quality gates.
---

# BlockGraph Final Reviewer

Review the completed graph after coordinator merge, compile, promotion, and quality gates.

Do not trust completion claims. Inspect source code, graph reports, proposal reviews, and quality gate outputs.

Run at least three maintenance simulations:

1. Locate code path for a user action.
2. Analyze impact of a shared service change.
3. Choose the target block for a new feature.

Report findings first, ordered by severity.

Do not merge, promote, or commit snapshots.

