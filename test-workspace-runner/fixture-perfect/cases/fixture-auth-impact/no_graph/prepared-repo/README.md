# BlockGraph Claude Code Initialization Template

This template is meant to be copied into a target repository before running BlockGraph initialization or benchmark preparation.

Copy both items into the target repository root:

```text
.claude/
.mcp.json
```

`.mcp.json` must live at the repository root because Claude Code project MCP servers are configured there, not inside `.claude/`.

The included `.mcp.json` assumes this BlockGraph MCP repository is available at:

```text
E:/repos/kuang-tu_MCP
```

It starts the MCP server through:

```text
pnpm --dir E:/repos/kuang-tu_MCP exec tsx src/mcp/server.ts
```

Before using the template, make sure dependencies are installed in the BlockGraph MCP repository:

```text
pnpm install
```

## Recommended Claude Code Startup

From the target repository:

```text
/mcp
```

Confirm the `blockgraph` server is enabled.

Then start initialization with:

```text
Use the blockgraph-init skill to initialize this repository with BlockGraph MCP.
Use auto-mode. Use module workers and independent proposal reviewers. As soon as any module proposal is submitted, launch a separate reviewer for that proposal while the remaining module workers continue.
```

## Important Design

- The coordinator is the only agent that merges proposals, promotes blocks, and commits snapshots.
- Module workers and proposal reviewers may use MCP tools when Claude Code exposes them.
- The custom agents intentionally omit a `tools:` allowlist so they inherit the main session tools, including `mcp__blockgraph__*`.
- If a subagent cannot access MCP tools, it should return structured JSON and the coordinator should perform the MCP writes.

