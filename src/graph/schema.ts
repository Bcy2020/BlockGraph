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

// ── v0.2 Types ─────────────────────────────────────────────────────────────

// §8.1 WorkPackage (PRD v0.2)
export type WorkPackageType =
  | "feature"
  | "app_shell"
  | "shared"
  | "ui"
  | "testing"
  | "config"
  | "infrastructure"
  | "unknown";

export type WorkPackageStatus =
  | "planned"
  | "assigned"
  | "proposed"
  | "reviewing"
  | "needs_revision"
  | "approved"
  | "merged"
  | "rejected"
  | "deferred";

export interface WorkPackage {
  id: string;
  name: string;
  type: WorkPackageType;
  status: WorkPackageStatus;
  scope_paths: string[];
  included_entity_ids: string[];
  excluded_entity_ids: string[];
  allowed_external_refs: string[];
  forbidden_ownership: string[];
  dependencies_on_packages: string[];
  owner_agent?: string;
  open_questions: string[];
  notes?: string;
}

// §9.1 ModuleProposal (PRD v0.2)
export type ModuleProposalStatus =
  | "draft"
  | "submitted"
  | "reviewing"
  | "needs_revision"
  | "approved"
  | "rejected"
  | "merged";

export interface ProposalEntity {
  code_entity_id: string;
  role: "owns" | "uses" | "entrypoint" | "adapter" | "helper" | "unknown";
  evidence: Evidence[];
  reason: string;
  confidence: number;
}

export interface ProposalPort {
  name: string;
  direction: "in" | "out";
  contract: string;
  evidence: Evidence[];
  confidence: number;
}

export type ProposalProtocol =
  | "function_call"
  | "http"
  | "event"
  | "state"
  | "render"
  | "config"
  | "type"
  | "unknown";

export interface ProposalDependency {
  target_work_package_id?: string;
  target_code_entity_id?: string;
  direction: "incoming" | "outgoing";
  protocol: ProposalProtocol;
  evidence: Evidence[];
  reason: string;
  confidence: number;
}

export interface ProposalFlowStep {
  order: number;
  code_entity_id: string;
  trigger: string;
  evidence: Evidence[];
  confidence: number;
}

export interface ProposalFlow {
  name: string;
  entrypoint_entity_id: string;
  steps: ProposalFlowStep[];
  confidence: number;
}

export type ProposalGapKind =
  | "missing_entity"
  | "unclear_ownership"
  | "missing_dependency"
  | "weak_evidence"
  | "needs_coordinator_decision"
  | "other";

export interface ProposalGap {
  kind: ProposalGapKind;
  related_entity_ids: string[];
  description: string;
  suggested_resolution?: string;
}

export interface ModuleProposal {
  id: string;
  work_package_id: string;
  module_name: string;
  module_type: WorkPackageType;
  purpose: string;
  owned_code_entities: ProposalEntity[];
  used_code_entities: ProposalEntity[];
  entrypoints: ProposalEntity[];
  ports: ProposalPort[];
  internal_flows: ProposalFlow[];
  outgoing_dependencies: ProposalDependency[];
  incoming_dependencies: ProposalDependency[];
  unknown_boundaries: ProposalUnknownBoundary[];
  coverage_gaps: ProposalGap[];
  confidence: number;
  status: ModuleProposalStatus;
}

export interface ProposalUnknownBoundary {
  related_entity_ids: string[];
  reason: string;
  evidence: Evidence[];
}

// §10.1 ProposalReview (PRD v0.2)
export type ProposalReviewStatus = "pass" | "needs_revision" | "reject";

export type FindingPriority = "P0" | "P1" | "P2" | "P3";

export type FindingResolution = "open" | "resolved" | "rejected" | "deferred";

export interface ReviewFinding {
  priority: FindingPriority;
  title: string;
  description: string;
  file_path?: string;
  start_line?: number;
  code_entity_id?: string;
  expected: string;
  observed: string;
  recommendation: string;
  resolution?: FindingResolution;
  resolution_reason?: string;
}

export interface ProposalReview {
  id: string;
  proposal_id: string;
  reviewer_agent?: string;
  status: ProposalReviewStatus;
  findings: ReviewFinding[];
  coverage_notes: string;
  evidence_notes: string;
  recommended_fixes: string[];
}

// §11.1 QualityGateReport (PRD v0.2)
export type RepoComplexity = "small" | "medium" | "complex";

export interface SharedDependencyCandidate {
  entity_id: string;
  file_path: string;
  name: string;
  used_by_packages: string[];
  recommendation: "own_shared_block" | "app_shell" | "ui_components" | "exclude";
}

export interface WeakConnector {
  connector_id: string;
  source_port_id: string;
  target_port_id: string;
  issue: string;
}

export interface MaintenanceSimulationResult {
  scenario: string;
  success: boolean;
  notes: string;
}

export interface QualityGateReport {
  id: string;
  created_at: string;
  repo_complexity: RepoComplexity;
  entity_coverage: number;
  runtime_entity_coverage: number;
  feature_directory_coverage: number;
  unmapped_entities: string[];
  unmapped_directories: string[];
  missing_feature_modules: string[];
  shared_dependency_candidates: SharedDependencyCandidate[];
  unexplained_cross_block_edges: string[];
  weak_connectors: WeakConnector[];
  flow_count: number;
  missing_flow_recommendations: string[];
  open_review_findings: string[];
  maintenance_simulation_results: MaintenanceSimulationResult[];
  ready_for_maintenance: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

// §8.4 Conflict Check Result (PRD v0.2)
export interface ConflictCheckResult {
  duplicate_ownership: Array<{
    code_entity_id: string;
    claiming_packages: string[];
  }>;
  scope_violations: Array<{
    package_id: string;
    entity_id: string;
    reason: string;
  }>;
  missing_dependencies: Array<{
    package_id: string;
    dependency: string;
  }>;
  undeclared_external_refs: Array<{
    package_id: string;
    entity_id: string;
  }>;
  unreviewed_proposals: string[];
}

// §12.4 Merged Proposal Mapping
export interface MergedProposalMapping {
  id: string;
  proposal_id: string;
  work_package_id: string;
  block_id: string;
  merged_at: string;
}
