/**
 * BlockGraph MCP v0.1 — Data Model Types
 * Matches PRD §8 exactly.
 */

// §8.10 Evidence
export interface Evidence {
  file_path: string;
  start_line: number;
  end_line: number;
  code_entity_id?: string;
  note?: string;
}

// §8.1 CodeEntity
export type CodeEntityType =
  | "file"
  | "function"
  | "class"
  | "method"
  | "component"
  | "route"
  | "api_call"
  | "event_handler";

export interface CodeEntity {
  id: string;
  type: CodeEntityType;
  name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  metadata: Record<string, unknown>;
}

// §8.2 CodeEdge
export type CodeEdgeType =
  | "imports"
  | "calls"
  | "renders"
  | "handles_event"
  | "fetches";

export interface CodeEdge {
  id: string;
  type: CodeEdgeType;
  source_entity_id: string;
  target_entity_id: string | null;
  confidence: number;
  evidence: Evidence[];
}

// §8.3 Block
export type BlockStatus = "draft" | "accepted" | "stale" | "disputed";

export interface Block {
  id: string;
  parent_id: string | null;
  name: string;
  purpose: string;
  status: BlockStatus;
  confidence: number;
}

// §8.4 BlockCodeMapping
export interface BlockCodeMapping {
  id: string;
  block_id: string;
  code_entity_id: string;
  role: string;
  evidence: Evidence[];
}

// §8.5 Port
export type PortDirection = "in" | "out";

export interface Port {
  id: string;
  block_id: string;
  name: string;
  direction: PortDirection;
  contract: string;
}

// §8.6 Connector
export interface Connector {
  id: string;
  source_port_id: string;
  target_port_id: string;
  protocol: string;
  evidence: Evidence[];
}

// §8.7 Flow
export type FlowStatus = "draft" | "accepted" | "stale" | "disputed";

export interface Flow {
  id: string;
  name: string;
  entrypoint_entity_id: string;
  status: FlowStatus;
}

// §8.8 FlowStep
export interface FlowStep {
  id: string;
  flow_id: string;
  order: number;
  block_id: string;
  code_entity_id: string;
  trigger: string;
  evidence: Evidence[];
}

// §8.9 UnknownBoundary
export type UnknownBoundaryStatus = "draft" | "accepted";

export interface UnknownBoundary {
  id: string;
  related_entity_ids: string[];
  reason: string;
  evidence: Evidence[];
  status: UnknownBoundaryStatus;
}

// §8.11 Snapshot
export interface Snapshot {
  id: string;
  git_sha: string;
  created_at: string;
  accepted_graph_version: string;
}

// §9 Diagnostic (shared across all MCP tools)
export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  code: string;
  message: string;
  entity_id?: string;
  severity: DiagnosticSeverity;
  suggested_fix?: string;
}

// Standard MCP tool response envelope
export interface ToolResponse<T = unknown> {
  ok: boolean;
  data?: T;
  errors?: Diagnostic[];
  warnings?: Diagnostic[];
}
