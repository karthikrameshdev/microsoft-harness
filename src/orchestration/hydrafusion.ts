import type {
  HydraFusionTrace,
  TaskComplexity,
  WorkflowLeg,
  LegStatus,
} from '../types/index.ts';
import type { ModelProviderPool } from './model-provider.ts';
import type { ModelRouter } from './model-router.ts';
import type { ConversationWorkspace } from '../core/workspace.ts';

export interface HydraFusionRunOptions {
  task: string;
  context: string;
  workspace: ConversationWorkspace;
  evidenceCount?: number;
  overallTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

export class HydraFusionEngine {
  private pool: ModelProviderPool;
  private router: ModelRouter;

  constructor(pool: ModelProviderPool, router: ModelRouter) {
    this.pool = pool;
    this.router = router;
  }

  public async executeWorkflow(options: HydraFusionRunOptions): Promise<{
    trace: HydraFusionTrace;
    finalOutput: string;
  }> {
    const startTime = Date.now();
    const legs: WorkflowLeg[] = [];

    // Principle 5: Validated routing
    const complexity: TaskComplexity = this.router.classifyTask(options.task, options.evidenceCount);
    const routing = this.router.routeWorkflow(complexity);

    // Principle 4: Fail-safe application snapshot
    options.workspace.createSnapshot();

    let solverOutput = '';
    let finalStatus: LegStatus = 'running';
    const rejectionReasons: string[] = [];

    try {
      // Leg 1: Solver Leg (Shared workspace context)
      const leg1Start = Date.now();
      const solverLeg: WorkflowLeg = {
        id: `leg-solver-${Date.now()}`,
        role: 'solver',
        modelId: routing.primaryModel,
        startTime: leg1Start,
        status: 'running',
        isolatedReview: false,
        usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0 },
      };
      legs.push(solverLeg);

      // Principle 2: Bounded execution
      const solverResponse = await this.executeBoundedLeg(
        solverLeg.modelId,
        'incident_solver_leg: You are an expert incident investigator and systems engineer.',
        `Task: ${options.task}\nEvidence Context:\n${options.context}`,
        routing.maxLegDurationMs,
        false
      );

      solverLeg.endTime = Date.now();
      solverLeg.durationMs = solverLeg.endTime - solverLeg.startTime;
      solverLeg.usage = solverResponse.usage;
      solverLeg.status = 'success';
      solverLeg.output = solverResponse.content;
      solverOutput = solverResponse.content;

      // Leg 2: Isolated Review Leg (HydraFusion Principle 3: Isolated Review)
      if (routing.requiresIsolatedReview) {
        const leg2Start = Date.now();
        const reviewLeg: WorkflowLeg = {
          id: `leg-review-${Date.now()}`,
          role: 'critic',
          modelId: routing.reviewerModel,
          startTime: leg2Start,
          status: 'running',
          isolatedReview: true, // Isolated, tool-less context!
          usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0 },
        };
        legs.push(reviewLeg);

        const reviewResponse = await this.executeBoundedLeg(
          reviewLeg.modelId,
          'incident_review_leg: You are an independent, isolated evaluation judge. You have no tool access and cannot modify repository state. Audit factual consistency, timestamps, and service scope.',
          `Proposed Output to Audit:\n${solverOutput}\n\nEvidence Context:\n${options.context}`,
          routing.maxLegDurationMs,
          true // isolatedMode: true
        );

        reviewLeg.endTime = Date.now();
        reviewLeg.durationMs = reviewLeg.endTime - reviewLeg.startTime;
        reviewLeg.usage = reviewResponse.usage;
        reviewLeg.output = reviewResponse.content;

        // Parse review verdict
        try {
          const parsedReview = JSON.parse(reviewResponse.content);
          if (parsedReview.verdict === 'APPROVED') {
            reviewLeg.status = 'success';
            reviewLeg.critiqueNotes = parsedReview.critiqueNotes;
            finalStatus = 'success';
          } else {
            reviewLeg.status = 'rejected';
            reviewLeg.critiqueNotes = parsedReview.critiqueNotes || ['Reviewer rejected output.'];
            finalStatus = 'rejected';
            rejectionReasons.push(...reviewLeg.critiqueNotes);
          }
        } catch {
          // If unstructured, check approval string
          if (reviewResponse.content.includes('APPROVED')) {
            reviewLeg.status = 'success';
            finalStatus = 'success';
          } else {
            reviewLeg.status = 'rejected';
            finalStatus = 'rejected';
            rejectionReasons.push('Reviewer did not explicitly approve the draft brief.');
          }
        }
      } else {
        finalStatus = 'success';
      }

      // Principle 4: Fail-safe application
      if (finalStatus !== 'success') {
        // Rollback workspace modifications
        options.workspace.rollback();
      }
    } catch (err: unknown) {
      finalStatus = 'failed';
      rejectionReasons.push(err instanceof Error ? err.message : String(err));
      // Principle 4: Rollback on exception
      options.workspace.rollback();
    }

    // Principle 1: Complete accounting
    const totalCostUsd = legs.reduce((acc, l) => acc + l.usage.costUsd, 0);
    const totalDurationMs = Date.now() - startTime;

    const trace: HydraFusionTrace = {
      workflowId: `hydra-${Date.now()}`,
      taskComplexity: complexity,
      legs,
      totalCostUsd,
      totalDurationMs,
      finalStatus,
      rejectionReasons: rejectionReasons.length > 0 ? rejectionReasons : undefined,
    };

    return {
      trace,
      finalOutput: finalStatus === 'success' ? solverOutput : '',
    };
  }

  private async executeBoundedLeg(
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
    isolatedMode: boolean
  ) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.pool.generateCompletion({
        modelId,
        systemPrompt,
        userPrompt,
        isolatedMode,
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
