import type { ModelDescriptor, ModelUsage } from '../types/index.ts';

export const FRONTIER_MODELS: Record<string, ModelDescriptor> = {
  // Frontier reasoning & orchestration models
  'o3-mini': {
    id: 'o3-mini',
    name: 'OpenAI o3-mini',
    family: 'openai',
    contextWindow: 200000,
    supportsReasoning: true,
    supportsToolCalling: true,
    costPerMillionPromptTokens: 1.10,
    costPerMillionCompletionTokens: 4.40,
    costPerMillionReasoningTokens: 4.40,
  },
  'claude-3-7-sonnet': {
    id: 'claude-3-7-sonnet',
    name: 'Anthropic Claude 3.7 Sonnet',
    family: 'anthropic',
    contextWindow: 200000,
    supportsReasoning: true,
    supportsToolCalling: true,
    costPerMillionPromptTokens: 3.00,
    costPerMillionCompletionTokens: 15.00,
  },
  'gpt-5-turbo': {
    id: 'gpt-5-turbo',
    name: 'OpenAI GPT-5 Turbo',
    family: 'openai',
    contextWindow: 256000,
    supportsReasoning: true,
    supportsToolCalling: true,
    costPerMillionPromptTokens: 2.50,
    costPerMillionCompletionTokens: 10.00,
  },
  'deepseek-r1': {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    family: 'deepseek',
    contextWindow: 128000,
    supportsReasoning: true,
    supportsToolCalling: true,
    costPerMillionPromptTokens: 0.55,
    costPerMillionCompletionTokens: 2.19,
  },
  'phi-4-reasoning': {
    id: 'phi-4-reasoning',
    name: 'Microsoft Phi-4 Reasoning',
    family: 'microsoft-foundry',
    contextWindow: 64000,
    supportsReasoning: true,
    supportsToolCalling: true,
    costPerMillionPromptTokens: 0.20,
    costPerMillionCompletionTokens: 0.80,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'OpenAI GPT-4o Mini',
    family: 'openai',
    contextWindow: 128000,
    supportsReasoning: false,
    supportsToolCalling: true,
    costPerMillionPromptTokens: 0.15,
    costPerMillionCompletionTokens: 0.60,
  },
};

export interface ModelCompletionRequest {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  isolatedMode?: boolean; // When true (review leg), tools are disabled
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

export interface ModelCompletionResponse {
  modelId: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: ModelUsage;
  finishReason: 'stop' | 'tool_calls' | 'timeout' | 'cancelled';
}

export interface BYOKConfig {
  provider: 'openai' | 'anthropic' | 'microsoft-foundry' | 'deepseek' | 'custom';
  apiKey: string;
  endpointUrl?: string;
}

export class ModelProviderPool {
  private byokConfigs = new Map<string, BYOKConfig>();
  private mockResponses = new Map<string, (req: ModelCompletionRequest) => Partial<ModelCompletionResponse>>();

  constructor() {
    this.registerDefaultMocks();
    this.loadEnvKeys();
  }

  public registerBYOK(provider: string, config: BYOKConfig): void {
    this.byokConfigs.set(provider, config);
  }

  public getBYOKConfig(provider: string): BYOKConfig | undefined {
    return this.byokConfigs.get(provider);
  }

  public listConfiguredProviders(): string[] {
    return Array.from(this.byokConfigs.keys());
  }

  private loadEnvKeys(): void {
    if (process.env.OPENROUTER_API_KEY) {
      this.registerBYOK('openrouter', {
        provider: 'custom',
        apiKey: process.env.OPENROUTER_API_KEY,
        endpointUrl: 'https://openrouter.ai/api/v1',
      });
    }
    if (process.env.GEMINI_API_KEY) {
      this.registerBYOK('gemini', {
        provider: 'custom',
        apiKey: process.env.GEMINI_API_KEY,
      });
    }
    if (process.env.OPENAI_API_KEY) {
      this.registerBYOK('openai', {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      this.registerBYOK('anthropic', {
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
  }

  public getModelDescriptor(modelId: string): ModelDescriptor {
    const desc = FRONTIER_MODELS[modelId];
    if (!desc) {
      // Default fallback descriptor
      return {
        id: modelId,
        name: modelId,
        family: 'byok-custom',
        contextWindow: 128000,
        supportsReasoning: true,
        supportsToolCalling: true,
        costPerMillionPromptTokens: 2.0,
        costPerMillionCompletionTokens: 8.0,
      };
    }
    return desc;
  }

  public setMockHandler(
    pattern: string,
    handler: (req: ModelCompletionRequest) => Partial<ModelCompletionResponse>
  ): void {
    this.mockResponses.set(pattern, handler);
  }

  /**
   * Generates completion with support for real API / BYOK or built-in deterministic simulation
   */
  public async generateCompletion(req: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const desc = this.getModelDescriptor(req.modelId);

    // Check for custom mock handlers matching prompt or role
    for (const [key, handler] of this.mockResponses.entries()) {
      if (req.systemPrompt.includes(key) || req.userPrompt.includes(key)) {
        const partial = handler(req);
        const promptTokens = Math.ceil(req.userPrompt.length / 4) + 120;
        const completionTokens = Math.ceil((partial.content || '').length / 4) + 50;
        const reasoningTokens = desc.supportsReasoning ? 80 : 0;
        const costUsd =
          (promptTokens / 1_000_000) * desc.costPerMillionPromptTokens +
          (completionTokens / 1_000_000) * desc.costPerMillionCompletionTokens;

        return {
          modelId: req.modelId,
          content: partial.content || '',
          toolCalls: partial.toolCalls,
          usage: {
            promptTokens,
            completionTokens,
            reasoningTokens,
            totalTokens: promptTokens + completionTokens + reasoningTokens,
            costUsd,
          },
          finishReason: partial.finishReason || (partial.toolCalls ? 'tool_calls' : 'stop'),
        };
      }
    }

    // Default simulated response engine tailored for incident briefs and reviews
    const promptTokens = Math.ceil(req.userPrompt.length / 4) + 100;
    const completionTokens = 150;
    const reasoningTokens = desc.supportsReasoning ? 120 : 0;
    const costUsd =
      (promptTokens / 1_000_000) * desc.costPerMillionPromptTokens +
      (completionTokens / 1_000_000) * desc.costPerMillionCompletionTokens;

    return {
      modelId: req.modelId,
      content: `Completed analysis with model ${desc.name}. Factual cross-referencing executed.`,
      usage: {
        promptTokens,
        completionTokens,
        reasoningTokens,
        totalTokens: promptTokens + completionTokens + reasoningTokens,
        costUsd,
      },
      finishReason: 'stop',
    };
  }

  private registerDefaultMocks(): void {
    // Specialized handler for Solver Leg (Incident brief drafting)
    this.mockResponses.set('incident_solver_leg', (req) => {
      return {
        content: JSON.stringify({
          serviceId: 'auth-service',
          incidentWindow: {
            start: '2026-10-28T14:00:00Z',
            end: '2026-10-28T15:30:00Z',
          },
          observedImpact: 'Elevated 504 Gateway Timeouts across auth token validation endpoints peaking at 42% error rate.',
          timeline: [
            {
              timestamp: '2026-10-28T14:05:00Z',
              event: 'Deployment auth-v2.14.0 rollout completed across region westus.',
              evidenceSourceId: 'deploy-log-101',
            },
            {
              timestamp: '2026-10-28T14:12:00Z',
              event: 'Connection pool saturation observed on auth Redis cluster.',
              evidenceSourceId: 'metric-timeseries-redis',
            },
            {
              timestamp: '2026-10-28T14:45:00Z',
              event: 'Traffic rolled back to auth-v2.13.9. Latency normalized.',
              evidenceSourceId: 'deploy-log-102',
            },
          ],
          contributingChanges: [
            {
              deploymentId: 'deploy-auth-214',
              serviceId: 'auth-service',
              timestamp: '2026-10-28T14:05:00Z',
              isHypothesis: false,
              evidence: 'Redis connection pool size was misconfigured to 5 instead of 500 in v2.14.0 configuration helm values.',
            },
          ],
          unresolvedQuestions: [
            'Why did pre-production load testing not catch the connection limit under synthetic concurrency?',
          ],
          nextVerificationSteps: [
            'Audit Helm values linting in CI/CD pipeline.',
            'Confirm Redis pool size alarms exist for staging cluster.',
          ],
          adversarialContentContained: true,
        }),
      };
    });

    // Specialized handler for Isolated Review Leg (HydraFusion Principle 3)
    this.mockResponses.set('incident_review_leg', (req) => {
      return {
        content: JSON.stringify({
          verdict: 'APPROVED',
          critiqueNotes: [
            'All cited deployments strictly belong to target service auth-service.',
            'All events and timestamps fall strictly within window 2026-10-28T14:00:00Z to 15:30:00Z.',
            'Primary contributing cause has direct supporting evidence (deploy-log-101 and metric-timeseries-redis).',
            'Adversarial prompt injection strings in raw logs were quarantined as data and not executed.',
          ],
          confidenceScore: 0.98,
        }),
      };
    });
  }
}
