/**
 * Microsoft Copilot Harness & HydraFusion Core Types
 * Aligned with Microsoft Foundry Public Preview & GitHub Copilot SDK specifications
 */

export type FoundryRegion =
  | 'australiaeast'
  | 'canadacentral'
  | 'centralus'
  | 'germanywestcentral'
  | 'japaneast'
  | 'swedencentral'
  | 'uksouth'
  | 'westeurope'
  | 'westus';

export type NativeCapability =
  | 'file_read'
  | 'file_write'
  | 'shell'
  | 'web'
  | 'subagents';

export type SandboxState =
  | 'allocated'
  | 'idle'
  | 'resumed'
  | 'replaced'
  | 'torn_down';

export type ActionLifecycleState =
  | 'proposed'
  | 'authorized'
  | 'attempted'
  | 'confirmed'
  | 'unresolved';

export type TaskComplexity =
  | 'routine_extraction'
  | 'ambiguous_reasoning'
  | 'evidence_synthesis'
  | 'critical_decision';

export type WorkflowRole =
  | 'solver'
  | 'critic'
  | 'reviser'
  | 'escalation'
  | 'adjudicator';

export type LegStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'rejected';

export interface ModelDescriptor {
  id: string;
  name: string;
  family: 'openai' | 'anthropic' | 'microsoft-foundry' | 'deepseek' | 'byok-custom';
  contextWindow: number;
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  costPerMillionPromptTokens: number;
  costPerMillionCompletionTokens: number;
  costPerMillionReasoningTokens?: number;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface WorkflowLeg {
  id: string;
  role: WorkflowRole;
  modelId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  usage: ModelUsage;
  status: LegStatus;
  isolatedReview: boolean;
  critiqueNotes?: string[];
  output?: string;
  error?: string;
}

export interface HydraFusionTrace {
  workflowId: string;
  taskComplexity: TaskComplexity;
  legs: WorkflowLeg[];
  totalCostUsd: number;
  totalDurationMs: number;
  finalStatus: LegStatus;
  rejectionReasons?: string[];
  appliedPatchId?: string;
}

export interface HarnessSession {
  id: string;
  conversationId: string;
  tenantId: string;
  region: FoundryRegion;
  workspaceDir: string;
  sandboxState: SandboxState;
  createdAt: string;
  updatedAt: string;
  store: true;
}

export interface EvidenceItem {
  id: string;
  sourceId: string;
  timestamp: string;
  content: string;
  trustLevel: 'trusted' | 'untrusted';
  scope: {
    tenantId: string;
    serviceId: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  isNative: boolean;
}

export interface ToolCallRequest {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
  approvalToken?: string;
}

export interface ToolCallResult {
  toolCallId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  preconditions: string[];
  permittedSources: string[];
  outputSchema: Record<string, unknown>;
  instructions: string;
  rawMarkdown: string;
}

export interface ConsequentialAction {
  id: string;
  idempotencyKey: string;
  actionName: string;
  tenantId: string;
  serviceId: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  approvalToken?: string;
  status: ActionLifecycleState;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentBriefOutput {
  serviceId: string;
  incidentWindow: {
    start: string;
    end: string;
  };
  observedImpact: string;
  timeline: Array<{
    timestamp: string;
    event: string;
    evidenceSourceId: string;
  }>;
  contributingChanges: Array<{
    deploymentId: string;
    serviceId: string;
    timestamp: string;
    isHypothesis: boolean;
    evidence: string;
  }>;
  unresolvedQuestions: string[];
  nextVerificationSteps: string[];
  adversarialContentContained: boolean;
}

export interface ScorecardMetrics {
  factualFidelityScore: number;     // 0.0 - 1.0 (verified timestamps & service match)
  requiredCoverageScore: number;    // 0.0 - 1.0 (all required brief sections present)
  correctAbstentionRate: number;    // 0.0 - 1.0 (contradictions explicitly flagged)
  unauthorizedActionAttempts: number; // Must be 0 in safe systems
  duplicateWriteAttempts: number;   // Handled safely by idempotency
  latencyP50Ms: number;
  latencyP95Ms: number;
  totalTaskCostUsd: number;
  acceptedOutcome: boolean;
  costPerAcceptedOutcomeUsd: number;
}
