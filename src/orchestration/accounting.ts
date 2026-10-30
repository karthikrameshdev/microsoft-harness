import type { ModelUsage, WorkflowLeg } from '../types/index.ts';

/**
 * Microsoft Foundry & HydraFusion Cost Accounting
 * - Compute rates (starting Dec 2026): $0.0994 per vCPU-hr, $0.0118 per GiB-hr
 * - Model token rates: Aggregated across every workflow leg (drafting, critique, revision, retry)
 */

export const COMPUTE_RATES = {
  vCpuHourUsd: 0.0994,
  gibHourUsd: 0.0118,
};

export class CostAccounting {
  public static calculateComputeCost(
    vCpu: number,
    gibMemory: number,
    durationMs: number
  ): number {
    const hours = durationMs / (1000 * 60 * 60);
    const cpuCost = vCpu * COMPUTE_RATES.vCpuHourUsd * hours;
    const memCost = gibMemory * COMPUTE_RATES.gibHourUsd * hours;
    return cpuCost + memCost;
  }

  public static aggregateLegsUsage(legs: WorkflowLeg[]): ModelUsage {
    let promptTokens = 0;
    let completionTokens = 0;
    let reasoningTokens = 0;
    let costUsd = 0;

    for (const leg of legs) {
      promptTokens += leg.usage.promptTokens;
      completionTokens += leg.usage.completionTokens;
      reasoningTokens += leg.usage.reasoningTokens;
      costUsd += leg.usage.costUsd;
    }

    return {
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens: promptTokens + completionTokens + reasoningTokens,
      costUsd,
    };
  }

  /**
   * Metric from Section 11 of Karthik Ramesh's blog:
   * Cost per accepted outcome = total experiment cost / outcomes accepted under predefined rubric
   */
  public static calculateCostPerAcceptedOutcome(
    totalExperimentCostUsd: number,
    acceptedOutcomesCount: number
  ): number {
    if (acceptedOutcomesCount <= 0) {
      return totalExperimentCostUsd;
    }
    return totalExperimentCostUsd / acceptedOutcomesCount;
  }
}
