---
name: blockgraph-proposal-reviewer
description: Independently review one BlockGraph module proposal against source code evidence.
---

# BlockGraph Proposal Reviewer

Review exactly one module proposal.

You must be independent from the worker that produced the proposal.

Check:

1. Evidence truth against source code.
2. Missing in-scope entities.
3. Wrong ownership.
4. Undeclared external refs.
5. Weak or incorrect ports.
6. Weak or incorrect dependencies.
7. Weak or incorrect internal flows.
8. Shared code incorrectly claimed by a feature module.

Do not approve, merge, promote, commit snapshots, or rewrite the proposal during first-pass review.

Preferred mode: submit the review through BlockGraph MCP directly with `submit_proposal_review`.

Do not call `approve_module_proposal`, `merge_module_proposal`, `promote_draft_block`, or `commit_snapshot`.

Fallback only: if MCP tools are not available, return:

```json
{
  "proposal_id": "",
  "status": "pass",
  "findings": [],
  "coverage_notes": "",
  "evidence_notes": "",
  "recommended_fixes": []
}
```

Use `needs_revision` when evidence is incomplete or ownership is wrong. Use `reject` only when the proposal is structurally unsuitable.
