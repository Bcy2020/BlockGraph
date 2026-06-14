# Agent Initialization Skill Guide

This guide instructs agents on how to use BlockGraph MCP to initialize an architecture model for a repository.

## Core Rules

1. **NEVER write graph JSON directly.** Always call MCP tools.
2. **Always call MCP tools.** Do not attempt to write to the SQLite database directly.
3. **Compile each block before promotion.** Call `compile_draft_block` and fix any errors before calling `promote_draft_block`.
4. **Bind evidence for every non-root block.** Every non-root block must have at least one code entity mapping with valid evidence.
5. **Mark unknown boundaries instead of hiding uncertainty.** If you cannot confidently model a cross-block interaction, call `mark_unknown_boundary` with a reason.

## Initialization Workflow

### Step 1: Start a Session

```
Call begin_initialization({ repo_path: "/path/to/repo" })
```

This creates the SQLite storage at `.blockgraph/blockgraph.db` inside the repository.

### Step 2: Scan the Repository

```
Call scan_repo({ repo_path: "/path/to/repo" })
```

This generates the Code Fact Graph with code entities (files, functions, classes, components, event handlers, api calls) and code edges (imports, calls).

### Step 3: Inspect the Code Graph

```
Call list_code_entities({}) to see all detected entities
Call list_code_edges({}) to see all detected edges
```

Use this to understand the repository structure before creating blocks.

### Step 4: Create the Root Block

```
Call create_block({ name: "Feature Name", purpose: "Description of the feature" })
```

The root block represents the overall feature or domain. It does not need code entity mappings.

### Step 5: Create Child Blocks

```
Call create_block({ name: "UI Layer", purpose: "User interface components", parent_id: "<root_block_id>" })
Call create_block({ name: "Service Layer", purpose: "Business logic", parent_id: "<root_block_id>" })
Call create_block({ name: "Data Layer", purpose: "Data access", parent_id: "<root_block_id>" })
```

Create blocks for each meaningful business module. Group related code entities together.

### Step 6: Attach Code Entities

```
Call attach_code_entity({
  block_id: "<block_id>",
  code_entity_id: "<entity_id>",
  role: "owns",
  evidence: [{ file_path: "src/component.tsx", start_line: 1, end_line: 50, note: "Main component" }]
})
```

Attach each code entity to its owning block. Provide evidence with real file paths and line ranges.

**Roles:**
- `owns` — the block owns this code entity
- `uses` — the block uses this code entity
- `entrypoint` — this entity is an entry point to the block
- `adapter` — this entity adapts external interfaces
- `helper` — this entity provides helper functionality

### Step 7: Create Ports

```
Call create_port({
  block_id: "<block_id>",
  name: "portName",
  direction: "out",
  contract: "Natural language description of what crosses this boundary"
})
```

Ports represent block boundaries. Use `out` for outgoing interactions and `in` for incoming.

### Step 8: Connect Ports

```
Call connect_ports({
  source_port_id: "<out_port_id>",
  target_port_id: "<in_port_id>",
  protocol: "function_call",
  evidence: [{ file_path: "src/a.ts", start_line: 10, end_line: 15, note: "a calls b" }]
})
```

Connect ports to model cross-block interactions. Source must be `out`, target must be `in`.

**Protocols:** `function_call`, `http`, `event`, `state`, `render`, `unknown`

### Step 9: Create Flows

```
Call create_flow({
  name: "User Login Flow",
  entrypoint_entity_id: "<component_or_handler_id>"
})
```

Flows represent entrypoint-triggered business processes.

### Step 10: Add Flow Steps

```
Call append_flow_step({
  flow_id: "<flow_id>",
  block_id: "<block_id>",
  code_entity_id: "<entity_id>",
  trigger: "form submission",
  evidence: [{ file_path: "src/Login.tsx", start_line: 20, end_line: 25, note: "onSubmit handler" }]
})
```

Add steps in order. Each step must reference both a block and a code entity.

### Step 11: Compile and Fix

For each non-root block:

```
Call compile_draft_block({ block_id: "<block_id>" })
```

If there are errors:
- Fix the issue (add missing mappings, evidence, etc.)
- Recompile until `can_promote` is true

### Step 12: Promote Blocks

```
Call promote_draft_block({ block_id: "<block_id>" })
```

This moves the block and its associated entities from draft to accepted status.

### Step 13: Compile the Graph

```
Call compile_draft_graph({})
```

This validates the entire graph. Fix any errors before proceeding.

### Step 14: Commit Snapshot

```
Call commit_snapshot({ git_sha: "<current_commit_sha>" })
```

This creates an immutable snapshot of the accepted graph tied to the git commit.

## Evidence Requirements

Evidence is required for:
- Non-root block code entity mappings
- Connectors between ports
- Flow steps

Evidence must have:
- `file_path`: repo-relative path to the source file
- `start_line`: 1-based start line number
- `end_line`: 1-based end line number (must be >= start_line)
- `note` (optional): explanation of what the evidence shows

## Handling Uncertainty

If you cannot confidently model a cross-block interaction:

```
Call mark_unknown_boundary({
  related_entity_ids: ["<entity1_id>", "<entity2_id>"],
  reason: "Cannot determine if this is a direct call or event-based interaction",
  evidence: [{ file_path: "src/unknown.ts", start_line: 1, end_line: 10 }]
})
```

This is better than hiding uncertainty or creating incorrect connectors.

## Common Errors

| Error Code | Meaning | Fix |
|------------|---------|-----|
| `NO_SESSION` | No active session | Call `begin_initialization` first |
| `BLOCK_NOT_FOUND` | Block ID doesn't exist | Check the block ID |
| `ENTITY_NOT_FOUND` | Code entity doesn't exist | Run `scan_repo` first |
| `NO_CODE_MAPPING` | Non-root block has no mappings | Attach at least one code entity |
| `INVALID_EVIDENCE` | Evidence has bad file path or lines | Check file_path and line numbers |
| `MISSING_PORT` | Connector references non-existent port | Check port IDs |
| `EMPTY_NAME` | Block name is empty | Provide a non-empty name |
| `EMPTY_PURPOSE` | Block purpose is empty | Provide a non-empty purpose |
