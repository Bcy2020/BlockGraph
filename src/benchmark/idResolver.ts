/**
 * BlockGraph MCP v0.2.7 — ID Resolution
 * Resolves MCP-specific IDs (UUIDs, wp-*, scanner IDs) to canonical forms.
 * v0.2.7: Improved path normalization, alias matching, diagnostics.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface GraphIndex {
  blocks: GraphIndexBlock[];
  entities: GraphIndexEntity[];
  ports?: GraphIndexPort[];
  connectors?: GraphIndexConnector[];
  flows?: GraphIndexFlow[];
  provenance?: {
    source_db_path: string;
    export_timestamp: string;
    graph_index_source: "live_db" | "synthetic" | "fixture";
  };
}

export interface GraphIndexBlock {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  mapped_entities: string[];
}

export interface GraphIndexEntity {
  canonical_id: string;
  raw_ids: string[];
  file_path: string;
  symbol_name: string;
  kind: string;
  line?: number;
}

export interface GraphIndexPort {
  id: string;
  block_id: string;
  block_name: string;
  name: string;
  direction: "in" | "out";
  contract: string;
}

export interface GraphIndexConnector {
  id: string;
  source_port_id: string;
  source_block_name: string;
  target_port_id: string;
  target_block_name: string;
  protocol: string;
}

export interface GraphIndexFlow {
  id: string;
  name: string;
  entrypoint_entity_id: string;
  steps: Array<{
    order: number;
    block_id: string;
    block_name: string;
    code_entity_id: string;
    entity_canonical_id: string;
    trigger: string;
  }>;
}

export interface ResolvedId {
  canonical: string;
  method: ResolutionMethod;
  raw: string;
}

export type ResolutionMethod =
  | "exact"
  | "normalized"
  | "slug"
  | "uuid"
  | "scanner_id"
  | "alias"
  | "wp_prefix"
  | "case_insensitive"
  | "partial"
  | "same_file"
  | "fixture_prefix_stripped"
  | "absolute_path_converted"
  | "unresolved";

export interface ResolutionDiagnostics {
  resolved_blocks: ResolvedId[];
  unresolved_blocks: ResolvedId[];
  resolved_entities: ResolvedId[];
  unresolved_entities: ResolvedId[];
  resolved_files: ResolvedId[];
  unresolved_files: ResolvedId[];
  resolution_methods: Record<string, number>;
}

// ── Block Resolution ──────────────────────────────────────────────────────

/**
 * Resolve a block ID to its canonical form.
 * Handles: UUID, wp-*, slug, name, case-insensitive, partial match, candidate:* format.
 */
export function resolveBlockId(
  raw: string,
  graphIndex?: GraphIndex,
): ResolvedId {
  // Handle candidate:* format from suggest_block_candidates
  if (raw.startsWith("candidate:")) {
    const candidateName = raw.slice("candidate:".length);
    // Try to match against graph index blocks
    if (graphIndex && graphIndex.blocks.length > 0) {
      // Exact name match
      for (const block of graphIndex.blocks) {
        if (block.name === candidateName || block.name.toLowerCase() === candidateName.toLowerCase()) {
          return { canonical: block.name, method: "exact", raw };
        }
      }
      // Alias match
      for (const block of graphIndex.blocks) {
        if (block.aliases.some((a) => a.toLowerCase() === candidateName.toLowerCase())) {
          return { canonical: block.name, method: "alias", raw };
        }
      }
    }
    // If no graph index or no match, return the candidate name as canonical
    return { canonical: candidateName, method: "normalized", raw };
  }

  if (!graphIndex || graphIndex.blocks.length === 0) {
    return { canonical: raw, method: "unresolved", raw };
  }

  // 1. Exact match on id or name
  for (const block of graphIndex.blocks) {
    if (block.id === raw || block.name === raw) {
      return { canonical: block.name, method: "exact", raw };
    }
  }

  // 2. Alias match
  for (const block of graphIndex.blocks) {
    if (block.aliases.some((a) => a === raw)) {
      return { canonical: block.name, method: "alias", raw };
    }
  }

  // 3. UUID match (block id looks like UUID)
  if (isUuid(raw)) {
    for (const block of graphIndex.blocks) {
      if (block.id === raw) {
        return { canonical: block.name, method: "uuid", raw };
      }
    }
  }

  // 4. wp-* prefix normalization
  if (raw.startsWith("wp-")) {
    const normalized = raw.replace(/^wp-/, "").replace(/-/g, " ");
    for (const block of graphIndex.blocks) {
      const blockSlug = block.slug.replace(/-/g, " ");
      if (normalized === blockSlug || normalized === block.name.toLowerCase()) {
        return { canonical: block.name, method: "wp_prefix", raw };
      }
    }
  }

  // 5. Slug match
  for (const block of graphIndex.blocks) {
    if (block.slug === raw) {
      return { canonical: block.name, method: "slug", raw };
    }
  }

  // 6. Case-insensitive match
  const rawLower = raw.toLowerCase();
  for (const block of graphIndex.blocks) {
    if (block.name.toLowerCase() === rawLower || block.slug.toLowerCase() === rawLower) {
      return { canonical: block.name, method: "case_insensitive", raw };
    }
  }

  // 7. Partial match (one contains the other)
  for (const block of graphIndex.blocks) {
    const blockLower = block.name.toLowerCase();
    if (blockLower.includes(rawLower) || rawLower.includes(blockLower)) {
      return { canonical: block.name, method: "partial", raw };
    }
  }

  return { canonical: raw, method: "unresolved", raw };
}

// ── Entity Resolution ─────────────────────────────────────────────────────

/**
 * Resolve an entity ID to its canonical form.
 * Handles: scanner format (path:type:name:line), file#symbol, raw IDs.
 */
export function resolveEntityId(
  raw: string,
  graphIndex?: GraphIndex,
): ResolvedId {
  if (!graphIndex || graphIndex.entities.length === 0) {
    // No graph index — try basic normalization
    const normalized = normalizeEntityIdBasic(raw);
    // If we successfully normalized (e.g., scanner format -> canonical), treat as resolved
    if (normalized !== raw) {
      return { canonical: normalized, method: "scanner_id", raw };
    }
    // If already in canonical format (file#symbol), treat as resolved
    if (raw.includes("#") && !raw.includes(":")) {
      return { canonical: raw, method: "exact", raw };
    }
    return { canonical: raw, method: "unresolved", raw };
  }

  // 1. Exact match on canonical_id
  for (const entity of graphIndex.entities) {
    if (entity.canonical_id === raw) {
      return { canonical: entity.canonical_id, method: "exact", raw };
    }
  }

  // 2. Raw ID match (scanner IDs, aliases)
  for (const entity of graphIndex.entities) {
    if (entity.raw_ids.includes(raw)) {
      return { canonical: entity.canonical_id, method: "scanner_id", raw };
    }
  }

  // 3. Normalize and match
  const normalized = normalizeEntityIdBasic(raw);
  if (normalized !== raw) {
    for (const entity of graphIndex.entities) {
      if (entity.canonical_id === normalized) {
        return { canonical: entity.canonical_id, method: "scanner_id", raw };
      }
    }
  }

  // 4. Same-file match (scanner ID with same file path and matching symbol name)
  const rawParts = raw.split(":");
  if (rawParts.length >= 3) {
    const rawFile = rawParts[0];
    const rawSymbol = rawParts[2];
    for (const entity of graphIndex.entities) {
      if (entity.file_path === rawFile && entity.symbol_name === rawSymbol) {
        return { canonical: entity.canonical_id, method: "same_file", raw };
      }
    }
  }

  // 5. Case-insensitive canonical match
  const rawLower = raw.toLowerCase();
  for (const entity of graphIndex.entities) {
    if (entity.canonical_id.toLowerCase() === rawLower) {
      return { canonical: entity.canonical_id, method: "case_insensitive", raw };
    }
  }

  return { canonical: raw, method: "unresolved", raw };
}

// ── File Resolution ───────────────────────────────────────────────────────

/**
 * Resolve a file path to canonical form (repo-relative).
 * Handles:
 * - Windows backslash to forward slash
 * - Absolute path to repo-relative (when possible)
 * - Fixture prefix stripping (fixtures/name/src to src)
 */
export function resolveFileId(raw: string, repoPath?: string): ResolvedId {
  let normalized = raw.replace(/\\/g, "/");
  let method: ResolutionMethod = "exact";

  // Convert absolute path to repo-relative if repoPath is provided
  if (repoPath && normalized.startsWith(repoPath.replace(/\\/g, "/"))) {
    normalized = normalized.slice(repoPath.replace(/\\/g, "/").length);
    if (normalized.startsWith("/")) normalized = normalized.slice(1);
    method = "absolute_path_converted";
  }

  // Strip fixture prefix: fixtures/<name>/src/... → src/...
  if (normalized.startsWith("fixtures/")) {
    const parts = normalized.split("/");
    // Find the 'src' directory after fixtures/<name>/
    const srcIndex = parts.indexOf("src", 2);
    if (srcIndex > 0) {
      normalized = parts.slice(srcIndex).join("/");
      method = "fixture_prefix_stripped";
    } else if (parts.length >= 3) {
      // Try removing just the fixtures/<name>/ prefix
      normalized = parts.slice(2).join("/");
      method = "fixture_prefix_stripped";
    }
  }

  // Normalize case for comparison (but preserve original for display)
  if (method === "exact" && normalized !== raw) {
    method = "normalized";
  }

  return { canonical: normalized, method, raw };
}

// ── Resolution Diagnostics ────────────────────────────────────────────────

/**
 * Build resolution diagnostics for a set of predicted IDs.
 */
export function buildResolutionDiagnostics(
  predictedBlocks: Array<{ id: string }>,
  predictedEntities: Array<{ id: string }>,
  predictedFiles: Array<{ id: string }>,
  graphIndex?: GraphIndex,
  repoPath?: string,
): ResolutionDiagnostics {
  const resolved_blocks: ResolvedId[] = [];
  const unresolved_blocks: ResolvedId[] = [];
  const resolved_entities: ResolvedId[] = [];
  const unresolved_entities: ResolvedId[] = [];
  const resolved_files: ResolvedId[] = [];
  const unresolved_files: ResolvedId[] = [];
  const resolutionMethods: Record<string, number> = {};

  for (const item of predictedBlocks) {
    const resolved = resolveBlockId(item.id, graphIndex);
    resolutionMethods[resolved.method] = (resolutionMethods[resolved.method] ?? 0) + 1;
    if (resolved.method === "unresolved") {
      unresolved_blocks.push(resolved);
    } else {
      resolved_blocks.push(resolved);
    }
  }

  for (const item of predictedEntities) {
    const resolved = resolveEntityId(item.id, graphIndex);
    resolutionMethods[resolved.method] = (resolutionMethods[resolved.method] ?? 0) + 1;
    if (resolved.method === "unresolved") {
      unresolved_entities.push(resolved);
    } else {
      resolved_entities.push(resolved);
    }
  }

  for (const item of predictedFiles) {
    const resolved = resolveFileId(item.id, repoPath);
    resolutionMethods[resolved.method] = (resolutionMethods[resolved.method] ?? 0) + 1;
    resolved_files.push(resolved);
  }

  return {
    resolved_blocks,
    unresolved_blocks,
    resolved_entities,
    unresolved_entities,
    resolved_files,
    unresolved_files,
    resolution_methods: resolutionMethods,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Normalize scanner entity ID to canonical form.
 * Scanner: src/foo.ts:function:Name:7 → src/foo.ts#Name
 */
function normalizeEntityIdBasic(id: string): string {
  // Already in canonical format
  if (id.includes("#") && !id.includes(":")) return id;
  // Scanner format: path:type:name:line
  const parts = id.split(":");
  if (parts.length >= 3) {
    const filePath = parts[0];
    const name = parts[2];
    return `${filePath}#${name}`;
  }
  return id;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
