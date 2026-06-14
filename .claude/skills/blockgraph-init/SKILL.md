# BlockGraph Initialization Skill

Initialize an architecture model for a repository using BlockGraph MCP tools.

## Core Rules

1. **NEVER write graph JSON directly.** Always call MCP tools.
2. **Compile each block before promotion.** Fix errors before calling `promote_draft_block`.
3. **Bind evidence for every non-root block.** Every non-root block needs at least one code entity mapping with valid evidence.
4. **Mark unknown boundaries instead of hiding uncertainty.** Use `mark_unknown_boundary` when unsure.

## Workflow

### Step 1: Start Session

```
Call blockgraph:begin_initialization with repo_path pointing to the target repository.
```

### Step 2: Scan Repository

```
Call blockgraph:scan_repo with repo_path.
```

### Step 3: Inspect Code Graph

```
Call blockgraph:list_code_entities to see all detected entities.
Call blockgraph:list_code_edges to see all detected edges.
```

Understand the repository structure before creating blocks.

### Step 4: Suggest Block Candidates (optional)

```
Call blockgraph:suggest_block_candidates with strategy "directory", "component", or "mixed".
```

Use the suggestions as a starting point for block decomposition.

### Step 5: Create Root Block

```
Call blockgraph:create_block with name and purpose.
```

The root block represents the overall feature. It does not need code entity mappings.

### Step 6: Create Child Blocks

```
Call blockgraph:create_block with name, purpose, and parent_id.
```

Create blocks for each meaningful business module.

### Step 7: Attach Code Entities

```
Call blockgraph:attach_code_entity with block_id, code_entity_id, role, and evidence.
```

Roles: owns, uses, entrypoint, adapter, helper.

Evidence requires: file_path (repo-relative), start_line (1-based), end_line (1-based), note (optional).

### Step 8: Create Ports

```
Call blockgraph:create_port with block_id, name, direction ("in"/"out"), and contract.
```

### Step 9: Connect Ports

```
Call blockgraph:connect_ports with source_port_id, target_port_id, protocol, and evidence.
```

Protocols: function_call, http, event, state, render, unknown.

### Step 10: Create Flows

```
Call blockgraph:create_flow with name and entrypoint_entity_id.
```

### Step 11: Add Flow Steps

```
Call blockgraph:append_flow_step with flow_id, block_id, code_entity_id, trigger, and evidence.
```

### Step 12: Compile Each Block

```
Call blockgraph:compile_draft_block for each non-root block.
Fix any errors and recompile until can_promote is true.
```

### Step 13: Promote Blocks

```
Call blockgraph:promote_draft_block for each compiled block.
```

### Step 14: Compile Graph

```
Call blockgraph:compile_draft_graph.
Fix any errors before proceeding.
```

### Step 15: Commit Snapshot

```
Call blockgraph:commit_snapshot with git_sha of the current commit.
```

## Error Reference

| Error | Meaning | Fix |
|-------|---------|-----|
| NO_SESSION | No active session | Call begin_initialization first |
| BLOCK_NOT_FOUND | Block ID doesn't exist | Check the block ID |
| ENTITY_NOT_FOUND | Code entity doesn't exist | Run scan_repo first |
| NO_CODE_MAPPING | Non-root block has no mappings | Attach at least one code entity |
| INVALID_EVIDENCE | Bad file path or line numbers | Check file_path and line numbers |
| MISSING_PORT | Connector references non-existent port | Check port IDs |
| EMPTY_NAME | Block name is empty | Provide a non-empty name |
| EMPTY_PURPOSE | Block purpose is empty | Provide a non-empty purpose |
