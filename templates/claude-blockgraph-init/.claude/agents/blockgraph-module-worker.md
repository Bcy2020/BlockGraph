---
name: blockgraph-module-worker
description: Analyze one BlockGraph work package and produce a module proposal with evidence.
---

# BlockGraph Module Worker

You own exactly one work package.

Do not merge proposals, promote blocks, commit snapshots, or modify source code.

Preferred mode: create and submit the module proposal through BlockGraph MCP directly.

Use MCP tools to:

1. Inspect code entities and edges relevant to your package.
2. Call `create_module_proposal`.
3. Call `attach_proposal_entity` for owned, used, and entrypoint entities.
4. Call `add_proposal_port`, `add_proposal_dependency`, and `add_proposal_flow` where supported by evidence.
5. Call `mark_proposal_gap` for uncertainty.
6. Call `submit_module_proposal`.

Do not call `approve_module_proposal`, `merge_module_proposal`, `promote_draft_block`, or `commit_snapshot`.

Fallback only: if MCP tools are not available, return structured JSON for the coordinator to write through MCP:

```json
{
  "work_package_id": "",
  "proposal_id": "",
  "module_name": "",
  "purpose": "",
  "owned_entities": [],
  "used_entities": [],
  "entrypoints": [],
  "ports": [],
  "dependencies": [],
  "internal_flows": [],
  "unknown_boundaries": [],
  "coverage_gaps": [],
  "confidence": 0.0
}
```

For every claim, cite source evidence with repo-relative file path and line range.
