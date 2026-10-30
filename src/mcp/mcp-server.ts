import type { ToolDefinition } from '../types/index.ts';
import { validateFunctionTool } from '../config/foundry-limits.ts';
import type { DeploymentService } from '../services/deployment-service.ts';
import type { TelemetryService } from '../services/telemetry-service.ts';
import type { IncidentService } from '../services/incident-service.ts';
import type { ConsequentialActionGate } from '../security/action-gate.ts';
import { JSONRPCServer } from './jsonrpc.ts';

export interface MCPServerOptions {
  deploymentService: DeploymentService;
  telemetryService: TelemetryService;
  incidentService: IncidentService;
  actionGate: ConsequentialActionGate;
  expectedAudience?: string;
}

export class MCPServer {
  private rpcServer = new JSONRPCServer();
  private tools = new Map<string, ToolDefinition>();
  private expectedAudience: string;

  private options: MCPServerOptions;

  constructor(options: MCPServerOptions) {
    this.options = options;
    this.expectedAudience = options.expectedAudience || 'copilot-harness-mcp';
    this.registerStandardTools();
    this.setupRPCMethods();
  }

  public getRPCServer(): JSONRPCServer {
    return this.rpcServer;
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  private registerStandardTools(): void {
    const definitions: ToolDefinition[] = [
      {
        name: 'mcp_query_deployments',
        description: 'Query deployment history for a target service and time window.',
        inputSchema: {
          type: 'object',
          properties: {
            serviceId: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
          },
          required: ['serviceId', 'startTime', 'endTime'],
        },
        requiresApproval: false,
        isNative: false,
      },
      {
        name: 'mcp_query_telemetry',
        description: 'Query metric time-series for a service in an incident window.',
        inputSchema: {
          type: 'object',
          properties: {
            serviceId: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
          },
          required: ['serviceId', 'startTime', 'endTime'],
        },
        requiresApproval: false,
        isNative: false,
      },
      {
        name: 'mcp_query_logs',
        description: 'Query error and warning logs for a service during an incident.',
        inputSchema: {
          type: 'object',
          properties: {
            serviceId: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
          },
          required: ['serviceId', 'startTime', 'endTime'],
        },
        requiresApproval: false,
        isNative: false,
      },
      {
        name: 'mcp_create_incident_ticket',
        description: 'Create an official follow-up incident remediation ticket.',
        inputSchema: {
          type: 'object',
          properties: {
            idempotencyKey: { type: 'string' },
            tenantId: { type: 'string' },
            serviceId: { type: 'string' },
            title: { type: 'string' },
            briefSummary: { type: 'string' },
            approvalToken: { type: 'string' },
          },
          required: ['idempotencyKey', 'tenantId', 'serviceId', 'title', 'briefSummary'],
        },
        requiresApproval: true, // Consequential write! Requires human approval gate
        isNative: false,
      },
    ];

    for (const tool of definitions) {
      // Validate with Foundry function tool preview rules
      validateFunctionTool(tool.name, tool.inputSchema);
      this.tools.set(tool.name, tool);
    }
  }

  private setupRPCMethods(): void {
    // Protocol method: tools/list
    this.rpcServer.registerMethod('tools/list', async () => {
      return { tools: this.listTools() };
    });

    // Protocol method: tools/call
    this.rpcServer.registerMethod('tools/call', async (params: {
      name: string;
      arguments: Record<string, any>;
      authToken?: { audience: string };
    }) => {
      // 1. Validate Audience-bound token (MCP security guidance)
      if (params.authToken && params.authToken.audience !== this.expectedAudience) {
        throw new Error(
          `[MCP Security Error] Audience mismatch. Expected '${this.expectedAudience}', got '${params.authToken.audience}'. Token passthrough denied.`
        );
      }

      const tool = this.tools.get(params.name);
      if (!tool) {
        throw new Error(`MCP tool '${params.name}' not found.`);
      }

      const args = params.arguments || {};

      switch (params.name) {
        case 'mcp_query_deployments': {
          const res = this.options.deploymentService.queryDeployments(
            args.serviceId,
            args.startTime,
            args.endTime
          );
          return { content: [{ type: 'text', text: JSON.stringify(res) }] };
        }

        case 'mcp_query_telemetry': {
          const res = this.options.telemetryService.queryMetrics(
            args.serviceId,
            args.startTime,
            args.endTime
          );
          return { content: [{ type: 'text', text: JSON.stringify(res) }] };
        }

        case 'mcp_query_logs': {
          const res = this.options.telemetryService.queryLogs(
            args.serviceId,
            args.startTime,
            args.endTime
          );
          return { content: [{ type: 'text', text: JSON.stringify(res) }] };
        }

        case 'mcp_create_incident_ticket': {
          // Guarded by ConsequentialActionGate
          const executionContext = {
            tenantId: String(args.tenantId),
            allowedServices: [String(args.serviceId)],
            validApprovalTokens: new Set(['operator-token-approved-2026', 'human-lead-override']),
          };

          const gateResult = await this.options.actionGate.executeGuardedAction(
            {
              actionName: 'create_incident_ticket',
              idempotencyKey: String(args.idempotencyKey),
              tenantId: String(args.tenantId),
              serviceId: String(args.serviceId),
              payload: args,
              requiresApproval: true,
              approvalToken: args.approvalToken ? String(args.approvalToken) : undefined,
            },
            executionContext,
            async (payload) => {
              return this.options.incidentService.createTicket({
                idempotencyKey: String(payload.idempotencyKey),
                tenantId: String(payload.tenantId),
                serviceId: String(payload.serviceId),
                title: String(payload.title),
                briefSummary: String(payload.briefSummary),
              });
            }
          );

          return { content: [{ type: 'text', text: JSON.stringify(gateResult) }] };
        }

        default:
          throw new Error(`Unhandled MCP tool '${params.name}'.`);
      }
    });
  }
}
