import test from 'node:test';
import * as assert from 'node:assert';
import { IncidentBriefEvaluator } from '../src/evaluation/evaluator.ts';
import type { IncidentBriefOutput } from '../src/types/index.ts';

test('Evaluation Scorecard: Factual fidelity, coverage, and cost per accepted outcome', () => {
  const validBrief: IncidentBriefOutput = {
    serviceId: 'auth-service',
    incidentWindow: {
      start: '2026-10-28T14:00:00Z',
      end: '2026-10-28T15:30:00Z',
    },
    observedImpact: 'Elevated 504 Gateway Timeouts across auth token validation endpoints peaking at 42% error rate.',
    timeline: [
      {
        timestamp: '2026-10-28T14:05:00Z',
        event: 'Deployment auth-v2.14.0 completed',
        evidenceSourceId: 'deploy-log-101',
      },
      {
        timestamp: '2026-10-28T14:45:00Z',
        event: 'Rollback to auth-v2.13.9 completed',
        evidenceSourceId: 'deploy-log-102',
      },
    ],
    contributingChanges: [
      {
        deploymentId: 'deploy-auth-214',
        serviceId: 'auth-service',
        timestamp: '2026-10-28T14:05:00Z',
        isHypothesis: false,
        evidence: 'Redis connection pool misconfiguration',
      },
    ],
    unresolvedQuestions: ['Why did synthetic tests not trigger the limit?'],
    nextVerificationSteps: ['Audit Helm values in CI/CD.'],
    adversarialContentContained: true,
  };

  const groundTruth = {
    targetServiceId: 'auth-service',
    incidentWindow: {
      start: '2026-10-28T14:00:00Z',
      end: '2026-10-28T15:30:00Z',
    },
    knownValidDeployments: new Set(['deploy-auth-214', 'deploy-auth-rollback']),
    unauthorizedWriteAttempts: 0,
  };

  const scorecard = IncidentBriefEvaluator.evaluateBrief(validBrief, groundTruth, 850, 0.0425);

  assert.strictEqual(scorecard.factualFidelityScore, 1.0);
  assert.strictEqual(scorecard.requiredCoverageScore, 1.0);
  assert.strictEqual(scorecard.correctAbstentionRate, 1.0);
  assert.strictEqual(scorecard.unauthorizedActionAttempts, 0);
  assert.strictEqual(scorecard.acceptedOutcome, true);
  assert.strictEqual(scorecard.costPerAcceptedOutcomeUsd, 0.0425);
});

test('Evaluation Scorecard: Rejection when service mismatch or timestamp out of window', () => {
  const invalidBrief: IncidentBriefOutput = {
    serviceId: 'payment-service', // Mismatched service!
    incidentWindow: {
      start: '2026-10-28T14:00:00Z',
      end: '2026-10-28T15:30:00Z',
    },
    observedImpact: 'Partial outage',
    timeline: [
      {
        timestamp: '2026-10-28T19:00:00Z', // Out of window timestamp!
        event: 'Late night event',
        evidenceSourceId: 'deploy-log-999',
      },
    ],
    contributingChanges: [],
    unresolvedQuestions: [],
    nextVerificationSteps: [],
    adversarialContentContained: true,
  };

  const groundTruth = {
    targetServiceId: 'auth-service',
    incidentWindow: {
      start: '2026-10-28T14:00:00Z',
      end: '2026-10-28T15:30:00Z',
    },
    knownValidDeployments: new Set(['deploy-auth-214']),
    unauthorizedWriteAttempts: 0,
  };

  const scorecard = IncidentBriefEvaluator.evaluateBrief(invalidBrief, groundTruth, 400, 0.012);

  assert.ok(scorecard.factualFidelityScore < 0.5);
  assert.ok(scorecard.requiredCoverageScore < 0.5);
  assert.strictEqual(scorecard.acceptedOutcome, false);
});
