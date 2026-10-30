import type { TaskComplexity } from '../types/index.ts';
import { FRONTIER_MODELS, type ModelProviderPool } from './model-provider.ts';

export interface RoutingDecision {
  primaryModel: string;
  reviewerModel: string;
  fallbackModel: string;
  requiresIsolatedReview: boolean;
  maxLegDurationMs: number;
}

export class ModelRouter {
  private pool: ModelProviderPool;
  constructor(pool: ModelProviderPool) {
    this.pool = pool;
  }

  public classifyTask(taskDescription: string, evidenceCount = 0): TaskComplexity {
    const lower = taskDescription.toLowerCase();

    // Critical decision: Incident briefs, external side-effects, database migration, production impact
    if (
      lower.includes('incident') ||
      lower.includes('outage') ||
      lower.includes('migration') ||
      lower.includes('production') ||
      lower.includes('consequential')
    ) {
      return 'critical_decision';
    }

    // Evidence synthesis: Cross-referencing telemetry, multi-file logs
    if (evidenceCount > 3 || lower.includes('cross-reference') || lower.includes('synthesize')) {
      return 'evidence_synthesis';
    }

    // Ambiguous reasoning: Contradictory records, root cause investigation
    if (lower.includes('contradiction') || lower.includes('root cause') || lower.includes('investigate')) {
      return 'ambiguous_reasoning';
    }

    // Routine extraction: Single record lookup, formatting, translation
    return 'routine_extraction';
  }

  /**
   * Validated Routing (HydraFusion Principle 5):
   * Selects model bindings and validates availability before execution begins.
   */
  public routeWorkflow(complexity: TaskComplexity): RoutingDecision {
    let decision: RoutingDecision;

    switch (complexity) {
      case 'critical_decision':
        decision = {
          primaryModel: 'claude-3-7-sonnet',
          reviewerModel: 'o3-mini', // High reasoning judge for isolated review
          fallbackModel: 'gpt-5-turbo',
          requiresIsolatedReview: true,
          maxLegDurationMs: 15000,
        };
        break;

      case 'evidence_synthesis':
        decision = {
          primaryModel: 'claude-3-7-sonnet',
          reviewerModel: 'o3-mini',
          fallbackModel: 'gpt-5-turbo',
          requiresIsolatedReview: true,
          maxLegDurationMs: 10000,
        };
        break;

      case 'ambiguous_reasoning':
        decision = {
          primaryModel: 'o3-mini',
          reviewerModel: 'deepseek-r1',
          fallbackModel: 'gpt-5-turbo',
          requiresIsolatedReview: false,
          maxLegDurationMs: 10000,
        };
        break;

      case 'routine_extraction':
      default:
        decision = {
          primaryModel: 'gpt-4o-mini',
          reviewerModel: 'gpt-4o-mini',
          fallbackModel: 'phi-4-reasoning',
          requiresIsolatedReview: false,
          maxLegDurationMs: 5000,
        };
        break;
    }

    // Pre-flight check: ensure models are registered in pool
    this.validateModelAvailability(decision.primaryModel);
    this.validateModelAvailability(decision.reviewerModel);
    this.validateModelAvailability(decision.fallbackModel);

    return decision;
  }

  private validateModelAvailability(modelId: string): void {
    const desc = this.pool.getModelDescriptor(modelId);
    if (!desc) {
      throw new Error(`[Validated Routing Error] Model '${modelId}' is not available in the model pool.`);
    }
  }
}
