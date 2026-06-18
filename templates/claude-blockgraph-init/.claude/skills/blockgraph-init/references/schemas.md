# Schemas

Use these schemas when subagents cannot write through MCP or when a structured handoff is needed.

## ModuleProposalDraft

```json
{
  "work_package_id": "wp-example",
  "proposal_id": "prop-example",
  "module_name": "Example Module",
  "module_type": "feature",
  "purpose": "What this module owns and why it exists.",
  "owned_entities": [
    {
      "code_entity_id": "entity-id",
      "role": "owns",
      "reason": "Why the module owns this entity.",
      "confidence": 0.9,
      "evidence": [
        {
          "file_path": "src/example.ts",
          "start_line": 1,
          "end_line": 20,
          "note": "Evidence note"
        }
      ]
    }
  ],
  "used_entities": [],
  "entrypoints": [],
  "ports": [
    {
      "name": "loadExample",
      "direction": "in",
      "contract": "What crosses the module boundary.",
      "confidence": 0.8,
      "evidence": []
    }
  ],
  "dependencies": [
    {
      "direction": "outgoing",
      "target_work_package_id": "wp-shared-api",
      "target_code_entity_id": "entity-id",
      "protocol": "function_call",
      "reason": "Why this dependency exists.",
      "confidence": 0.8,
      "evidence": []
    }
  ],
  "internal_flows": [
    {
      "name": "Example Flow",
      "entrypoint_entity_id": "entity-id",
      "confidence": 0.8,
      "steps": [
        {
          "order": 1,
          "code_entity_id": "entity-id",
          "trigger": "user action",
          "confidence": 0.8,
          "evidence": []
        }
      ]
    }
  ],
  "unknown_boundaries": [],
  "coverage_gaps": [
    {
      "kind": "missing_dependency",
      "related_entity_ids": [],
      "description": "What remains unclear.",
      "suggested_resolution": "How coordinator can resolve it."
    }
  ],
  "confidence": 0.8,
  "open_questions": []
}
```

## ProposalReviewDraft

```json
{
  "proposal_id": "prop-example",
  "reviewer_agent": "blockgraph-proposal-reviewer",
  "status": "pass",
  "findings": [
    {
      "priority": "P1",
      "title": "Finding title",
      "description": "What is wrong and why it matters.",
      "file_path": "src/example.ts",
      "start_line": 10,
      "code_entity_id": "entity-id",
      "expected": "What should be true.",
      "observed": "What the proposal actually says.",
      "recommendation": "Concrete fix."
    }
  ],
  "coverage_notes": "What was checked.",
  "evidence_notes": "Whether evidence is strong enough.",
  "recommended_fixes": []
}
```

Allowed review statuses:

```text
pass
needs_revision
reject
```

Use `pass` only when no blocking issue remains.

## FinalReviewReport

```json
{
  "status": "pass",
  "findings": [],
  "quality_gate_notes": "",
  "maintenance_simulations": [
    {
      "name": "Locate user action path",
      "result": "pass",
      "expected_path": [],
      "observed_path": [],
      "notes": ""
    }
  ],
  "snapshot_recommendation": "commit"
}
```

Allowed final statuses:

```text
pass
needs_revision
reject
```

