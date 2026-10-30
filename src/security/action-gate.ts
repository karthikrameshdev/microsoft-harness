import type { ConsequentialAction } from '../types/index.ts';
import type { IdempotencyManager } from './idempotency.ts';

export class ActionAuthorizationError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(`[Action Authorization Error] ${message}`);
    this.name = 'ActionAuthorizationError';
    this.code = code;
  }
}

export interface ActionExecutionContext {
  tenantId: string;
  allowedServices: string[];
  validApprovalTokens: Set<string>;
}

export class ConsequentialActionGate {
  private idempotency: IdempotencyManager;
  constructor(idempotency: IdempotencyManager) {
    this.idempotency = idempotency;
  }

  public async executeGuardedAction<T>(
    action: {
      actionName: string;
      idempotencyKey: string;
      tenantId: string;
      serviceId: string;
      payload: Record<string, unknown>;
      requiresApproval: boolean;
      approvalToken?: string;
    },
    context: ActionExecutionContext,
    handler: (payload: Record<string, unknown>) => Promise<T>
  ): Promise<{ status: 'confirmed' | 'cached' | 'proposed'; result?: T; error?: string }> {
    // 1. Check Idempotency Key
    const existing = this.idempotency.getAction(action.idempotencyKey);
    if (existing) {
      if (existing.status === 'confirmed') {
        // Return existing result without repeating external side effect!
        return { status: 'cached', result: existing.result as T };
      }
      if (existing.status === 'attempted') {
        throw new ActionAuthorizationError(
          `Action '${action.actionName}' with idempotency key '${action.idempotencyKey}' is already in-flight.`,
          'ACTION_IN_FLIGHT'
        );
      }
    }

    // 2. Validate Tenant Isolation Boundary
    if (action.tenantId !== context.tenantId) {
      throw new ActionAuthorizationError(
        `Cross-tenant violation: Action tenant '${action.tenantId}' does not match authenticated session tenant '${context.tenantId}'.`,
        'CROSS_TENANT_VIOLATION'
      );
    }

    // 3. Validate Service Scope Boundary
    if (!context.allowedServices.includes('*') && !context.allowedServices.includes(action.serviceId)) {
      throw new ActionAuthorizationError(
        `Service scope violation: Action target service '${action.serviceId}' is not permitted in this context.`,
        'SERVICE_SCOPE_VIOLATION'
      );
    }

    // 4. Validate Human-in-the-Loop Operator Approval Gate
    if (action.requiresApproval) {
      if (!action.approvalToken || !context.validApprovalTokens.has(action.approvalToken)) {
        // Record as proposed action awaiting human review
        const proposedAction: ConsequentialAction = {
          id: `act-${Date.now()}`,
          idempotencyKey: action.idempotencyKey,
          actionName: action.actionName,
          tenantId: action.tenantId,
          serviceId: action.serviceId,
          payload: action.payload,
          requiresApproval: true,
          status: 'proposed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.idempotency.recordAction(proposedAction);

        return {
          status: 'proposed',
          error: `Action '${action.actionName}' requires explicit human operator approval token before execution.`,
        };
      }
    }

    // 5. Authorized - Transition to Attempted -> Execute -> Confirmed
    const authorizedAction: ConsequentialAction = {
      id: `act-${Date.now()}`,
      idempotencyKey: action.idempotencyKey,
      actionName: action.actionName,
      tenantId: action.tenantId,
      serviceId: action.serviceId,
      payload: action.payload,
      requiresApproval: action.requiresApproval,
      approvalToken: action.approvalToken,
      status: 'attempted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.idempotency.recordAction(authorizedAction);

    try {
      const result = await handler(action.payload);
      this.idempotency.updateState(action.idempotencyKey, 'confirmed', result);
      return { status: 'confirmed', result };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.idempotency.updateState(action.idempotencyKey, 'unresolved', undefined, errMsg);
      throw new ActionAuthorizationError(`Action execution failed: ${errMsg}`, 'EXECUTION_FAILED');
    }
  }
}
