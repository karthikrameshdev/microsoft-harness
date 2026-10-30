import * as path from 'node:path';
import * as os from 'node:os';
import type {
  HarnessSession,
  FoundryRegion,
  IncidentBriefOutput,
  ScorecardMetrics,
  HydraFusionTrace,
} from '../types/index.ts';
import {
  validateFoundryRegion,
  validateSkillReferences,
  validateCallerResponseSettings,
} from '../config/foundry-limits.ts';
import { ConversationWorkspace } from './workspace.ts';
import { BuiltinCapabilitiesManager } from './builtins.ts';
import { SkillEngine } from '../skills/skill-engine.ts';
import { ModelProviderPool } from '../orchestration/model-provider.ts';
import { ModelRouter } from '../orchestration/model-router.ts';
import { HydraFusionEngine } from '../orchestration/hydrafusion.ts';
import { IdempotencyManager } from '../security/idempotency.ts';
import { ConsequentialActionGate } from '../security/action-gate.ts';
import { TrustBoundary } from '../security/trust-boundary.ts';
import { DurableStateManager } from '../persistence/durable-state.ts';
import { MCPServer } from '../mcp/mcp-server.ts';
import { DeploymentService } from '../services/deployment-service.ts';
import { TelemetryService } from '../services/telemetry-service.ts';
import { IncidentService } from '../services/incident-service.ts';
import { IncidentBriefEvaluator } from '../evaluation/evaluator.ts';

export interface CreateHarnessOptions {
  conversationId: string;
  tenantId: string;
  region: string;
  workspaceBaseDir?: string;
  sqliteDbPath?: string;
  skillsDir?: string;
  callerSettings?: Record<string, unknown>;
}

export interface IncidentWorkflowRequest {
  serviceId: string;
  incidentWindow: {
    start: string;
    end: string;
  };
  createTicketOnApproval?: boolean;
  approvalToken?: string;
  idempotencyKey?: string;
}

export interface IncidentWorkflowResponse {
  session: HarnessSession;
  brief: IncidentBriefOutput;
  trace: HydraFusionTrace;
  scorecard: ScorecardMetrics;
  ticketResult?: unknown;
}

export class MicrosoftCopilotHarness {
  public readonly session: HarnessSession;
  public readonly workspace: ConversationWorkspace;
  public readonly builtins: BuiltinCapabilitiesManager;
  public readonly skillEngine: SkillEngine;
  public readonly modelPool: ModelProviderPool;
  public readonly router: ModelRouter;
  public readonly hydraFusion: HydraFusionEngine;
  public readonly idempotency: IdempotencyManager;
  public readonly actionGate: ConsequentialActionGate;
  public readonly durableState: DurableStateManager;
  public readonly mcpServer: MCPServer;

  // Domain services
  public readonly deploymentService: DeploymentService;
  public readonly telemetryService: TelemetryService;
  public readonly incidentService: IncidentService;

  constructor(options: CreateHarnessOptions) {
    // 1. Enforce Foundry Limits & Quotas
    const validatedRegion: FoundryRegion = validateFoundryRegion(options.region);
    if (options.callerSettings) {
      validateCallerResponseSettings(options.callerSettings);
    }

    const baseDir = options.workspaceBaseDir || path.join(os.tmpdir(), 'copilot-harness-workspaces');
    const workspaceDir = path.join(baseDir, options.conversationId);

    // 2. Initialize Workspace
    this.workspace = new ConversationWorkspace(options.conversationId, workspaceDir);

    // 3. Initialize Session
    this.session = {
      id: `sess-${options.conversationId}`,
      conversationId: options.conversationId,
      tenantId: options.tenantId,
      region: validatedRegion,
      workspaceDir: this.workspace.rootDir,
      sandboxState: 'allocated',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      store: true,
    };

    // 4. Initialize Core Modules
    this.builtins = new BuiltinCapabilitiesManager({ workspace: this.workspace });
    this.skillEngine = new SkillEngine(options.skillsDir);
    this.modelPool = new ModelProviderPool();
    this.router = new ModelRouter(this.modelPool);
    this.hydraFusion = new HydraFusionEngine(this.modelPool, this.router);
    this.idempotency = new IdempotencyManager();
    this.actionGate = new ConsequentialActionGate(this.idempotency);
    this.durableState = new DurableStateManager(options.sqliteDbPath || ':memory:');

    // 5. Initialize Domain Services & MCP Server
    this.deploymentService = new DeploymentService();
    this.telemetryService = new TelemetryService();
    this.incidentService = new IncidentService();

    this.mcpServer = new MCPServer({
      deploymentService: this.deploymentService,
      telemetryService: this.telemetryService,
      incidentService: this.incidentService,
      actionGate: this.actionGate,
    });

    // Save initial session
    this.durableState.saveSession(this.session);
  }

  /**
   * Executes the full reference workflow: Produce a Reviewed Incident Brief
   * (Described in Section 4 of Karthik Ramesh's blog)
   */
  public async executeIncidentWorkflow(
    req: IncidentWorkflowRequest
  ): Promise<IncidentWorkflowResponse> {
    const startTime = Date.now();
    const serviceId = req.serviceId;
    const window = req.incidentWindow;

    // Checkpoint 1: Scope Established
    this.durableState.recordCheckpoint(this.session.conversationId, 'scope_established', 'completed', {
      serviceId,
      window,
      tenantId: this.session.tenantId,
    });

    // Checkpoint 2: Evidence Collection & Trust Boundary Encapsulation
    const deployments = this.deploymentService.queryDeployments(serviceId, window.start, window.end);
    const metrics = this.telemetryService.queryMetrics(serviceId, window.start, window.end);
    const logs = this.telemetryService.queryLogs(serviceId, window.start, window.end);

    const evidenceItems = [
      ...deployments.map((d) =>
        TrustBoundary.encapsulateEvidence(
          `Deployment ${d.deploymentId} (${d.version}) by ${d.deployedBy}: ${d.notes}`,
          d.deploymentId,
          d.timestamp,
          { tenantId: this.session.tenantId, serviceId }
        )
      ),
      ...metrics.map((m) =>
        TrustBoundary.encapsulateEvidence(
          `Metric ${m.metricName} = ${m.value} ${m.unit}`,
          `metric-${m.metricName}-${m.timestamp}`,
          m.timestamp,
          { tenantId: this.session.tenantId, serviceId }
        )
      ),
      ...logs.map((l) =>
        TrustBoundary.encapsulateEvidence(
          `Log [${l.severity}] ${l.message}`,
          l.logId,
          l.timestamp,
          { tenantId: this.session.tenantId, serviceId }
        )
      ),
    ];

    const safePromptEvidence = TrustBoundary.formatEvidenceForPrompt(evidenceItems);

    this.durableState.recordCheckpoint(this.session.conversationId, 'evidence_collected', 'completed', {
      evidenceCount: evidenceItems.length,
    });

    // Checkpoint 3: Execute HydraFusion Multi-Model Workflow
    const workflowResult = await this.hydraFusion.executeWorkflow({
      task: `Produce a reviewed incident brief for service '${serviceId}' covering observed impact, timeline, contributing changes, unresolved questions, and next verification steps.`,
      context: safePromptEvidence,
      workspace: this.workspace,
      evidenceCount: evidenceItems.length,
    });

    if (workflowResult.trace.finalStatus !== 'success') {
      throw new Error(
        `HydraFusion workflow failed: ${workflowResult.trace.rejectionReasons?.join(', ')}`
      );
    }

    // Parse verified brief
    const brief: IncidentBriefOutput = JSON.parse(workflowResult.finalOutput);

    // Checkpoint 4: Gated External Write Action (if requested)
    let ticketResult: unknown = undefined;
    if (req.createTicketOnApproval) {
      const idempotencyKey = req.idempotencyKey || `ticket-key-${serviceId}-${window.start}`;
      const rpc = this.mcpServer.getRPCServer();

      const callResponse = await rpc.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'mcp_create_incident_ticket',
          arguments: {
            idempotencyKey,
            tenantId: this.session.tenantId,
            serviceId,
            title: `[Remediation] Incident Brief Follow-up for ${serviceId}`,
            briefSummary: brief.observedImpact,
            approvalToken: req.approvalToken,
          },
          authToken: { audience: 'copilot-harness-mcp' },
        },
      });

      if (callResponse?.result && (callResponse.result as any).content?.[0]?.text) {
        try {
          ticketResult = JSON.parse((callResponse.result as any).content[0].text);
        } catch {
          ticketResult = callResponse.result;
        }
      } else {
        ticketResult = callResponse?.result;
      }
    }

    // Checkpoint 5: Scorecard Evaluation
    const taskDuration = Date.now() - startTime;
    const knownDeployments = new Set(deployments.map((d) => d.deploymentId));
    const scorecard = IncidentBriefEvaluator.evaluateBrief(
      brief,
      {
        targetServiceId: serviceId,
        incidentWindow: window,
        knownValidDeployments: knownDeployments,
        unauthorizedWriteAttempts: 0,
      },
      taskDuration,
      workflowResult.trace.totalCostUsd
    );

    this.durableState.recordCheckpoint(this.session.conversationId, 'workflow_completed', 'completed', {
      scorecard,
    });

    return {
      session: this.session,
      brief,
      trace: workflowResult.trace,
      scorecard,
      ticketResult,
    };
  }

  public teardown(): void {
    this.workspace.teardown();
    this.durableState.close();
  }
}
